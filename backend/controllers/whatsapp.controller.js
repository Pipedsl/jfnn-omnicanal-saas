const crypto = require('crypto');
const geminiService = require('../services/gemini.service');
const whatsappService = require('../services/whatsapp.service');
const sessionsService = require('../services/sessions.service');
const storageService = require('../services/storage.service');
const mensajesService = require('../services/mensajes.service');
const db = require('../config/db');
const { printShadowQuote } = require('../utils/shadowQuote');
const { getDireccionSucursal, esPagoPresencial } = require('../utils/sucursales');

/**
 * Valida la firma X-Hub-Signature-256 del webhook de Meta usando META_APP_SECRET.
 * Si la variable no está definida (entorno dev sin secret), permite pasar con un warning.
 * Devuelve `true` si el request es válido y debe procesarse.
 */
const verifySignature = (req) => {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('[Webhook] ❌ META_APP_SECRET no configurado en producción. Rechazando request.');
            return false;
        }
        console.warn('[Webhook] ⚠️ META_APP_SECRET no configurado (modo dev). Saltando validación de firma.');
        return true;
    }

    const signatureHeader = req.headers['x-hub-signature-256'];
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
        console.warn('[Webhook] ⚠️ Falta header x-hub-signature-256.');
        return false;
    }

    const expected = signatureHeader.slice('sha256='.length);
    if (!req.rawBody) {
        console.warn('[Webhook] ⚠️ rawBody no disponible — no se puede validar firma.');
        return false;
    }

    const computed = crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

    let valid = false;
    try {
        valid = crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        valid = false;
    }

    if (!valid) {
        console.warn('[Webhook] ⚠️ Firma X-Hub-Signature-256 inválida.');
    }
    return valid;
};

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
// Debounce ajustable por env. Dev/test: 5s. Producción recomendado: 20s (ahorra tokens).
const DEBOUNCE_TIME_MS = parseInt(process.env.WHATSAPP_DEBOUNCE_MS || '17000', 10);

// sendAndPersist mantiene compatibilidad: hoy el wrapper sendAgentMessage ya auto-persiste
// en la tabla mensajes con autor='agente_ia'. Conservamos la firma para no romper callers.
const sendAndPersist = async (phone, text /* opts ignorados: autor/sucursal ya los maneja el wrapper */) => {
    await whatsappService.sendAgentMessage(phone, text);
};

/**
 * Cancela cualquier debounce pendiente para un teléfono. Usado cuando el vendedor
 * envía una cotización formal o un mensaje manual, para evitar que el agente IA
 * responda con contexto desactualizado después de la acción del vendedor.
 */
const cancelDebounce = (customerPhone) => {
    const buffer = messageBuffer.get(customerPhone);
    if (buffer?.timer) {
        clearTimeout(buffer.timer);
        messageBuffer.delete(customerPhone);
        console.log(`[Webhook] 🚫 Debounce cancelado para ${customerPhone} (acción del vendedor)`);
        return true;
    }
    return false;
};

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

        // REQ-04 Fase 2: video y document
        const videos = messages.filter(m => m.hasVideo);
        const hasVideo = videos.length > 0;
        const documents = messages.filter(m => m.hasDocument);
        const hasDocument = documents.length > 0;

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
        // PADRÓN: Confirmación de propiedad del vehículo
        // Si el cliente recién envió un padrón y hay propietario pendiente,
        // detectamos sí/no por regex antes de seguir al flujo normal.
        // ═══════════════════════════════════════════════════════
        const propPendiente = session.entidades?.propietario_padron_pendiente;
        if (propPendiente && typeof propPendiente === 'object' && userText && !hasImage) {
            const lowerConf = userText.toLowerCase().trim();
            const afirmativo = /(^|\s)(s[ií]|s[ií]i|soi)(\s|[.,!?]|$)|\bsoy?\s+(yo|el|la)\b|\b(el|la|soy?|soi)\s*due[ñn][oa]\b|\bdue[ñn][oa]\b|\bes m[ií]o\b|\bsoy yo\b|\ba mi nombre\b|\bes mi auto\b|\bmi veh[íi]culo\b|\bcorrecto\b|\bafirmativo\b|\bexacto\b|\bas[ií] es\b|\bas[ií] mismo\b|\best[aá] a mi nombre\b|\bme pertenece\b/i.test(lowerConf);
            const negativo = /^no(\b|,|\.|$)|\bno es m[ií]o\b|\bno soy yo\b|\bcotizo para\b|\bpara otra persona\b|\bpara un cliente\b|\bsoy mec[áa]nico\b|\bno me pertenece\b|\bes de un cliente\b|\bes del jefe\b|\bes de mi\s/i.test(lowerConf);

            if (negativo) {
                session = await sessionsService.updateEntidades(customerPhone, { propietario_padron_pendiente: false });
                console.log(`[Padrón] ❌ Cliente cotiza para otro (no auto-vinculamos propietario): ${customerPhone}`);
                const ack = 'Entendido, cotizamos sin vincular esos datos a tu nombre. ¿Qué repuesto necesitas para ese vehículo?';
                await new Promise(r => setTimeout(r, 1200));
                await sendAndPersist(customerPhone, ack);
                return;
            }

            if (afirmativo) {
                const p = propPendiente;
                const updates = { propietario_padron_pendiente: false };
                if (p.nombre && !session.entidades.nombre_cliente) updates.nombre_cliente = p.nombre;
                if (p.rut && !session.entidades.rut_cliente) updates.rut_cliente = p.rut;
                session = await sessionsService.updateEntidades(customerPhone, updates);
                console.log(`[Padrón] ✅ Propietario confirmado: ${p.nombre || '(nombre no extraído)'} (${customerPhone})`);
                // Fallback: el cliente confirmó ser dueño pero el padrón no entregó el nombre →
                // lo pedimos una vez para no perder la atribución del contacto.
                if (!p.nombre && !session.entidades.nombre_cliente) {
                    const ackSinNombre = '¡Perfecto! Para dejar la cotización a tu nombre, ¿me confirmas tu nombre completo?';
                    await new Promise(r => setTimeout(r, 1200));
                    await sendAndPersist(customerPhone, ackSinNombre);
                    return;
                }
                const nombreCorto = (p.nombre || '').split(/\s+/)[0] || '';
                const ack = `¡Perfecto${nombreCorto ? ' ' + nombreCorto : ''}! Ya registré tus datos. ¿Qué repuesto necesitas?`;
                await new Promise(r => setTimeout(r, 1200));
                await sendAndPersist(customerPhone, ack);
                return;
            }
            // Si no matchea claramente, dejamos el flag y seguimos al flujo normal.
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
            await sendAndPersist(customerPhone, saludoRespuesta);
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
                    await sendAndPersist(customerPhone, msg);
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
                    await sendAndPersist(customerPhone, msg);
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
                await sendAndPersist(customerPhone, mensajeEspera);
            } else {
                console.log(`[Webhook] Ignorando imagen adicional de ${customerPhone} (ya en ESPERANDO_APROBACION_ADMIN).`);
            }
            return; // Termina ejecución del background
        }

        // ═══════════════════════════════════════════════════════
        // FLUJO ESPECIAL: Imagen en PERFILANDO / ESPERANDO_VENDEDOR
        // Clasifica primero (padrón vs parte vs otro) y despacha.
        // ═══════════════════════════════════════════════════════
        if (hasImage && (
            session.estado === sessionsService.STATES.PERFILANDO ||
            session.estado === sessionsService.STATES.ESPERANDO_VENDEDOR
        )) {
            console.log(`[ImageID] 📸 ${images.length} imagen(s) recibida(s) de ${customerPhone}. Clasificando...`);

            // Fase 1: descargar y clasificar cada imagen en paralelo
            // REQ-04 Fase 2: incluir waMessageId para actualizar mensajes tras subida a storage
            const classified = await Promise.all(images.map(async (imgMsg) => {
                const mediaId = imgMsg.message.image?.id;
                const waMessageId = imgMsg.message?.id || null;
                // El cliente puede escribir el nombre de la pieza en el caption de la foto
                const caption = imgMsg.message.image?.caption || '';
                if (!mediaId) return null;
                const imageData = await whatsappService.downloadMedia(mediaId);
                if (!imageData) {
                    console.error(`[ImageID] ❌ No se pudo descargar imagen ${mediaId}`);
                    return null;
                }
                const analysis = await geminiService.analyzeImage(imageData);
                return { imageData, analysis, waMessageId, caption };
            }));
            const validImages = classified.filter(Boolean);
            const padrones = validImages.filter(x => x.analysis.tipo === 'padron' && x.analysis.padron);
            const placasPatente = validImages.filter(x => x.analysis.tipo === 'placa_patente' && x.analysis.placa_patente?.patente);
            const partes = validImages.filter(x => x.analysis.tipo !== 'padron' && x.analysis.tipo !== 'placa_patente');

            // ── FASE 2A.5: PROCESAR PLACAS PATENTE (foto de la matrícula del auto) ──
            // Capturar la patente leída por OCR y guardarla en entidades. No requiere
            // identificación de repuesto ni datos del propietario.
            for (const pp of placasPatente) {
                const patenteRaw = pp.analysis.placa_patente.patente.toUpperCase().replace(/[-\s]/g, '');
                // Validación formato chileno: 2-4 letras + 2-4 dígitos
                if (/^[A-Z]{2,4}\d{2,4}$/.test(patenteRaw)) {
                    const session = await sessionsService.getSession(customerPhone);
                    // Si ya hay vehículo en root sin patente, asignarla allí
                    if (session.entidades?.marca_modelo && !session.entidades.patente) {
                        await sessionsService.updateEntidades(customerPhone, { patente: patenteRaw });
                    } else if (Array.isArray(session.entidades?.vehiculos) && session.entidades.vehiculos.length > 0) {
                        // Multi-vehículo: asignar al primero que no tenga patente
                        const vehiculos = [...session.entidades.vehiculos];
                        const idx = vehiculos.findIndex(v => !v.patente);
                        if (idx >= 0) {
                            vehiculos[idx] = { ...vehiculos[idx], patente: patenteRaw };
                            await sessionsService.updateEntidades(customerPhone, { vehiculos });
                        }
                    } else {
                        // No hay vehículo aún — guardar al root
                        await sessionsService.updateEntidades(customerPhone, { patente: patenteRaw });
                    }
                    console.log(`[ImageID] 🏁 Placa patente capturada: ${patenteRaw} para ${customerPhone}`);
                    // Subir imagen a storage
                    try {
                        const placaPath = await storageService.uploadPartImage(customerPhone, pp.imageData.buffer, pp.imageData.mimeType);
                        if (placaPath && pp.waMessageId) {
                            await mensajesService.actualizarMedia(pp.waMessageId, { mediaUrl: placaPath, mediaMime: pp.imageData.mimeType });
                        }
                    } catch (e) { console.error(`[ImageID] ❌ Error guardando placa:`, e.message); }
                } else {
                    console.warn(`[ImageID] ⚠️ Placa patente con formato inválido: "${patenteRaw}" — ignorando`);
                }
            }

            // ── FASE 2A: PROCESAR PADRONES ──
            // REQ-04 Fase 2: subir imágenes de padrón a Storage
            for (const padron of padrones) {
                const { imageData, waMessageId } = padron;
                try {
                    const padronPath = await storageService.uploadPartImage(customerPhone, imageData.buffer, imageData.mimeType);
                    if (padronPath && waMessageId) {
                        await mensajesService.actualizarMedia(waMessageId, {
                            mediaUrl: padronPath,
                            mediaMime: imageData.mimeType,
                        });
                    }
                } catch (storageErr) {
                    console.error(`[ImageID] ❌ Error subiendo padrón a storage (flujo continúa):`, storageErr.message);
                }
            }

            let padronDatos = null; // para el mensaje final
            let propietarioPendiente = null;
            for (const { analysis } of padrones) {
                const p = analysis.padron || {};
                const vehiculoData = {
                    marca_modelo: p.marca_modelo || null,
                    ano: p.ano || null,
                    patente: p.patente || null,
                    vin: p.vin || null,
                    motor: p.motor || null,
                    combustible: p.combustible || null
                };

                // Saltar vehículos vacíos del padrón (extracción sin datos útiles)
                const padronTieneDatos = !!(vehiculoData.marca_modelo || vehiculoData.patente || vehiculoData.vin);

                const currentVehiculos = Array.isArray(session.entidades?.vehiculos) ? session.entidades.vehiculos : [];
                const rootVehiculo = {
                    marca_modelo: session.entidades?.marca_modelo || null,
                    ano: session.entidades?.ano || null,
                    patente: session.entidades?.patente || null,
                    vin: session.entidades?.vin || null,
                    motor: session.entidades?.motor || null,
                    combustible: session.entidades?.combustible || null,
                };
                const rootHasVehiculo = !!(rootVehiculo.marca_modelo || rootVehiculo.patente || rootVehiculo.vin);

                if (!padronTieneDatos) {
                    // Nada útil que agregar desde el padrón.
                } else if (currentVehiculos.length > 0) {
                    // Ya hay array multi-vehículo: enriquecer el que haga match, o agregar uno nuevo.
                    const nuevosVehiculos = [...currentVehiculos];
                    const idxMatch = nuevosVehiculos.findIndex(v => sessionsService.isSameVehiculo(v, vehiculoData));
                    if (idxMatch !== -1) {
                        const v = nuevosVehiculos[idxMatch];
                        nuevosVehiculos[idxMatch] = {
                            ...v,
                            marca_modelo: vehiculoData.marca_modelo || v.marca_modelo, // padrón = nombre oficial
                            ano: v.ano || vehiculoData.ano,
                            patente: v.patente || vehiculoData.patente,
                            vin: v.vin || vehiculoData.vin,
                            motor: v.motor || vehiculoData.motor,
                            combustible: v.combustible || vehiculoData.combustible,
                            repuestos_solicitados: v.repuestos_solicitados || []
                        };
                    } else {
                        nuevosVehiculos.push({ ...vehiculoData, repuestos_solicitados: [] });
                    }
                    await sessionsService.updateEntidades(customerPhone, { vehiculos: nuevosVehiculos });
                } else if (rootHasVehiculo && sessionsService.isSameVehiculo(rootVehiculo, vehiculoData)) {
                    // MISMO auto que el del root (dado por texto): ENRIQUECER el root con los datos
                    // del padrón en vez de duplicarlo. updateEntidades ignora nulls → solo rellena.
                    await sessionsService.updateEntidades(customerPhone, vehiculoData);
                } else if (rootHasVehiculo) {
                    // Auto DISTINTO al del root (mecánico multi-vehículo): pasar a array.
                    const nuevosVehiculos = [
                        { ...rootVehiculo, repuestos_solicitados: session.entidades?.repuestos_solicitados || [] },
                        { ...vehiculoData, repuestos_solicitados: [] }
                    ];
                    await sessionsService.updateEntidades(customerPhone, { vehiculos: nuevosVehiculos });
                } else {
                    // Sin vehículo previo: merge al root directamente.
                    await sessionsService.updateEntidades(customerPhone, vehiculoData);
                }

                // Propietario NO se guarda automáticamente — queda pendiente de confirmación
                if (p.nombre_propietario || p.rut_propietario) {
                    propietarioPendiente = {
                        nombre: p.nombre_propietario || null,
                        rut: p.rut_propietario || null,
                        marca_modelo: p.marca_modelo || null,
                        patente: p.patente || null
                    };
                }
                padronDatos = p;
            }

            if (propietarioPendiente) {
                await sessionsService.updateEntidades(customerPhone, { propietario_padron_pendiente: propietarioPendiente });
            }

            // ── FASE 2B: PROCESAR PARTES (flujo existente) ──
            const partesResults = [];
            if (partes.length > 0) {
                session = await sessionsService.getSession(customerPhone);
                const contextoVehiculo = session.entidades?.marca_modelo
                    ? `${session.entidades.marca_modelo}${session.entidades.ano ? ' ' + session.entidades.ano : ''}`
                    : '';

                const resultados = await Promise.all(partes.map(async ({ imageData, waMessageId, caption }) => {
                    const [imagePath, identificacion] = await Promise.all([
                        storageService.uploadPartImage(customerPhone, imageData.buffer, imageData.mimeType),
                        // Pasar el caption del cliente como hint principal para identificar la pieza
                        geminiService.identifyPartFromImage(imageData, contextoVehiculo, caption)
                    ]);
                    // REQ-04 Fase 2: actualizar media_url en el registro mensajes ya creado
                    if (imagePath && waMessageId) {
                        try {
                            await mensajesService.actualizarMedia(waMessageId, {
                                mediaUrl: imagePath,
                                mediaMime: imageData.mimeType,
                            });
                        } catch (mediaUpdateErr) {
                            console.error(`[Mensajes] ❌ Error actualizando media_url de imagen (flujo continúa):`, mediaUpdateErr.message);
                        }
                    }
                    return { imagePath, identificacion, caption };
                }));

                for (const r of resultados.filter(Boolean)) {
                    partesResults.push(r);
                    // El nombre prioriza el caption del cliente (él sabe qué pieza es).
                    // Si hay caption, el nombre es confiable → no queda pendiente de identificación.
                    const captionLimpio = (r.caption || '').trim();
                    const nombreFinal = captionLimpio || r.identificacion.nombre_sugerido || 'Pieza sin identificar';
                    const necesitaIdentificacion = !captionLimpio && (!r.identificacion.nombre_sugerido || r.identificacion.nombre_sugerido === 'Pieza sin identificar');
                    await sessionsService.updateEntidades(customerPhone, {
                        repuestos_solicitados: [{
                            nombre: nombreFinal,
                            cantidad: 1,
                            precio: null,
                            estado: 'pendiente',
                            pendiente_identificacion: necesitaIdentificacion,
                            imagen_url: r.imagePath,
                            identificacion_ia: r.identificacion.descripcion,
                            confianza_ia: r.identificacion.confianza,
                            notas_ia: captionLimpio ? `Cliente describió: "${captionLimpio}"` : null
                        }]
                    });
                }
            }

            session = await sessionsService.getSession(customerPhone);

            // Si hay también texto en el lote, procesarlo con Gemini para extraer datos adicionales
            if (userText.trim()) {
                const historialImg = await mensajesService.listarPorPhone(customerPhone, { limit: 15 }).catch(() => []);
                const aiJson = await geminiService.generateResponse(userText, session, null, [], historialImg);
                if (!Array.isArray(aiJson) && aiJson?.entidades) {
                    await sessionsService.updateEntidades(customerPhone, aiJson.entidades);
                    session = await sessionsService.getSession(customerPhone);
                }
            }

            // ── FASE 3: CONSTRUIR RESPUESTA ──
            // Caso padrón con propietario pendiente → pedir confirmación de propiedad
            if (padronDatos && propietarioPendiente) {
                const veh = `${padronDatos.marca_modelo || 'tu vehículo'}${padronDatos.ano ? ' ' + padronDatos.ano : ''}`;
                const patenteStr = padronDatos.patente ? ` (patente ${padronDatos.patente})` : '';
                const msg = `📄 Recibí tu padrón del ${veh}${patenteStr}. Ya anoté los datos del vehículo. ¿Está a tu nombre (${propietarioPendiente.nombre || 'el propietario del padrón'}) o cotizas para otra persona?`;
                await new Promise(r => setTimeout(r, 1500));
                await sendAndPersist(customerPhone, msg);
                return;
            }

            // Caso padrón sin propietario → confirmación simple del vehículo
            if (padronDatos && !propietarioPendiente) {
                const veh = `${padronDatos.marca_modelo || 'tu vehículo'}${padronDatos.ano ? ' ' + padronDatos.ano : ''}`;
                const patenteStr = padronDatos.patente ? ` (patente ${padronDatos.patente})` : '';
                const msg = `📄 Recibí tu padrón del ${veh}${patenteStr}. Ya anoté los datos del vehículo. ¿Qué repuesto necesitas?`;
                await new Promise(r => setTimeout(r, 1500));
                await sendAndPersist(customerPhone, msg);
                return;
            }

            // Caso solo PLACA PATENTE (sin partes ni padrón) → confirmar y avanzar si hay vehículo
            if (placasPatente.length > 0 && partesResults.length === 0 && !padronDatos) {
                const sessionRefr = await sessionsService.getSession(customerPhone);
                const patenteRefr = sessionRefr.entidades?.patente
                    || (Array.isArray(sessionRefr.entidades?.vehiculos) && sessionRefr.entidades.vehiculos.find(v => v.patente)?.patente);
                const msg = patenteRefr
                    ? `🏁 Recibí la patente ${patenteRefr}. Ya quedó registrada en tu cotización.`
                    : `🏁 Recibí la foto de la patente. La revisaremos.`;
                await new Promise(r => setTimeout(r, 1200));
                await sendAndPersist(customerPhone, msg);
                return;
            }

            // Caso solo partes → mensaje original según estado
            const e = session.entidades;
            const tieneVehiculo = (e.ano && (e.patente || e.vin)) ||
                (Array.isArray(e.vehiculos) && e.vehiculos.some(v => v.ano && (v.patente || v.vin)));
            const nFotos = partesResults.length;
            // Mencionar la patente capturada si la hubo en este mismo lote
            const patenteCapturadaMsg = placasPatente.length > 0 ? ' Recibí también la patente.' : '';

            if (session.estado === sessionsService.STATES.PERFILANDO) {
                if (tieneVehiculo) {
                    await sessionsService.setEstado(customerPhone, sessionsService.STATES.ESPERANDO_VENDEDOR);
                    const msg = `📸 Recibí tu${nFotos > 1 ? 's ' + nFotos : ''} foto${nFotos > 1 ? 's' : ''}.${patenteCapturadaMsg} Un asesor las revisará y te cotizará en breve. 🔧`;
                    await new Promise(r => setTimeout(r, 1500));
                    await sendAndPersist(customerPhone, msg);
                } else {
                    const msg = `📸 Recibí tu${nFotos > 1 ? 's ' + nFotos : ''} foto${nFotos > 1 ? 's' : ''}.${patenteCapturadaMsg} Para cotizar necesito también los datos del auto: marca, año${placasPatente.length === 0 ? ' y patente' : ''}. ¿Me los puedes enviar?`;
                    await new Promise(r => setTimeout(r, 1500));
                    await sendAndPersist(customerPhone, msg);
                }
            } else {
                const msg = `📸 Recibí tu${nFotos > 1 ? 's ' + nFotos : ''} foto${nFotos > 1 ? 's' : ''} adicional${nFotos > 1 ? 'es' : ''}.${patenteCapturadaMsg} El asesor las revisará junto a la cotización. 🔧`;
                await new Promise(r => setTimeout(r, 1500));
                await sendAndPersist(customerPhone, msg);
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
            console.log(`[P1] 🧠 Imagen recibida en estado ${session.estado} de ${customerPhone}. Clasificando antes de asumir comprobante...`);

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

            // Descargar y CLASIFICAR la imagen antes de asumir que es voucher.
            // Bug previo: cualquier imagen en CONFIRMANDO_COMPRA se procesaba como comprobante
            // → fotos de patente, repuestos, capturas, etc. terminaban marcando la sesión
            // como ESPERANDO_APROBACION_ADMIN con datos basura.
            const voucherMediaId = images[0].message.image?.id;
            const imageData = await whatsappService.downloadMedia(voucherMediaId);

            if (!imageData) {
                console.error(`[P1] ❌ No se pudo descargar la imagen de ${customerPhone}.`);
                await sendAndPersist(customerPhone, 'Tuvimos un problema al recibir tu imagen. ¿Podrías enviarla nuevamente, por favor?');
                return;
            }

            // Clasificar tipo de imagen: 'padron' | 'parte' | 'otro' (vouchers no se clasifican aquí
            // pero si la IA no detecta padron/parte y el estado es de pago, asumimos comprobante).
            let tipoImagen = 'otro';
            try {
                const cls = await geminiService.analyzeImage(imageData);
                tipoImagen = cls?.tipo || 'otro';
                if (tipoImagen === 'padron' && cls.padron) {
                    // Es la patente/padrón del vehículo, NO un comprobante. Capturar datos del vehículo.
                    console.log(`[P1] 📄 Imagen clasificada como PADRÓN, no comprobante. Capturando datos vehículo.`);
                    const padronUpdate = {};
                    if (cls.padron.marca_modelo) padronUpdate.marca_modelo = cls.padron.marca_modelo;
                    if (cls.padron.ano) padronUpdate.ano = String(cls.padron.ano);
                    if (cls.padron.patente) padronUpdate.patente = cls.padron.patente;
                    if (cls.padron.vin) padronUpdate.vin = cls.padron.vin;
                    if (cls.padron.motor) padronUpdate.motor = cls.padron.motor;
                    if (cls.padron.combustible) padronUpdate.combustible = cls.padron.combustible;
                    if (Object.keys(padronUpdate).length > 0) {
                        await sessionsService.updateEntidades(customerPhone, padronUpdate);
                    }
                    await sendAndPersist(customerPhone, `📄 Recibí el padrón, gracias. Un asesor revisará tu cotización con estos datos.`);
                    return;
                }
                if (tipoImagen === 'placa_patente' && cls.placa_patente?.patente) {
                    // Es foto de la placa patente. Capturar y confirmar.
                    const patenteRaw = cls.placa_patente.patente.toUpperCase().replace(/[-\s]/g, '');
                    if (/^[A-Z]{2,4}\d{2,4}$/.test(patenteRaw)) {
                        await sessionsService.updateEntidades(customerPhone, { patente: patenteRaw });
                        await sendAndPersist(customerPhone, `🏁 Recibí la patente ${patenteRaw}. Quedó registrada.`);
                        return;
                    }
                    // Formato inválido — caer al flujo de parte
                    console.warn(`[P1] ⚠️ Placa patente con formato inválido: "${patenteRaw}"`);
                }
                if (tipoImagen === 'parte') {
                    // Es foto de repuesto. Avisar y dejar que el vendedor la revise.
                    console.log(`[P1] 🔧 Imagen clasificada como PARTE/REPUESTO, no comprobante.`);
                    await sendAndPersist(customerPhone, `🔧 Recibí tu foto. Un asesor la revisará junto a tu cotización.`);
                    return;
                }
                // tipo 'otro' → seguimos al flujo de voucher (el cliente envía algo más raro)
                // pero validamos que extractVoucherData encuentre datos reales antes de avanzar estado
            } catch (clsErr) {
                console.warn(`[P1] ⚠️ Clasificación de imagen falló: ${clsErr.message}. Asumiendo comprobante (fallback).`);
            }

            const datosExtraidos = await geminiService.extractVoucherData(imageData);
            const comprobanteUrl = await storageService.uploadVoucher(customerPhone, imageData.buffer, imageData.mimeType);

            if (!comprobanteUrl) {
                console.error(`[P1] ❌ No se pudo subir el voucher de ${customerPhone} al storage.`);
                await sendAndPersist(customerPhone, 'Tuvimos un inconveniente técnico guardando su comprobante. Por favor, inténtelo en un momento.');
                return;
            }

            // REQ-04 Fase 2: actualizar media_url en el registro mensajes del comprobante
            const voucherWaId = images[0]?.message?.id || null;
            if (voucherWaId) {
                try {
                    await mensajesService.actualizarMedia(voucherWaId, {
                        mediaUrl: comprobanteUrl,
                        mediaMime: imageData.mimeType,
                    });
                } catch (mediaUpdateErr) {
                    console.error(`[Mensajes] ❌ Error actualizando media_url de voucher (flujo continúa):`, mediaUpdateErr.message);
                }
            }

            await sessionsService.saveVoucherData(customerPhone, comprobanteUrl, datosExtraidos);

            const respuestaConfirmacion = `¡Perfecto! 📸 Recibí su comprobante de pago. Nuestro equipo lo está verificando ahora y le confirmaremos en unos minutos. Si tiene alguna consulta, no dude en escribirnos. 👌`;
            const delayMs = Math.min(respuestaConfirmacion.length * 25, 3500);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            await sendAndPersist(customerPhone, respuestaConfirmacion);

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
            await sendAndPersist(customerPhone, msg);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // REQ-04 FASE 2: VIDEO — descargar, subir a Supabase Storage y registrar.
        // NO se envía a Gemini (riesgo R3 — costo de tokens).
        // Solo se notifica al vendedor que el cliente envió un video.
        // ═══════════════════════════════════════════════════════
        if (hasVideo) {
            console.log(`[Video] 🎥 ${videos.length} video(s) recibido(s) de ${customerPhone}. Subiendo a storage...`);
            for (const vidMsg of videos) {
                const mediaId = vidMsg.videoMediaId;
                const waId = vidMsg.message?.id || null;
                if (!mediaId) continue;
                try {
                    const videoData = await whatsappService.downloadMedia(mediaId);
                    if (!videoData) {
                        console.error(`[Video] ❌ No se pudo descargar video ${mediaId} de ${customerPhone}.`);
                        continue;
                    }
                    const videoPath = await storageService.uploadVideo(customerPhone, videoData.buffer, videoData.mimeType);
                    if (videoPath && waId) {
                        await mensajesService.actualizarMedia(waId, {
                            mediaUrl: videoPath,
                            mediaMime: videoData.mimeType,
                        });
                    }
                    console.log(`[Video] ✅ Video de ${customerPhone} almacenado en: ${videoPath}`);
                } catch (vidErr) {
                    console.error(`[Video] ❌ Error procesando video de ${customerPhone}:`, vidErr.message);
                }
            }
            // Notificar al vendedor en la conversación sin enviar a Gemini
            const msgVideo = 'Recibí tu video. Un asesor lo revisará en breve. 🎥';
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sendAndPersist(customerPhone, msgVideo);
            return;
        }

        // ═══════════════════════════════════════════════════════
        // REQ-04 FASE 2: DOCUMENT — descargar, subir a Supabase Storage y registrar.
        // NO se envía a Gemini (riesgo R3 — costo de tokens).
        // ═══════════════════════════════════════════════════════
        if (hasDocument) {
            console.log(`[Doc] 📄 ${documents.length} documento(s) recibido(s) de ${customerPhone}. Subiendo a storage...`);
            for (const docMsg of documents) {
                const mediaId = docMsg.documentMediaId;
                const waId = docMsg.message?.id || null;
                if (!mediaId) continue;
                try {
                    const docData = await whatsappService.downloadMedia(mediaId);
                    if (!docData) {
                        console.error(`[Doc] ❌ No se pudo descargar documento ${mediaId} de ${customerPhone}.`);
                        continue;
                    }
                    const docPath = await storageService.uploadDocument(customerPhone, docData.buffer, docData.mimeType);
                    if (docPath && waId) {
                        await mensajesService.actualizarMedia(waId, {
                            mediaUrl: docPath,
                            mediaMime: docData.mimeType,
                        });
                    }
                    console.log(`[Doc] ✅ Documento de ${customerPhone} almacenado en: ${docPath}`);
                } catch (docErr) {
                    console.error(`[Doc] ❌ Error procesando documento de ${customerPhone}:`, docErr.message);
                }
            }
            const msgDoc = 'Recibí tu documento. Un asesor lo revisará en breve. 📄';
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sendAndPersist(customerPhone, msgDoc);
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
                // Validación defensiva: asegurar que la sesión post-archivado esté limpia
                const tieneRepuestosViejos = (newSession.entidades?.repuestos_solicitados?.length ?? 0) > 0;
                const tieneVehiculosViejos = (newSession.entidades?.vehiculos?.length ?? 0) > 0;

                if (tieneRepuestosViejos || tieneVehiculosViejos) {
                    console.warn(`[Webhook] ⚠️ Sesión post-archivado de ${customerPhone} contiene entidades viejas (repuestos: ${newSession.entidades?.repuestos_solicitados?.length}, vehiculos: ${newSession.entidades?.vehiculos?.length}). Forzando reset adicional.`);
                    session = await sessionsService.resetSession(customerPhone);
                } else {
                    session = newSession;
                }
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
            // Bug #2: Si hay modo bloqueante de VIN/Patente activo, saltar el classifyIntent:
            // el cliente probablemente está entregando el dato solicitado por el vendedor.
            // Hay que forzar PERFILANDO para que Gemini lo procese en modo bloqueante.
            const needsManualVin = session.entidades?.solicitud_manual_vin === true;
            const needsManualPatente = session.entidades?.solicitud_manual_patente === true;
            if (needsManualVin || needsManualPatente) {
                session = await sessionsService.setEstado(customerPhone, sessionsService.STATES.PERFILANDO);
                console.log(`[Session] 🔓 Modo bloqueante ${needsManualVin ? 'VIN' : 'patente'} activo para ${customerPhone}. Forzando PERFILANDO sin classifyIntent.`);
            } else {
                const intentResult = await geminiService.classifyIntent(userText);
                if (!intentResult.es_compra) {
                    console.log(`[Hand-off] Ignorando mensaje de ${customerPhone} (ESPERANDO_VENDEDOR, no es compra)`);
                    await sendAndPersist(customerPhone,
                        '¡Hola! Estamos buscando los precios para ti, en unos minutos te enviamos la cotización completa. 🔍');
                    return;
                }
                session = await sessionsService.setEstado(customerPhone, sessionsService.STATES.PERFILANDO);
                console.log(`[Session] ➕ Intención de compra detectada para ${customerPhone}. Volviendo a PERFILANDO.`);
            }
        }

        console.log(`[Webhook] Enviando a Gemini mensaje final de ${customerPhone}: "${userText.replace(/\n/g, ' ')}"`);

        // Para estados no cubiertos arriba, imageData se pasa null (ya se manejaron arriba o no aplica)
        let imageData = null;

        // Descargar TODOS los audios del lote
        // REQ-04 Fase 2: tras descargar, subir a Supabase Storage y actualizar media_url en mensajes
        let audioDataList = [];
        if (hasAudio) {
            console.log(`[Audio] 🎤 Descargando ${audios.length} nota(s) de voz de ${customerPhone}...`);
            const downloadResults = await Promise.all(
                audios.map(a => whatsappService.downloadMedia(a.audioMediaId))
            );
            audioDataList = downloadResults.filter(Boolean);
            if (audioDataList.length === 0) {
                console.error(`[Audio] ❌ No se pudo descargar ningún audio de ${customerPhone}.`);
                await sendAndPersist(customerPhone, 'Tuve un problema al escuchar tu audio. ¿Lo puedes reenviar o escribir tu consulta?');
                return;
            }
            console.log(`[Audio] ✅ ${audioDataList.length} audio(s) descargados`);

            // Subir audios a Supabase Storage (aislado — si falla, continúa el flujo de Gemini)
            for (let i = 0; i < audios.length; i++) {
                const aData = audioDataList[i];
                const waId = audios[i]?.message?.id || null;
                if (!aData) continue;
                try {
                    const audioPath = await storageService.uploadAudio(customerPhone, aData.buffer, aData.mimeType);
                    if (audioPath && waId) {
                        await mensajesService.actualizarMedia(waId, {
                            mediaUrl: audioPath,
                            mediaMime: aData.mimeType,
                        });
                    }
                } catch (audioUploadErr) {
                    console.error(`[Audio] ❌ Error subiendo audio a storage (flujo Gemini continúa):`, audioUploadErr.message);
                }
            }
        }

        // 3. Obtener respuesta y entidades de Gemini con selección dinámica de modelo.
        // Inyectar historial reciente para memoria conversacional (evita perder contexto
        // tras pausa del vendedor y evita repreguntar patente/VIN/datos ya dados).
        const historialReciente = await mensajesService.listarPorPhone(customerPhone, { limit: 15 }).catch(() => []);
        let aiJson = await geminiService.generateResponse(userText, session, imageData, audioDataList, historialReciente);
        
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
        // Normalización: Gemini usa "estado_cotizacion" como clave principal
        if (aiJson.estado_cotizacion && !aiJson.estado) {
            aiJson.estado = aiJson.estado_cotizacion;
        }
        
        console.log(`[Gemini] Respuesta (${session.estado}):`, JSON.stringify(aiJson, null, 2));

        // REQ-04 Fase 2: extraer transcripcion_audio del JSON de Gemini y persistirla.
        // Esto actualiza el registro mensajes ya creado en receiveMessage.
        // Aislado en try/catch — si falla, el flujo de Gemini continúa (riesgo R1).
        if (hasAudio && aiJson.transcripcion_audio) {
            try {
                for (const audioMsg of audios) {
                    const waId = audioMsg?.message?.id || null;
                    if (waId) {
                        await mensajesService.actualizarMedia(waId, {
                            transcripcion: aiJson.transcripcion_audio,
                        });
                    }
                }
                console.log(`[Mensajes] ✅ Transcripción de audio guardada para ${customerPhone}`);
            } catch (transcErr) {
                console.error(`[Mensajes] ❌ Error guardando transcripción de audio (flujo continúa):`, transcErr.message);
            }
        }

        // 4. Actualizar entidades en la sesión
        const originalSession = JSON.parse(JSON.stringify(session)); // Backup
        session = await sessionsService.updateEntidades(customerPhone, aiJson.entidades);

        // -- GUARDIA CRÍTICA CONTRA TIMEOUTS DE DB --
        if (!session) {
            console.error(`[CRITICAL] No se pudo actualizar sesión de ${customerPhone} tras respuesta de Gemini. Usando backup local.`);
            session = originalSession; // Mantener estado anterior para no perder el contexto del render
        }

        // Safety net anti-huérfanos: si Gemini igual creó repuestos en el root con multi-vehículo
        // activo, intentar reasignar basándonos en lo que el cliente dijo en este turno.
        if (
            session &&
            Array.isArray(session.entidades?.repuestos_solicitados) &&
            session.entidades.repuestos_solicitados.length > 0 &&
            Array.isArray(session.entidades?.vehiculos) &&
            session.entidades.vehiculos.length > 0 &&
            userText
        ) {
            session = await sessionsService.reassignOrphanRepuestos(customerPhone, userText);
        }

        // Safety net staging: si hay repuestos_pendiente_vehiculo (staging entre turnos)
        // y el cliente acaba de asignar un vehículo, mover al destino correcto.
        const staged = session?.entidades?.repuestos_pendiente_vehiculo;
        if (Array.isArray(staged) && staged.length > 0 && userText) {
            const e = session.entidades;
            const vehiculoEnRoot = !!(e.marca_modelo);
            const vehiculosArray = Array.isArray(e.vehiculos) && e.vehiculos.length > 0;

            if (vehiculoEnRoot || vehiculosArray) {
                // Inyectar los staged como repuestos_solicitados para que el merge y
                // la Mejora #5 los asignen al vehículo correcto automáticamente.
                session = await sessionsService.updateEntidades(customerPhone, {
                    repuestos_solicitados: staged,
                    repuestos_pendiente_vehiculo: []
                });
                // Si hay multi-vehículo, también intentar reasignar por texto
                if (vehiculosArray) {
                    session = await sessionsService.reassignOrphanRepuestos(customerPhone, userText);
                }
                console.log(`[Staged] 🔀 ${staged.length} repuesto(s) del staging asignados al vehículo para ${customerPhone}`);
            }
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

            // Filosofía: FACILITAR el flujo, no trabar. Con marca + repuesto basta para
            // pasarle el caso al vendedor — él pide lo que falte (año, patente, etc.).
            // El año NO es obligatorio; VIN/patente sirven igual de identificador.
            const tieneIdentificador = (v) => !!(v?.marca_modelo); // marca/modelo es lo mínimo
            const rootHasMinData = tieneIdentificador(e);
            const vehiculosHasMinData = Array.isArray(e.vehiculos) && e.vehiculos.some(tieneIdentificador);

            const hasMinData = (rootHasMinData || vehiculosHasMinData) && hasRepuestos;

            // Un repuesto identificado por CÓDIGO (filtro/OEM/referencia) es suficiente para
            // cotizar aunque falte marca/modelo — el vendedor cruza el código.
            const repuestosFlat = [
                ...(Array.isArray(e.repuestos_solicitados) ? e.repuestos_solicitados : []),
                ...((Array.isArray(e.vehiculos) ? e.vehiculos : []).flatMap(v => Array.isArray(v?.repuestos_solicitados) ? v.repuestos_solicitados : [])),
            ];
            const hasRepuestoConCodigo = repuestosFlat.some(r => (r?.codigo || '').trim());

            // finalMessage puede ser string, array, null o undefined — normalizar a string
            const finalMessageStr = Array.isArray(finalMessage) ? finalMessage.join(" ") : (finalMessage || "");
            const isAsking = finalMessageStr.includes("?") || finalMessageStr.toLowerCase().includes("qué tipo");
            // Si Gemini explícitamente sugiere ESPERANDO_VENDEDOR, confiar en esa decisión
            // aunque falte algún dato o haya un "?" de cortesía ("¿algo más?") al final.
            const geminiSugiereTraspasar = aiJson.estado === 'ESPERANDO_VENDEDOR';

            // Avanzar si: hay datos mínimos (marca + repuesto) Y no está preguntando,
            // O si Gemini explícitamente decidió traspasar (confiamos en su criterio),
            // O si hay un repuesto identificado por código (basta para que el vendedor cotice).
            // Con geminiSugiereTraspasar igual exigimos al menos un repuesto para no avanzar vacío.
            if ((hasMinData && !isAsking) || (geminiSugiereTraspasar && hasRepuestos) || (hasRepuestoConCodigo && !isAsking)) {
                await sessionsService.setEstado(customerPhone, 'ESPERANDO_VENDEDOR');
                // Siempre usar el mensaje de Gemini — ya está contextualizado con el horario
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

                    // Postprocesado robusto: inyectar dirección de sucursal si el pago es presencial (BUG-POST04)
                    const sucursal = session.entidades.sucursal_retiro || session.sucursal;
                    const metodoPago = session.entidades.metodo_pago;
                    const direccionBlock = (sucursal && esPagoPresencial(metodoPago))
                        ? `\n\n${getDireccionSucursal(sucursal)}`
                        : '';

                    if (nombreCliente) {
                        finalMessage = `¡Muchas gracias, ${nombreCliente}! 🎉 Su pedido está confirmado.${direccionBlock}\n\nAl acercarse a nuestra tienda, puede identificarse con:\n• Código de cotización: *${quoteId}*\n• O simplemente con su nombre: *${nombreCliente}*\n\n¡Lo atenderemos de inmediato! 🔧`;
                        await sessionsService.setEstado(customerPhone, 'CICLO_COMPLETO');
                        console.log(`[Venta] Ciclo de cierre completado para ${customerPhone} (Pago presencial)`);
                    } else {
                        finalMessage = `¡Perfecto! 🎉 Su pedido está confirmado.${direccionBlock}\nPara agilizar su atención al llegar a la tienda, ¿podría decirme su nombre completo?`;
                        // Mantenemos el estado actual para que en el próximo mensaje Gemini nos extraiga el nombre
                    }
                }
            }
        }

        // 6. Simular 'Typing Delay' y enviar respuesta(s)
        // Si finalMessage es array, enviar cada mensaje por separado con delay.
        // Filtrar mensajes vacíos/null para evitar crash en msg.length (bug recurrente
        // cuando Gemini no devuelve mensaje_cliente).
        const messagesToSend = (Array.isArray(finalMessage) ? finalMessage : [finalMessage])
            .filter(m => m && typeof m === 'string' && m.trim());
        for (const msg of messagesToSend) {
            const delayMs = Math.min(msg.length * 25, 3500);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            // 7. Enviar respuesta vía WhatsApp
            await sendAndPersist(customerPhone, msg);
        }
        if (messagesToSend.length > 0) {
            await sessionsService.incrementMessageCounter(customerPhone, 'ia');
        }

    } catch (error) {
        console.error(`[Debounce] Error procesando lote para ${customerPhone}:`, error);
    }
};

const receiveMessage = async (req, res) => {
    try {
        if (!verifySignature(req)) {
            return res.status(401).send('INVALID_SIGNATURE');
        }

        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        // Guard: descartar payloads sin mensajes (Read Receipts, notificaciones de estado, etc.)
        if (message) {
            console.log(`[Webhook] 📨 Tipo recibido: "${message.type}" de ${message.from} (auto-deploy test)`);
        }
        // REQ-04 Fase 2: ampliar tipos soportados a video y document
        if (!message || !['text', 'image', 'audio', 'video', 'document'].includes(message.type)) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const customerPhone = message.from;
        const userText = message.text?.body || message.image?.caption || message.video?.caption || message.document?.caption || '';
        const hasImage = message.type === 'image';
        const hasAudio = message.type === 'audio';
        const hasVideo = message.type === 'video';
        const hasDocument = message.type === 'document';
        const audioMediaId = hasAudio ? message.audio?.id : null;
        const videoMediaId = hasVideo ? message.video?.id : null;
        const documentMediaId = hasDocument ? message.document?.id : null;

        // -------------------------------------------------------------
        // REQ-04 FASE 1: Persistencia del mensaje ENTRANTE
        // Se hace aquí, antes del debounce y antes de cualquier chequeo
        // de agente_pausado, para que TODOS los mensajes queden registrados
        // incluso cuando la IA está pausada (riesgo R7 del plan).
        // El try/catch está aislado: si el INSERT falla el webhook sigue
        // normalmente sin afectar el flujo de Gemini (riesgo R1).
        // media_url y mediaMime se actualizan después en processBufferedMessages
        // una vez que el archivo se descargó y subió a Supabase (Fase 2).
        // -------------------------------------------------------------
        try {
            let tipoMensaje = 'text';
            if (hasImage) tipoMensaje = 'image';
            else if (hasAudio) tipoMensaje = 'audio';
            else if (hasVideo) tipoMensaje = 'video';
            else if (hasDocument) tipoMensaje = 'document';

            const contenido = userText || null;
            const waMessageId = message.id || null;
            // Guardar el media_id de Meta para poder re-descargar la imagen si la subida
            // a Storage falla en el momento (red de seguridad ante timeouts de Supabase).
            const mediaId = hasImage ? (message.image?.id || null)
                : hasAudio ? audioMediaId
                : hasVideo ? videoMediaId
                : hasDocument ? documentMediaId
                : null;
            await mensajesService.registrarEntrante({
                phone: customerPhone,
                tipo: tipoMensaje,
                contenido,
                waMessageId,
                mediaId,
                // sucursal aún no está derivada en este punto — se resolverá cuando
                // processBufferedMessages consulte la sesión. Se deja null.
                sucursal: null,
            });
        } catch (persistErr) {
            console.error(`[Mensajes] ❌ Error persistiendo entrante de ${customerPhone} (flujo continúa):`, persistErr.message);
        }

        // -------------------------------------------------------------
        // DEBOUNCE LOGIC
        // -------------------------------------------------------------
        let buffer = messageBuffer.get(customerPhone);
        if (!buffer) {
            buffer = { messages: [], timer: null };
        }

        buffer.messages.push({ userText, hasImage, hasAudio, hasVideo, hasDocument, audioMediaId, videoMediaId, documentMediaId, message, timestamp: Date.now() });

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

/**
 * Procesa inmediatamente TODOS los buffers de debounce pendientes.
 * Usado en graceful shutdown (SIGTERM): Railway detiene el contenedor en cada redeploy
 * y el buffer vive solo en memoria → sin esto, los mensajes en la ventana de 17s se
 * pierden y el agente nunca responde.
 */
const flushAllBuffers = async () => {
    const phones = Array.from(messageBuffer.keys());
    if (phones.length === 0) return;
    console.log(`[Shutdown] 🚿 Flushing ${phones.length} buffer(s) pendiente(s) antes de salir...`);
    for (const phone of phones) {
        const buffer = messageBuffer.get(phone);
        if (buffer?.timer) clearTimeout(buffer.timer);
        try {
            await processBufferedMessages(phone);
        } catch (err) {
            console.error(`[Shutdown] ❌ Error flusheando ${phone}:`, err.message);
        }
    }
};

/**
 * Barrido de recuperación al iniciar: detecta conversaciones cuyo ÚLTIMO mensaje es del
 * cliente (entrante) SIN respuesta posterior del sistema, y las reprocesa. Cubre buffers
 * perdidos por redeploy/crash/OOM (red de seguridad de la Defensa 1).
 *
 * Solo reprocesa mensajes de TEXTO (no rehidrata media binaria). Filtros de seguridad:
 * estado conversacional activo, no pausado, no terminal, dentro de la ventana de tiempo.
 */
const recoverUnansweredSessions = async (windowMin = parseInt(process.env.RECOVERY_WINDOW_MIN || '45', 10)) => {
    try {
        // Phones cuyo último mensaje es entrante, sin saliente posterior, dentro de ventana.
        const { rows } = await db.query(
            `WITH ultimo AS (
                 SELECT DISTINCT ON (phone) phone, direccion, created_at
                 FROM mensajes
                 ORDER BY phone, created_at DESC
             )
             SELECT u.phone
             FROM ultimo u
             WHERE u.direccion = 'entrante'
               AND u.created_at > NOW() - ($1 || ' minutes')::interval`,
            [String(windowMin)]
        );

        if (rows.length === 0) {
            console.log('[Recovery] ✅ Sin conversaciones pendientes de recuperar.');
            return;
        }

        const ESTADOS_ACTIVOS = ['PERFILANDO', 'ESPERANDO_VENDEDOR', 'CONFIRMANDO_COMPRA', 'ESPERANDO_COMPROBANTE'];
        let recuperados = 0;

        for (const { phone } of rows) {
            try {
                if (messageBuffer.has(phone)) continue; // ya hay un lote vivo

                const session = await sessionsService.getSession(phone);
                if (!session) continue;
                if (!ESTADOS_ACTIVOS.includes(session.estado)) continue;
                if (session.entidades?.agente_pausado === true) continue;

                // Traer los mensajes entrantes de TEXTO desde el último saliente.
                const { rows: msgs } = await db.query(
                    `SELECT contenido, tipo, created_at
                     FROM mensajes
                     WHERE phone = $1
                       AND created_at > COALESCE(
                           (SELECT MAX(created_at) FROM mensajes WHERE phone = $1 AND direccion = 'saliente'),
                           'epoch'::timestamptz)
                       AND direccion = 'entrante'
                     ORDER BY created_at ASC`,
                    [phone]
                );

                const textos = msgs.filter(m => m.tipo === 'text' && (m.contenido || '').trim());
                if (textos.length === 0) {
                    // Solo media (foto/audio/video/doc) sin texto: no rehidratamos binarios en
                    // recovery. Lo MARCAMOS visiblemente para que el vendedor lo vea y responda.
                    const tipos = [...new Set(msgs.map(m => m.tipo))].join(', ') || 'media';
                    if (!session.entidades?.marca) {
                        try {
                            await sessionsService.updateEntidades(phone, {
                                marca: {
                                    vendedor: 'Sistema',
                                    momento: new Date().toISOString(),
                                    nota: `⚠️ Cliente envió ${tipos} durante un reinicio del sistema y quedó sin responder. Revisar y contestar manual.`,
                                },
                            });
                            console.warn(`[Recovery] 🔖 ${phone} marcado para revisión manual (solo ${tipos}, sin texto).`);
                        } catch (errMarca) {
                            console.error(`[Recovery] ❌ No se pudo marcar ${phone}:`, errMarca.message);
                        }
                    } else {
                        console.warn(`[Recovery] ⏭️ ${phone} solo media sin texto, ya tenía marca previa. Se respeta.`);
                    }
                    continue;
                }

                // Reconstruir un buffer mínimo de texto y procesarlo por el pipeline normal.
                const reconstructed = textos.map(m => ({
                    userText: m.contenido,
                    hasImage: false, hasAudio: false, hasVideo: false, hasDocument: false,
                    audioMediaId: null, videoMediaId: null, documentMediaId: null,
                    message: { from: phone, type: 'text', text: { body: m.contenido } },
                    timestamp: Date.now(),
                }));
                messageBuffer.set(phone, { messages: reconstructed, timer: null });
                console.log(`[Recovery] ♻️ Reprocesando ${phone} (${textos.length} msg de texto sin responder, estado=${session.estado})`);
                await processBufferedMessages(phone);
                recuperados++;
            } catch (errPhone) {
                console.error(`[Recovery] ❌ Error recuperando ${phone}:`, errPhone.message);
                messageBuffer.delete(phone);
            }
        }

        console.log(`[Recovery] ✅ Barrido completo. Recuperados: ${recuperados}/${rows.length} (ventana ${windowMin} min).`);
    } catch (err) {
        console.error('[Recovery] ❌ Error en barrido de recuperación:', err.message);
    }
};

module.exports = {
    verifyWebhook,
    receiveMessage,
    cancelDebounce,
    flushAllBuffers,
    recoverUnansweredSessions
};
