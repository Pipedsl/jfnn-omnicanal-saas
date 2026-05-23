'use strict';

/**
 * storage.service.js
 * REQ-04 Fase 2 — Migración de almacenamiento local efímero a Supabase Storage.
 *
 * Bucket: whatsapp-media (privado, proyecto jfnn-omnicanal-prod)
 * Subcarpetas:
 *   comprobantes/   — vouchers de pago (uploadVoucher)
 *   part-images/    — fotos de repuestos enviadas por clientes (uploadPartImage)
 *   audios/         — notas de voz (uploadAudio)
 *   videos/         — videos (uploadVideo)
 *   documents/      — documentos (uploadDocument)
 *
 * Todas las funciones devuelven el PATH interno del objeto en el bucket (string),
 * NO una URL pública. La generación de URLs firmadas para el dashboard es de la Fase 3.
 *
 * Política de error: si Supabase falla, se loguea y se retorna null. El caller
 * (whatsapp.controller.js) decide si es bloqueante o no (riesgo R1 del plan).
 *
 * Límite: archivos >16 MB son rechazados sin intentar la subida (límite Meta, riesgo R2).
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const BUCKET = 'whatsapp-media';
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB — límite Meta (riesgo R2)

// Inicializar cliente solo si las variables están disponibles (en prod vienen de Railway).
// En dev local sin credenciales, las funciones loguean un warning y retornan null.
let supabase = null;

const _getClient = () => {
    if (supabase) return supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        console.warn('[Storage] ⚠️ SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados. Storage deshabilitado (modo dev local).');
        return null;
    }

    supabase = createClient(url, key, {
        auth: { persistSession: false },
        realtime: { transport: WebSocket },
    });
    console.log('[Storage] ✅ Cliente Supabase Storage inicializado.');
    return supabase;
};

/**
 * Sube un buffer al bucket whatsapp-media bajo la subcarpeta dada.
 * Función interna compartida por todas las variantes públicas.
 *
 * @param {string} subfolder   - 'comprobantes' | 'part-images' | 'audios' | 'videos' | 'documents'
 * @param {string} phone       - Número del cliente (para nombre de archivo)
 * @param {Buffer} buffer      - Contenido binario del archivo
 * @param {string} mimeType    - MIME type (ej: 'image/jpeg', 'audio/ogg')
 * @returns {Promise<string|null>} Path interno del objeto (ej: 'comprobantes/56912345678_1716000000.jpg') o null
 */
const _upload = async (subfolder, phone, buffer, mimeType) => {
    const client = _getClient();
    if (!client) return null;

    // Validación de tamaño — riesgo R2
    if (buffer && buffer.length > MAX_BYTES) {
        console.warn(`[Storage] ⚠️ Archivo de ${phone} supera 16 MB (${(buffer.length / 1024 / 1024).toFixed(1)} MB). No se sube.`);
        return null;
    }

    try {
        const sanitizedPhone = phone.replace(/[^0-9]/g, '');
        const ext = _mimeToExt(mimeType);
        const fileName = `${sanitizedPhone}_${Date.now()}.${ext}`;
        const objectPath = `${subfolder}/${fileName}`;

        const { error } = await client.storage
            .from(BUCKET)
            .upload(objectPath, buffer, {
                contentType: mimeType || 'application/octet-stream',
                upsert: false,
            });

        if (error) {
            console.error(`[Storage] ❌ Error subiendo a ${BUCKET}/${objectPath}:`, error.message);
            return null;
        }

        console.log(`[Storage] ✅ Subido: ${BUCKET}/${objectPath}`);
        return objectPath;

    } catch (err) {
        console.error(`[Storage] ❌ Excepción en _upload (${subfolder}):`, err.message);
        return null;
    }
};

/**
 * Convierte un MIME type a extensión de archivo.
 */
const _mimeToExt = (mimeType) => {
    if (!mimeType) return 'bin';
    const map = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'audio/wav': 'wav',
        'audio/opus': 'opus',
        'video/mp4': 'mp4',
        'video/3gpp': '3gp',
        'video/quicktime': 'mov',
        'application/pdf': 'pdf',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };
    const lower = mimeType.toLowerCase().split(';')[0].trim();
    if (map[lower]) return map[lower];
    // Fallback: tomar la parte después de '/'
    const parts = lower.split('/');
    return parts[1]?.replace('jpeg', 'jpg') || 'bin';
};

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Sube el comprobante de pago de un cliente.
 * Firma mantenida idéntica a la versión anterior para no romper callers.
 *
 * @param {string} phone
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<string|null>} Path interno en Supabase Storage, o null
 */
const uploadVoucher = async (phone, imageBuffer, mimeType) => {
    return _upload('comprobantes', phone, imageBuffer, mimeType);
};

/**
 * Sube una imagen de repuesto/pieza enviada por el cliente.
 * Firma mantenida idéntica a la versión anterior para no romper callers.
 *
 * @param {string} phone
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<string|null>} Path interno en Supabase Storage, o null
 */
const uploadPartImage = async (phone, imageBuffer, mimeType) => {
    return _upload('part-images', phone, imageBuffer, mimeType);
};

/**
 * Sube una nota de voz.
 *
 * @param {string} phone
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @returns {Promise<string|null>} Path interno en Supabase Storage, o null
 */
const uploadAudio = async (phone, audioBuffer, mimeType) => {
    return _upload('audios', phone, audioBuffer, mimeType);
};

/**
 * Sube un video enviado por el cliente.
 * No se procesa con Gemini en esta fase (riesgo R3 — costo).
 *
 * @param {string} phone
 * @param {Buffer} videoBuffer
 * @param {string} mimeType
 * @returns {Promise<string|null>} Path interno en Supabase Storage, o null
 */
const uploadVideo = async (phone, videoBuffer, mimeType) => {
    return _upload('videos', phone, videoBuffer, mimeType);
};

/**
 * Sube un documento (PDF, Word, etc.) enviado por el cliente.
 * No se procesa con Gemini en esta fase (riesgo R3 — costo).
 *
 * @param {string} phone
 * @param {Buffer} docBuffer
 * @param {string} mimeType
 * @returns {Promise<string|null>} Path interno en Supabase Storage, o null
 */
const uploadDocument = async (phone, docBuffer, mimeType) => {
    return _upload('documents', phone, docBuffer, mimeType);
};

const getSignedUrl = async (objectPath, expiresIn = 3600) => {
    const client = _getClient();
    if (!client || !objectPath) return null;

    try {
        const { data, error } = await client.storage
            .from(BUCKET)
            .createSignedUrl(objectPath, expiresIn);

        if (error) {
            console.error(`[Storage] ❌ Error generando signed URL para ${objectPath}:`, error.message);
            return null;
        }
        return data.signedUrl;
    } catch (err) {
        console.error(`[Storage] ❌ Excepción en getSignedUrl:`, err.message);
        return null;
    }
};

module.exports = {
    uploadVoucher,
    uploadPartImage,
    uploadAudio,
    uploadVideo,
    uploadDocument,
    getSignedUrl,
};
