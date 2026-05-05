/**
 * Servicio de sesiones de clientes usando PostgreSQL local (pg Pool).
 * 100% independiente de Supabase.
 */
const db = require('../config/db');

const STATES = {
    PERFILANDO: 'PERFILANDO',
    ESPERANDO_VENDEDOR: 'ESPERANDO_VENDEDOR',
    CONFIRMANDO_COMPRA: 'CONFIRMANDO_COMPRA',
    ESPERANDO_COMPROBANTE: 'ESPERANDO_COMPROBANTE',
    ESPERANDO_APROBACION_ADMIN: 'ESPERANDO_APROBACION_ADMIN',
    PAGO_VERIFICADO: 'PAGO_VERIFICADO',
    ABONO_VERIFICADO: 'ABONO_VERIFICADO',
    ENCARGO_SOLICITADO: 'ENCARGO_SOLICITADO',
    ESPERANDO_SALDO: 'ESPERANDO_SALDO',
    ESPERANDO_RETIRO: 'ESPERANDO_RETIRO',
    ENTREGADO: 'ENTREGADO',
    CICLO_COMPLETO: 'CICLO_COMPLETO',
    ARCHIVADO: 'ARCHIVADO'
};

const INITIAL_ENTITIES = {
    marca_modelo: null,
    ano: null,
    patente: null,
    vin: null,
    motor: null,
    combustible: null,
    vehiculos: [],
    repuestos_solicitados: [],
    sintomas_reportados: null,
    metodo_pago: null,
    metodo_entrega: null,
    horario_entrega: null,
    direccion_envio: null,
    tipo_documento: null,
    total_cotizacion: null,
    quote_id: null,
    quote_id: null,
    nombre_cliente: null,
    email_cliente: null,
    rut_cliente: null,
    agente_pausado: false,
    saludo_dado: false,
    comprobante_url: null,
    datos_extraidos: null,
    datos_factura: { rut: null, razon_social: null, giro: null },
    pago_pendiente: {
        monto: null, banco_origen: null, fecha_transaccion: null,
        id_transaccion: null, rut_origen: null, nombre_origen: null,
        datos_extraidos_por_ia: true
    }
};

// ─── Helpers de deduplicación de repuestos ──────────────────────
/**
 * Elimina anotaciones vehiculares entre paréntesis al final del nombre.
 * "pastillas de freno delanteras (Nissan V16)" → "pastillas de freno delanteras"
 */
const stripVehicleAnnotation = (nombre) =>
    (nombre || '').replace(/\s*\([^)]*\)\s*$/, '').toLowerCase().trim();

// Calificadores que Gemini añade/quita al refinar nombres: no son parte del nombre canónico
const CALIFICADORES_RE = /\b(nuevo|nueva|estandar|estándar|standard|original|genérico|generico|genuino|alternativo|chino|china|coreano|coreana|korea|japones|japonesa|importado|reforzado|reforzada)\b/gi;

/**
 * Normaliza un nombre de repuesto para comparación: quita anotación de vehículo,
 * calificadores de marca/calidad y colapsa espacios.
 */
const normalizeRepuestoName = (nombre) =>
    stripVehicleAnnotation(nombre)
        .replace(CALIFICADORES_RE, '')
        .replace(/\s+/g, ' ')
        .trim();

// Stopwords en español para excluir de la comparación de repuestos
const STOPWORDS = new Set(['de', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'sin', 'a']);

/**
 * Compara dos nombres de repuesto para determinar si son el mismo ítem refinado.
 * Retorna 'exact' | 'refined' | 'similar' | false
 * - exact: mismo nombre canónico (después de strip + normalize)
 * - refined: uno contiene al otro como substring tras normalizar
 * - similar: comparten ≥75% de tokens significativos (sin stopwords)
 */
const isSameRepuesto = (nombreA, nombreB) => {
    const a = normalizeRepuestoName(nombreA);
    const b = normalizeRepuestoName(nombreB);
    if (!a || !b) return false;
    if (a === b) return 'exact';
    if (a.includes(b) || b.includes(a)) return 'refined';
    const tokensA = new Set(a.split(/\s+/).filter(t => !STOPWORDS.has(t)));
    const tokensB = new Set(b.split(/\s+/).filter(t => !STOPWORDS.has(t)));
    const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
    const smaller = Math.min(tokensA.size, tokensB.size);
    if (smaller > 0 && intersection / smaller >= 0.75) return 'similar';
    return false;
};

// ─── derivarSucursal ────────────────────────────────────────────
/**
 * Deriva la columna sucursal de user_sessions a partir de las entidades de la sesión.
 * - retiro + sucursal_retiro conocida → esa sucursal
 * - domicilio → 'Melipilla' (regla provisional: San Felipe sin cobertura de despacho aún)
 * - sin metodo_entrega → null (aún no se puede determinar)
 */
function derivarSucursal(entidades) {
    if (!entidades) return null;
    if (entidades.metodo_entrega === 'retiro' && entidades.sucursal_retiro) {
        return entidades.sucursal_retiro; // 'Melipilla' o 'San Felipe'
    }
    if (entidades.metodo_entrega === 'domicilio') {
        return 'Melipilla'; // regla provisional: domicilio → Melipilla mientras San Felipe se estabiliza
    }
    return null;
}

// ─── Caché en memoria ───────────────────────────────────────────
const sessionCache = new Map();
const CACHE_TTL = 5000;
let globalPendingCache = { data: null, timestamp: 0 };
const GLOBAL_CACHE_TTL = 2500;

// ─── invalidateSessionCache ──────────────────────────────────────
const invalidateSessionCache = (phone) => {
    sessionCache.delete(phone);
    globalPendingCache = { data: null, timestamp: 0 };
};

// ─── FUNCIÓN AUXILIAR: Mapear fila de DB al formato esperado ────
const rowToSession = (row) => ({
    id: row.id,
    phone: row.phone,
    estado: row.estado,
    entidades: typeof row.entidades === 'string' ? JSON.parse(row.entidades) : row.entidades,
    ultimo_mensaje: row.ultimo_mensaje,
    created_at: row.created_at,
    sucursal: row.sucursal || null,
    lock_vendedor: row.lock_vendedor || null,
    lock_expires_at: row.lock_expires_at || null
});

// ─── PERFIL DEL CLIENTE ─────────────────────────────────────────
const getClientProfile = async (phone) => {
    try {
        const { rows } = await db.query('SELECT * FROM clientes WHERE phone = $1', [phone]);
        return rows[0] || null;
    } catch (err) {
        console.error('[Sessions] ❌ Error en getClientProfile:', err.message);
        return null;
    }
};

const updateClientProfile = async (phone, data) => {
    try {
        const {
            nombre, email, rut, quote_id_to_archive,
            // Mejora #7: datos de venta para stats
            monto_venta, vehiculo_comprado
        } = data;

        const query = `
            INSERT INTO clientes (phone, nombre, email, rut)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (phone) DO UPDATE SET
                nombre = COALESCE(EXCLUDED.nombre, clientes.nombre),
                email = COALESCE(EXCLUDED.email, clientes.email),
                rut = COALESCE(EXCLUDED.rut, clientes.rut),
                updated_at = NOW()
            RETURNING *;
        `;

        await db.query(query, [phone, nombre, email, rut]);

        if (quote_id_to_archive) {
             await db.query(`
                UPDATE clientes
                SET historial_cotizaciones_ids = array_append(historial_cotizaciones_ids, $1)
                WHERE phone = $2
             `, [quote_id_to_archive, phone]);
        }

        // Mejora #7: incrementar stats de compras (solo si hay venta real archivada)
        if (quote_id_to_archive) {
            const montoNum = parseInt(monto_venta) || 0;
            const { rows } = await db.query(`
                UPDATE clientes
                SET total_compras = COALESCE(total_compras, 0) + 1,
                    total_gastado = COALESCE(total_gastado, 0) + $1,
                    ultima_compra = NOW(),
                    es_recurrente = (COALESCE(total_compras, 0) + 1) >= 2,
                    updated_at = NOW()
                WHERE phone = $2
                RETURNING total_compras, vehiculos_historicos
            `, [montoNum, phone]);

            // Acumular vehículo en el historial si es nuevo (dedup por marca_modelo+ano)
            if (vehiculo_comprado && (vehiculo_comprado.marca_modelo || vehiculo_comprado.ano)) {
                const historicos = Array.isArray(rows[0]?.vehiculos_historicos) ? rows[0].vehiculos_historicos : [];
                const yaExiste = historicos.some(v =>
                    (v.marca_modelo || '').toLowerCase() === (vehiculo_comprado.marca_modelo || '').toLowerCase() &&
                    String(v.ano || '') === String(vehiculo_comprado.ano || '')
                );
                if (!yaExiste) {
                    historicos.push({
                        marca_modelo: vehiculo_comprado.marca_modelo || null,
                        ano: vehiculo_comprado.ano || null,
                        patente: vehiculo_comprado.patente || null,
                        motor: vehiculo_comprado.motor || null,
                        ultima_compra: new Date().toISOString()
                    });
                    await db.query(`
                        UPDATE clientes SET vehiculos_historicos = $1 WHERE phone = $2
                    `, [JSON.stringify(historicos), phone]);
                }
            }
        }
    } catch (err) {
        console.error('[Sessions] ❌ Error en updateClientProfile:', err.message);
    }
};

// ─── getSession ─────────────────────────────────────────────────
const getSession = async (phone) => {
    const cached = sessionCache.get(phone);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.data;
    }

    try {
        const { rows } = await db.query(
            'SELECT * FROM user_sessions WHERE phone = $1',
            [phone]
        );

        let result;
        if (rows.length === 0) {
            // Buscar perfil preexistente del cliente
            const cliente = await getClientProfile(phone);
            
            const entidadesIniciales = { ...INITIAL_ENTITIES };
            if (cliente) {
                entidadesIniciales.nombre_cliente = cliente.nombre || null;
                entidadesIniciales.email_cliente = cliente.email || null;
                entidadesIniciales.rut_cliente = cliente.rut || null;
                // Mejora #7: cargar historial para que Gemini personalice trato
                entidadesIniciales.es_recurrente = cliente.es_recurrente || false;
                entidadesIniciales.total_compras = cliente.total_compras || 0;
                entidadesIniciales.vehiculos_historicos = Array.isArray(cliente.vehiculos_historicos)
                    ? cliente.vehiculos_historicos
                    : (typeof cliente.vehiculos_historicos === 'string'
                        ? JSON.parse(cliente.vehiculos_historicos || '[]')
                        : []);
            }

            // Crear sesión nueva
            const { rows: newRows } = await db.query(
                `INSERT INTO user_sessions (phone, estado, entidades, ultimo_mensaje)
                 VALUES ($1, $2, $3, NOW())
                 RETURNING *`,
                [phone, STATES.PERFILANDO, JSON.stringify(entidadesIniciales)]
            );
            result = rowToSession(newRows[0]);
        } else {
            result = rowToSession(rows[0]);
            // Mejora #7: hidratar historial de cliente si aún no está en entidades
            if (result.entidades && result.entidades.es_recurrente === undefined) {
                const cliente = await getClientProfile(phone);
                if (cliente) {
                    result.entidades.es_recurrente = cliente.es_recurrente || false;
                    result.entidades.total_compras = cliente.total_compras || 0;
                    result.entidades.vehiculos_historicos = Array.isArray(cliente.vehiculos_historicos)
                        ? cliente.vehiculos_historicos
                        : (typeof cliente.vehiculos_historicos === 'string'
                            ? JSON.parse(cliente.vehiculos_historicos || '[]')
                            : []);
                }
            }
        }

        sessionCache.set(phone, { data: result, timestamp: Date.now() });
        return result;
    } catch (err) {
        console.error('[Sessions] ❌ Error en getSession:', err.message);
        if (cached) return cached.data;
        throw err;
    }
};

// ─── updateEntidades ─────────────────────────────────────────────
const updateEntidades = async (phone, nuevasEntidades) => {
    try {
        const session = await getSession(phone);
        let entities = session.entidades || { ...INITIAL_ENTITIES };

        // MERGE inteligente de vehículos múltiples (HU-5)
        if (nuevasEntidades.vehiculos && Array.isArray(nuevasEntidades.vehiculos)) {
            if (!entities.vehiculos) entities.vehiculos = [];
            // MEJORA #4 fix: guardar las marcas que reciben patente en ESTE merge para saber cuál es la asignación reciente
            const marcasConPatenteNueva = new Set();
            nuevasEntidades.vehiculos.forEach(nv => {
                if (nv.patente && nv.marca_modelo) {
                    marcasConPatenteNueva.add(nv.marca_modelo);
                }
            });
            
            nuevasEntidades.vehiculos.forEach(nuevoVehiculo => {
                let targetAuto = entities.vehiculos.find(v => 
                    v.marca_modelo === nuevoVehiculo.marca_modelo && v.ano === nuevoVehiculo.ano
                );
                
                if (!targetAuto) {
                    entities.vehiculos.push(nuevoVehiculo);
                    targetAuto = entities.vehiculos[entities.vehiculos.length - 1];
                } else {
                    // MEJORA #4: Patente solo se asigna si el vehículo aún no la tiene + validación formato chileno
                    if (nuevoVehiculo.patente && !targetAuto.patente) {
                        const patenteNorm = nuevoVehiculo.patente.trim().toUpperCase().replace(/[-\s]/g, '');
                        const patenteValida = /^[A-Z]{2,4}\d{2,4}$/.test(patenteNorm);
                        if (patenteValida) {
                            targetAuto.patente = patenteNorm;
                        } else {
                            console.warn(`[Merge] ⚠️ Patente rechazada por formato inválido (vehículo ${targetAuto.marca_modelo}): "${nuevoVehiculo.patente}"`);
                        }
                    }
                    targetAuto.vin = nuevoVehiculo.vin || targetAuto.vin;
                    targetAuto.motor = nuevoVehiculo.motor || targetAuto.motor;
                    targetAuto.combustible = nuevoVehiculo.combustible || targetAuto.combustible;
                    
                    if (!targetAuto.repuestos_solicitados) targetAuto.repuestos_solicitados = [];
                    if (nuevoVehiculo.repuestos_solicitados && Array.isArray(nuevoVehiculo.repuestos_solicitados)) {
                        nuevoVehiculo.repuestos_solicitados.forEach(nuevoRep => {
                            // BUG-5: usar isSameRepuesto que strippea anotaciones vehiculares y usa similitud por tokens
                            const refinedIdx = targetAuto.repuestos_solicitados.findIndex(ext => {
                                const match = isSameRepuesto(nuevoRep.nombre, ext.nombre);
                                return match === 'refined' || match === 'similar';
                            });

                            if (refinedIdx !== -1) {
                                const viejo = targetAuto.repuestos_solicitados[refinedIdx];
                                // Preservar el nombre más específico (más largo después de strip)
                                const nombreFinal = stripVehicleAnnotation(nuevoRep.nombre).length >= stripVehicleAnnotation(viejo.nombre).length ? nuevoRep.nombre : viejo.nombre;
                                const cantidadFinal = viejo.cantidad_fijada
                                    ? (nuevoRep.cantidad != null ? nuevoRep.cantidad : (viejo.cantidad || 1))
                                    : (nuevoRep.cantidad != null ? nuevoRep.cantidad : (viejo.cantidad || 1));
                                targetAuto.repuestos_solicitados[refinedIdx] = {
                                    ...viejo, ...nuevoRep, nombre: nombreFinal,
                                    cantidad: cantidadFinal,
                                    estado: nuevoRep.estado || viejo.estado,
                                    precio: viejo.precio != null ? viejo.precio : (nuevoRep.precio !== undefined ? nuevoRep.precio : null),
                                    codigo: nuevoRep.codigo !== undefined ? nuevoRep.codigo : viejo.codigo,
                                    disponibilidad: nuevoRep.disponibilidad || viejo.disponibilidad
                                };
                                return;
                            }

                            const exactIdx = targetAuto.repuestos_solicitados.findIndex(e => isSameRepuesto(nuevoRep.nombre, e.nombre) === 'exact');
                            if (exactIdx !== -1) {
                                const viejoExact = targetAuto.repuestos_solicitados[exactIdx];
                                const cantidadFinalExact = viejoExact.cantidad_fijada
                                    ? (nuevoRep.cantidad != null ? nuevoRep.cantidad : (viejoExact.cantidad || 1))
                                    : (nuevoRep.cantidad != null ? nuevoRep.cantidad : (viejoExact.cantidad || 1));
                                targetAuto.repuestos_solicitados[exactIdx] = {
                                    ...viejoExact, ...nuevoRep,
                                    cantidad: cantidadFinalExact,
                                    estado: nuevoRep.estado || viejoExact.estado,
                                    precio: viejoExact.precio != null ? viejoExact.precio : (nuevoRep.precio !== undefined ? nuevoRep.precio : null),
                                    codigo: nuevoRep.codigo !== undefined ? nuevoRep.codigo : viejoExact.codigo,
                                    disponibilidad: nuevoRep.disponibilidad || viejoExact.disponibilidad
                                };
                            } else {
                                targetAuto.repuestos_solicitados.push(nuevoRep);
                            }
                        });
                    }
                }
            });

            // MEJORA #4: Detectar y limpiar patentes duplicadas entre vehículos
            // "Última asignación gana": si la patente fue recién asignada a un vehículo en este merge,
            // ese vehículo la conserva y se limpia del que la tenía antes (que probablemente la heredó por migración root).
            const patentesVistas = new Map(); // patente → índice del vehículo que la tiene
            for (let i = 0; i < entities.vehiculos.length; i++) {
                const v = entities.vehiculos[i];
                if (!v.patente) continue;
                const prevIdx = patentesVistas.get(v.patente);
                if (prevIdx !== undefined) {
                    const prevMarca = entities.vehiculos[prevIdx].marca_modelo;
                    const actualEsReciente = marcasConPatenteNueva.has(v.marca_modelo);
                    const prevEsReciente = marcasConPatenteNueva.has(prevMarca);
                    if (actualEsReciente && !prevEsReciente) {
                        // El vehículo actual recibió la patente en este merge → limpiar el anterior
                        console.warn(`[Merge] ⚠️ Patente "${v.patente}" reasignada: ${prevMarca} → ${v.marca_modelo}. Limpiando del anterior.`);
                        entities.vehiculos[prevIdx].patente = null;
                        patentesVistas.set(v.patente, i);
                    } else {
                        // El anterior tenía la patente antes (o ambiguo) → limpiar el actual
                        console.warn(`[Merge] ⚠️ Patente duplicada "${v.patente}" limpiada de ${v.marca_modelo}.`);
                        v.patente = null;
                    }
                } else {
                    patentesVistas.set(v.patente, i);
                }
            }

            delete nuevasEntidades.vehiculos;
        }

        // MEJORA #5: Auto-asignar repuestos huérfanos cuando hay exactamente 1 vehículo en la sesión
        if (Array.isArray(entities.vehiculos) && entities.vehiculos.length === 1 &&
            Array.isArray(nuevasEntidades.repuestos_solicitados) && nuevasEntidades.repuestos_solicitados.length > 0) {

            const unicoVehiculo = entities.vehiculos[0];
            if (!unicoVehiculo.repuestos_solicitados) unicoVehiculo.repuestos_solicitados = [];

            console.log(`[Merge] 🔀 Auto-asignando ${nuevasEntidades.repuestos_solicitados.length} repuesto(s) huérfano(s) al único vehículo: ${unicoVehiculo.marca_modelo || 'sin nombre'}`);

            // Procesar cada repuesto huérfano directamente en el vehículo (mismo merge que el existente)
            nuevasEntidades.repuestos_solicitados.forEach(huerfano => {
                const refinedIdx = unicoVehiculo.repuestos_solicitados.findIndex(ext => {
                    const match = isSameRepuesto(huerfano.nombre, ext.nombre);
                    return match === 'refined' || match === 'similar';
                });
                if (refinedIdx !== -1) {
                    const viejo = unicoVehiculo.repuestos_solicitados[refinedIdx];
                    const nombreFinal = stripVehicleAnnotation(huerfano.nombre).length >= stripVehicleAnnotation(viejo.nombre).length ? huerfano.nombre : viejo.nombre;
                    unicoVehiculo.repuestos_solicitados[refinedIdx] = {
                        ...viejo, ...huerfano, nombre: nombreFinal,
                        cantidad: huerfano.cantidad != null ? huerfano.cantidad : (viejo.cantidad || 1),
                        precio: viejo.precio != null ? viejo.precio : (huerfano.precio !== undefined ? huerfano.precio : null)
                    };
                } else {
                    const exactIdx = unicoVehiculo.repuestos_solicitados.findIndex(e => isSameRepuesto(huerfano.nombre, e.nombre) === 'exact');
                    if (exactIdx !== -1) {
                        const viejoExact = unicoVehiculo.repuestos_solicitados[exactIdx];
                        unicoVehiculo.repuestos_solicitados[exactIdx] = {
                            ...viejoExact, ...huerfano,
                            cantidad: huerfano.cantidad != null ? huerfano.cantidad : (viejoExact.cantidad || 1),
                            precio: viejoExact.precio != null ? viejoExact.precio : (huerfano.precio !== undefined ? huerfano.precio : null)
                        };
                    } else {
                        unicoVehiculo.repuestos_solicitados.push(huerfano);
                    }
                }
            });

            // Limpiar el array raíz — los repuestos ya están en el vehículo
            delete nuevasEntidades.repuestos_solicitados;
        }

        // MERGE inteligente de repuestos (Backward Compatibility)
        if (nuevasEntidades.repuestos_solicitados && Array.isArray(nuevasEntidades.repuestos_solicitados)) {
            if (!entities.repuestos_solicitados) entities.repuestos_solicitados = [];

            nuevasEntidades.repuestos_solicitados.forEach(nuevo => {
                // BUG-5: usar isSameRepuesto que strippea anotaciones vehiculares y usa similitud por tokens
                const refinedIdx = entities.repuestos_solicitados.findIndex(existente => {
                    const match = isSameRepuesto(nuevo.nombre, existente.nombre);
                    return match === 'refined' || match === 'similar';
                });

                if (refinedIdx !== -1) {
                    const viejo = entities.repuestos_solicitados[refinedIdx];
                    const nombreFinal = stripVehicleAnnotation(nuevo.nombre).length >= stripVehicleAnnotation(viejo.nombre).length ? nuevo.nombre : viejo.nombre;
                    const cantidadFinal = viejo.cantidad_fijada
                        ? (nuevo.cantidad != null ? nuevo.cantidad : (viejo.cantidad || 1))
                        : (nuevo.cantidad != null ? nuevo.cantidad : (viejo.cantidad || 1));
                    entities.repuestos_solicitados[refinedIdx] = {
                        ...viejo, ...nuevo, nombre: nombreFinal,
                        cantidad: cantidadFinal,
                        estado: nuevo.estado || viejo.estado,
                        precio: viejo.precio != null ? viejo.precio : (nuevo.precio !== undefined ? nuevo.precio : null),
                        codigo: nuevo.codigo !== undefined ? nuevo.codigo : viejo.codigo,
                        disponibilidad: nuevo.disponibilidad || viejo.disponibilidad
                    };
                    return;
                }

                const exactIdx = entities.repuestos_solicitados.findIndex(
                    e => isSameRepuesto(nuevo.nombre, e.nombre) === 'exact'
                );

                if (exactIdx !== -1) {
                    const viejoExact = entities.repuestos_solicitados[exactIdx];
                    const cantidadFinalExact = viejoExact.cantidad_fijada
                        ? (nuevo.cantidad != null ? nuevo.cantidad : (viejoExact.cantidad || 1))
                        : (nuevo.cantidad != null ? nuevo.cantidad : (viejoExact.cantidad || 1));
                    entities.repuestos_solicitados[exactIdx] = {
                        ...viejoExact, ...nuevo,
                        cantidad: cantidadFinalExact,
                        estado: nuevo.estado || viejoExact.estado,
                        precio: viejoExact.precio != null ? viejoExact.precio : (nuevo.precio !== undefined ? nuevo.precio : null),
                        codigo: nuevo.codigo !== undefined ? nuevo.codigo : viejoExact.codigo,
                        disponibilidad: nuevo.disponibilidad || viejoExact.disponibilidad
                    };
                } else {
                    entities.repuestos_solicitados.push(nuevo);
                }
            });
            delete nuevasEntidades.repuestos_solicitados;
        }

        // Merge del resto de entidades (sin sobreescribir con null si ya hay valor)
        for (const [key, value] of Object.entries(nuevasEntidades)) {
            if (value !== null && value !== undefined && value !== '') {
                if (typeof value === 'object' && !Array.isArray(value) && typeof entities[key] === 'object') {
                    entities[key] = { ...entities[key], ...value };
                } else {
                    entities[key] = value;
                }
            }
        }

        // MEJORA #7.5: Sticky truthy para saludo_dado (A.3 BUG-POST05)
        // Una vez que el agente ha saludado (saludo_dado = true), nunca debe volver a false en esta sesión
        if (entities.saludo_dado === true) {
            entities.saludo_dado = true; // Persistir — una vez saludado, queda saludado
        }

        // MEJORA #2: Auto-limpieza de flags bloqueantes cuando llega el dato solicitado
        const tienePatenteEnRaiz = !!entities.patente;
        const tienePatenteEnVehiculos = Array.isArray(entities.vehiculos) && entities.vehiculos.some(v => v.patente);
        if ((tienePatenteEnRaiz || tienePatenteEnVehiculos) && entities.solicitud_manual_patente) {
            entities.solicitud_manual_patente = false;
            console.log(`[Merge] 🔓 Flag solicitud_manual_patente limpiado: patente recibida para ${phone}.`);
        }

        const tieneVinEnRaiz = !!entities.vin;
        const tieneVinEnVehiculos = Array.isArray(entities.vehiculos) && entities.vehiculos.some(v => v.vin);
        if ((tieneVinEnRaiz || tieneVinEnVehiculos) && entities.solicitud_manual_vin) {
            entities.solicitud_manual_vin = false;
            console.log(`[Merge] 🔓 Flag solicitud_manual_vin limpiado: VIN recibido para ${phone}.`);
        }

        // Derivar sucursal a partir de metodo_entrega / sucursal_retiro capturados por Gemini
        const nuevaSucursal = derivarSucursal(entities);

        const { rows } = nuevaSucursal
            ? await db.query(
                `UPDATE user_sessions SET entidades = $1, sucursal = $2, ultimo_mensaje = NOW()
                 WHERE phone = $3 RETURNING *`,
                [JSON.stringify(entities), nuevaSucursal, phone]
              )
            : await db.query(
                `UPDATE user_sessions SET entidades = $1, ultimo_mensaje = NOW()
                 WHERE phone = $2 RETURNING *`,
                [JSON.stringify(entities), phone]
              );

        if (nuevaSucursal) {
            console.log(`[Sessions] 📍 Sucursal derivada → "${nuevaSucursal}" para ${phone}`);
        }

        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 }; // Invalidar cache global
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en updateEntidades:', err.message);
        throw err;
    }
};

// ─── setEstado ───────────────────────────────────────────────────
const setEstado = async (phone, nuevoEstado) => {
    try {
        if (!STATES[nuevoEstado]) return null;

        const { rows } = await db.query(
            `UPDATE user_sessions SET estado = $1, ultimo_mensaje = NOW()
             WHERE phone = $2 RETURNING *`,
            [nuevoEstado, phone]
        );

        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en setEstado:', err.message);
        throw err;
    }
};

// ─── getAllPendingSessions ────────────────────────────────────────
const getAllPendingSessions = async (sucursal = null) => {
    // Solo usar cache cuando no hay filtro de sucursal
    if (!sucursal && globalPendingCache.data && (Date.now() - globalPendingCache.timestamp < GLOBAL_CACHE_TTL)) {
        return globalPendingCache.data;
    }

    try {
        const activeStates = [
            STATES.ESPERANDO_VENDEDOR, STATES.CONFIRMANDO_COMPRA,
            STATES.ESPERANDO_APROBACION_ADMIN,
            STATES.PAGO_VERIFICADO, STATES.ABONO_VERIFICADO,
            STATES.ENCARGO_SOLICITADO, STATES.ESPERANDO_SALDO, STATES.ESPERANDO_RETIRO, STATES.CICLO_COMPLETO
        ];

        const params = [activeStates];
        let whereClause = `WHERE estado = ANY($1)`;
        if (sucursal) {
            params.push(sucursal);
            whereClause += ` AND sucursal = $2`;
        }

        const { rows } = await db.query(
            `SELECT * FROM user_sessions ${whereClause}
             ORDER BY ultimo_mensaje DESC`,
            params
        );

        const data = rows.map(rowToSession);
        // Solo guardar en cache cuando no hay filtro de sucursal
        if (!sucursal) {
            globalPendingCache = { data, timestamp: Date.now() };
        }
        return data;
    } catch (err) {
        console.error('[Sessions] ❌ Error en getAllPendingSessions:', err.message);
        // Si tenemos cache previa válida, devolvemos eso como fallback degradado.
        // Pero si nunca hubo datos (primer error tras un deploy), propagamos el error
        // para que el endpoint responda 500 y el problema sea visible de inmediato.
        if (globalPendingCache.data) return globalPendingCache.data;
        throw err;
    }
};

// ─── getHistoricalSessions ────────────────────────────────────────
const getHistoricalSessions = async (sucursal = null) => {
    try {
        const activeParams = [STATES.ENTREGADO];
        let activeWhere = `WHERE estado = $1`;
        if (sucursal) {
            activeParams.push(sucursal);
            activeWhere += ` AND sucursal = $2`;
        }

        const { rows: activeRows } = await db.query(
            `SELECT * FROM user_sessions ${activeWhere}`,
            activeParams
        );

        const archivedParams = [];
        let archivedWhere = '';
        if (sucursal) {
            archivedParams.push(sucursal);
            archivedWhere = `WHERE sucursal = $1`;
        }

        const { rows: archivedRows } = await db.query(
            `SELECT * FROM pedidos ${archivedWhere} ORDER BY archivado_en DESC`,
            archivedParams
        );

        const mapped = archivedRows.map(p => ({
            id: p.id, phone: p.phone,
            estado: p.estado_final,
            entidades: typeof p.entidades_completas === 'string' ? JSON.parse(p.entidades_completas) : p.entidades_completas,
            ultimo_mensaje: p.archivado_en,
            updated_at: p.created_at || p.archivado_en,
            sucursal: p.sucursal || null
        }));

        const combined = [...activeRows.map(rowToSession), ...mapped];
        combined.sort((a, b) => new Date(b.updated_at || b.ultimo_mensaje) - new Date(a.updated_at || a.ultimo_mensaje));
        return combined;
    } catch (err) {
        console.error('[Sessions] ❌ Error en getHistoricalSessions:', err.message);
        return [];
    }
};

// ─── resetSession ────────────────────────────────────────────────
const resetSession = async (phone) => {
    try {
        const { rows } = await db.query(
            `UPDATE user_sessions SET estado = $1, entidades = $2, ultimo_mensaje = NOW()
             WHERE phone = $3 RETURNING *`,
            [STATES.PERFILANDO, JSON.stringify(INITIAL_ENTITIES), phone]
        );
        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };
        console.log(`[Sessions] ♻️  Sesión reseteada para ${phone}.`);
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en resetSession:', err.message);
        return null;
    }
};

// ─── archiveSession ───────────────────────────────────────────────
const archiveSession = async (phone) => {
    try {
        const session = await getSession(phone);
        const e = session.entidades || {};

        const totalRoot = (e.repuestos_solicitados || []).reduce((acc, r) => {
            const precio = parseInt(r.precio) || 0;
            const cantidad = parseInt(r.cantidad) || 1;
            return acc + (precio * cantidad);
        }, 0);
        const totalVehiculos = (e.vehiculos || []).reduce((sum, v) =>
            sum + (v.repuestos_solicitados || []).reduce((a, r) =>
                a + ((parseInt(r.precio) || 0) * (parseInt(r.cantidad) || 1)), 0), 0);
        const totalCotizacion = totalRoot + totalVehiculos;

        // Mejora #7: capturar vehículo principal para historial
        const vehiculoPrincipal = Array.isArray(e.vehiculos) && e.vehiculos.length > 0
            ? e.vehiculos[0]
            : (e.marca_modelo || e.ano ? { marca_modelo: e.marca_modelo, ano: e.ano, patente: e.patente, motor: e.motor } : null);

        // Actualizar perfil del cliente en la base de datos (MEJORA-3 + Mejora #7)
        await updateClientProfile(phone, {
            nombre: e.nombre_cliente || null,
            email: e.email_cliente || null,
            rut: e.rut_cliente || e.datos_factura?.rut || null,
            quote_id_to_archive: e.quote_id || null,
            monto_venta: totalCotizacion,
            vehiculo_comprado: vehiculoPrincipal
        });

        // Truncar campos para respetar límites de columnas VARCHAR
        const anoTruncado = (e.ano || '').substring(0, 10) || null;

        // Leer contadores de mensajes para snapshot atribuido al pedido
        const { rows: counterRows } = await db.query(
            `SELECT mensajes_ia, mensajes_vendedor FROM user_sessions WHERE phone = $1`,
            [phone]
        );
        const mensajesIa = counterRows[0]?.mensajes_ia || 0;
        const mensajesVendedor = counterRows[0]?.mensajes_vendedor || 0;

        // Derivar sucursal para el pedido archivado (fuente de verdad: entidades)
        const sucursalPedido = derivarSucursal(e);

        // Leer el vendedor que tenía el lock en el momento del cierre (para REQ-03)
        const { rows: lockRows } = await db.query(
            `SELECT lock_vendedor FROM user_sessions WHERE phone = $1`,
            [phone]
        );
        const vendedorNombre = lockRows[0]?.lock_vendedor || null;

        const { rows: pedidoRows } = await db.query(
            `INSERT INTO pedidos (phone, quote_id, estado_final, marca_modelo, ano, patente, vin,
             repuestos, total_cotizacion, metodo_pago, metodo_entrega, direccion_envio,
             tipo_documento, datos_factura, comprobante_url, datos_comprobante, entidades_completas,
             mensajes_ia_total, mensajes_vendedor_total, sucursal, vendedor_nombre, created_at, archivado_en)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
             RETURNING *`,
            [
                phone, e.quote_id || null, session.estado,
                e.marca_modelo || null, anoTruncado, e.patente || null, e.vin || null,
                JSON.stringify(e.repuestos_solicitados || []), totalCotizacion,
                e.metodo_pago || null, e.metodo_entrega || null, e.direccion_envio || null,
                e.tipo_documento || null, JSON.stringify(e.datos_factura || {}),
                e.comprobante_url || null, JSON.stringify(e.pago_pendiente || {}),
                JSON.stringify(e), mensajesIa, mensajesVendedor,
                sucursalPedido || 'Melipilla', // backfill seguro: si aún null, asignar Melipilla
                vendedorNombre,
                session.created_at || null, session.ultimo_mensaje || null
            ]
        );

        console.log(`[Sessions] 🗄️  Venta archivada → pedido ID: ${pedidoRows[0]?.id}`);
        // Invalidar cache explícitamente antes de resetear para evitar race conditions
        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };
        const newSession = await resetSession(phone);
        return { archivedPedido: pedidoRows[0] || null, newSession };
    } catch (err) {
        console.error('[Sessions] ❌ Error en archiveSession:', err.message);
        return { archivedPedido: null, newSession: null };
    }
};

// ─── saveVoucherData ──────────────────────────────────────────────
const saveVoucherData = async (phone, comprobanteUrl, datosExtraidos = {}) => {
    try {
        const session = await getSession(phone);
        const entidades = session.entidades || { ...INITIAL_ENTITIES };
        const esSaldo = session.estado === STATES.ESPERANDO_SALDO;
        const abonoAnterior = entidades.pago_pendiente?.monto || null;

        entidades.comprobante_url = comprobanteUrl;
        entidades.pago_pendiente = {
            monto: datosExtraidos.monto || null,
            banco_origen: datosExtraidos.banco_origen || null,
            fecha_transaccion: datosExtraidos.fecha_transaccion || null,
            id_transaccion: datosExtraidos.id_transaccion || null,
            rut_origen: datosExtraidos.rut_origen || null,
            nombre_origen: datosExtraidos.nombre_origen || null,
            datos_extraidos_por_ia: true,
            es_saldo: esSaldo,
            abono_previo: esSaldo ? abonoAnterior : null
        };

        const { rows } = await db.query(
            `UPDATE user_sessions SET estado = $1, entidades = $2, ultimo_mensaje = NOW()
             WHERE phone = $3 RETURNING *`,
            [STATES.ESPERANDO_APROBACION_ADMIN, JSON.stringify(entidades), phone]
        );

        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };
        console.log(`[Sessions] ✅ Voucher guardado para ${phone}.`);
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en saveVoucherData:', err.message);
        return null;
    }
};

// ─── getPendingApprovalSessions ───────────────────────────────────
const getPendingApprovalSessions = async () => {
    try {
        const { rows } = await db.query(
            `SELECT * FROM user_sessions WHERE estado = $1 ORDER BY ultimo_mensaje DESC`,
            [STATES.ESPERANDO_APROBACION_ADMIN]
        );
        return rows.map(rowToSession);
    } catch (err) {
        console.error('[Sessions] ❌ Error en getPendingApprovalSessions:', err.message);
        return [];
    }
};

// ─── setAgentePausado ─────────────────────────────────────────────
const setAgentePausado = async (phone, pausado) => {
    try {
        const session = await getSession(phone);
        const entidades = { ...session.entidades, agente_pausado: pausado };

        const { rows } = await db.query(
            `UPDATE user_sessions SET entidades = $1 WHERE phone = $2 RETURNING *`,
            [JSON.stringify(entidades), phone]
        );

        sessionCache.delete(phone);
        console.log(`[Sessions] ⏸️ Agente ${pausado ? 'pausado' : 'reactivado'} para ${phone}`);
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en setAgentePausado:', err.message);
        return null;
    }
};

/**
 * HU-1: Elimina un repuesto del array repuestos_solicitados y recalcula el total.
 * Usa fuzzy match case-insensitive (sin tildes) para encontrar el ítem correcto.
 * @param {string} phone
 * @param {string} nombreRepuesto - Nombre del repuesto a remover (tal como lo detectó Gemini)
 */
const removeRepuesto = async (phone, nombreRepuesto) => {
    try {
        const session = await getSession(phone);
        const entidades = { ...session.entidades };

        const normalize = (str) => (str || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const nombreNorm = normalize(nombreRepuesto);

        let antes = entidades.repuestos_solicitados?.length || 0;
        let despues = 0;
        let removido = false;

        // Limpiar el arreglo root por retrocompatibilidad
        entidades.repuestos_solicitados = (entidades.repuestos_solicitados || []).filter(r => {
            const rNorm = normalize(r.nombre);
            if (!rNorm.includes(nombreNorm) && !nombreNorm.includes(rNorm)) {
                return true;
            }
            removido = true;
            return false;
        });
        despues += entidades.repuestos_solicitados.length;

        // HU-5 Limpiar dentro de la estructura multivehiculos
        if (entidades.vehiculos && Array.isArray(entidades.vehiculos)) {
            entidades.vehiculos.forEach(v => {
                if (v.repuestos_solicitados && Array.isArray(v.repuestos_solicitados)) {
                    antes += v.repuestos_solicitados.length;
                    v.repuestos_solicitados = v.repuestos_solicitados.filter(r => {
                        const rNorm = normalize(r.nombre);
                        if (!rNorm.includes(nombreNorm) && !nombreNorm.includes(rNorm)) {
                            return true;
                        }
                        removido = true;
                        return false;
                    });
                    despues += v.repuestos_solicitados.length;
                }
            });
        }

        // Recalcular total con los ítems restantes (Root + Vehiculos)
        let nuevoTotal = entidades.repuestos_solicitados.reduce((sum, r) => sum + ((r.precio || 0) * (r.cantidad || 1)), 0);
        
        if (entidades.vehiculos && Array.isArray(entidades.vehiculos)) {
            entidades.vehiculos.forEach(v => {
                const subTotal = (v.repuestos_solicitados || []).reduce((sum, r) => sum + ((r.precio || 0) * (r.cantidad || 1)), 0);
                nuevoTotal += subTotal;
            });
        }
        
        entidades.total_cotizacion = nuevoTotal;

        const { rows } = await db.query(
            `UPDATE user_sessions SET entidades = $1 WHERE phone = $2 RETURNING *`,
            [JSON.stringify(entidades), phone]
        );

        sessionCache.delete(phone);
        console.log(`[Sessions] 🗑️ Repuesto "${nombreRepuesto}" removido para ${phone}. Antes: ${antes}, Después: ${despues}. Total nuevo: $${nuevoTotal}`);
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en removeRepuesto:', err.message);
        return null;
    }
};

// ─── incrementMessageCounter ──────────────────────────────────────
// Incrementa contador de mensajes enviados por agente IA o vendedor.
// Se usa para calcular tiempo ahorrado y atribución de venta.
const incrementMessageCounter = async (phone, who) => {
    if (who !== 'ia' && who !== 'vendedor') return;
    const column = who === 'ia' ? 'mensajes_ia' : 'mensajes_vendedor';
    try {
        await db.query(
            `UPDATE user_sessions SET ${column} = COALESCE(${column}, 0) + 1 WHERE phone = $1`,
            [phone]
        );
    } catch (err) {
        console.warn(`[Sessions] ⚠️ No se pudo incrementar ${column} para ${phone}:`, err.message);
    }
};

// ─── getDashboardMetrics (Analytics) ──────────────────────────────
// Mapea un rango lógico ('hoy'|'7d'|'30d'|'total') a un fragmento SQL para
// filtrar por columna timestamp en zona Santiago.
const rangeToSql = (range, column) => {
    switch (range) {
        case '7d':
            return `${column} AT TIME ZONE 'America/Santiago' >= (NOW() AT TIME ZONE 'America/Santiago') - INTERVAL '7 days'`;
        case '30d':
            return `${column} AT TIME ZONE 'America/Santiago' >= (NOW() AT TIME ZONE 'America/Santiago') - INTERVAL '30 days'`;
        case 'total':
            return 'TRUE';
        case 'hoy':
        default:
            return `DATE(${column} AT TIME ZONE 'America/Santiago') = DATE(NOW() AT TIME ZONE 'America/Santiago')`;
    }
};

const getDashboardMetrics = async (range = 'hoy') => {
    try {
        const tiempoRespuestaSeg = parseInt(process.env.IA_TIEMPO_RESPUESTA_SEG || '30', 10);

        const filtroPedidos = rangeToSql(range, 'archivado_en');
        const filtroSesionesCreadas = rangeToSql(range, 'created_at');

        // 1. Ventas en el rango (cerradas)
        const ventasResult = await db.query(`
            SELECT
                COUNT(*) AS cantidad_ventas,
                COALESCE(SUM(total_cotizacion), 0) AS total_vendido,
                COALESCE(SUM(mensajes_ia_total), 0) AS mensajes_ia_pedidos,
                COALESCE(SUM(mensajes_vendedor_total), 0) AS mensajes_vendedor_pedidos,
                COALESCE(AVG(EXTRACT(EPOCH FROM (archivado_en - created_at))) / 60, 0) AS mins_promedio_cierre
            FROM pedidos
            WHERE ${filtroPedidos}
              AND estado_final IN ('ENTREGADO', 'PAGO_VERIFICADO')
        `);

        // 2. Sesiones activas (snapshot actual)
        const activasResult = await db.query(`SELECT COUNT(*) AS sesiones_activas FROM user_sessions`);

        // 3. Tiempo promedio de espera del vendedor (snapshot actual)
        const tiempoEsperaResult = await db.query(`
            SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - ultimo_mensaje))) / 60, 0) AS mins_espera
            FROM user_sessions
            WHERE estado = 'ESPERANDO_VENDEDOR'
        `);

        // 4. Conversaciones iniciadas en el rango (sesiones + pedidos creados)
        const iniciadasResult = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM user_sessions WHERE ${rangeToSql(range, 'created_at')}) +
                (SELECT COUNT(*) FROM pedidos WHERE ${filtroSesionesCreadas}) AS total_iniciadas
        `);

        // 5. Mensajes IA en sesiones activas creadas en el rango
        const sesionesIaResult = await db.query(`
            SELECT COALESCE(SUM(mensajes_ia), 0) AS mensajes_ia_sesiones
            FROM user_sessions
            WHERE ${rangeToSql(range, 'created_at')}
        `);

        // 6. Sesiones en ESPERANDO_VENDEDOR (snapshot actual)
        const esperandoVendedorResult = await db.query(`
            SELECT COUNT(*)::int AS cantidad_esperando FROM user_sessions WHERE estado = 'ESPERANDO_VENDEDOR'
        `);

        const cantidadVentas = parseInt(ventasResult.rows[0].cantidad_ventas, 10);
        const totalVendido = parseInt(ventasResult.rows[0].total_vendido, 10);
        const mensajesIaPedidos = parseInt(ventasResult.rows[0].mensajes_ia_pedidos, 10);
        const mensajesVendedorPedidos = parseInt(ventasResult.rows[0].mensajes_vendedor_pedidos, 10);
        const minsPromedioCierre = parseFloat(ventasResult.rows[0].mins_promedio_cierre);
        const sesionesActivas = parseInt(activasResult.rows[0].sesiones_activas, 10);
        const minsEspera = parseFloat(tiempoEsperaResult.rows[0].mins_espera);
        const totalIniciadas = parseInt(iniciadasResult.rows[0].total_iniciadas, 10);
        const mensajesIaSesiones = parseInt(sesionesIaResult.rows[0].mensajes_ia_sesiones, 10);

        const cantidadEsperandoVendedor = parseInt(esperandoVendedorResult.rows[0].cantidad_esperando, 10);

        const mensajesIaTotal = mensajesIaPedidos + mensajesIaSesiones;
        const tiempoAhorradoMin = Math.round((mensajesIaTotal * tiempoRespuestaSeg) / 60);

        const tasaConversion = totalIniciadas > 0
            ? Math.round(((cantidadVentas / totalIniciadas) * 100) * 10) / 10
            : 0;
        const ticketPromedio = cantidadVentas > 0 ? Math.round(totalVendido / cantidadVentas) : 0;

        return {
            // Compatibilidad con dashboard principal (rango = hoy)
            totalVendidoHoy: totalVendido,
            cantidadVentasHoy: cantidadVentas,
            ticketPromedioHoy: ticketPromedio,
            sesionesActivas,
            tiempoPromedioEsperaVendedorMins: Math.round(minsEspera),
            tasaConversionHoy: tasaConversion,
            // Métricas reales del agente IA
            range,
            mensajesIa: mensajesIaTotal,
            mensajesVendedor: mensajesVendedorPedidos,
            tiempoAhorradoMin,
            tiempoRespuestaSegConfig: tiempoRespuestaSeg,
            tiempoPromedioCierreMin: Math.round(minsPromedioCierre),
            // Aliases de rango (para frontend de estadísticas)
            dineroRecaudado: totalVendido,
            cantidadVentas,
            ticketPromedio,
            tasaConversion,
            cantidadEsperandoVendedor
        };
    } catch (err) {
        console.error('[Sessions Analytics] ❌ Error en getDashboardMetrics:', err.message);
        return {
            totalVendidoHoy: 0,
            cantidadVentasHoy: 0,
            ticketPromedioHoy: 0,
            sesionesActivas: 0,
            tiempoPromedioEsperaVendedorMins: 0,
            tasaConversionHoy: 0,
            range,
            mensajesIa: 0,
            mensajesVendedor: 0,
            tiempoAhorradoMin: 0,
            tiempoRespuestaSegConfig: parseInt(process.env.IA_TIEMPO_RESPUESTA_SEG || '30', 10),
            tiempoPromedioCierreMin: 0,
            dineroRecaudado: 0,
            cantidadVentas: 0,
            ticketPromedio: 0,
            tasaConversion: 0,
            cantidadEsperandoVendedor: 0
        };
    }
};


// ─── patchSellerData ─────────────────────────────────────────────
// Sobreescribe vehiculos/repuestos directamente sin merge inteligente.
// Usado cuando el VENDEDOR envía una cotización desde el dashboard.
// A diferencia de updateEntidades, NO aplica Math.max en cantidades
// porque el vendedor tiene autoridad para reducir o cambiar valores.
const patchSellerData = async (phone, patch) => {
    try {
        const session = await getSession(phone);
        const entities = session.entidades || { ...INITIAL_ENTITIES };

        // Detectar qué ruta usó el vendedor para saber cómo sincronizar
        const patchIncludesVehiculos = 'vehiculos' in patch;

        // Sobreescritura directa de los campos enviados por el vendedor
        for (const [key, value] of Object.entries(patch)) {
            if (value !== null && value !== undefined) {
                entities[key] = value;
            }
        }

        // Marcar cantidad_fijada en todos los repuestos para que Gemini no los sobreescriba accidentalmente
        if (entities.repuestos_solicitados) {
            entities.repuestos_solicitados = entities.repuestos_solicitados.map(r => ({ ...r, cantidad_fijada: true }));
        }
        if (entities.vehiculos) {
            if (patchIncludesVehiculos) {
                // Vendedor patcheó vía vehiculos → marcar y sincronizar flat desde vehiculos
                entities.vehiculos = entities.vehiculos.map(v => ({
                    ...v,
                    repuestos_solicitados: (v.repuestos_solicitados || []).map(r => ({ ...r, cantidad_fijada: true }))
                }));
                entities.repuestos_solicitados = entities.vehiculos.flatMap(v =>
                    (v.repuestos_solicitados || []).map(r => ({ ...r }))
                );
            } else {
                // Vendedor patcheó vía items (flat) → actualizar vehiculos desde flat para mantener consistencia
                // Evita que vehiculos con datos viejos sobreescriban los nuevos valores del vendedor
                entities.vehiculos = entities.vehiculos.map(v => ({
                    ...v,
                    repuestos_solicitados: (v.repuestos_solicitados || []).map(vr => {
                        const flatMatch = (entities.repuestos_solicitados || []).find(
                            fr => fr.nombre?.toLowerCase().trim() === vr.nombre?.toLowerCase().trim()
                        );
                        return flatMatch ? { ...vr, ...flatMatch } : { ...vr, cantidad_fijada: true };
                    })
                }));
            }
        }

        const { rows } = await db.query(
            `UPDATE user_sessions SET entidades = $1, ultimo_mensaje = NOW()
             WHERE phone = $2 RETURNING *`,
            [JSON.stringify(entities), phone]
        );

        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };
        return rowToSession(rows[0]);
    } catch (err) {
        console.error('[Sessions] ❌ Error en patchSellerData:', err.message);
        throw err;
    }
};

// ─── autoArchiveStaleSessions ─────────────────────────────────────
/**
 * Archiva automáticamente las sesiones que llevan X horas sin actividad
 * en estados PERFILANDO o ESPERANDO_VENDEDOR.
 * @param {number} hoursThreshold - Horas de inactividad para archivar (default: 48)
 * @returns {Promise<{archived: number, details: Array}>} - Resultado del archivado
 */
const autoArchiveStaleSessions = async (hoursThreshold = 48) => {
    try {
        const stalableStates = [STATES.PERFILANDO, STATES.ESPERANDO_VENDEDOR];

        const { rows: staleSessions } = await db.query(
            `SELECT * FROM user_sessions
             WHERE estado = ANY($1)
             AND ultimo_mensaje < NOW() - INTERVAL '1 hour' * $2`,
            [stalableStates, hoursThreshold]
        );

        if (staleSessions.length === 0) {
            console.log(`[AutoArchive] ✅ No hay sesiones inactivas (umbral: ${hoursThreshold}h).`);
            return { archived: 0, details: [] };
        }

        console.log(`[AutoArchive] 🔍 Encontradas ${staleSessions.length} sesiones inactivas. Archivando...`);
        const details = [];

        for (const row of staleSessions) {
            const session = rowToSession(row);
            const e = session.entidades || {};

            // Guardar snapshot en pedidos con estado_final = 'ABANDONADO'
            await db.query(
                `INSERT INTO pedidos (phone, quote_id, estado_final, marca_modelo, ano, patente, vin,
                 repuestos, total_cotizacion, metodo_pago, metodo_entrega, direccion_envio,
                 tipo_documento, datos_factura, comprobante_url, datos_comprobante, entidades_completas,
                 mensajes_ia_total, mensajes_vendedor_total, created_at, archivado_en)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
                [
                    session.phone, e.quote_id || null, 'ABANDONADO',
                    e.marca_modelo || null, e.ano || null, e.patente || null, e.vin || null,
                    JSON.stringify(e.repuestos_solicitados || []), 0,
                    e.metodo_pago || null, e.metodo_entrega || null, e.direccion_envio || null,
                    e.tipo_documento || null, JSON.stringify(e.datos_factura || {}),
                    null, JSON.stringify({}),
                    JSON.stringify(e),
                    row.mensajes_ia || 0, row.mensajes_vendedor || 0,
                    session.created_at || null, row.ultimo_mensaje || null
                ]
            );

            // Cambiar estado a ARCHIVADO (no resetear para poder retomar)
            await db.query(
                `UPDATE user_sessions SET estado = $1, ultimo_mensaje = NOW()
                 WHERE phone = $2`,
                [STATES.ARCHIVADO, session.phone]
            );

            sessionCache.delete(session.phone);
            details.push({
                phone: session.phone,
                previousState: session.estado,
                repuestos: (e.repuestos_solicitados || []).map(r => r.nombre).join(', ') || 'Sin repuestos',
                inactiveSince: row.ultimo_mensaje
            });

            console.log(`[AutoArchive] 📦 ${session.phone} archivado (era: ${session.estado}, inactivo desde: ${row.ultimo_mensaje})`);
        }

        globalPendingCache = { data: null, timestamp: 0 };
        console.log(`[AutoArchive] ✅ ${details.length} sesiones archivadas exitosamente.`);
        return { archived: details.length, details };
    } catch (err) {
        console.error('[AutoArchive] ❌ Error:', err.message);
        return { archived: 0, details: [], error: err.message };
    }
};

// ─── getArchivedSessionForResume ──────────────────────────────────
/**
 * Verifica si un cliente tiene una sesión archivada con datos aprovechables
 * para ofrecerle retomar la cotización cuando vuelve a escribir.
 * @param {string} phone - Teléfono del cliente
 * @returns {Promise<{hasArchived: boolean, summary: string, entidades: Object}|null>}
 */
const getArchivedSessionForResume = async (phone) => {
    try {
        const { rows } = await db.query(
            `SELECT * FROM user_sessions WHERE phone = $1 AND estado = $2`,
            [phone, STATES.ARCHIVADO]
        );

        if (rows.length === 0) return null;

        const session = rowToSession(rows[0]);
        const e = session.entidades || {};
        const repuestos = e.repuestos_solicitados || [];
        const vehiculos = e.vehiculos || [];

        // Solo ofrecer retomar si hay datos sustanciales
        if (repuestos.length === 0 && vehiculos.length === 0) return null;

        const repNames = repuestos.map(r => r.nombre).filter(Boolean).join(', ');
        const vehicleDesc = vehiculos.length > 0
            ? vehiculos.map(v => `${v.marca_modelo || 'Vehículo'} ${v.ano || ''}`).join(', ')
            : (e.marca_modelo ? `${e.marca_modelo} ${e.ano || ''}` : '');

        const summary = vehicleDesc
            ? `${repNames} para ${vehicleDesc}`
            : repNames;

        return {
            hasArchived: true,
            summary: summary || 'una cotización pendiente',
            entidades: e
        };
    } catch (err) {
        console.error('[Sessions] ❌ Error en getArchivedSessionForResume:', err.message);
        return null;
    }
};

/**
 * Safety net: mueve repuestos huérfanos del root a un vehículo específico
 * cuando el cliente acaba de aclarar a cuál pertenecen.
 * Se llama después del merge de Gemini solo si hay huérfanos + multi-vehículo.
 * @param {string} phone
 * @param {string} userText - Último mensaje del cliente para detectar vehículo destino
 * @returns {Promise<Object>} sesión actualizada (o sesión sin cambios si no hay match)
 */
const reassignOrphanRepuestos = async (phone, userText) => {
    try {
        const session = await getSession(phone);
        const entities = session.entidades || {};
        const orphans = entities.repuestos_solicitados || [];
        const vehiculos = entities.vehiculos || [];

        if (orphans.length === 0 || vehiculos.length === 0) return session;

        const lower = (userText || '').toLowerCase();
        let target = null;

        // Estrategia 1: "padrón" → el último vehículo agregado (el más reciente)
        if (/\bpadr[oó]n\b/i.test(lower)) {
            target = vehiculos[vehiculos.length - 1];
        }

        // Estrategia 2: match por marca_modelo (substring de token ≥4 chars)
        if (!target) {
            target = vehiculos.find(v => {
                if (!v.marca_modelo) return false;
                return v.marca_modelo.toLowerCase().split(/\s+/)
                    .filter(t => t.length >= 4)
                    .some(t => lower.includes(t));
            });
        }

        // Estrategia 3: match por año
        if (!target) {
            target = vehiculos.find(v => v.ano && lower.includes(v.ano));
        }

        // Estrategia 4: match por patente
        if (!target) {
            const upperText = (userText || '').toUpperCase().replace(/[-\s]/g, '');
            target = vehiculos.find(v => v.patente && upperText.includes(v.patente.replace(/[-\s]/g, '')));
        }

        // Estrategia 5: si solo hay UN vehículo, asignar sin match
        if (!target && vehiculos.length === 1) {
            target = vehiculos[0];
        }

        if (!target) return session; // No fue posible determinar vehículo destino

        // Mover repuestos huérfanos al vehículo target (con dedup)
        if (!target.repuestos_solicitados) target.repuestos_solicitados = [];
        for (const orphan of orphans) {
            const yaExiste = target.repuestos_solicitados.some(r => isSameRepuesto(r.nombre, orphan.nombre));
            if (!yaExiste) target.repuestos_solicitados.push(orphan);
        }

        // Limpiar root
        entities.repuestos_solicitados = [];

        await db.query(
            `UPDATE user_sessions SET entidades = $1, ultimo_mensaje = NOW() WHERE phone = $2`,
            [JSON.stringify(entities), phone]
        );
        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };

        console.log(`[Reassign] 🔀 ${orphans.length} repuesto(s) huérfano(s) → ${target.marca_modelo || target.patente || 'vehículo'} para ${phone}`);
        return getSession(phone);
    } catch (err) {
        console.error('[Sessions] ❌ Error en reassignOrphanRepuestos:', err.message);
        return getSession(phone);
    }
};

// ─── claimSession ─────────────────────────────────────────────────
/**
 * Reclama el lock pesimista de una sesión para un vendedor.
 * Si otro vendedor ya lo tiene (y no expiró), devuelve success:false con quién lo tiene.
 * Si el mismo vendedor llama de nuevo, extiende el TTL (renovación).
 */
const claimSession = async (phone, vendedor) => {
    const { rows } = await db.query(`
        UPDATE user_sessions
        SET lock_token = gen_random_uuid(),
            lock_vendedor = $1,
            lock_expires_at = NOW() + INTERVAL '5 minutes'
        WHERE phone = $2
          AND (lock_token IS NULL OR lock_expires_at < NOW() OR lock_vendedor = $1)
        RETURNING lock_token, lock_vendedor, lock_expires_at
    `, [vendedor, phone]);

    if (rows.length === 0) {
        // Bloqueado por otro vendedor — leer quién lo tiene
        const { rows: holderRows } = await db.query(
            'SELECT lock_vendedor, lock_expires_at FROM user_sessions WHERE phone = $1',
            [phone]
        );
        return { success: false, ...(holderRows[0] || {}) };
    }
    sessionCache.delete(phone);
    globalPendingCache = { data: null, timestamp: 0 };
    return { success: true, ...rows[0] };
};

// ─── releaseSession ───────────────────────────────────────────────
/**
 * Libera el lock pesimista. Solo funciona si el lock_token coincide.
 */
const releaseSession = async (phone, lock_token) => {
    const { rowCount } = await db.query(
        `UPDATE user_sessions SET lock_token = NULL, lock_vendedor = NULL, lock_expires_at = NULL
         WHERE phone = $1 AND lock_token = $2::uuid`,
        [phone, lock_token]
    );
    if (rowCount > 0) {
        sessionCache.delete(phone);
        globalPendingCache = { data: null, timestamp: 0 };
    }
    return { success: rowCount > 0 };
};

// ─── validateLock ─────────────────────────────────────────────────
/**
 * Valida si el lock_token dado es vigente para la sesión.
 * Retorna { valid: true } o { valid: false, reason, lock_vendedor? }
 */
const validateLock = async (phone, lock_token) => {
    if (!lock_token) return { valid: false, reason: 'missing_token' };
    const { rows } = await db.query(
        `SELECT lock_token, lock_vendedor, lock_expires_at FROM user_sessions WHERE phone = $1`,
        [phone]
    );
    if (rows.length === 0) return { valid: false, reason: 'not_found' };
    const r = rows[0];
    if (!r.lock_token || r.lock_token !== lock_token) {
        return { valid: false, reason: 'mismatched_token', lock_vendedor: r.lock_vendedor };
    }
    if (new Date(r.lock_expires_at) < new Date()) return { valid: false, reason: 'expired' };
    return { valid: true, lock_vendedor: r.lock_vendedor };
};

module.exports = {
    getSession,
    updateEntidades,
    setEstado,
    resetSession,
    archiveSession,
    getAllPendingSessions,
    getHistoricalSessions,
    saveVoucherData,
    getPendingApprovalSessions,
    setAgentePausado,
    removeRepuesto,
    getDashboardMetrics,
    patchSellerData,
    autoArchiveStaleSessions,
    getArchivedSessionForResume,
    reassignOrphanRepuestos,
    incrementMessageCounter,
    derivarSucursal,
    claimSession,
    releaseSession,
    validateLock,
    invalidateSessionCache,
    STATES
};
