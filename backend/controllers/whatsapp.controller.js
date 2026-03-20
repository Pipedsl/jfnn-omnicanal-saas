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

// -------------------------------------------------------------
// SISTEMA DE DEBOUNCE (COLA DE MENSAJES)
// -------------------------------------------------------------
const messageBuffer = new Map();
const DEBOUNCE_TIME_MS = 20000; // 15 segundos de buffer

const processBufferedMessages = async (customerPhone) => {
    try {
        const bufferData = messageBuffer.get(customerPhone);
        if (!bufferData) return;

        // Limpiar el buffer inmediatamente para que nuevos mensajes entren en un lote nuevo
        messageBuffer.delete(customerPhone);

        const { messages } = bufferData;

        // Concatenar textos y agrupar media
        const userText = messages.map(m => m.userText).filter(Boolean).join('\n\n');
        const images = messages.filter(m => m.hasImage);
        const hasImage = images.length > 0;

        // Tomaremos solo la última imagen del buffer (comportamiento actual)
        let lastMediaId = null;
        if (hasImage) {
            const lastImageMsg = images[images.length - 1];
            lastMediaId = lastImageMsg.message.image.id;
        }

        console.log(`[Debounce] Procesando lote de ${customerPhone} (${messages.length} mensaje/s): "${userText.replace(/\n/g, ' ')}"`);

        // 1. Obtener o crear sesión
        let session = await sessionsService.getSession(customerPhone);

        // 1.5 Verificar modo pausa (HU-3)
        if (session.entidades?.agente_pausado === true) {
            console.log(`[Pausa] 🔇 Agente pausado para ${customerPhone}. Ignorando mensaje.`);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // ESTADO: ESPERANDO_APROBACION_ADMIN
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
            return; // Termina ejecución del background
        }

        // ═══════════════════════════════════════════════════════
        // FLUJO ESPECIAL: Imagen de pago (Abono o Saldo Restante)
        // ═══════════════════════════════════════════════════════
        if (hasImage && (
            session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA || 
            session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE ||
            session.estado === sessionsService.STATES.ESPERANDO_SALDO
        )) {
            console.log(`[P1] 🧠 Comprobante de pago detectado de ${customerPhone} (Estado: ${session.estado}). Procesando...`);
            const imageData = await whatsappService.downloadMedia(lastMediaId);

            if (!imageData) {
                console.error(`[P1] ❌ No se pudo descargar la imagen de ${customerPhone}.`);
                await whatsappService.sendTextMessage(customerPhone, 'Tuvimos un problema al recibir su comprobante. ¿Podía enviarlo nuevamente, por favor?');
                return;
            }

            const datosExtraidos = await geminiService.extractVoucherData(imageData);
            const comprobanteUrl = await storageService.uploadVoucher(customerPhone, imageData.buffer, imageData.mimeType);

            if (!comprobanteUrl) {
                console.error(`[P1] ❌ No se pudo subir el voucher de ${customerPhone} al storage.`);
                await whatsappService.sendTextMessage(customerPhone, 'Tuvimos un inconveniente técnico guardando su comprobante. Por favor, inténtelo en un momento.');
                return;
            }

            await sessionsService.saveVoucherData(customerPhone, comprobanteUrl, datosExtraidos);

            const respuestaConfirmacion = `¡Perfecto! 📸 Recibí su comprobante de pago. Nuestro equipo lo está verificando ahora y le confirmaremos en unos minutos. Si tiene alguna consulta, no dude en escribirnos. 👌`;
            const delayMs = Math.min(respuestaConfirmacion.length * 25, 3500);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            await whatsappService.sendTextMessage(customerPhone, respuestaConfirmacion);

            console.log(`[P1] ✅ Flujo de comprobante completado para ${customerPhone}. Esperando aprobación del admin.`);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // REINICIO DE FLUJO: ENTREGADO o ARCHIVADO
        // ═══════════════════════════════════════════════════════
        const reengageStates = [sessionsService.STATES.ENTREGADO, sessionsService.STATES.ARCHIVADO];
        if (reengageStates.includes(session.estado)) {
            console.log(`[Session] 🔄 Re-engage detectado para ${customerPhone} (estado: ${session.estado}). Archivando venta y reiniciando...`);
            const { archivedPedido, newSession } = await sessionsService.archiveSession(customerPhone);
            session = newSession;
            if (archivedPedido) {
                console.log(`[Session] ✅ Pedido archivado: ${archivedPedido.id} (quote: ${archivedPedido.quote_id})`);
            }
        }

        // ═══════════════════════════════════════════════════════
        // FLUJO RE-ENGAGE EN ESTADOS INTERMEDIOS
        // ═══════════════════════════════════════════════════════
        const intermediateHoldStates = [sessionsService.STATES.CICLO_COMPLETO, sessionsService.STATES.PAGO_VERIFICADO, sessionsService.STATES.ESPERANDO_COMPROBANTE];
        if (intermediateHoldStates.includes(session.estado)) {
            const lowerText = userText.toLowerCase();
            const wantsMore = lowerText.includes("cotizar") || lowerText.includes("necesito") ||
                (lowerText.length < 25 && (lowerText.includes("otro auto") || lowerText.includes("nueva cotizacion") || lowerText.includes("otra pieza") || lowerText.includes("quiero comprar algo mas")));

            if (wantsMore && !hasImage) {
                session = await sessionsService.resetSession(customerPhone);
                console.log(`[Session] ♻️ Re-perfilado para ${customerPhone} desde ${session.estado}.`);
            }
        }

        // Guard: ESPERANDO_VENDEDOR
        if (session.estado === sessionsService.STATES.ESPERANDO_VENDEDOR) {
            const lowerText = userText.toLowerCase();
            const wantsMoreFromWaitingState = lowerText.includes("cotizar") || lowerText.includes("necesito") || lowerText.includes("quiero") || lowerText.includes("también") || lowerText.includes("tambie") || lowerText.includes("auto") || lowerText.includes("camioneta") || lowerText.includes("vehículo") || lowerText.includes("vehiculo") || lowerText.includes("patente") || lowerText.includes("corolla") || lowerText.includes("hilux") || lowerText.includes("yaris");
            if (!wantsMoreFromWaitingState) {
                console.log(`[Hand-off] Ignorando mensaje de ${customerPhone} (ESPERANDO_VENDEDOR)`);
                return;
            }
            session = await sessionsService.setEstado(customerPhone, sessionsService.STATES.PERFILANDO);
            console.log(`[Session] ➕ Append de repuesto para ${customerPhone}. Volviendo a PERFILANDO conservando historial.`);
        }

        console.log(`[Webhook] Enviando a Gemini mensaje final de ${customerPhone}: "${userText.replace(/\n/g, ' ')}"`);

        let imageData = null;
        if (hasImage && lastMediaId) {
            console.log(`[Media] Descargando imagen ${lastMediaId} para ${customerPhone}...`);
            imageData = await whatsappService.downloadMedia(lastMediaId);
        }

        // 3. Obtener respuesta y entidades de Gemini con selección dinámica de modelo
        const aiJson = await geminiService.generateResponse(userText, session, imageData);
        console.log(`[Gemini] Respuesta (${session.estado}):`, JSON.stringify(aiJson, null, 2));

        // 4. Actualizar entidades en la sesión
        const originalSession = JSON.parse(JSON.stringify(session)); // Backup
        session = await sessionsService.updateEntidades(customerPhone, aiJson.entidades);

        // -- GUARDIA CRÍTICA CONTRA TIMEOUTS DE DB --
        if (!session) {
            console.error(`[CRITICAL] No se pudo actualizar sesión de ${customerPhone} tras respuesta de Gemini. Usando backup local.`);
            session = originalSession; // Mantener estado anterior para no perder el contexto del render
        }

        let finalMessage = aiJson.mensaje_cliente;

        // 5. Lógica de transición de estados
        if (session && session.estado === sessionsService.STATES.PERFILANDO) {
            const e = session.entidades;
            const hasRepuestos = Array.isArray(e.repuestos_solicitados) && e.repuestos_solicitados.length > 0;
            const hasMinData = e.ano && (e.patente || e.vin) && hasRepuestos;
            const isAsking = finalMessage.includes("?") || finalMessage.toLowerCase().includes("qué tipo");

            if (hasMinData && !isAsking) {
                await sessionsService.setEstado(customerPhone, 'ESPERANDO_VENDEDOR');
                finalMessage = "Perfecto, recibí toda la información. Un asesor revisará el stock ahora mismo y le enviará los precios por este chat en unos minutos. ¡Muchas gracias!";
                printShadowQuote(customerPhone, session.entidades);
            }
        } else if (session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA || session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE) {
            const e = session.entidades;
            if (e.metodo_pago && e.metodo_entrega && (e.tipo_documento === 'boleta' || (e.tipo_documento === 'factura' && e.datos_factura.rut))) {
                if (e.metodo_pago === 'online') {
                    if (session.estado !== sessionsService.STATES.ESPERANDO_COMPROBANTE) {
                        await sessionsService.setEstado(customerPhone, 'ESPERANDO_COMPROBANTE');
                        console.log(`[Venta] Cambiado a ESPERANDO_COMPROBANTE para ${customerPhone}`);
                    }
                } else {
                    const quoteId = session.entidades.quote_id || 'SIN-NÚMERO';
                    const nombreCliente = session.entidades.nombre_cliente;
                    
                    if (nombreCliente) {
                        finalMessage = `¡Muchas gracias, ${nombreCliente}! 🎉 Su pedido está confirmado.\n\nAl acercarse a nuestra tienda, puede identificarse con:\n• Código de cotización: *${quoteId}*\n• O simplemente con su nombre: *${nombreCliente}*\n\n¡Lo atenderemos de inmediato! 🔧`;
                        await sessionsService.setEstado(customerPhone, 'CICLO_COMPLETO');
                        console.log(`[Venta] Ciclo de cierre completado para ${customerPhone} (Pago presencial)`);
                    } else {
                        finalMessage = `¡Perfecto! 🎉 Su pedido está confirmado.\nPara agilizar su atención al llegar a la tienda, ¿podría decirme su nombre completo?`;
                        // Mantenemos el estado actual para que en el próximo mensaje Gemini nos extraiga el nombre
                    }
                }
            }
        }

        // 6. Simular 'Typing Delay'
        const delayMs = Math.min(finalMessage.length * 25, 3500);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // 7. Enviar respuesta vía WhatsApp
        await whatsappService.sendTextMessage(customerPhone, finalMessage);

    } catch (error) {
        console.error(`[Debounce] Error procesando lote para ${customerPhone}:`, error);
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

        // -------------------------------------------------------------
        // DEBOUNCE LOGIC
        // -------------------------------------------------------------
        let buffer = messageBuffer.get(customerPhone);
        if (!buffer) {
            buffer = { messages: [], timer: null };
        }

        buffer.messages.push({ userText, hasImage, message, timestamp: Date.now() });

        if (buffer.timer) {
            clearTimeout(buffer.timer);
            console.log(`[Webhook] Timer reseteado para ${customerPhone}. Mensajes en buffer: ${buffer.messages.length}`);
        } else {
            console.log(`[Webhook] Mensaje recibido de ${customerPhone}. Iniciando buffer de espera de ${DEBOUNCE_TIME_MS / 1000}s...`);
        }

        // Reiniciar el timer
        buffer.timer = setTimeout(() => {
            processBufferedMessages(customerPhone);
        }, DEBOUNCE_TIME_MS);

        messageBuffer.set(customerPhone, buffer);

        // Responder siempre 200 INMEDIATAMENTE a Meta para evitar retries o bloqueos
        return res.status(200).send('EVENT_RECEIVED');

    } catch (error) {
        console.error('Error recibiendo webhook de WhatsApp:', error);
        return res.status(200).send('EVENT_RECEIVED_WITH_ERROR');
    }
};

module.exports = {
    verifyWebhook,
    receiveMessage
};
