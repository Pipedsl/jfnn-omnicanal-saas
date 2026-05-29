/**
 * mensajes.service.js
 * REQ-04 Fase 1 — Persistencia de mensajes entrantes y salientes de WhatsApp.
 *
 * Todas las escrituras usan ON CONFLICT (wa_message_id) DO NOTHING para deduplicar
 * reintentos de webhook de Meta (riesgo R9 del plan).
 *
 * La escritura a esta tabla es ADITIVA: si el INSERT falla, el error se loguea y
 * el flujo de Gemini / cotización continúa normalmente (riesgo R1 del plan).
 */

'use strict';

const db = require('../config/db');

/**
 * Registra un mensaje ENTRANTE (cliente → sistema).
 *
 * @param {object} params
 * @param {string} params.phone          - Número del cliente (E.164, sin +)
 * @param {string} params.tipo           - 'text' | 'image' | 'audio' | 'video' | 'document'
 * @param {string|null} params.contenido - Cuerpo de texto o caption de la imagen
 * @param {string|null} params.mediaUrl  - URL/path del media (null si tipo=text)
 * @param {string|null} params.mediaMime - MIME type del media
 * @param {string|null} params.waMessageId - ID único del mensaje en Meta (para dedupe)
 * @param {string|null} params.sucursal  - Sucursal derivada (puede ser null en el punto de webhook)
 * @param {string|null} params.transcripcion - Transcripción de audio (solo tipo='audio', Fase 2)
 * @returns {Promise<object|null>} La fila insertada o null si hubo conflicto/error
 */
const registrarEntrante = async ({
    phone,
    tipo,
    contenido = null,
    mediaUrl = null,
    mediaMime = null,
    waMessageId = null,
    mediaId = null,
    sucursal = null,
    transcripcion = null,
}) => {
    try {
        if (waMessageId) {
            const dup = await db.query(
                'SELECT id FROM mensajes WHERE wa_message_id = $1 LIMIT 1',
                [waMessageId]
            );
            if (dup.rows.length > 0) {
                console.log(`[Mensajes] ℹ️ Entrante ignorado (wa_message_id duplicado): ${waMessageId}`);
                return null;
            }
        }

        const result = await db.query(
            `INSERT INTO mensajes
                (phone, direccion, tipo, contenido, media_url, media_mime, transcripcion, autor, sucursal, wa_message_id, media_id)
             VALUES ($1, 'entrante', $2, $3, $4, $5, $6, 'cliente', $7, $8, $9)
             RETURNING *`,
            [phone, tipo, contenido, mediaUrl, mediaMime, transcripcion, sucursal, waMessageId, mediaId]
        );

        console.log(`[Mensajes] ✅ Entrante registrado id=${result.rows[0].id} phone=${phone} tipo=${tipo}`);
        return result.rows[0];
    } catch (err) {
        console.error(`[Mensajes] ❌ Error registrando entrante de ${phone}:`, err.message);
        return null;
    }
};

/**
 * Registra un mensaje SALIENTE (sistema → cliente).
 *
 * @param {object} params
 * @param {string} params.phone          - Número del cliente
 * @param {string} params.tipo           - 'text' | 'image' | 'audio' | 'video' | 'document'
 * @param {string|null} params.contenido - Texto del mensaje enviado
 * @param {string|null} params.mediaUrl  - URL/path del media si aplica
 * @param {string|null} params.mediaMime - MIME type del media
 * @param {'agente_ia'|'vendedor'} params.autor - Quién envió el mensaje
 * @param {string|null} params.autorNombre - Nombre del vendedor (solo cuando autor='vendedor')
 * @param {string|null} params.sucursal  - Sucursal de la conversación
 * @returns {Promise<object|null>} La fila insertada o null si hubo error
 */
const registrarSaliente = async ({
    phone,
    tipo = 'text',
    contenido = null,
    mediaUrl = null,
    mediaMime = null,
    autor,
    autorNombre = null,
    sucursal = null,
}) => {
    try {
        const result = await db.query(
            `INSERT INTO mensajes
                (phone, direccion, tipo, contenido, media_url, media_mime, autor, autor_nombre, sucursal)
             VALUES ($1, 'saliente', $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [phone, tipo, contenido, mediaUrl, mediaMime, autor, autorNombre, sucursal]
        );

        console.log(`[Mensajes] ✅ Saliente registrado id=${result.rows[0].id} phone=${phone} autor=${autor}`);
        return result.rows[0];
    } catch (err) {
        console.error(`[Mensajes] ❌ Error registrando saliente para ${phone}:`, err.message);
        return null;
    }
};

/**
 * Lista mensajes de una conversación en orden cronológico ascendente con paginación.
 *
 * @param {string} phone           - Número del cliente
 * @param {object} [options]
 * @param {number} [options.limit=50]    - Cantidad máxima de mensajes a devolver
 * @param {string} [options.before]      - ISO timestamp: devuelve mensajes anteriores a esta fecha (scroll infinito)
 * @returns {Promise<object[]>} Array de filas ordenadas por created_at ASC
 */
const listarPorPhone = async (phone, { limit = 50, before = null } = {}) => {
    try {
        let query;
        let params;

        if (before) {
            query = `
                SELECT * FROM (
                    SELECT * FROM mensajes
                    WHERE phone = $1 AND created_at < $2
                    ORDER BY created_at DESC
                    LIMIT $3
                ) sub ORDER BY created_at ASC
            `;
            params = [phone, before, limit];
        } else {
            query = `
                SELECT * FROM (
                    SELECT * FROM mensajes
                    WHERE phone = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                ) sub ORDER BY created_at ASC
            `;
            params = [phone, limit];
        }

        const result = await db.query(query, params);
        return result.rows;
    } catch (err) {
        console.error(`[Mensajes] ❌ Error listando mensajes de ${phone}:`, err.message);
        return [];
    }
};

/**
 * Lista conversaciones activas agrupadas por phone, con el último mensaje y su timestamp.
 * Destinado al panel de conversaciones del dashboard (Fase 3).
 *
 * @param {object} [options]
 * @param {string|null} [options.sucursal] - Filtrar por sucursal; null devuelve todas
 * @returns {Promise<object[]>}
 */
const listarConversacionesActivas = async ({ sucursal = null, q = null } = {}) => {
    try {
        // Optimización: usamos DISTINCT ON + LEFT JOIN para traer en UNA sola query
        // toda la metadata del último mensaje + datos de la sesión. Antes hacíamos
        // N queries adicionales (1 por phone) con getSession() → causaba lentitud
        // con muchas conversaciones (305+).
        const conds = [];
        const params = [];
        if (sucursal) {
            params.push(sucursal);
            conds.push(`m.phone IN (SELECT DISTINCT phone FROM mensajes WHERE sucursal = $${params.length})`);
        }
        // Búsqueda por número, nombre del cliente o palabra clave en mensajes.
        // Accent-insensitive: clientes/vendedores tipean sin tildes ("direccion" vs
        // "dirección"). translate() normaliza acentos en ambos lados sin necesidad de la
        // extensión unaccent. Así la búsqueda por palabra clave encuentra el texto del
        // chat sin importar tildes ni mayúsculas.
        if (q && q.trim()) {
            const term = `%${q.trim()}%`;
            params.push(term);
            const pIdx = params.length;
            // unaccent casero vía translate: minúsculas + quita tildes/ñ/ü.
            const norm = (col) => `translate(lower(${col}), 'áéíóúüñ', 'aeiouun')`;
            const t = norm(`$${pIdx}`);
            conds.push(`m.phone IN (
                SELECT DISTINCT mm.phone FROM mensajes mm
                LEFT JOIN user_sessions ss ON ss.phone = mm.phone
                WHERE mm.phone ILIKE $${pIdx}
                   OR ${norm('mm.contenido')} LIKE ${t}
                   OR ${norm('mm.transcripcion')} LIKE ${t}
                   OR ${norm(`ss.entidades->>'nombre_cliente'`)} LIKE ${t}
            )`);
        }
        const whereClause = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
        // Cuando hay búsqueda, limitar resultados; sin búsqueda, traer todo (con LIMIT defensivo)
        const limitClause = q && q.trim() ? 'LIMIT 50' : 'LIMIT 500';

        const query = `
            WITH agg AS (
                SELECT
                    m.phone,
                    MAX(m.sucursal) AS sucursal_msg,
                    MAX(m.created_at) AS ultimo_mensaje_at,
                    COUNT(*) FILTER (WHERE m.direccion = 'entrante') AS total_entrantes
                FROM mensajes m
                ${whereClause}
                GROUP BY m.phone
            ),
            ultimo AS (
                SELECT DISTINCT ON (m.phone) m.phone, m.contenido
                FROM mensajes m
                ${whereClause}
                ORDER BY m.phone, m.created_at DESC
            )
            SELECT
                a.phone,
                COALESCE(a.sucursal_msg, s.sucursal) AS sucursal,
                a.ultimo_mensaje_at,
                u.contenido AS ultimo_contenido,
                a.total_entrantes,
                s.estado,
                COALESCE(NULLIF(s.entidades->>'nombre_cliente', ''), c.nombre) AS nombre_cliente,
                s.entidades->>'marca_modelo' AS marca_modelo,
                COALESCE((s.entidades->>'agente_pausado')::boolean, false) AS agente_pausado,
                s.entidades->'consulta_pendiente' AS consulta_pendiente,
                s.entidades->'marca' AS marca
            FROM agg a
            LEFT JOIN ultimo u ON u.phone = a.phone
            LEFT JOIN user_sessions s ON s.phone = a.phone
            LEFT JOIN clientes c ON c.phone = a.phone
            ORDER BY a.ultimo_mensaje_at DESC
            ${limitClause}
        `;

        const result = await db.query(query, params);
        return result.rows;
    } catch (err) {
        console.error(`[Mensajes] ❌ Error listando conversaciones activas:`, err.message);
        return [];
    }
};

/**
 * Actualiza media_url, media_mime y/o transcripcion en un mensaje ya registrado.
 * Usado en Fase 2 para actualizar el registro de audio/video/documento tras
 * la subida asíncrona a Supabase Storage (el INSERT ocurrió al llegar el webhook,
 * antes de que el media se descargara y subiera).
 *
 * @param {string} waMessageId   - ID del mensaje en Meta (clave de búsqueda)
 * @param {object} fields
 * @param {string|null} fields.mediaUrl     - Path interno en Supabase Storage
 * @param {string|null} fields.mediaMime    - MIME type del archivo
 * @param {string|null} fields.transcripcion - Transcripción de audio (opcional)
 * @returns {Promise<object|null>} Fila actualizada o null si no encontró / error
 */
const actualizarMedia = async (waMessageId, { mediaUrl = null, mediaMime = null, transcripcion = null } = {}) => {
    if (!waMessageId) return null;
    try {
        const result = await db.query(
            `UPDATE mensajes
             SET media_url = COALESCE($2, media_url),
                 media_mime = COALESCE($3, media_mime),
                 transcripcion = COALESCE($4, transcripcion)
             WHERE wa_message_id = $1
             RETURNING *`,
            [waMessageId, mediaUrl, mediaMime, transcripcion]
        );
        if (result.rows.length === 0) {
            console.warn(`[Mensajes] ⚠️ actualizarMedia: no se encontró mensaje con wa_message_id=${waMessageId}`);
            return null;
        }
        console.log(`[Mensajes] ✅ Media actualizada para wa_message_id=${waMessageId}`);
        return result.rows[0];
    } catch (err) {
        console.error(`[Mensajes] ❌ Error en actualizarMedia (wa_message_id=${waMessageId}):`, err.message);
        return null;
    }
};

module.exports = {
    registrarEntrante,
    registrarSaliente,
    actualizarMedia,
    listarPorPhone,
    listarConversacionesActivas,
};
