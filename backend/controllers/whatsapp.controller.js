const geminiService = require('../services/gemini.service');
const whatsappService = require('../services/whatsapp.service');
const sessionsService = require('../services/sessions.service');
const { printShadowQuote } = require('../utils/shadowQuote');

/**
 * Controlador para gestionar las comunicaciones con WhatsApp Cloud API
 */

const verifyWebhook = (req, res) => {
    /**
     * Validación del Webhook por parte de Meta
     */
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
};

const receiveMessage = async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        // Guard: descartar payloads sin mensajes (Read Receipts, notificaciones de estado, etc.)
        if (!message || !['text', 'image'].includes(message.type)) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        if (message.type === 'text' || message.type === 'image') {
            const customerPhone = message.from;
            const userText = message.text?.body || message.image?.caption || (message.type === 'image' ? "[IMAGEN ENVIADA]" : "");
            const hasImage = message.type === 'image';

            // 1. Obtener o crear sesión
            let session = await sessionsService.getSession(customerPhone);

            // 2. Manejo de re-engage o corrección si está en estados finales
            const finalStates = [sessionsService.STATES.CICLO_COMPLETO, sessionsService.STATES.ESPERANDO_VENDEDOR, sessionsService.STATES.PAGO_VERIFICADO];

            if (finalStates.includes(session.estado)) {
                const lowerText = userText.toLowerCase();
                const wantsMore = lowerText.includes("cotizar") || lowerText.includes("necesito") ||
                    (lowerText.length < 25 && (lowerText.includes("otro auto") || lowerText.includes("nueva cotizacion") || lowerText.includes("otra pieza") || lowerText.includes("quiero comprar algo mas")));

                if (wantsMore && !hasImage) {
                    session = await sessionsService.resetSession(customerPhone);
                    console.log(`[Session] Re-perfilado para ${customerPhone} desde estado ${session.estado}.`);
                } else if (session.estado === sessionsService.STATES.ESPERANDO_VENDEDOR && !wantsMore) {
                    console.log(`[Hand-off] Ignorando mensaje de ${customerPhone} (ESPERANDO_VENDEDOR)`);
                    return res.status(200).send('EVENT_RECEIVED');
                }
                // Si es CICLO_COMPLETO y NO es wantsMore (ej: es el comprobante), dejamos que pase a Gemini para el agradecimiento
            }

            console.log(`[Webhook] Mensaje (${message.type}) de ${customerPhone}: "${userText}"`);

            let imageData = null;
            if (hasImage) {
                const mediaId = message.image.id;
                console.log(`[Media] Descargando imagen ${mediaId} para ${customerPhone}...`);
                imageData = await whatsappService.downloadMedia(mediaId);
            }

            // 4. Obtener respuesta y entidades de Gemini con selección dinámica de modelo
            const aiJson = await geminiService.generateResponse(userText, session, imageData);
            console.log(`[Gemini] Respuesta (${session.estado}):`, JSON.stringify(aiJson, null, 2));

            // 5. Actualizar entidades en la sesión
            session = await sessionsService.updateEntidades(customerPhone, aiJson.entidades);

            let finalMessage = aiJson.mensaje_cliente;

            // 6. Lógica de transición de estados
            if (session.estado === sessionsService.STATES.PERFILANDO) {
                const e = session.entidades;
                const hasRepuestos = Array.isArray(e.repuestos_solicitados) && e.repuestos_solicitados.length > 0;
                const hasMinData = e.ano && (e.patente || e.vin) && hasRepuestos;
                const isAsking = finalMessage.includes("?") || finalMessage.toLowerCase().includes("qué tipo");

                if (hasMinData && !isAsking) {
                    await sessionsService.setEstado(customerPhone, 'ESPERANDO_VENDEDOR');
                    finalMessage = "Perfecto, recibí toda la información. Un asesor revisará el stock ahora mismo y le enviará los precios por este chat en unos minutos. ¡Muchas gracias!";
                    printShadowQuote(customerPhone, session.entidades);
                }
            } else if (session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA) {
                // Verificar si el flujo de cierre terminó (ej: ya eligió pago y entrega)
                const e = session.entidades;
                if (e.metodo_pago && e.metodo_entrega && (e.tipo_documento === 'boleta' || (e.tipo_documento === 'factura' && e.datos_factura.rut))) {
                    // Marcamos como ciclo completo para el bot, pero el vendedor lo verá en el dashboard
                    await sessionsService.setEstado(customerPhone, 'CICLO_COMPLETO');
                    console.log(`[Venta] Ciclo de cierre completado para ${customerPhone}`);
                }
            }

            // 7. Simular 'Typing Delay' (Humanización Nivel 2 inicial)
            // Esperar 25ms por cada carácter del mensaje, máximo 3.5 segundos
            const delayMs = Math.min(finalMessage.length * 25, 3500);
            await new Promise(resolve => setTimeout(resolve, delayMs));

            // 8. Enviar respuesta vía WhatsApp
            await whatsappService.sendTextMessage(customerPhone, finalMessage);
        }

        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('Error procesando webhook POST de WhatsApp:', error);
        res.status(200).send('EVENT_RECEIVED_WITH_ERROR');
    }
};

module.exports = {
    verifyWebhook,
    receiveMessage
};

