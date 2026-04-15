const geminiService = require('../services/gemini.service');
const whatsappService = require('../services/whatsapp.service');
const sessionsService = require('../services/sessions.service');
const storageService = require('../services/storage.service');
const db = require('../config/db');
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
const DEBOUNCE_TIME_MS = 5000; // 15 segundos de buffer

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

        // Audios: recolectar TODOS del lote
        const audios = messages.filter(m => m.hasAudio);
        const hasAudio = audios.length > 0;

        console.log(`[Debounce] Procesando lote de ${customerPhone} (${messages.length} mensaje/s): "${userText.replace(/\n/g, ' ')}"`);

        // 1. Obtener o crear sesión
        let session = await sessionsService.getSession(customerPhone);

        // ═══════════════════════════════════════════════════════
        // MEJORA #2b: Pre-carga de nombre_cliente desde tabla clientes
        // ═══════════════════════════════════════════════════════
        if (!session.entidades?.nombre_cliente) {
            try {
                const clienteResult = await db.query(
                    'SELECT nombre FROM clientes WHERE phone = $1 LIMIT 1',
                    [customerPhone]
                );
                if (clienteResult.rows.length > 0) {
                    const nombrePrevio = clienteResult.rows[0].nombre;
                    await sessionsService.updateEntidades(customerPhone, { nombre_cliente: nombrePrevio });
                    session.entidades.nombre_cliente = nombrePrevio;
                    console.log(`[PreCarga] ✅ Nombre pre-cargado desde BD: ${nombrePrevio}`);
                }
            } catch (err) {
                console.warn(`[PreCarga] ⚠️ Error buscando nombre en BD:`, err.message);
            }
        }

        // ═══════════════════════════════════════════════════════
        // MEJORA #3: Pre-filtro de saludos puros (sin interrogatorio)
        // ═══════════════════════════════════════════════════════
        const textoTrimmed = userText.trim().toLowerCase();
        const esSaludoPuro = /^(hola|buenas|buenos|buenos días|buenas noches|buenas tardes|ola|q tal|que tal|hey|holi|oi)[\s.,!?¡¿👋🙏]*$/.test(textoTrimmed);
        const tieneEntidades = !!(session.entidades?.marca_modelo || session.entidades?.ano || session.entidades?.patente ||
                                   (Array.isArray(session.entidades?.vehiculos) && session.entidades.vehiculos.length > 0));

        if (esSaludoPuro && !tieneEntidades) {
            console.log(`[Saludo] 👋 Saludo puro detectado sin entidades previas. Respuesta local, sin llamar a Gemini.`);
            const saludoRespuesta = '¡Hola! 👋 ¿En qué puedo ayudarte hoy?';
            const delayMs = Math.min(saludoRespuesta.length * 25, 1500);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            await whatsappService.sendTextMessage(customerPhone, saludoRespuesta);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // ESTADO: ARCHIVADO → Ofrecer re-enganche o iniciar nueva
        // ═══════════════════════════════════════════════════════
        if (session.estado === sessionsService.STATES.ARCHIVADO) {
            const archived = await sessionsService.getArchivedSessionForResume(customerPhone);

            if (archived && archived.hasArchived) {
                // Detectar intención del usuario
                const textoLower = userText.toLowerCase().trim();
                const quiereContinuar = /^(s[ií]|continuar|retomar|la misma|seguir|esa|dale|obvio|claro)/i.test(textoLower);
                const quiereNueva = /^(no|nueva|otro|diferente|empezar|de cero|nada)/i.test(textoLower);
                
                // Si es un saludo corto, o solo dicen "hola"
                const esSaludoCorto = /^(hola|buenas|ola|q tal|que tal|buenos|hello)/i.test(textoLower) && textoLower.length < 35;

                if (quiereContinuar) {
                    // Restaurar sesión al estado PERFILANDO con las entidades preservadas
                    await sessionsService.setEstado(customerPhone, sessionsService.STATES.PERFILANDO);
                    const msg = `¡Perfecto! Retomamos tu cotización de ${archived.summary}. ¿Hay algo que quieras modificar?`;
                    const delayMs = Math.min(msg.length * 25, 3500);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    await whatsappService.sendTextMessage(customerPhone, msg);
                    return;
                } else if (quiereNueva || !esSaludoCorto) {
                    // Resetear completamente si dice que NO explícitamente, o si ya nos mandó un texto largo (empezando a pedir repuestos)
                    await sessionsService.resetSession(customerPhone);
                    session = await sessionsService.getSession(customerPhone);
                    // Continuar flujo normal (caerá al flujo de PERFILANDO abajo)
                } else {
                    // Primera vez que escribe tras archivado → ofrecer opciones
                    const msg = `¡Hola de nuevo! 👋 Veo que tenías pendiente una cotización de ${archived.summary}. ¿Te gustaría continuarla o prefieres empezar una nueva?`;
                    const delayMs = Math.min(msg.length * 25, 3500);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    await whatsappService.sendTextMessage(customerPhone, msg);
                    return;
                }
            } else {
                // Archivado pero sin datos aprovechables → resetear silenciosamente
                await sessionsService.resetSession(customerPhone);
                session = await sessionsService.getSession(customerPhone);
            }
        }

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
        // FLUJO ESPECIAL: Identificación de piezas por foto
        // Solo en PERFILANDO o ESPERANDO_VENDEDOR
        // ═══════════════════════════════════════════════════════
        if (hasImage && (
            session.estado === sessionsService.STATES.PERFILANDO ||
            session.estado === sessionsService.STATES.ESPERANDO_VENDEDOR
        )) {
            console.log(`[ImageID] 📸 ${images.length} imagen(s) recibida(s) de ${customerPhone} para identificación de piezas...`);

            const contextoVehiculo = session.entidades?.marca_modelo
                ? `${session.entidades.marca_modelo}${session.entidades.ano ? ' ' + session.entidades.ano : ''}`
                : '';

            // Procesar TODAS las imágenes en paralelo: descargar + identificar + guardar
            const imageResults = await Promise.all(images.map(async (imgMsg) => {
                const mediaId = imgMsg.message.image?.id;
                if (!mediaId) return null;

                const imageData = await whatsappService.downloadMedia(mediaId);
                if (!imageData) {
                    console.error(`[ImageID] ❌ No se pudo descargar imagen ${mediaId}`);
                    return null;
                }

                const [imagePath, identificacion] = await Promise.all([
                    storageService.uploadPartImage(customerPhone, imageData.buffer, imageData.mimeType),
                    geminiService.identifyPartFromImage(imageData, contextoVehiculo)
                ]);

                return { imagePath, identificacion };
            }));

            const validResults = imageResults.filter(Boolean);

            // Agregar cada pieza identificada como repuesto pendiente en la sesión
            for (const { imagePath, identificacion } of validResults) {
                await sessionsService.updateEntidades(customerPhone, {
                    repuestos_solicitados: [{
                        nombre: identificacion.nombre_sugerido || 'Pieza sin identificar',
                        cantidad: 1,
                        precio: null,
                        estado: 'pendiente',
                        pendiente_identificacion: true,
                        imagen_url: imagePath,
                        identificacion_ia: identificacion.descripcion,
                        confianza_ia: identificacion.confianza,
                        notas_ia: null
                    }]
                });
            }

            session = await sessionsService.getSession(customerPhone);

            // Si hay también texto en el lote, procesarlo con Gemini para extraer datos del vehículo
            if (userText.trim()) {
                const aiJson = await geminiService.generateResponse(userText, session, null, []);
                if (Array.isArray(aiJson)) {
                    // ignore malformed
                } else if (aiJson?.entidades) {
                    await sessionsService.updateEntidades(customerPhone, aiJson.entidades);
                    session = await sessionsService.getSession(customerPhone);
                }
            }

            // Verificar si ya tenemos datos mínimos del vehículo para pasar a ESPERANDO_VENDEDOR
            const e = session.entidades;
            const tieneVehiculo = (e.ano && (e.patente || e.vin)) ||
                (Array.isArray(e.vehiculos) && e.vehiculos.some(v => v.ano && (v.patente || v.vin)));

            if (session.estado === sessionsService.STATES.PERFILANDO) {
                if (tieneVehiculo) {
                    await sessionsService.setEstado(customerPhone, sessionsService.STATES.ESPERANDO_VENDEDOR);
                    const nFotos = validResults.length;
                    const msg = `📸 Recibí tu${nFotos > 1 ? 's ' + nFotos : ''} foto${nFotos > 1 ? 's' : ''}. Un asesor las revisará y te cotizará en breve. 🔧`;
                    await new Promise(r => setTimeout(r, 1500));
                    await whatsappService.sendTextMessage(customerPhone, msg);
                } else {
                    const nFotos = validResults.length;
                    const msg = `📸 Recibí tu${nFotos > 1 ? 's ' + nFotos : ''} foto${nFotos > 1 ? 's' : ''}. Para cotizar necesito también los datos del auto: marca, año y patente. ¿Me los puedes enviar?`;
                    await new Promise(r => setTimeout(r, 1500));
                    await whatsappService.sendTextMessage(customerPhone, msg);
                }
            } else {
                // ESPERANDO_VENDEDOR: nueva imagen llegó, notificar que se agregó
                const nFotos = validResults.length;
                const msg = `📸 Recibí tu${nFotos > 1 ? 's ' + nFotos : ''} foto${nFotos > 1 ? 's' : ''} adicional${nFotos > 1 ? 'es' : ''}. El asesor las revisará junto a la cotización. 🔧`;
                await new Promise(r => setTimeout(r, 1500));
                await whatsappService.sendTextMessage(customerPhone, msg);
            }

            return;
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

            // Extraer nombre del cliente del texto si está disponible y aún no se ha capturado
            if (!session.entidades?.nombre_cliente && userText) {
                const nombreMatch = userText.match(/mi\s+nombre\s+(?:es\s+)?([a-záéíóúñA-ZÁÉÍÓÚÑ\s]+)/i);
                if (nombreMatch && nombreMatch[1]) {
                    const nombreLimpio = nombreMatch[1].trim();
                    await sessionsService.updateEntidades(customerPhone, { nombre_cliente: nombreLimpio });
                    session.entidades.nombre_cliente = nombreLimpio;
                    console.log(`[P1] ✅ Nombre extraído del texto: ${nombreLimpio}`);
                }
            }

            // Usar la primera imagen del buffer como comprobante
            const voucherMediaId = images[0].message.image?.id;
            const imageData = await whatsappService.downloadMedia(voucherMediaId);

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
        // AUDIO EN ESTADO ESPERANDO COMPROBANTE: recordar al cliente
        // ═══════════════════════════════════════════════════════
        if (hasAudio && (
            session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE ||
            session.estado === sessionsService.STATES.ESPERANDO_SALDO
        )) {
            const msg = 'Recibí tu audio, pero en este momento estamos esperando la imagen del comprobante de pago. ¿Lo tienes listo? 📸';
            await new Promise(resolve => setTimeout(resolve, 1500));
            await whatsappService.sendTextMessage(customerPhone, msg);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // REINICIO DE FLUJO: ENTREGADO o ARCHIVADO
        // ═══════════════════════════════════════════════════════
        const reengageStates = [sessionsService.STATES.ENTREGADO, sessionsService.STATES.ARCHIVADO];
        if (reengageStates.includes(session.estado)) {
            console.log(`[Session] 🔄 Re-engage detectado para ${customerPhone} (estado: ${session.estado}). Archivando venta y reiniciando...`);
            const { archivedPedido, newSession } = await sessionsService.archiveSession(customerPhone);
            if (newSession) {
                session = newSession;
            } else {
                // Si archiveSession falló, forzar un reset limpio
                console.warn(`[Session] ⚠️ archiveSession falló para ${customerPhone}. Forzando reset...`);
                session = await sessionsService.resetSession(customerPhone);
            }
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

        // Guard: ESPERANDO_VENDEDOR — HU-2: clasificación semántica (reemplaza keywords estáticas)
        if (session.estado === sessionsService.STATES.ESPERANDO_VENDEDOR) {
            const intentResult = await geminiService.classifyIntent(userText);
            if (!intentResult.es_compra) {
                console.log(`[Hand-off] Ignorando mensaje de ${customerPhone} (ESPERANDO_VENDEDOR, no es compra)`);
                await whatsappService.sendTextMessage(customerPhone,
                    '¡Hola! Estamos buscando los precios para ti, en unos minutos te enviamos la cotización completa. 🔍');
                return;
            }
            session = await sessionsService.setEstado(customerPhone, sessionsService.STATES.PERFILANDO);
            console.log(`[Session] ➕ Intención de compra detectada para ${customerPhone}. Volviendo a PERFILANDO.`);
        }

        console.log(`[Webhook] Enviando a Gemini mensaje final de ${customerPhone}: "${userText.replace(/\n/g, ' ')}"`);

        // Para estados no cubiertos arriba, imageData se pasa null (ya se manejaron arriba o no aplica)
        let imageData = null;

        // Descargar TODOS los audios del lote
        let audioDataList = [];
        if (hasAudio) {
            console.log(`[Audio] 🎤 Descargando ${audios.length} nota(s) de voz de ${customerPhone}...`);
            const downloadResults = await Promise.all(
                audios.map(a => whatsappService.downloadMedia(a.audioMediaId))
            );
            audioDataList = downloadResults.filter(Boolean);
            if (audioDataList.length === 0) {
                console.error(`[Audio] ❌ No se pudo descargar ningún audio de ${customerPhone}.`);
                await whatsappService.sendTextMessage(customerPhone, 'Tuve un problema al escuchar tu audio. ¿Lo puedes reenviar o escribir tu consulta?');
                return;
            }
            console.log(`[Audio] ✅ ${audioDataList.length} audio(s) descargados`);
        }

        // 3. Obtener respuesta y entidades de Gemini con selección dinámica de modelo
        let aiJson = await geminiService.generateResponse(userText, session, imageData, audioDataList);
        
        // Normalización: Gemini a veces devuelve array en vez de objeto
        if (Array.isArray(aiJson)) {
            console.log(`[Gemini] ⚠️ Respuesta vino como array (${aiJson.length} elementos). Extrayendo primer elemento.`);
            aiJson = aiJson[0] || {};
        }
        
        // Normalización BUG-002: Gemini a veces usa "estado_nuevo" en vez de "estado"
        if (aiJson.estado_nuevo && !aiJson.estado) {
            aiJson.estado = aiJson.estado_nuevo;
            console.log(`[Gemini] ⚠️ Normalizado estado_nuevo -> estado: ${aiJson.estado}`);
        }
        
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

        // HU-1: Remoción de repuesto solicitada por el cliente en CONFIRMANDO_COMPRA
        if (
            aiJson.accion === 'REMOVER_REPUESTO' &&
            aiJson.repuesto_a_remover &&
            (session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA || session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE)
        ) {
            console.log(`[HU-1] Removiendo repuesto "${aiJson.repuesto_a_remover}" para ${customerPhone}`);
            session = await sessionsService.removeRepuesto(customerPhone, aiJson.repuesto_a_remover);

            if (session && session.entidades && session.entidades.total_cotizacion !== undefined) {
                const formatMoney = (val) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(val);
                finalMessage = finalMessage + `\n\n💡 _El nuevo total de su cotización es de *${formatMoney(session.entidades.total_cotizacion)}*._`;
            }
        }

        // BUG-3: Agregar repuesto estando en CONFIRMANDO_COMPRA -> volver a ESPERANDO_VENDEDOR
        if (
            aiJson.accion === 'AGREGAR_REPUESTO' &&
            (session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA || session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE)
        ) {
            console.log(`[BUG-3] Cliente quiere agregar repuesto en el cierre. Pasando a ESPERANDO_VENDEDOR para ${customerPhone}`);
            session = await sessionsService.setEstado(customerPhone, sessionsService.STATES.ESPERANDO_VENDEDOR);

            const nombre = session.entidades?.nombre_cliente ? ` ${session.entidades.nombre_cliente}, h` : ' H';
            finalMessage = `Entendido${nombre}e anotado su nuevo repuesto a la solicitud. 🔄 En breve un asesor verificará el stock y le enviará la cotización actualizada con los nuevos totales.`;
        }

        // BUG-10: Cliente elige entre opciones múltiples → eliminar las descartadas
        if (
            aiJson.accion === 'SELECCION_OPCION' &&
            aiJson.opciones_descartadas &&
            Array.isArray(aiJson.opciones_descartadas) &&
            (session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA || session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE)
        ) {
            console.log(`[BUG-10] Cliente eligió "${aiJson.opcion_elegida}". Descartando: ${aiJson.opciones_descartadas.join(', ')}`);
            for (const descartada of aiJson.opciones_descartadas) {
                session = await sessionsService.removeRepuesto(customerPhone, descartada);
            }
            if (session && session.entidades && session.entidades.total_cotizacion !== undefined) {
                const formatMoney = (val) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(val);
                finalMessage = finalMessage + `\n\n💡 _Total actualizado: *${formatMoney(session.entidades.total_cotizacion)}*._`;
            }
        }

        // BUG-4: Abandono de cotización
        if (aiJson.accion === 'ABANDONAR_COTIZACION') {
            console.log(`[BUG-4] Cliente abandonó la cotización. Reseteando sesión de ${customerPhone}`);
            session = await sessionsService.resetSession(customerPhone);
        }

        // 5. Lógica de transición de estados
        if (session && session.estado === sessionsService.STATES.PERFILANDO) {
            const e = session.entidades;

            // Validar existencia de repuestos en el root o en los carritos
            const hasRepuestosRoot = Array.isArray(e.repuestos_solicitados) && e.repuestos_solicitados.length > 0;
            const hasRepuestosVehiculos = Array.isArray(e.vehiculos) && e.vehiculos.some(v => Array.isArray(v.repuestos_solicitados) && v.repuestos_solicitados.length > 0);
            const hasRepuestos = hasRepuestosRoot || hasRepuestosVehiculos;

            // Validar metadata mínima del auto (Año + Patente o VIN) en la raíz o en al menos UN carrito manual
            const rootHasMinData = e.ano && (e.patente || e.vin);
            const vehiculosHasMinData = Array.isArray(e.vehiculos) && e.vehiculos.some(v => v.ano && (v.patente || v.vin));

            const hasMinData = (rootHasMinData || vehiculosHasMinData) && hasRepuestos;
            // finalMessage puede ser string o array — convertir a string para revisar
            const finalMessageStr = Array.isArray(finalMessage) ? finalMessage.join(" ") : finalMessage;
            const isAsking = finalMessageStr.includes("?") || finalMessageStr.toLowerCase().includes("qué tipo");

            if (hasMinData && !isAsking) {
                await sessionsService.setEstado(customerPhone, 'ESPERANDO_VENDEDOR');
                finalMessage = "Perfecto, recibí toda la información. Un asesor revisará el stock ahora mismo y le enviará los precios por este chat en unos minutos. ¡Muchas gracias!";
                printShadowQuote(customerPhone, session.entidades);
            }
        } else if (session.estado === sessionsService.STATES.CONFIRMANDO_COMPRA || session.estado === sessionsService.STATES.ESPERANDO_COMPROBANTE) {
            const e = session.entidades;
            
            // Auto-default: Si el cliente no especificó tipo de documento, asumir 'boleta'
            // (En Chile, la venta presencial en local por defecto es boleta)
            if (e.metodo_pago && e.metodo_entrega && !e.tipo_documento) {
                e.tipo_documento = 'boleta';
                await sessionsService.updateEntidades(customerPhone, { tipo_documento: 'boleta' });
                console.log(`[Venta] Auto-default: tipo_documento = 'boleta' para ${customerPhone}`);
            }
            
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

        // 6. Simular 'Typing Delay' y enviar respuesta(s)
        // Si finalMessage es array, enviar cada mensaje por separado con delay
        const messagesToSend = Array.isArray(finalMessage) ? finalMessage : [finalMessage];
        for (const msg of messagesToSend) {
            const delayMs = Math.min(msg.length * 25, 3500);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            // 7. Enviar respuesta vía WhatsApp
            await whatsappService.sendTextMessage(customerPhone, msg);
        }

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
        if (message) {
            console.log(`[Webhook] 📨 Tipo recibido: "${message.type}" de ${message.from} (auto-deploy test)`);
        }
        if (!message || !['text', 'image', 'audio'].includes(message.type)) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const customerPhone = message.from;
        const userText = message.text?.body || message.image?.caption || '';
        const hasImage = message.type === 'image';
        const hasAudio = message.type === 'audio';
        const audioMediaId = hasAudio ? message.audio?.id : null;

        // -------------------------------------------------------------
        // DEBOUNCE LOGIC
        // -------------------------------------------------------------
        let buffer = messageBuffer.get(customerPhone);
        if (!buffer) {
            buffer = { messages: [], timer: null };
        }

        buffer.messages.push({ userText, hasImage, hasAudio, audioMediaId, message, timestamp: Date.now() });

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
