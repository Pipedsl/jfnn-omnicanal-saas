const geminiService = require('../services/gemini.service');
const whatsappService = require('../services/whatsapp.service');
const sessionsService = require('../services/sessions.service');
const storageService = require('../services/storage.service');
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

        const customerPhone = message.from;
        const userText = message.text?.body || message.image?.caption || '';
        const hasImage = message.type === 'image';

        // 1. Obtener o crear sesión
        let session = await sessionsService.getSession(customerPhone);

        // ═══════════════════════════════════════════════════════
        // ESTADO: ESPERANDO_APROBACION_ADMIN
        // El cliente ya envió su comprobante y está en espera.
        // Responder solo si habla (sin cambiar estado), ignorar imágenes adicionales.
        // ═══════════════════════════════════════════════════════
        if (session.estado === sessionsService.STATES.ESPERANDO_APROBACION_ADMIN) {
            if (!hasImage) {
                // Responde a consultas informativas sin alterar el estado
                const mensajeEspera = '¡Hola! Tu comprobante de pago ya fue recibido y está siendo revisado por nuestro equipo. Te confirmaremos el pago en unos minutos. ¿Hay algo más en lo que pueda ayudarte mientras tanto?';
                const delayMs = Math.min(mensajeEspera.length * 25, 3500);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                await whatsappService.sendTextMessage(customerPhone, mensajeEspera);
            } else {
                console.log(`[Webhook] Ignorando imagen adicional de ${customerPhone} (ya en ESPERANDO_APROBACION_ADMIN).`);
            }
            return res.status(200).send('EVENT_RECEIVED');
        }

        // ═══════════════════════════════════════════════════════
        // FLUJO ESPECIAL: Imagen en estado CONFIRMANDO_COMPRA = Comprobante de pago
        // ═══════════════════════════════════════════════════════
        if (hasImage && session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA) {
            const mediaId = message.image.id;
            console.log(`[P1] 🧠 Comprobante de pago detectado de ${customerPhone}. Procesando...`);

            // 1. Descargar imagen de los servidores de Meta
            const imageData = await whatsappService.downloadMedia(mediaId);

            if (!imageData) {
                console.error(`[P1] ❌ No se pudo descargar la imagen de ${customerPhone}.`);
                await whatsappService.sendTextMessage(customerPhone, 'Tuvimos un problema al recibir su comprobante. ¿Podía enviarlo nuevamente, por favor?');
                return res.status(200).send('EVENT_RECEIVED');
            }

            // 2. Extraer datos del comprobante usando Gemini (IA como asistente, NO aprobador)
            const datosExtraidos = await geminiService.extractVoucherData(imageData);

            // 3. Subir imagen al bucket 'comprobantes' de Supabase Storage
            const comprobanteUrl = await storageService.uploadVoucher(
                customerPhone,
                imageData.buffer,
                imageData.mimeType
            );

            if (!comprobanteUrl) {
                console.error(`[P1] ❌ No se pudo subir el voucher de ${customerPhone} al storage.`);
                await whatsappService.sendTextMessage(customerPhone, 'Tuvimos un inconveniente técnico guardando su comprobante. Por favor, inténtelo en un momento.');
                return res.status(200).send('EVENT_RECEIVED');
            }

            // 4. Guardar URL, datos extraídos y cambiar estado a ESPERANDO_APROBACION_ADMIN
            await sessionsService.saveVoucherData(customerPhone, comprobanteUrl, datosExtraidos);

            // 5. Notificar al cliente (el Admin verifica manualmente desde el Dashboard)
            const respuestaConfirmacion = `¡Perfecto! 📸 Recibí su comprobante de pago. Nuestro equipo lo está verificando ahora y le confirmaremos en unos minutos. Si tiene alguna consulta, no dude en escribirnos. 👌`;
            const delayMs = Math.min(respuestaConfirmacion.length * 25, 3500);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            await whatsappService.sendTextMessage(customerPhone, respuestaConfirmacion);

            console.log(`[P1] ✅ Flujo de comprobante completado para ${customerPhone}. Esperando aprobación del admin.`);
            return res.status(200).send('EVENT_RECEIVED');
        }

        // ═══════════════════════════════════════════════════════
        // FLUJO GENERAL: Texto e imágenes de repuestos (estados normales)
        // ═══════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════
        // REINICIO DE FLUJO: Si el cliente vuelve después de una venta ENTREGADA o ARCHIVADA
        // → Resetear sesión silenciosamente (preserva datos del vehículo) y continuar como PERFILANDO
        // ═══════════════════════════════════════════════════════
        const reengageStates = [
            sessionsService.STATES.ENTREGADO,
            sessionsService.STATES.ARCHIVADO
        ];

        if (reengageStates.includes(session.estado)) {
            console.log(`[Session] 🔄 Re-engage detectado para ${customerPhone} (estado: ${session.estado}). Reiniciando sesión...`);
            session = await sessionsService.resetSession(customerPhone);
            // El flujo continúa como si estuviera en PERFILANDO — sin respuesta especial aquí
        }

        // ═══════════════════════════════════════════════════════
        // FLUJO GENERAL: Texto e imágenes de repuestos (estados normales)
        // ═══════════════════════════════════════════════════════

        // Manejo de re-engage en estados intermedios (sin venta finalizada)
        const intermediateHoldStates = [sessionsService.STATES.CICLO_COMPLETO, sessionsService.STATES.PAGO_VERIFICADO];

        if (intermediateHoldStates.includes(session.estado)) {
            const lowerText = userText.toLowerCase();
            const wantsMore = lowerText.includes("cotizar") || lowerText.includes("necesito") ||
                (lowerText.length < 25 && (lowerText.includes("otro auto") || lowerText.includes("nueva cotizacion") || lowerText.includes("otra pieza") || lowerText.includes("quiero comprar algo mas")));

            if (wantsMore && !hasImage) {
                session = await sessionsService.resetSession(customerPhone);
                console.log(`[Session] ♻️ Re-perfilado para ${customerPhone} desde ${session.estado}.`);
            }
        }

        // Guard: si está ESPERANDO_VENDEDOR, no interrumpir (el vendedor debe responder primero)
        if (session.estado === sessionsService.STATES.ESPERANDO_VENDEDOR) {
            const lowerText = userText.toLowerCase();
            const wantsMoreFromWaitingState = lowerText.includes("cotizar") || lowerText.includes("necesito");
            if (!wantsMoreFromWaitingState) {
                console.log(`[Hand-off] Ignorando mensaje de ${customerPhone} (ESPERANDO_VENDEDOR)`);
                return res.status(200).send('EVENT_RECEIVED');
            }
            // Si el cliente pide algo nuevo, permitir el re-perfilado
            session = await sessionsService.resetSession(customerPhone);
            console.log(`[Session] ♻️ Re-perfilado desde ESPERANDO_VENDEDOR para ${customerPhone}.`);
        }


        console.log(`[Webhook] Mensaje (${message.type}) de ${customerPhone}: "${userText}"`);

        let imageData = null;
        if (hasImage) {
            const mediaId = message.image.id;
            console.log(`[Media] Descargando imagen ${mediaId} para ${customerPhone}...`);
            imageData = await whatsappService.downloadMedia(mediaId);
        }

        // 3. Obtener respuesta y entidades de Gemini con selección dinámica de modelo
        const aiJson = await geminiService.generateResponse(userText, session, imageData);
        console.log(`[Gemini] Respuesta (${session.estado}):`, JSON.stringify(aiJson, null, 2));

        // 4. Actualizar entidades en la sesión
        session = await sessionsService.updateEntidades(customerPhone, aiJson.entidades);

        let finalMessage = aiJson.mensaje_cliente;

        // 5. Lógica de transición de estados
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
            const e = session.entidades;
            if (e.metodo_pago && e.metodo_entrega && (e.tipo_documento === 'boleta' || (e.tipo_documento === 'factura' && e.datos_factura.rut))) {
                await sessionsService.setEstado(customerPhone, 'CICLO_COMPLETO');
                console.log(`[Venta] Ciclo de cierre completado para ${customerPhone}`);
            }
        }

        // 6. Simular 'Typing Delay'
        const delayMs = Math.min(finalMessage.length * 25, 3500);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // 7. Enviar respuesta vía WhatsApp
        await whatsappService.sendTextMessage(customerPhone, finalMessage);

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

