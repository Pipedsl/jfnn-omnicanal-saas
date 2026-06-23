/**
 * cotizaciones.service.js
 *
 * Gestión de cotizaciones persistentes (tabla `cotizaciones`). La PK es el
 * `quote_id` (ej. "JFNN-1A8CCE"). Permite al agente y al vendedor recuperar
 * cotizaciones sin parsear el chat. Validez por defecto: 5 días.
 *
 * Estados:
 *  - ACTIVA    → la cotización está vigente, esperando respuesta del cliente.
 *  - ARCHIVADA → el cliente pidió arrancar nueva pero la guardamos por si vuelve (5 días).
 *  - EXPIRADA  → pasó la fecha de validez sin confirmación.
 *  - CERRADA   → el cliente confirmó la compra Y/O explícitamente la descartó.
 */
const db = require('../config/db');

const VALIDEZ_DIAS = 5;

/**
 * Crear o actualizar una cotización (upsert por quote_id). Se llama desde el
 * endpoint POST /cotizaciones/responder cuando el vendedor envía cotización formal.
 */
const upsertCotizacion = async ({
    quote_id,
    phone,
    nombre_cliente,
    sucursal,
    vendedor_nombre,
    repuestos,
    vehiculos,
    total_aproximado,
    tiene_encargo,
    abono_minimo,
}) => {
    if (!quote_id || !phone) {
        console.warn('[Cotizaciones] upsertCotizacion: faltan quote_id o phone, skip.');
        return null;
    }
    try {
        const validaHasta = new Date(Date.now() + VALIDEZ_DIAS * 24 * 60 * 60 * 1000);
        const { rows } = await db.query(
            `INSERT INTO cotizaciones
                (quote_id, phone, nombre_cliente, sucursal, vendedor_nombre, repuestos,
                 vehiculos, total_aproximado, tiene_encargo, abono_minimo, estado_cotizacion,
                 valida_hasta, enviada_en, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVA',$11,NOW(),NOW())
             ON CONFLICT (quote_id) DO UPDATE SET
                 nombre_cliente   = COALESCE(EXCLUDED.nombre_cliente, cotizaciones.nombre_cliente),
                 vendedor_nombre  = COALESCE(EXCLUDED.vendedor_nombre, cotizaciones.vendedor_nombre),
                 repuestos        = EXCLUDED.repuestos,
                 vehiculos        = EXCLUDED.vehiculos,
                 total_aproximado = EXCLUDED.total_aproximado,
                 tiene_encargo    = EXCLUDED.tiene_encargo,
                 abono_minimo     = COALESCE(EXCLUDED.abono_minimo, cotizaciones.abono_minimo),
                 estado_cotizacion = 'ACTIVA',
                 valida_hasta     = EXCLUDED.valida_hasta,
                 updated_at       = NOW()
             RETURNING *`,
            [quote_id, phone, nombre_cliente || null, sucursal || null, vendedor_nombre || null,
             JSON.stringify(repuestos || []), JSON.stringify(vehiculos || []),
             total_aproximado || 0, !!tiene_encargo, abono_minimo || null, validaHasta]
        );
        console.log(`[Cotizaciones] ✅ upsert quote_id=${quote_id} (válida hasta ${validaHasta.toISOString().slice(0,10)})`);
        return rows[0];
    } catch (err) {
        console.error('[Cotizaciones] ❌ Error en upsertCotizacion:', err.message);
        return null;
    }
};

/**
 * Buscar la última cotización ACTIVA de un phone (la más reciente).
 * Útil para detectar re-engage tras 1h de inactividad o detección textual.
 */
const getCotizacionActivaPorPhone = async (phone) => {
    try {
        const { rows } = await db.query(
            `SELECT * FROM cotizaciones
             WHERE phone = $1 AND estado_cotizacion = 'ACTIVA' AND valida_hasta > NOW()
             ORDER BY enviada_en DESC LIMIT 1`,
            [phone]
        );
        return rows[0] || null;
    } catch (err) {
        console.error('[Cotizaciones] ❌ Error en getCotizacionActivaPorPhone:', err.message);
        return null;
    }
};

/**
 * Cambiar estado de una cotización.
 *   ACTIVA → pendiente · ACEPTADA → cliente confirmó (visible al vendedor en caja)
 *   RECHAZADA → cliente la descartó · CERRADA → venta finalizada/comprada (terminal)
 *   ARCHIVADA → guardada 5 días · EXPIRADA → vencida
 * Para CERRADA y RECHAZADA también marca cerrada_en con NOW() (cierre definitivo).
 */
const setEstado = async (quote_id, nuevoEstado) => {
    if (!['ACTIVA', 'ARCHIVADA', 'EXPIRADA', 'CERRADA', 'ACEPTADA', 'RECHAZADA'].includes(nuevoEstado)) {
        throw new Error(`Estado inválido: ${nuevoEstado}`);
    }
    try {
        const { rows } = await db.query(
            `UPDATE cotizaciones
             SET estado_cotizacion = $1::varchar,
                 cerrada_en = CASE WHEN $1::varchar IN ('CERRADA','RECHAZADA') THEN NOW() ELSE cerrada_en END,
                 updated_at = NOW()
             WHERE quote_id = $2
             RETURNING *`,
            [nuevoEstado, quote_id]
        );
        if (rows[0]) {
            console.log(`[Cotizaciones] 🔁 ${quote_id} → ${nuevoEstado}`);
        }
        return rows[0] || null;
    } catch (err) {
        console.error('[Cotizaciones] ❌ Error en setEstado:', err.message);
        return null;
    }
};

/**
 * Marca como EXPIRADA todas las cotizaciones ACTIVAS cuya validez ya pasó.
 * Llamada por cron interno cada 1h.
 */
const expirarAntiguas = async () => {
    try {
        const { rows } = await db.query(
            `UPDATE cotizaciones
             SET estado_cotizacion = 'EXPIRADA', updated_at = NOW()
             WHERE estado_cotizacion = 'ACTIVA' AND valida_hasta < NOW()
             RETURNING quote_id`
        );
        if (rows.length > 0) {
            console.log(`[Cotizaciones] ⏰ ${rows.length} cotizaciones expiradas: ${rows.map(r => r.quote_id).join(', ')}`);
        }
        return rows.length;
    } catch (err) {
        console.error('[Cotizaciones] ❌ Error en expirarAntiguas:', err.message);
        return 0;
    }
};

/**
 * Listar cotizaciones con filtros (para vista de dashboard).
 */
const listar = async ({ estado, phone, sucursal, vendedor, limit = 100 } = {}) => {
    const conditions = [];
    const params = [];
    if (estado) { params.push(estado); conditions.push(`estado_cotizacion = $${params.length}`); }
    if (phone) { params.push(phone); conditions.push(`phone = $${params.length}`); }
    if (sucursal) { params.push(sucursal); conditions.push(`sucursal = $${params.length}`); }
    if (vendedor) { params.push(vendedor); conditions.push(`vendedor_nombre = $${params.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    try {
        const { rows } = await db.query(
            `SELECT * FROM cotizaciones ${where} ORDER BY enviada_en DESC LIMIT $${params.length}`,
            params
        );
        return rows;
    } catch (err) {
        console.error('[Cotizaciones] ❌ Error en listar:', err.message);
        return [];
    }
};

/**
 * Obtener una cotización por quote_id.
 */
const getByQuoteId = async (quote_id) => {
    try {
        const { rows } = await db.query('SELECT * FROM cotizaciones WHERE quote_id = $1', [quote_id]);
        return rows[0] || null;
    } catch (err) {
        console.error('[Cotizaciones] ❌ Error en getByQuoteId:', err.message);
        return null;
    }
};

module.exports = {
    VALIDEZ_DIAS,
    upsertCotizacion,
    getCotizacionActivaPorPhone,
    setEstado,
    expirarAntiguas,
    listar,
    getByQuoteId,
};
