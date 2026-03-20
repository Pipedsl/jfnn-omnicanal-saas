/**
 * Servicio para gestionar las sesiones de los clientes en Supabase (PostgreSQL).
 * Almacena el estado de la conversación y las entidades extraídas.
 */
const supabase = require('../config/supabase');

const STATES = {
    PERFILANDO: 'PERFILANDO',
    ESPERANDO_VENDEDOR: 'ESPERANDO_VENDEDOR',
    CONFIRMANDO_COMPRA: 'CONFIRMANDO_COMPRA',
    ESPERANDO_COMPROBANTE: 'ESPERANDO_COMPROBANTE',
    ESPERANDO_APROBACION_ADMIN: 'ESPERANDO_APROBACION_ADMIN', // ← Nuevo: comprobante enviado, pendiente de revisión humana
    PAGO_VERIFICADO: 'PAGO_VERIFICADO',
    ABONO_VERIFICADO: 'ABONO_VERIFICADO', // Nuevo: abono recibido, pedido por encargo.
    ENCARGO_SOLICITADO: 'ENCARGO_SOLICITADO', // Nuevo: Vendedor compró al proveedor y notificó ETA al cliente.
    ESPERANDO_SALDO: 'ESPERANDO_SALDO', // Nuevo: Repuestos llegaron al local, se cobró el remanente al cliente.
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
    repuestos_solicitados: [],
    sintomas_reportados: null,
    metodo_pago: null,
    metodo_entrega: null,
    horario_entrega: null,
    direccion_envio: null,
    tipo_documento: null,
    total_cotizacion: null,
    quote_id: null,
    nombre_cliente: null,
    agente_pausado: false,
    comprobante_url: null,
    datos_extraidos: null,
    datos_factura: {
        rut: null,
        razon_social: null,
        giro: null
    },
    // Campos de comprobante de pago (poblados en ESPERANDO_APROBACION_ADMIN)
    pago_pendiente: {
        monto: null,
        banco_origen: null,
        fecha_transaccion: null,
        id_transaccion: null,     // Opcional según disponibilidad en el comprobante
        rut_origen: null,         // RUT/cuenta de quien transfirió (opcional)
        nombre_origen: null,      // Nombre de quien transfirió (opcional)
        datos_extraidos_por_ia: true  // Bandera para el admin: "estos datos son estimados"
    }
};

/**
 * Obtiene o crea una sesión para un número de teléfono
 */
const getSession = async (phone) => {
    try {
        const { data, error } = await supabase
            .from('user_sessions')
            .select('*')
            .eq('phone', phone)
            .single();

        if (error && error.code === 'PGRST116') {
            // No existe, crearla
            const { data: newData, error: createError } = await supabase
                .from('user_sessions')
                .insert([{
                    phone,
                    estado: STATES.PERFILANDO,
                    entidades: INITIAL_ENTITIES,
                    ultimo_mensaje: new Date()
                }])
                .select()
                .single();

            if (createError) throw createError;
            return newData;
        }

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error en getSession Supabase:", err);
        // Fallback local en caso de error crítico (opcional)
        return { phone, estado: STATES.PERFILANDO, entidades: INITIAL_ENTITIES };
    }
};

/**
 * Actualiza las entidades de una sesión mezclándolas con las existentes
 */
const updateEntidades = async (phone, nuevasEntidades) => {
    try {
        const session = await getSession(phone);
        let entities = session.entidades || { ...INITIAL_ENTITIES };

        // Fusionar repuestos_solicitados con detección de refinamientos (MERGE inteligente)
        if (nuevasEntidades.repuestos_solicitados && Array.isArray(nuevasEntidades.repuestos_solicitados)) {
            nuevasEntidades.repuestos_solicitados.forEach(nuevo => {
                const nuevoNombre = nuevo.nombre.toLowerCase().trim();

                // Buscar si el nuevo ítem es un refinamiento de uno existente
                // Caso A: "pastillas de freno" existe → llega "pastillas de freno delanteras" → actualizar
                // Caso B: "pastillas" existe → llega "pastillas de freno delanteras" → actualizar
                const refinedIdx = entities.repuestos_solicitados.findIndex(existente => {
                    const existenteNombre = existente.nombre.toLowerCase().trim();
                    return existenteNombre !== nuevoNombre && (
                        nuevoNombre.includes(existenteNombre) || existenteNombre.includes(nuevoNombre)
                    );
                });

                if (refinedIdx !== -1) {
                    // Actualizar el ítem existente conservando el nombre más largo/específico
                    const viejo = entities.repuestos_solicitados[refinedIdx];
                    const nuevoNombreStr = nuevo.nombre;
                    const viejoNombreStr = viejo.nombre;

                    // Si el nuevo nombre es más corto, mantenemos el viejo (más específico)
                    const nombreFinal = nuevoNombreStr.length >= viejoNombreStr.length ? nuevoNombreStr : viejoNombreStr;

                    console.log(`[Session] 🔀 MERGE: "${viejoNombreStr}" + "${nuevoNombreStr}" → "${nombreFinal}"`);

                    entities.repuestos_solicitados[refinedIdx] = {
                        ...viejo,
                        nombre: nombreFinal,
                        estado: nuevo.estado || viejo.estado,
                        precio: nuevo.precio !== undefined ? nuevo.precio : viejo.precio,
                        codigo: nuevo.codigo !== undefined ? nuevo.codigo : viejo.codigo,
                        disponibilidad: nuevo.disponibilidad || viejo.disponibilidad
                    };
                    return;
                }

                // Si no es un refinamiento, buscar si es un match EXACTO
                const exactIdx = entities.repuestos_solicitados.findIndex(
                    e => e.nombre.toLowerCase().trim() === nuevoNombre
                );
                
                if (exactIdx !== -1) {
                    // Actualizar el ítem existente con los nuevos datos (precios, códigos, etc)
                    entities.repuestos_solicitados[exactIdx] = {
                        ...entities.repuestos_solicitados[exactIdx],
                        estado: nuevo.estado || entities.repuestos_solicitados[exactIdx].estado,
                        precio: nuevo.precio !== undefined ? nuevo.precio : entities.repuestos_solicitados[exactIdx].precio,
                        codigo: nuevo.codigo !== undefined ? nuevo.codigo : entities.repuestos_solicitados[exactIdx].codigo,
                        disponibilidad: nuevo.disponibilidad || entities.repuestos_solicitados[exactIdx].disponibilidad
                    };
                } else {
                    // Si no existe para nada, agregarlo
                    entities.repuestos_solicitados.push(nuevo);
                }
            });
            delete nuevasEntidades.repuestos_solicitados;
        }

        // FIX CONTEXTO: Si el cliente proporciona una nueva patente o un nuevo VIN que difiere del actual,
        // o un nuevo año y marca de golpe, limpiar los datos contradictorios anteriores.
        const providedPatente = nuevasEntidades.patente && nuevasEntidades.patente !== 'null' ? nuevasEntidades.patente.toUpperCase() : null;
        const currentPatente = entities.patente ? entities.patente.toUpperCase() : null;

        const providedVin = nuevasEntidades.vin && nuevasEntidades.vin !== 'null' ? nuevasEntidades.vin.toUpperCase() : null;
        const currentVin = entities.vin ? entities.vin.toUpperCase() : null;

        if ((providedPatente && currentPatente && providedPatente !== currentPatente) ||
            (providedVin && currentVin && providedVin !== currentVin)) {

            console.log(`[Session] 🔄 Cambio de vehículo detectado para ${phone}. Limpiando datos base.`);
            entities.marca_modelo = null;
            entities.ano = null;
            entities.patente = providedPatente || null;
            entities.vin = providedVin || null;
            entities.motor = null;
            entities.combustible = null;
        }

        // Limpiar strings literales 'null' que manda Gemini a veces
        Object.keys(nuevasEntidades).forEach(k => {
            if (nuevasEntidades[k] === 'null') nuevasEntidades[k] = null;
        });

        // Fusionar el resto
        entities = { ...entities, ...nuevasEntidades };

        const { data, error } = await supabase
            .from('user_sessions')
            .update({
                entidades: entities,
                ultimo_mensaje: new Date()
            })
            .eq('phone', phone)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error updateEntidades Supabase:", err);
        return null;
    }
};

/**
 * Cambia el estado de una sesión
 */
const setEstado = async (phone, nuevoEstado) => {
    try {
        if (!STATES[nuevoEstado]) return null;

        const { data, error } = await supabase
            .from('user_sessions')
            .update({ estado: nuevoEstado, ultimo_mensaje: new Date() })
            .eq('phone', phone)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error setEstado Supabase:", err);
        return null;
    }
};

/**
 * Obtiene todas las sesiones activas en estados pendientes para el vendedor
 */
const getAllPendingSessions = async () => {
    try {
        const activeStates = [
            STATES.ESPERANDO_VENDEDOR,
            STATES.CONFIRMANDO_COMPRA,
            STATES.PAGO_VERIFICADO,
            STATES.ABONO_VERIFICADO,
            STATES.ENCARGO_SOLICITADO,
            STATES.ESPERANDO_SALDO,
            STATES.CICLO_COMPLETO
        ];

        const { data, error } = await supabase
            .from('user_sessions')
            .select('*')
            .in('estado', activeStates)
            .order('ultimo_mensaje', { ascending: false });

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error getAllPendingSessions Supabase:", err);
        return [];
    }
};

/**
 * Obtiene el historial combinando ventas pendientes de archivar (ENTREGADO)
 * y ventas archivadas en el historial permanente (pedidos).
 */
const getHistoricalSessions = async () => {
    try {
        // 1. Obtener sesiones activas en estado ENTREGADO
        const { data: activeData, error: errActive } = await supabase
            .from('user_sessions')
            .select('*')
            .eq('estado', STATES.ENTREGADO);

        if (errActive) throw errActive;

        // 2. Obtener historial persistente de la tabla pedidos
        const { data: archivedData, error: errArchive } = await supabase
            .from('pedidos')
            .select('*')
            .order('archivado_en', { ascending: false });

        if (errArchive) throw errArchive;

        // 3. Mapear pedidos al formato esperado por el Frontend (interfaz Quote)
        const mappedArchived = archivedData.map(p => ({
            id: p.id,
            phone: p.phone,
            estado: p.estado_final === 'ENTREGADO' ? 'ARCHIVADO' : p.estado_final,
            entidades: p.entidades_completas,
            ultimo_mensaje: p.archivado_en,
            updated_at: p.created_at || p.archivado_en
        }));

        // 4. Combinar y ordenar por fecha descendente
        const combined = [...(activeData || []), ...mappedArchived];
        combined.sort((a, b) => new Date(b.updated_at || b.ultimo_mensaje) - new Date(a.updated_at || a.ultimo_mensaje));

        return combined;
    } catch (err) {
        console.error("[Sessions] ❌ Error getHistoricalSessions:", err.message);
        return [];
    }
};

/**
 * Limpia o reinicia una sesión de forma SEGURA.
 * Reinicia TODOS los datos (incluyendo vehículo) para empezar desde cero.
 */
const resetSession = async (phone) => {
    try {
        const { data, error } = await supabase
            .from('user_sessions')
            .update({
                estado: STATES.PERFILANDO,
                entidades: {
                    ...INITIAL_ENTITIES
                },
                ultimo_mensaje: new Date()
            })
            .eq('phone', phone)
            .select()
            .single();

        if (error) throw error;
        console.log(`[Sessions] ♻️  Sesión reseteada limpia para ${phone}. Listo para nueva cotización.`);
        return data;
    } catch (err) {
        console.error('[Sessions] ❌ Error en resetSession:', err.message);
        return null;
    }
};

/**
 * Archiva una sesión completada en la tabla `pedidos` (historial permanente)
 * y luego resetea la sesión activa para permitir una nueva cotización.
 * 
 * Flujo: getSession → INSERT into pedidos → resetSession
 * 
 * @param {string} phone
 * @returns {Promise<Object>} - { archivedPedido, newSession }
 */
const archiveSession = async (phone) => {
    try {
        const session = await getSession(phone);
        const e = session.entidades || {};

        // Calcular el total de la cotización
        const totalCotizacion = (e.repuestos_solicitados || []).reduce((acc, r) => {
            return acc + (parseInt(r.precio) || 0);
        }, 0);

        // INSERT en pedidos: snapshot completo de la venta
        const { data: pedido, error: insertError } = await supabase
            .from('pedidos')
            .insert([{
                phone,
                quote_id: e.quote_id || null,
                estado_final: session.estado,
                // Vehículo
                marca_modelo: e.marca_modelo || null,
                ano: e.ano || null,
                patente: e.patente || null,
                vin: e.vin || null,
                // Productos
                repuestos: e.repuestos_solicitados || [],
                total_cotizacion: totalCotizacion,
                // Pago y despacho
                metodo_pago: e.metodo_pago || null,
                metodo_entrega: e.metodo_entrega || null,
                direccion_envio: e.direccion_envio || null,
                tipo_documento: e.tipo_documento || null,
                datos_factura: e.datos_factura || {},
                // Comprobante
                comprobante_url: e.comprobante_url || null,
                datos_comprobante: e.pago_pendiente || {},
                // Snapshot completo
                entidades_completas: e
            }])
            .select()
            .single();

        if (insertError) {
            console.error('[Sessions] ❌ Error al archivar pedido en tabla pedidos:', insertError.message);
            // No bloqueamos el flujo aunque el archivo falle — el reset sigue adelante
        } else {
            console.log(`[Sessions] 🗄️  Venta archivada → pedido ID: ${pedido.id} | quote: ${pedido.quote_id} | total: $${totalCotizacion}`);
        }

        // Resetear sesión activa (preserva vehículo)
        const newSession = await resetSession(phone);

        return { archivedPedido: pedido || null, newSession };
    } catch (err) {
        console.error('[Sessions] ❌ Error en archiveSession:', err.message);
        return { archivedPedido: null, newSession: null };
    }
};


/**
 * Guarda la URL del comprobante y los datos extraídos por Gemini en la sesión.
 * Cambia el estado a ESPERANDO_APROBACION_ADMIN automáticamente.
 * @param {string} phone 
 * @param {string} comprobanteUrl - URL pública del arquivo en Supabase Storage
 * @param {Object} datosExtraidos - Datos obtenidos de la inferencia multimodal de Gemini
 */
const saveVoucherData = async (phone, comprobanteUrl, datosExtraidos = {}) => {
    try {
        const session = await getSession(phone);
        const entidades = session.entidades || { ...INITIAL_ENTITIES };
        
        const esSaldo = session.estado === STATES.ESPERANDO_SALDO;
        const abonoAnterior = entidades.pago_pendiente?.monto || null;

        // Guardar URL del comprobante y datos extraídos por IA
        entidades.comprobante_url = comprobanteUrl;
        entidades.pago_pendiente = {
            monto: datosExtraidos.monto || null,
            banco_origen: datosExtraidos.banco_origen || null,
            fecha_transaccion: datosExtraidos.fecha_transaccion || null,
            id_transaccion: datosExtraidos.id_transaccion || null,
            rut_origen: datosExtraidos.rut_origen || null,
            nombre_origen: datosExtraidos.nombre_origen || null,
            datos_extraidos_por_ia: true,
            // Nuevos campos para HU-5
            es_saldo: esSaldo,
            abono_previo: esSaldo ? abonoAnterior : null
        };

        const { data, error } = await supabase
            .from('user_sessions')
            .update({
                estado: STATES.ESPERANDO_APROBACION_ADMIN,
                entidades,
                ultimo_mensaje: new Date()
            })
            .eq('phone', phone)
            .select()
            .single();

        if (error) throw error;
        console.log(`[Sessions] ✅ Voucher guardado para ${phone}. Estado: ESPERANDO_APROBACION_ADMIN`);
        return data;
    } catch (err) {
        console.error('[Sessions] ❌ Error en saveVoucherData:', err.message);
        return null;
    }
};

/**
 * Obtiene todas las sesiones en estado ESPERANDO_APROBACION_ADMIN para el panel de administración
 */
const getPendingApprovalSessions = async () => {
    try {
        const { data, error } = await supabase
            .from('user_sessions')
            .select('*')
            .eq('estado', STATES.ESPERANDO_APROBACION_ADMIN)
            .order('ultimo_mensaje', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[Sessions] ❌ Error en getPendingApprovalSessions:', err.message);
        return [];
    }
};

/**
 * Activa o desactiva el modo pausa del agente para un cliente específico.
 * @param {string} phone Teléfono del cliente
 * @param {boolean} pausado True si el bot no debe responder
 */
const setAgentePausado = async (phone, pausado) => {
    try {
        const session = await getSession(phone);
        const entidades = { ...session.entidades, agente_pausado: pausado };

        const { data, error } = await supabase
            .from('user_sessions')
            .update({ entidades })
            .eq('phone', phone)
            .select()
            .single();

        if (error) throw error;
        console.log(`[Sessions] ⏸️ Agente pausado actualizado a ${pausado} para ${phone}`);
        return data;
    } catch (err) {
        console.error('[Sessions] ❌ Error en setAgentePausado:', err.message);
        return null;
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
    STATES
};
