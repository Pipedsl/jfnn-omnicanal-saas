const axios = require('axios');
const sessionsService = require('./sessions.service');
const mensajesService = require('./mensajes.service');

/**
 * Helper interno: persiste un mensaje saliente en la tabla `mensajes`.
 * Se llama desde sendSellerMessage/sendAgentMessage para mantener consistencia
 * entre lo que se envía a Meta y lo visible en el chat panel.
 */
const _persistSaliente = async (to, text, { autor, autorNombre }) => {
    try {
        const session = await sessionsService.getSession(to).catch(() => null);
        await mensajesService.registrarSaliente({
            phone: to,
            tipo: 'text',
            contenido: text,
            autor,
            autorNombre: autorNombre || null,
            sucursal: session?.sucursal || 'Melipilla',
        });
    } catch (err) {
        console.error(`[Mensajes] ⚠️ No se pudo persistir saliente para ${to} (envío sí completó):`, err.message);
    }
};

/**
 * Servicio para enviar mensajes vía WhatsApp Cloud API (Meta)
 */

const WINDOW_CLOSED_ERROR = 'WHATSAPP_WINDOW_CLOSED';
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

// Retry para errores 5xx de Meta y errores de red (ej: outage parcial 2026-06-12
// con "OAuth Facebook Platform / unknown_error / HTTP 500"). NO reintenta 4xx
// (incluido 130472 que tiene fallback HSM dedicado). Backoff exponencial 1s/3s/9s.
const TRANSIENT_RETRY_MAX = 3;
const TRANSIENT_RETRY_BACKOFF_MS = [1000, 3000, 9000];
const _isTransientMetaError = (err) => {
    if (!err.response) return true; // network: ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.
    const s = err.response.status;
    return s >= 500 && s < 600;
};
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Templates HSM aprobados por Meta. Centralizados aquí para que el fallback
// automático fuera de la ventana de 24h pueda usar el correcto sin tocar callers.
const TEMPLATES = {
    REOPEN_24H: { name: 'retomar_cotizacion', language: 'es_CL' }
};

/**
 * Envía un mensaje de texto plano a un número de teléfono específico.
 * Si la ventana de 24h está cerrada (error 130472) y hay un template de re-apertura
 * configurado, intenta automáticamente enviar la plantilla aprobada como fallback.
 */
const sendTextMessage = async (to, text) => {
    let lastError;
    let response;
    for (let attempt = 0; attempt < TRANSIENT_RETRY_MAX; attempt++) {
        try {
            response = await axios.post(
                `${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_ID}/messages`,
                {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: to,
                    type: "text",
                    text: {
                        preview_url: false,
                        body: text
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            lastError = null;
            break;
        } catch (err) {
            lastError = err;
            if (_isTransientMetaError(err) && attempt < TRANSIENT_RETRY_MAX - 1) {
                const wait = TRANSIENT_RETRY_BACKOFF_MS[attempt];
                const status = err.response?.status || 'NETERR';
                console.warn(`⏳ [WhatsApp] retry ${attempt + 1}/${TRANSIENT_RETRY_MAX - 1} para ${to} tras ${status} de Meta. Esperando ${wait}ms...`);
                await _sleep(wait);
                continue;
            }
            break;
        }
    }
    try {
        if (lastError) throw lastError;
        const messageId = response.data?.messages?.[0]?.id || 'ID no disponible';
        console.log(`✅ [WhatsApp] Mensaje entregado a Meta para ${to} | message_id: ${messageId}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        const errorCode = error.response?.data?.error?.code;
        const errorSubcode = error.response?.data?.error?.error_subcode;

        // Error 130472 / subcode 2494010 = fuera de la ventana de 24h de Meta.
        // Fuera de esa ventana, solo se permiten mensajes de plantilla pre-aprobada.
        if (errorCode === 130472 || errorSubcode === 2494010) {
            console.warn(`⚠️ [WhatsApp] Ventana 24h cerrada para ${to}. Intentando fallback con plantilla "${TEMPLATES.REOPEN_24H.name}"...`);
            try {
                const tplResponse = await sendTemplateMessage(
                    to,
                    TEMPLATES.REOPEN_24H.name,
                    TEMPLATES.REOPEN_24H.language,
                    []
                );
                console.log(`✅ [WhatsApp] Fallback HSM enviado a ${to} tras ventana cerrada.`);
                return tplResponse;
            } catch (tplErr) {
                console.error(`❌ [WhatsApp] Fallback HSM también falló para ${to}:`, tplErr.message);
                const windowError = new Error(WINDOW_CLOSED_ERROR);
                windowError.code = WINDOW_CLOSED_ERROR;
                throw windowError;
            }
        } else {
            console.error(`❌ [WhatsApp] Error enviando a ${to} | Código: ${errorCode} | Detalle:`, errorData);
        }

        // MOCK PARA PRUEBAS EN DESARROLLO: Si falla la API real, permitimos
        // seguir para validar la lógica del bot — pero lo marcamos claramente.
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`⚠️ [MOCK] Mensaje NO enviado realmente a ${to}. Simulando éxito para continuar pruebas en desarrollo.`);
            return { mocked: true, originalError: errorData };
        }

        throw error;
    }
};

/**
 * Wrapper: envía mensaje atribuyéndolo al agente IA (incrementa contador y persiste).
 * Usado por el controller de WhatsApp para todas las respuestas automatizadas.
 * opts.persist=false para evitar persistencia automática (cuando el caller ya persiste manualmente).
 */
const sendAgentMessage = async (to, text, opts = {}) => {
    const { persist = true } = opts;
    const result = await sendTextMessage(to, text);
    await sessionsService.incrementMessageCounter(to, 'ia');
    if (persist) await _persistSaliente(to, text, { autor: 'agente_ia', autorNombre: null });
    return result;
};

/**
 * Wrapper: envía mensaje atribuyéndolo al vendedor humano (incrementa contador y persiste).
 * Usado por endpoints del dashboard. Por defecto auto-persiste en la tabla mensajes
 * para que aparezca en el chat panel.
 * opts.autorNombre = nombre del vendedor (si null queda como mensaje del sistema).
 * opts.persist=false para evitar persistencia automática.
 */
const sendSellerMessage = async (to, text, opts = {}) => {
    const { persist = true, autorNombre = null } = opts;
    const result = await sendTextMessage(to, text);
    await sessionsService.incrementMessageCounter(to, 'vendedor');
    if (persist) await _persistSaliente(to, text, { autor: 'vendedor', autorNombre: autorNombre || 'Sistema JFNN' });
    return result;
};

/**
 * Envía un mensaje usando una plantilla HSM pre-aprobada por Meta.
 * Esto funciona FUERA de la ventana de 24 horas.
 */
const sendTemplateMessage = async (to, templateName, languageCode = 'es', bodyParams = []) => {
    try {
        const components = [];
        if (bodyParams.length > 0) {
            // Las plantillas de JFNN usan placeholders POSICIONALES ({{1}}, {{2}}…),
            // por lo que enviamos parámetros posicionales (sin parameter_name). Enviar
            // parameter_name aquí hace que Meta rechace el mensaje.
            components.push({
                type: 'body',
                parameters: bodyParams.map(p => {
                    const text = (typeof p === 'object' && p !== null) ? (p.text ?? '') : p;
                    return { type: 'text', text: String(text) };
                })
            });
        }

        const response = await axios.post(
            `${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_ID}/messages`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "template",
                template: {
                    name: templateName,
                    language: { code: languageCode },
                    components
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const messageId = response.data?.messages?.[0]?.id || 'ID no disponible';
        console.log(`✅ [WhatsApp HSM] Plantilla "${templateName}" enviada a ${to} | message_id: ${messageId}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error(`❌ [WhatsApp HSM] Error enviando plantilla "${templateName}" a ${to}:`, errorData);

        if (process.env.NODE_ENV !== 'production') {
            console.warn(`⚠️ [MOCK HSM] Plantilla NO enviada realmente a ${to}. Simulando éxito.`);
            return { mocked: true, templateName, originalError: errorData };
        }

        throw error;
    }
};

/**
 * Lista las plantillas HSM realmente aprobadas en la WABA (vía Graph API), con su idioma
 * y el número de parámetros posicionales del body ({{1}}, {{2}}…). Cache 5 min.
 * Devuelve [] si no hay WABA_ID/token o si Meta falla (el caller usa su fallback).
 */
let _tplCache = { data: null, ts: 0 };
const listApprovedTemplates = async () => {
    const WABA_ID = process.env.WHATSAPP_WABA_ID || '1003088295416438';
    if (_tplCache.data && Date.now() - _tplCache.ts < 5 * 60 * 1000) return _tplCache.data;
    try {
        const { data } = await axios.get(
            `${GRAPH_BASE}/${WABA_ID}/message_templates`,
            {
                params: { fields: 'name,status,language,components', limit: 200, access_token: process.env.WHATSAPP_ACCESS_TOKEN },
            }
        );
        const aprobadas = (data?.data || [])
            .filter(t => t.status === 'APPROVED')
            .map(t => {
                const body = (t.components || []).find(c => c.type === 'BODY');
                const texto = body?.text || '';
                const nums = (texto.match(/\{\{\s*(\d+)\s*\}\}/g) || []).length;
                return { name: t.name, language: t.language, numParams: nums, body: texto };
            });
        _tplCache = { data: aprobadas, ts: Date.now() };
        return aprobadas;
    } catch (err) {
        console.error('[WhatsApp] ⚠️ No se pudieron listar plantillas de Meta:', err.response?.data?.error?.message || err.message);
        return [];
    }
};


/**
 * Descarga un archivo multimedia de WhatsApp y lo retorna como Buffer
 */
const downloadMedia = async (mediaId) => {
    try {
        const urlRes = await axios.get(
            `${GRAPH_BASE}/${mediaId}`,
            {
                headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
            }
        );

        const mediaUrl = urlRes.data.url;

        const fileRes = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
            responseType: 'arraybuffer'
        });

        return {
            buffer: Buffer.from(fileRes.data),
            mimeType: fileRes.headers['content-type']
        };
    } catch (error) {
        console.error("Error descargando media:", error.response?.data || error.message);
        return null;
    }
};

/**
 * Solicita una reseña en Google Maps al cliente (HU-6)
 */
/**
 * Envía una imagen al cliente vía WhatsApp Cloud API.
 * @param {string} to - phone del destinatario
 * @param {string} imageUrl - URL pública de la imagen (firmada de Supabase Storage)
 * @param {string} [caption] - texto opcional debajo de la imagen
 */
const sendImageMessage = async (to, imageUrl, caption = null) => {
    try {
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "image",
            image: { link: imageUrl, ...(caption ? { caption } : {}) }
        };
        const response = await axios.post(
            `${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_ID}/messages`,
            payload,
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        console.log(`✅ [WhatsApp Image] Enviada a ${to} | message_id: ${response.data?.messages?.[0]?.id || '?'}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        const errorCode = error.response?.data?.error?.code;
        if (errorCode === 130472) {
            const windowError = new Error(WINDOW_CLOSED_ERROR);
            windowError.code = WINDOW_CLOSED_ERROR;
            throw windowError;
        }
        console.error(`❌ [WhatsApp Image] Error enviando a ${to}:`, errorData);
        throw error;
    }
};

const sendGoogleReviewRequest = async (phone) => {
    const reviewUrl = process.env.GOOGLE_REVIEW_URL;
    if (!reviewUrl) {
        console.warn('[Review] ⚠️ GOOGLE_REVIEW_URL no configurada en variables de entorno.');
        return;
    }
    const mensaje = `¡Muchas gracias por su compra en Repuestos JFNN! 🙏\n\nSi quedó satisfecho con nuestro servicio, nos ayudaría muchísimo si nos deja una reseña en Google. ¡Solo toma un minuto! 🌟\n👉 ${reviewUrl}`;
    return sendAgentMessage(phone, mensaje);
};

module.exports = {
    sendTextMessage,
    sendAgentMessage,
    sendSellerMessage,
    sendImageMessage,
    sendTemplateMessage,
    listApprovedTemplates,
    downloadMedia,
    sendGoogleReviewRequest,
    WINDOW_CLOSED_ERROR,
    TEMPLATES
};
