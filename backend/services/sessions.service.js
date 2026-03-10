/**
 * Servicio para gestionar las sesiones de los clientes en Supabase (PostgreSQL).
 * Almacena el estado de la conversación y las entidades extraídas.
 */
const supabase = require('../config/supabase');

const STATES = {
    PERFILANDO: 'PERFILANDO',
    ESPERANDO_VENDEDOR: 'ESPERANDO_VENDEDOR',
    CONFIRMANDO_COMPRA: 'CONFIRMANDO_COMPRA',
    ESPERANDO_APROBACION_ADMIN: 'ESPERANDO_APROBACION_ADMIN', // ← Nuevo: comprobante enviado, pendiente de revisión humana
    PAGO_VERIFICADO: 'PAGO_VERIFICADO',
    ENTREGADO: 'ENTREGADO',
    CICLO_COMPLETO: 'CICLO_COMPLETO',
    ARCHIVADO: 'ARCHIVADO'
};

const INITIAL_ENTITIES = {
    marca_modelo: null,
    ano: null,
    cilindraje: null,
    patente: null,
    repuestos_solicitados: [],
    vin: null,
    sintomas_reportados: null,
    metodo_pago: null,
    metodo_entrega: null,
    direccion_envio: null,
    tipo_documento: null,
    datos_factura: {
        rut: null,
        razon_social: null,
        giro: null
    },
    quote_id: null,
    // Campos de comprobante de pago (poblados en ESPERANDO_APROBACION_ADMIN)
    comprobante_url: null,
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

        // Fusionar repuestos_solicitados
        if (nuevasEntidades.repuestos_solicitados && Array.isArray(nuevasEntidades.repuestos_solicitados)) {
            const existingNames = new Set(entities.repuestos_solicitados.map(r => r.nombre.toLowerCase()));

            nuevasEntidades.repuestos_solicitados.forEach(nuevo => {
                if (!existingNames.has(nuevo.nombre.toLowerCase())) {
                    entities.repuestos_solicitados.push(nuevo);
                    existingNames.add(nuevo.nombre.toLowerCase());
                }
            });
            delete nuevasEntidades.repuestos_solicitados;
        }

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
 * Obtiene el historial de ventas finalizadas
 */
const getHistoricalSessions = async () => {
    try {
        const historyStates = [STATES.ENTREGADO, STATES.ARCHIVADO];

        const { data, error } = await supabase
            .from('user_sessions')
            .select('*')
            .in('estado', historyStates)
            .order('ultimo_mensaje', { ascending: false });

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error getHistoricalSessions Supabase:", err);
        return [];
    }
};

/**
 * Limpia o reinicia una sesión de forma SEGURA.
 */
const resetSession = async (phone) => {
    try {
        const session = await getSession(phone);

        const vehicleData = {
            marca_modelo: session.entidades.marca_modelo,
            ano: session.entidades.ano,
            cilindraje: session.entidades.cilindraje,
            patente: session.entidades.patente,
            vin: session.entidades.vin,
        };

        const { data, error } = await supabase
            .from('user_sessions')
            .update({
                estado: STATES.PERFILANDO,
                entidades: {
                    ...INITIAL_ENTITIES,
                    ...vehicleData
                },
                ultimo_mensaje: new Date()
            })
            .eq('phone', phone)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Error resetSession Supabase:", err);
        return null;
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

        // Guardar URL del comprobante y datos extraídos por IA
        entidades.comprobante_url = comprobanteUrl;
        entidades.pago_pendiente = {
            monto: datosExtraidos.monto || null,
            banco_origen: datosExtraidos.banco_origen || null,
            fecha_transaccion: datosExtraidos.fecha_transaccion || null,
            id_transaccion: datosExtraidos.id_transaccion || null,
            rut_origen: datosExtraidos.rut_origen || null,
            nombre_origen: datosExtraidos.nombre_origen || null,
            datos_extraidos_por_ia: true
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

module.exports = {
    getSession,
    updateEntidades,
    setEstado,
    resetSession,
    getAllPendingSessions,
    getHistoricalSessions,
    saveVoucherData,
    getPendingApprovalSessions,
    STATES
};
