const axios = require('axios');

/**
 * Servicio para enviar mensajes vía WhatsApp Cloud API (Meta)
 */

/**
 * Envía un mensaje de texto plano a un número de teléfono específico
 * @param {string} to - Número de teléfono del destinatario (con código de país)
 * @param {string} text - Contenido del mensaje
 * @returns {Promise<Object>} - Respuesta de la API de Meta
 */
const sendTextMessage = async (to, text) => {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
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

        // Log detallado: confirma que Meta aceptó y generó un message_id real
        const messageId = response.data?.messages?.[0]?.id || 'ID no disponible';
        console.log(`✅ [WhatsApp] Mensaje entregado a Meta para ${to} | message_id: ${messageId}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        const errorCode = error.response?.data?.error?.code;
        const errorSubcode = error.response?.data?.error?.error_subcode;

        // Error 130472 / subcode 2494010 = fuera de la ventana de 24 horas de Meta
        // El negocio solo puede iniciar conversaciones con plantillas pre-aprobadas (HSM).
        // Para texto libre, el cliente debe haber escrito en las últimas 24 horas.
        if (errorCode === 130472 || errorSubcode === 2494010) {
            console.error(`❌ [WhatsApp] VENTANA DE 24H EXPIRADA para ${to}. El cliente debe escribir primero para reactivar la conversación.`);
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
 * Descarga un archivo multimedia de WhatsApp y lo retorna como Buffer
 * @param {string} mediaId - ID del archivo multimedia enviado por WhatsApp
 */
const downloadMedia = async (mediaId) => {
    try {
        // 1. Obtener la URL del archivo
        const urlRes = await axios.get(
            `https://graph.facebook.com/v19.0/${mediaId}`,
            {
                headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
            }
        );

        const mediaUrl = urlRes.data.url;

        // 2. Descargar el archivo real
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
 * @param {string} phone Número de teléfono del cliente
 */
const sendGoogleReviewRequest = async (phone) => {
    const reviewUrl = process.env.GOOGLE_REVIEW_URL;
    if (!reviewUrl) {
        console.warn('[Review] ⚠️ GOOGLE_REVIEW_URL no configurada en variables de entorno.');
        return;
    }
    const mensaje = `¡Muchas gracias por su compra en Repuestos JFNN! 🙏\n\nSi quedó satisfecho con nuestro servicio, nos ayudaría muchísimo si nos deja una reseña en Google. ¡Solo toma un minuto! 🌟\n👉 ${reviewUrl}`;
    return sendTextMessage(phone, mensaje);
};

module.exports = {
    sendTextMessage,
    downloadMedia,
    sendGoogleReviewRequest
};
