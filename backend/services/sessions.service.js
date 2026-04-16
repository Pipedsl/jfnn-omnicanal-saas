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

/**
 * Compara dos nombres de repuesto para determinar si son el mismo ítem refinado.
 * Retorna 'exact' | 'refined' | 'similar' | false
 * - exact: mismo nombre (después de strip)
 * - refined: uno contiene al otro como substring (Gemini añadió/quitó calificadores)
 * - similar: comparten ≥60% de tokens (reordenamiento o variación menor)
 */
const isSameRepuesto = (nombreA, nombreB) => {
    const a = stripVehicleAnnotation(nombreA);
    const b = stripVehicleAnnotation(nombreB);
    if (!a || !b) return false;
    if (a === b) return 'exact';
    if (a.includes(b) || b.includes(a)) return 'refined';
    const tokensA = new Set(a.split(/\s+/));
    const tokensB = new Set(b.split(/\s+/));
    const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
    const smaller = Math.min(tokensA.size, tokensB.size);
    if (smaller > 0 && intersection / smaller >= 0.6) return 'similar';
    return false;
};

// ─── Caché en memoria ───────────────────────────────────────────
const sessionCache = new Map();
const CACHE_TTL = 5000;
let globalPendingCache = { data: null, timestamp: 0 };
const GLOBAL_CACHE_TTL = 2500;

// ─── FUNCIÓN AUXILIAR: Mapear fila de DB al formato esperado ────
const rowToSession = (row) => ({
    id: row.id,
    phone: row.phone,
    estado: row.estado,
    entidades: typeof row.entidades === 'string' ? JSON.parse(row.entidades) : row.entidades,
    ultimo_mensaje: row.ultimo_mensaje,
    created_at: row.created_at
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

        const { rows } = await db.query(
            `UPDATE user_sessions SET entidades = $1, ultimo_mensaje = NOW()
             WHERE phone = $2 RETURNING *`,
            [JSON.stringify(entities), phone]
        );

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
const getAllPendingSessions = async () => {
    if (globalPendingCache.data && (Date.now() - globalPendingCache.timestamp < GLOBAL_CACHE_TTL)) {
        return globalPendingCache.data;
    }

    try {
        const activeStates = [
            STATES.ESPERANDO_VENDEDOR, STATES.CONFIRMANDO_COMPRA,
            STATES.ESPERANDO_APROBACION_ADMIN,
            STATES.PAGO_VERIFICADO, STATES.ABONO_VERIFICADO,
            STATES.ENCARGO_SOLICITADO, STATES.ESPERANDO_SALDO, STATES.ESPERANDO_RETIRO, STATES.CICLO_COMPLETO
        ];

        const { rows } = await db.query(
            `SELECT * FROM user_sessions WHERE estado = ANY($1)
             ORDER BY ultimo_mensaje DESC`,
            [activeStates]
        );

        const data = rows.map(rowToSession);
        globalPendingCache = { data, timestamp: Date.now() };
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
const getHistoricalSessions = async () => {
    try {
        const { rows: activeRows } = await db.query(
            `SELECT * FROM user_sessions WHERE estado = $1`,
            [STATES.ENTREGADO]
        );

        const { rows: archivedRows } = await db.query(
            `SELECT * FROM pedidos ORDER BY archivado_en DESC`
        );

        const mapped = archivedRows.map(p => ({
            id: p.id, phone: p.phone,
            estado: p.estado_final === 'ENTREGADO' ? 'ARCHIVADO' : p.estado_final,
            entidades: typeof p.entidades_completas === 'string' ? JSON.parse(p.entidades_completas) : p.entidades_completas,
            ultimo_mensaje: p.archivado_en,
            updated_at: p.created_at || p.archivado_en
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

        const totalCotizacion = (e.repuestos_solicitados || []).reduce((acc, r) => acc + (parseInt(r.precio) || 0), 0);

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

        const { rows: pedidoRows } = await db.query(
            `INSERT INTO pedidos (phone, quote_id, estado_final, marca_modelo, ano, patente, vin,
             repuestos, total_cotizacion, metodo_pago, metodo_entrega, direccion_envio,
             tipo_documento, datos_factura, comprobante_url, datos_comprobante, entidades_completas)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [
                phone, e.quote_id || null, session.estado,
                e.marca_modelo || null, anoTruncado, e.patente || null, e.vin || null,
                JSON.stringify(e.repuestos_solicitados || []), totalCotizacion,
                e.metodo_pago || null, e.metodo_entrega || null, e.direccion_envio || null,
                e.tipo_documento || null, JSON.stringify(e.datos_factura || {}),
                e.comprobante_url || null, JSON.stringify(e.pago_pendiente || {}),
                JSON.stringify(e)
            ]
        );

        console.log(`[Sessions] 🗄️  Venta archivada → pedido ID: ${pedidoRows[0]?.id}`);
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

// ─── getDashboardMetrics (Analytics) ──────────────────────────────
const getDashboardMetrics = async () => {
    try {
        // 1. Métricas de Ventas Hoy (de la tabla pedidos que han sido cerrados hoy)
        const ventasResult = await db.query(`
            SELECT 
                COUNT(*) as cantidad_ventas,
                COALESCE(SUM(total_cotizacion), 0) as total_vendido
            FROM pedidos
            WHERE DATE(archivado_en AT TIME ZONE 'America/Santiago') = DATE(NOW() AT TIME ZONE 'America/Santiago')
            AND estado_final IN ('ENTREGADO', 'PAGO_VERIFICADO')
        `);

        // 2. Sesiones activas (total de conversaciones en curso)
        const activasResult = await db.query(`
            SELECT COUNT(*) as sesiones_activas 
            FROM user_sessions
        `);

        // 3. Tiempo promedio de espera del vendedor (minutos)
        const tiempoEsperaResult = await db.query(`
            SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - ultimo_mensaje))) / 60, 0) as mins_espera
            FROM user_sessions
            WHERE estado = 'ESPERANDO_VENDEDOR'
        `);

        // 4. Conversión (Aproximada): Pagados Hoy / Total Iniciados Hoy
        // Calculamos los iniciados hoy en user_sessions + los ya archivados hoy
        const iniciadasResult = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM user_sessions WHERE DATE(created_at AT TIME ZONE 'America/Santiago') = DATE(NOW() AT TIME ZONE 'America/Santiago')) +
                (SELECT COUNT(*) FROM pedidos WHERE DATE(created_at AT TIME ZONE 'America/Santiago') = DATE(NOW() AT TIME ZONE 'America/Santiago')) as total_iniciadas
        `);

        const cantidadVentas = parseInt(ventasResult.rows[0].cantidad_ventas, 10);
        const totalVendido = parseInt(ventasResult.rows[0].total_vendido, 10);
        const sesionesActivas = parseInt(activasResult.rows[0].sesiones_activas, 10);
        const minsEspera = parseFloat(tiempoEsperaResult.rows[0].mins_espera);
        const totalIniciadas = parseInt(iniciadasResult.rows[0].total_iniciadas, 10);

        let tasaConversion = 0;
        if (totalIniciadas > 0) {
            tasaConversion = (cantidadVentas / totalIniciadas) * 100;
        }

        let ticketPromedio = 0;
        if (cantidadVentas > 0) {
            ticketPromedio = totalVendido / cantidadVentas;
        }

        return {
            totalVendidoHoy: totalVendido,
            cantidadVentasHoy: cantidadVentas,
            ticketPromedioHoy: Math.round(ticketPromedio),
            sesionesActivas: sesionesActivas,
            tiempoPromedioEsperaVendedorMins: Math.round(minsEspera),
            tasaConversionHoy: Math.round(tasaConversion * 10) / 10 // un decimal
        };
    } catch (err) {
        console.error('[Sessions Analytics] ❌ Error en getDashboardMetrics:', err.message);
        return {
            totalVendidoHoy: 0,
            cantidadVentasHoy: 0,
            ticketPromedioHoy: 0,
            sesionesActivas: 0,
            tiempoPromedioEsperaVendedorMins: 0,
            tasaConversionHoy: 0
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
                 tipo_documento, datos_factura, comprobante_url, datos_comprobante, entidades_completas)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
                [
                    session.phone, e.quote_id || null, 'ABANDONADO',
                    e.marca_modelo || null, e.ano || null, e.patente || null, e.vin || null,
                    JSON.stringify(e.repuestos_solicitados || []), 0,
                    e.metodo_pago || null, e.metodo_entrega || null, e.direccion_envio || null,
                    e.tipo_documento || null, JSON.stringify(e.datos_factura || {}),
                    null, JSON.stringify({}),
                    JSON.stringify(e)
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
    STATES
};
