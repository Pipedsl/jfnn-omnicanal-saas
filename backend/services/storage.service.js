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
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

const _upload = async (subfolder, phone, buffer, mimeType) => {
    const client = _getClient();
    if (!client) return null;

    // Validación de tamaño — riesgo R2
    if (buffer && buffer.length > MAX_BYTES) {
        console.warn(`[Storage] ⚠️ Archivo de ${phone} supera 16 MB (${(buffer.length / 1024 / 1024).toFixed(1)} MB). No se sube.`);
        return null;
    }

    const sanitizedPhone = phone.replace(/[^0-9]/g, '');
    const ext = _mimeToExt(mimeType);
    const fileName = `${sanitizedPhone}_${Date.now()}.${ext}`;
    const objectPath = `${subfolder}/${fileName}`;

    // Retry con backoff: Supabase Storage devuelve Gateway Timeout intermitente.
    const maxIntentos = 3;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            const { error } = await client.storage
                .from(BUCKET)
                .upload(objectPath, buffer, {
                    contentType: mimeType || 'application/octet-stream',
                    upsert: true, // upsert true para que un reintento no falle por "ya existe"
                });

            if (!error) {
                console.log(`[Storage] ✅ Subido: ${BUCKET}/${objectPath}${intento > 1 ? ` (intento ${intento})` : ''}`);
                return objectPath;
            }
            console.error(`[Storage] ⚠️ Intento ${intento}/${maxIntentos} subiendo ${objectPath}:`, error.message);
        } catch (err) {
            console.error(`[Storage] ⚠️ Excepción intento ${intento}/${maxIntentos} (${subfolder}):`, err.message);
        }
        if (intento < maxIntentos) await _sleep(intento * 800); // 800ms, 1600ms
    }
    console.error(`[Storage] ❌ Falló subida tras ${maxIntentos} intentos: ${objectPath}`);
    return null;
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
 * Sube una imagen enviada por el vendedor (foto de repuesto para mostrar al cliente).
 */
const uploadVendorImage = async (phone, imageBuffer, mimeType) => {
    return _upload('vendor-images', phone, imageBuffer, mimeType);
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

// Cache en memoria de signed URLs por objectPath. TTL = expiresIn - 5 minutos
// de margen. Evita pedir signed URL al Storage en cada poll del dashboard
// (bandeja + chat actualizan cada 4-8s).
const SIGNED_URL_CACHE = new Map();
const SIGNED_URL_CACHE_MAX = 500;
const SIGNED_URL_SAFETY_MARGIN_MS = 5 * 60 * 1000;

const getSignedUrl = async (objectPath, expiresIn = 3600) => {
    const client = _getClient();
    if (!client || !objectPath) return null;

    // Cache hit: si la URL en cache aún tiene >5min de vida, reusar.
    const cached = SIGNED_URL_CACHE.get(objectPath);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.signedUrl;
    }

    // Retry: Supabase devuelve Gateway Timeout intermitente al firmar URLs.
    const maxIntentos = 2;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            const { data, error } = await client.storage
                .from(BUCKET)
                .createSignedUrl(objectPath, expiresIn);

            if (!error && data?.signedUrl) {
                // Guardar en cache. LRU naive: si está lleno, drop el más viejo.
                if (SIGNED_URL_CACHE.size >= SIGNED_URL_CACHE_MAX) {
                    const oldestKey = SIGNED_URL_CACHE.keys().next().value;
                    if (oldestKey) SIGNED_URL_CACHE.delete(oldestKey);
                }
                SIGNED_URL_CACHE.set(objectPath, {
                    signedUrl: data.signedUrl,
                    expiresAt: Date.now() + (expiresIn * 1000) - SIGNED_URL_SAFETY_MARGIN_MS,
                });
                return data.signedUrl;
            }
            if (error) console.error(`[Storage] ⚠️ Intento ${intento}/${maxIntentos} firmando ${objectPath}:`, error.message);
        } catch (err) {
            console.error(`[Storage] ⚠️ Excepción intento ${intento}/${maxIntentos} en getSignedUrl:`, err.message);
        }
        if (intento < maxIntentos) await _sleep(500);
    }
    return null;
};

// Invalidar cache manualmente (cuando un archivo se borra/reemplaza).
const invalidateSignedUrlCache = (objectPath) => {
    if (objectPath) SIGNED_URL_CACHE.delete(objectPath);
    else SIGNED_URL_CACHE.clear();
};

module.exports = {
    uploadVoucher,
    uploadPartImage,
    uploadVendorImage,
    uploadAudio,
    uploadVideo,
    uploadDocument,
    getSignedUrl,
    invalidateSignedUrlCache,
};
