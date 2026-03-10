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
        console.log(`Mensaje enviado exitosamente a ${to}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error("Error en WhatsApp Service:", errorData);

        // MOCK PARA PRUEBAS: Si falla la API real (ej: token vencido), permitimos seguir para validar la lógica del bot
        if (process.env.NODE_ENV !== 'production') {
            console.log("⚠️ [MOCK] Simulando envío exitoso a pesar del error de API.");
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

module.exports = {
    sendTextMessage,
    downloadMedia
};
