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
    datos_factura: { rut: null, razon_social: null, giro: null },
    pago_pendiente: {
        monto: null, banco_origen: null, fecha_transaccion: null,
        id_transaccion: null, rut_origen: null, nombre_origen: null,
        datos_extraidos_por_ia: true
    }
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
            // Crear sesión nueva
            const { rows: newRows } = await db.query(
                `INSERT INTO user_sessions (phone, estado, entidades, ultimo_mensaje)
                 VALUES ($1, $2, $3, NOW())
                 RETURNING *`,
                [phone, STATES.PERFILANDO, JSON.stringify(INITIAL_ENTITIES)]
            );
            result = rowToSession(newRows[0]);
        } else {
            result = rowToSession(rows[0]);
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

        // MERGE inteligente de repuestos
        if (nuevasEntidades.repuestos_solicitados && Array.isArray(nuevasEntidades.repuestos_solicitados)) {
            nuevasEntidades.repuestos_solicitados.forEach(nuevo => {
                const nuevoNombre = nuevo.nombre.toLowerCase().trim();

                const refinedIdx = entities.repuestos_solicitados.findIndex(existente => {
                    const existenteNombre = existente.nombre.toLowerCase().trim();
                    return existenteNombre !== nuevoNombre && (
                        nuevoNombre.includes(existenteNombre) || existenteNombre.includes(nuevoNombre)
                    );
                });

                if (refinedIdx !== -1) {
                    const viejo = entities.repuestos_solicitados[refinedIdx];
                    const nombreFinal = nuevo.nombre.length >= viejo.nombre.length ? nuevo.nombre : viejo.nombre;
                    entities.repuestos_solicitados[refinedIdx] = {
                        ...viejo, nombre: nombreFinal,
                        estado: nuevo.estado || viejo.estado,
                        precio: nuevo.precio !== undefined ? nuevo.precio : viejo.precio,
                        codigo: nuevo.codigo !== undefined ? nuevo.codigo : viejo.codigo,
                        disponibilidad: nuevo.disponibilidad || viejo.disponibilidad
                    };
                    return;
                }

                const exactIdx = entities.repuestos_solicitados.findIndex(
                    e => e.nombre.toLowerCase().trim() === nuevoNombre
                );

                if (exactIdx !== -1) {
                    entities.repuestos_solicitados[exactIdx] = {
                        ...entities.repuestos_solicitados[exactIdx],
                        estado: nuevo.estado || entities.repuestos_solicitados[exactIdx].estado,
                        precio: nuevo.precio !== undefined ? nuevo.precio : entities.repuestos_solicitados[exactIdx].precio,
                        codigo: nuevo.codigo !== undefined ? nuevo.codigo : entities.repuestos_solicitados[exactIdx].codigo,
                        disponibilidad: nuevo.disponibilidad || entities.repuestos_solicitados[exactIdx].disponibilidad
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
            STATES.PAGO_VERIFICADO, STATES.ABONO_VERIFICADO,
            STATES.ENCARGO_SOLICITADO, STATES.ESPERANDO_SALDO, STATES.CICLO_COMPLETO
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
        return globalPendingCache.data || [];
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

        const { rows: pedidoRows } = await db.query(
            `INSERT INTO pedidos (phone, quote_id, estado_final, marca_modelo, ano, patente, vin,
             repuestos, total_cotizacion, metodo_pago, metodo_entrega, direccion_envio,
             tipo_documento, datos_factura, comprobante_url, datos_comprobante, entidades_completas)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [
                phone, e.quote_id || null, session.estado,
                e.marca_modelo || null, e.ano || null, e.patente || null, e.vin || null,
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
