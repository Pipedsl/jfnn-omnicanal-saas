/**
 * Controlador para gestionar las comunicaciones con WhatsApp Cloud API
 */

const verifyWebhook = (req, res) => {
    /**
     * Validación del Webhook por parte de Meta
     * Meta envía una petición GET con:
     * hub.mode, hub.verify_token y hub.challenge
     */
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            // Si el token no coincide, respondemos con 403 Forbidden
            res.sendStatus(403);
        }
    }
};

const receiveMessage = (req, res) => {
    /**
     * Recepción de notificaciones de WhatsApp (Mensajes, estados, etc.)
     * Respondemos inmediatamente con 200 OK para evitar reintentos por parte de Meta.
     */
    console.log('Mensaje Recibido de WhatsApp:', JSON.stringify(req.body, null, 2));

    // Meta espera una respuesta 200 OK rápida
    res.status(200).send('EVENT_RECEIVED');
};

module.exports = {
    verifyWebhook,
    receiveMessage
};
