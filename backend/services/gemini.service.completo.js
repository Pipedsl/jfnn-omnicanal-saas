const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const scheduleService = require('./schedule.service');
const sessionsService = require('./sessions.service');

/**
 * Servicio para interactuar con Google Gemini AI con Structured Outputs
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Carga de Knowledge Base (una sola vez al arrancar el módulo) ---
let knowledgeBase = '';
// Fallback: prueba paths locales (dev) y paths del contenedor Docker (prod)
const kbCandidates = [
    path.join(__dirname, '../../knowledge-base.md'),  // dev: desde backend/services → repo root
    path.join(__dirname, '../knowledge-base.md'),     // prod Docker: desde /app/services → /app/knowledge-base.md
];
for (const kbPath of kbCandidates) {
    try {
        knowledgeBase = fs.readFileSync(kbPath, 'utf8');
        console.log(`[Gemini] ✅ knowledge-base.md cargado desde ${kbPath}.`);
        break;
    } catch (err) {
        // continue al siguiente candidato
    }
}
if (!knowledgeBase) {
    console.warn('[Gemini] ⚠️ knowledge-base.md no encontrado en ningún path. Usando prompt base sin contexto de negocio.');
}

// --- MÉTRICAS DE JSON FALLBACK (Mejora #1) ---
let jsonParseFailures = 0;
let jsonRetrySuccesses = 0;

/**
 * MEJORA #1: Extrae JSON válido del texto de Gemini de forma robusta.
 * Si el parse directo falla, intenta extraer el primer bloque {...} balanceado.
 * Si todo falla, retorna null para disparar reintento.
 */
const extractValidJSON = (text) => {
    // Intento 1: parse directo
    try {
        return JSON.parse(text);
    } catch (e) {
        // Intento 2: extraer primer bloque {...} balanceado
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;

        try {
            return JSON.parse(match[0]);
        } catch (e2) {
            // Si tiene comentarios JSON inválidos, limpiar antes de paréntesis
            const cleaned = match[0].replace(/\/\/.*$/gm, '').replace(/,\s*\}/g, '}');
            try {
                return JSON.parse(cleaned);
            } catch (e3) {
                return null;
            }
        }
    }
};

/**
 * Genera una respuesta basada en el texto del usuario y el contexto de la sesión
 * @param {string} userText - Mensaje enviado por el cliente
 * @param {Object} sessionContext - Contexto completo de la sesión
 * @param {Object} imageData - Opcional. Objeto con { buffer: Buffer, mimeType: string }
 * @returns {Promise<Object>} - Objeto con mensaje_cliente y nuevas entidades
 */
/**
 * Formatea el historial de mensajes para inyectarlo al prompt de Gemini.
 * Da memoria conversacional al agente: ve lo que dijeron cliente, vendedor e IA.
 * @param {Array} mensajes - filas de mensajes (cronológico ASC) de listarPorPhone
 * @returns {string} bloque de texto legible
 */
const _fmtFechaHora = (iso) => {
    try {
        return new Date(iso).toLocaleString('es-CL', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago',
        });
    } catch (_) { return ''; }
};
const _lineaMensaje = (m) => {
    const quien = m.autor === 'cliente' ? 'Cliente'
        : m.autor === 'vendedor' ? `Vendedor${m.autor_nombre ? ' (' + m.autor_nombre + ')' : ''}`
        : 'IA';
    let contenido = m.contenido || '';
    if (m.tipo === 'image') contenido = '[imagen' + (contenido ? ': ' + contenido : '') + ']';
    else if (m.tipo === 'audio') contenido = '[nota de voz]' + (m.transcripcion ? ': ' + m.transcripcion : '');
    else if (m.tipo === 'video') contenido = '[video]';
    else if (m.tipo === 'document') contenido = '[documento]';
    return `[${_fmtFechaHora(m.created_at)}] ${quien}: ${contenido}`.slice(0, 320);
};

/**
 * Formatea el historial separando la CONVERSACIÓN ACTUAL (desde sesionIniciadaAt) del
 * CONTEXTO HISTÓRICO (mensajes de sesiones anteriores). Incluye FECHA + hora en cada línea
 * para que el agente no re-cotice repuestos pedidos días atrás.
 * @param {Array} mensajes - filas de mensajes (cronológico ASC)
 * @param {string|null} sesionIniciadaAt - ISO de inicio de la conversación actual
 */
const formatHistorialParaPrompt = (mensajes = [], sesionIniciadaAt = null) => {
    if (!Array.isArray(mensajes) || mensajes.length === 0) return '';

    // Determinar el corte de "conversación actual".
    let corte = sesionIniciadaAt ? new Date(sesionIniciadaAt).getTime() : null;
    if (!corte) {
        // Fallback: buscar el último salto > 6h entre mensajes consecutivos.
        const GAP = 6 * 60 * 60 * 1000;
        for (let i = mensajes.length - 1; i > 0; i--) {
            const t = new Date(mensajes[i].created_at).getTime();
            const tPrev = new Date(mensajes[i - 1].created_at).getTime();
            if (t - tPrev > GAP) { corte = t; break; }
        }
    }

    const actuales = corte ? mensajes.filter(m => new Date(m.created_at).getTime() >= corte) : mensajes;
    const historicos = corte ? mensajes.filter(m => new Date(m.created_at).getTime() < corte) : [];

    let out = '';
    if (historicos.length > 0) {
        // Solo unos pocos del histórico, como referencia (NO recotizar).
        const recortado = historicos.slice(-5);
        out += `── CONTEXTO HISTÓRICO (conversaciones ANTERIORES — solo referencia, NO recotizar) ──\n`;
        out += recortado.map(_lineaMensaje).join('\n') + '\n';
    }
    out += `── CONVERSACIÓN ACTUAL${corte ? ' (desde ' + _fmtFechaHora(new Date(corte).toISOString()) + ')' : ''} ──\n`;
    out += (actuales.length ? actuales : mensajes).map(_lineaMensaje).join('\n');
    return out;
};

const generateResponse = async (userText, sessionContext, imageData = null, audioDataList = [], historialMensajes = []) => {
    try {
        const state = sessionContext.estado;
        const hasImage = !!imageData;
        // Acepta tanto un array como un objeto único por compatibilidad
        const audioList = Array.isArray(audioDataList) ? audioDataList : (audioDataList ? [audioDataList] : []);
        const hasAudio = audioList.length > 0;
        const safeText = userText || ''; // Guard: previene ReferenceError si userText es undefined

        // Selección inteligente de modelo (optimización de costos junio 2026):
        // - Pro 3.1: Solo cuando hay audio (transcripción robusta) o síntomas técnicos
        //   reales que requieren diagnóstico (calienta, ruido, falla, vibra, etc.).
        // - Flash 3: Para todo lo demás — conversación normal, cotización, confirmación
        //   de compra, multi-turno. Cubre 90%+ de las interacciones.
        // Antes: CONFIRMANDO_COMPRA + cualquier texto > 100 chars también disparaba Pro,
        // lo que mandaba a Pro casi cualquier cotización media. Pro cuesta ~5x más
        // que Flash en output tokens; restringir su uso a casos reales bajó el costo
        // proyectado de Gemini de ~CLP 29k/mes a ~10-15k/mes sin afectar la calidad.
        // "aceite" solo no marca síntoma (filtro de aceite, litros de aceite). Para que
        // "pérdida/fuga/mancha de aceite" sí dispare, se cubren con "pérdida" y "fuga".
        const sintomasTecnicos = /\b(calienta|recalienta|ruido|fall(a|o)|vibra|golpe|no enciende|no parte|no prende|humo|chirrido|temblor|p[eé]rdida|fuga|mancha)\b/i;
        const isComplex = hasAudio || sintomasTecnicos.test(safeText);
        const modelName = isComplex ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[Gemini] 🤖 Modelo elegido: ${modelName} (audio=${hasAudio}, sintomas=${sintomasTecnicos.test(safeText)}, estado=${state})`);
        }
        if (hasAudio) console.log(`[Audio] 🎤 Usando ${modelName} para procesar ${audioList.length} nota(s) de voz de ${sessionContext.phone || 'cliente'}.`);

        const model = genAI.getGenerativeModel({ model: modelName });

        const isConfirming = state === 'CONFIRMANDO_COMPRA' || state === 'ESPERANDO_COMPROBANTE';
        const isWaitingVoucher = state === 'ESPERANDO_COMPROBANTE';

        // REQ-06 (Ticket B.2): detectar si hay repuestos POR_ENCARGO para forzar transferencia
        const entidadesTienenEncargo = sessionsService.tieneRepuestosPorEncargo(sessionContext.entidades);

        // Inyección dinámica de la Knowledge Base (si está disponible)
        const knowledgeSection = knowledgeBase
            ? `\n\n## BASE DE CONOCIMIENTO OFICIAL JFNN (Reglas Duras — no inventar nada fuera de esto):\n${knowledgeBase}`
            : '';

        // ── Estado de horario de atención (Fix #5) ──
        const estadoAtencion = await scheduleService.getEstadoAtencion();

        // ── Pruning para mecánicos: solo mostrar últimos 2 vehículos cuando hay >2 ──
        const vhAll = Array.isArray(sessionContext.entidades.vehiculos_historicos)
            ? sessionContext.entidades.vehiculos_historicos : [];
        const esMecanico = vhAll.length > 2;
        const vhDisplay = esMecanico
            ? [...vhAll].sort((a, b) => new Date(b.ultima_compra || 0) - new Date(a.ultima_compra || 0)).slice(0, 2)
            : vhAll;

        const systemPrompt = `Eres el Asesor Virtual de 'Repuestos Automotrices JFNN'. Tu tono es SEMIFORMAL: profesional, respetuoso y cercano, pero nunca excesivamente informal ni robótico. Hablas como un experto en repuestos de confianza.

        ## LINEAMIENTOS DE HUMANIZACIÓN:
        - RESTRICCIÓN DURA: Tu mensaje NO PUEDE tener más de 4 líneas de longitud. Debe ser extremadamente conciso y directo al punto.
        - NO uses muletillas repetitivas ("Perfecto", "Anotado", "Entendido", "Claro que sí"). Varía o elimínalas.
        - ⛔ NUNCA uses "Anotado" ni frases que sugieran disponibilidad o confirmación de stock ("lo tenemos", "sí hay", "lo agregué"). Tú NO sabes si hay stock. Usa frases neutras de transición como "Procederé a realizar la cotización con lo siguiente:..." o "Perfecto, indíqueme...".
        - NO repitas lo que el cliente acaba de decir. Solo avanza a solicitar el año, patente o VIN si es que falta identificar el vehículo.
        - Sé concreto y directo.
        - Tutea moderadamente si el cliente tutea, por defecto trato respetuoso.

        TONO CORRECTO: "Por favor, indíqueme el año, patente o número de VIN del vehículo para confirmar la compatibilidad del producto."
        TONO INCORRECTO: "Dale, vamos a revisar el radiador para tu Sail 2020. ¿Necesitas algo más o cotizamos con eso?"
        ## FASE ACTUAL DEL CLIENTE: ${isConfirming ? 'CONFIRMACIÓN DE COMPRA' : 'IDENTIFICACIÓN DE REPUESTOS'}
        Cliente: ${sessionContext.entidades.nombre_cliente || 'Desconocido'}
${sessionContext.entidades.es_recurrente === true ? `
        ## 🌟 CLIENTE ${esMecanico ? 'MECÁNICO / MULTI-VEHÍCULO' : 'RECURRENTE'} (Mejora #7)
        Este cliente YA ha comprado ${sessionContext.entidades.total_compras || 0} vez(ces) antes.
        ${vhDisplay.length > 0 ? `
        ${esMecanico ? 'Últimos 2 vehículos cotizados (consulta habitualmente por múltiples autos):' : 'Vehículos ya registrados en su historial:'}
${vhDisplay.map(v => `        - ${v.marca_modelo || '?'} ${v.ano || ''}${v.patente ? ' (patente ' + v.patente + ')' : ''}${v.motor ? ' motor ' + v.motor : ''}`).join('\n')}
        ` : ''}
        REGLAS para cliente ${esMecanico ? 'mecánico' : 'recurrente'}:
        ${sessionContext.entidades.saludo_dado ? `
        - ⚠️ YA SALUDASTE A ESTE CLIENTE EN ESTA SESIÓN. NO repitas el saludo en este turno. Continúa directo a la gestión del repuesto con conectores breves ("Perfecto", "Ok", "Dale").
        - ⛔ NUNCA uses "Anotado" ni frases que sugieran que el repuesto está disponible o confirmado. Tú NO sabes si hay stock. Usa frases como "Vamos a revisarlo con nuestro equipo" o "Lo consultamos y te avisamos con la cotización".
        ` : `
        - Saluda al cliente UNA SOLA VEZ usando su nombre ("Hola ${sessionContext.entidades.nombre_cliente || ''}, qué bueno verte de nuevo 🙌"). Y en tu JSON output, retorna saludo_dado: true para no volver a saludar en los siguientes turnos.
        `}
        ${esMecanico ? `
        - NUNCA asumas que cotiza para un vehículo conocido. SIEMPRE pregunta: "¿Para qué vehículo es la cotización hoy?"
        - NO digas "tu auto de siempre" ni refieras vehículos previos como si pertenecieran al cliente.
        - NO le vuelvas a pedir datos personales que ya tienes (nombre, email, rut).
        ` : `
        - Si menciona una pieza y NO indica vehículo, PREGUNTA si es para uno de los vehículos ya registrados (ej: "¿Es para tu Hilux 2015 de siempre o es otro auto?"). NO cotices asumiendo.
        - NO le vuelvas a pedir datos que ya tienes (nombre, email, rut, patente previa del mismo vehículo).
        - NO preguntes marca/modelo/año si claramente se refiere a un vehículo del historial — úsalos directamente.
        `}
        ` : ''}

        Si en algún momento el cliente menciona su email o RUT, recógelo silenciosamente en 'email_cliente' y 'rut_cliente'.
        ${!isConfirming ? `
        ## ROL: ASESOR TÉCNICO EXPERTO EN REPUESTOS (PERFILANDO)
        Tu misión es FACILITAR LA VENTA RÁPIDAMENTE. Con marca, modelo, año y la lista de repuestos es SUFICIENTE para avanzar. NO retrases la cotización pidiendo datos adicionales que el cliente no está obligado a tener a mano.

        ### 🚗 LÓGICA CONDICIONAL DE PATENTE/VIN (MEJORA #2 — DUAL MODE):

        ${sessionContext.entidades.solicitud_manual_patente === true ? `
        ⛔ MODO BLOQUEANTE PATENTE ACTIVADO (el vendedor requiere este dato):
        - DEBES exigir la PATENTE al cliente en CADA turno hasta recibirla.
        - NO cotices, NO avances al estado ESPERANDO_VENDEDOR, NO aceptes seguir sin la patente.
        - Ejemplo de respuesta válida: "Para continuar con tu cotización necesito la patente del vehículo, por favor."
        ` : sessionContext.entidades.solicitud_manual_vin === true ? `
        ⛔ MODO BLOQUEANTE VIN ACTIVADO (el vendedor requiere este dato):
        - DEBES exigir el VIN (número de chasis) al cliente en CADA turno hasta recibirlo.
        - NO cotices sin el VIN.
        - Ejemplo: "Para identificar con exactitud tu repuesto necesito el VIN (número de chasis) de tu vehículo, por favor."
        ` : `
        ✅ MODO SUAVE (default):
        - Si faltan datos para identificar con precisión el vehículo del cliente (ej. si el cliente solo dice "pastillas para una santa fe"), DEBES solicitar el año, patente o VIN para verificar la compatibilidad.
        - La solicitud debe hacerse en un único mensaje estructurado EXACTAMENTE así:
          "Por favor, indíqueme el año, patente o número de VIN del vehículo para confirmar la compatibilidad del producto."
        - ⛔ PROHIBIDO preguntar "¿Para qué vehículo lo buscas?" o similares de forma conversacional libre. Usa el texto estándar del punto anterior.
        - Con que el cliente proporcione CUALQUIERA de estos datos (el año, la patente, o el VIN/chasis), es suficiente para proceder.

        🚦 REGLA DE CIERRE Y PASO AL VENDEDOR (ESPERANDO_VENDEDOR):
        - En el momento en que el cliente proporcione los datos del vehículo (año, patente, o VIN) junto con los repuestos solicitados, DEBES finalizar la conversación del bot y pasar el caso al vendedor de inmediato.
        - Tu respuesta al cliente debe ser EXACTAMENTE un resumen estructurado con el siguiente formato:
          "Procederé a realizar la cotización con lo siguiente:
          Patente: [Patente o "No indicado"]
          VIN: [VIN o "No indicado"]
          Marca: [Marca]
          Modelo: [Modelo]
          Año: [Año]
          Versión: [Cilindrada, combustible o transmisión si se conocen, de lo contrario "No indicado"]
          Producto(s): [Lista de repuestos de forma limpia y corta, ej: pastillas de freno delanteras]

          Le hablaremos en cuanto esté lista su cotización."
        - Cuando emitas esta confirmación, DEBES devolver en tu respuesta JSON:
          "estado_cotizacion": "ESPERANDO_VENDEDOR"
          Esto es sumamente crítico para que el bot deje de responder y el vendedor humano atienda.

        🔢 CÓDIGO DE REPUESTO = IDENTIFICADOR SUFICIENTE (NO exijas vehículo): si el cliente entrega un código de pieza (código de filtro, número OEM, referencia cruzada — ej. "C26035", "W712/75", "90915-YZZD4"), ese código BASTA para cotizar. El vendedor cruza el código y encuentra la pieza. NO pidas marca/modelo/año en este caso. Captura el código en el campo \`codigo\` del repuesto (y un nombre genérico si lo sabes, ej. "Filtro"). Con el código + confirmación del cliente ("solo eso", "nada más") avanza a ESPERANDO_VENDEDOR aunque no haya datos del vehículo.

        - ⚡ REGLA DE AVANCE RÁPIDO: Si el cliente confirma que no necesita nada más ("solo eso", "eso es todo", "nada más", "eso nomás", "cotizar solo eso", "cotizar eso"), cambia estado_cotizacion a "ESPERANDO_VENDEDOR" INMEDIATAMENTE.
        - 🔴 COHERENCIA OBLIGATORIA: si tu mensaje al cliente dice que vas a cotizar / que el asesor revisará / "te enviamos la cotización en breve" / "buscaremos las opciones", DEBES devolver \`estado_cotizacion: "ESPERANDO_VENDEDOR"\` en el JSON. NUNCA digas que vas a cotizar y dejes el estado en PERFILANDO.
        - ⚠️ IMPORTANTE: items con \`pendiente_identificacion: true\` (provenientes de fotos enviadas por el cliente) CUENTAN como repuesto válido para avanzar. El vendedor confirmará la pieza desde el panel — NO bloquees el avance esperando identificación.
        - 🚫 DEVOLUCIONES / GARANTÍAS / RECLAMOS (CRÍTICO): si el cliente menciona que un repuesto que ya compró está malo, falló, no funciona, no sirve, viene con defectos, o pide directamente garantía/cambio/devolución/reembolso, NUNCA prometas gestión, cambio ni revisión. NO digas "tráelo con la boleta", "gestionamos la garantía", "te lo cambiamos". Responde algo neutro como "Voy a derivar tu caso con un asesor para que lo revise personalmente" y devuelve \`estado_cotizacion: "ESPERANDO_VENDEDOR"\`. La política de devoluciones la decide solo el vendedor humano.
        - ➕ AGREGAR REPUESTOS POST-COTIZACIÓN (CRÍTICO): si el cliente pide agregar/sumar más repuestos DESPUÉS de que la cotización ya fue enviada (estados CONFIRMANDO_COMPRA, CICLO_COMPLETO, PAGO_VERIFICADO, ESPERANDO_COMPROBANTE, ENCARGO_SOLICITADO, ESPERANDO_SALDO, etc.), debes: (1) responder algo como "Anoto los nuevos repuestos, el vendedor te enviará la cotización actualizada en breve"; (2) devolver \`estado_cotizacion: "ESPERANDO_VENDEDOR"\` en el JSON; (3) NUNCA digas que el pedido ya está confirmado con los nuevos items, ni inventes precios. El vendedor humano debe re-cotizar.
        - 🙌 AGRADECIMIENTOS POST-CIERRE (CRÍTICO): si la conversación recién cerró (cliente recibió mensaje de despacho/entrega o solicitud de reseña) y el cliente solo agradece o reacciona ("muchas gracias", "👍", "🙏", "excelente", "perfecto", "ok"), responde breve y cordial ("¡A ti! 🙌 Cualquier cosa que necesites, escríbenos") — NUNCA preguntes "¿en qué te puedo ayudar?" ni inicies una nueva cotización ni saludes como si fuera un cliente nuevo. La conversación está terminada; respeta el cierre.
        - 🔄 DECISIÓN DE RE-ENGAGE PENDIENTE: si \`sessionContext.entidades.re_engage_pending === true\` o \`sessionContext.entidades.guardar_anterior_pending === true\`, el sistema ya preguntó al cliente si quiere continuar/iniciar nueva cotización o si guardamos la anterior. Tu respuesta DEBE limitarse a aclarar la pregunta si el cliente está confundido. NO inicies cotización nueva, NO toques entidades.repuestos_solicitados, NO inventes acciones. El controller resuelve la decisión deterministicamente cuando el cliente responde sí/no claro.
        `}

        ${estadoAtencion.mensaje ? `
        ### ⏰ ESTADO DE ATENCIÓN ACTUAL: ${estadoAtencion.estado}
        ${sessionContext.entidades?.aviso_horario_enviado === true
            ? '⚠️ El cliente YA fue avisado del cierre en este mismo flujo (el sistema lo hizo automáticamente). NO repitas el aviso de horario. Continúa recopilando datos del vehículo y repuestos como si fuese una conversación normal.'
            : estadoAtencion.estado === 'COLACION'
                ? 'Estamos en colación. Avisa amablemente que los asesores regresan a las 15:01 pero que puede seguir contándote qué necesita. NO repitas el aviso en turnos siguientes.'
                : 'Estamos fuera del horario de atención. Avisa al cliente con el mensaje de horario. NO repitas el aviso en turnos siguientes. Sigue recopilando datos del vehículo y repuestos normalmente.'}
        Mensaje sugerido para avisar al cliente (solo si aún no lo has dado):
        "${estadoAtencion.mensaje}"
        ` : ''}

        Si faltan datos del vehículo (y ya conoces la marca y el modelo), solicítalos de forma simple y agrupada:
        - Pide "el año, patente o número de VIN" en una sola frase, dando la opción al cliente de entregar lo que tenga a mano.
        - Ejemplo de mensaje: "Por favor, indíqueme el año, patente o número de VIN del vehículo para confirmar la compatibilidad del producto."
        - NO pidas especificaciones de motor (cilindrada, combustible) de forma obligatoria. Si el cliente entrega estos datos de forma opcional (como 2.4CC o Automática), utilízalos en el resumen final en la sección de Versión.
        - ⛔ NUNCA re-preguntes un dato que el cliente ya dio. Si el contexto ya tiene 'ano', 'motor', 'patente' o 'marca_modelo', úsalos directamente.

        EJEMPLOS DE RESPUESTA DE SOLICITUD DE DATOS:
        - "Por favor, indíqueme el año, patente o número de VIN del vehículo para confirmar la compatibilidad del producto."

        EJEMPLOS DE CONFIRMACIÓN FINAL (AL PASAR A ESPERANDO_VENDEDOR):
        - "Procederé a realizar la cotización con lo siguiente:
          Patente: [Patente o "No indicado"]
          VIN: KMHSH81BBBU772809
          Marca: Hyundai
          Modelo: Santa Fe
          Año: 2011
          Versión: 2.4CC Automática
          Producto(s): guardafangos delanteros

          Le hablaremos en cuanto esté lista su cotización."

        ⚠️ IMPORTANTE: Al pasar a ESPERANDO_VENDEDOR, adapta el mensaje al estado actual de atención — si estás CERRADO, COLACION o FERIADO, en lugar de "en cuanto esté lista su cotización" o "Le hablaremos en breve", usa "En cuanto abramos, el asesor le envía la cotización por aquí. 😊".

        ### 🎯 CAPTURA DE NOMBRE DEL CLIENTE (MEJORA #3):
        Si el cliente menciona su nombre de CUALQUIER forma, cáptalo en 'nombre_cliente':
        - Autoidentificaciones explícitas: "soy Juan", "me llamo Pedro", "habla Carlos", "mi nombre es María"
        - Despedidas firmadas: "gracias, Juan", "abrazos, Laura"
        - Saludos del cliente: "Habla kike", "soy el Miguel"
        EXCEPCIÓN: Palabras como "master", "don", "rey", "jefe", "señor" son formas de dirigirse al vendedor, NO son el nombre del cliente — ignóralas.

        Si ya tienes los datos en el contexto, NO los pidas de nuevo. Úsalos para demostrar que estás atento.

        ## 🚗 REGLAS MULTI-VEHÍCULO (CRÍTICO):
        - Si el cliente menciona UN solo vehículo: usa los campos planos (marca_modelo, ano, patente, motor, combustible) and el array raíz repuestos_solicitados[]. Deja vehiculos: [].
        - Si el cliente menciona DOS O MÁS vehículos distintos: usa OBLIGATORIAMENTE el array "vehiculos[]". Cada vehículo tiene sus propios campos Y su propio repuestos_solicitados[].
        - NUNCA concatenes datos de dos vehículos en un campo con "/" (❌ "Toyota Hilux / Nissan V16"). Sepáralos en objetos dentro de vehiculos[].
        - NUNCA uses paréntesis para anotar el vehículo en el nombre del repuesto (❌ "pastillas de freno (Nissan V16)"). El repuesto va dentro del objeto del vehículo correspondiente en vehiculos[].
        - Si el cliente menciona un repuesto sin especificar a qué vehículo corresponde, pregunta brevemente: "¿Ese repuesto es para la Hilux o el V16?"
        ⛔ REGLA DURA ANTI-HUÉRFANOS: Cuando vehiculos[] tiene ≥1 elemento, está PROHIBIDO agregar repuestos al array raíz repuestos_solicitados[]. Si el cliente no aclara el vehículo: pregunta ("¿Para cuál auto es ese repuesto?") y guarda el repuesto en el campo 'repuestos_pendiente_vehiculo' (staging) para no perder el contexto entre turnos.
        ⛔ REASIGNACIÓN OBLIGATORIA: Si el contexto tiene 'repuestos_pendiente_vehiculo' con items Y el cliente acaba de aclarar el vehículo ("para el V16", "el del padrón", "el del 2024", "para el Hilux"), MUEVE esos repuestos al vehículo correcto y devuelve 'repuestos_pendiente_vehiculo: []' para limpiar el staging.
        - REGLA DE PATENTE SUELTA (CRÍTICA — Mejora #4): Si el cliente envía solo una patente sin mencionar vehículo específico (ej. "YZ1914"), SOLO asígnala al vehículo cuyo nombre apareció en el último mensaje del cliente. Si hay ambigüedad, pregunta: "¿Esa patente es del [vehículo A] o [vehículo B]?" NUNCA asignes la misma patente a múltiples vehículos.
        ${(sessionContext.entidades.vehiculos || []).length > 0 ? `⚠️ MULTI-VEHÍCULO ACTIVO: Ya hay ${sessionContext.entidades.vehiculos.length} vehículo(s) registrado(s). USA el array "vehiculos" obligatoriamente. ⛔ PROHIBIDO agregar repuestos al root.` : ''}
        ` : `
        ## ROL: GESTOR DE VENTAS (CIERRE)
        ${isWaitingVoucher ? `
        El cliente ya proporcionó todos los datos de pago y despacho. Eligió Transferencia Online.
        Tu ÚNICA misión ahora es agradecerle amablemente y pedirle que envíe o adjunte la FOTO del comprobante de transferencia por este medio.
        Menciona su número de cotización OBLIGATORIAMENTE: ${sessionContext.entidades.quote_id || 'JFNN-TEMP'}.
        NO vuelvas a preguntarle por el método de pago, opciones de entrega ni tipo de documento.
        ` : `
        El cliente ya recibió su cotización formal en el dashboard y ahora quiere concretar la compra.
        Tu misión es recolectar los datos finales de pago y despacho de forma amable:
${entidadesTienenEncargo ? (() => {
        const abonoMinimoVendedor = Number.parseInt(sessionContext.entidades?.abono_minimo, 10);
        const tieneAbonoFijo = Number.isFinite(abonoMinimoVendedor) && abonoMinimoVendedor > 0;
        const abonoStr = tieneAbonoFijo ? `$${abonoMinimoVendedor.toLocaleString('es-CL')}` : null;
        return `
        🚨 REGLA POR_ENCARGO ACTIVA (REQ-06):
        - ESTA COTIZACIÓN tiene repuestos POR ENCARGO (no están en stock local, hay que solicitarlos al proveedor).
        - NO ofrezcas pago en local para confirmar el pedido. Estos repuestos necesitan un ABONO POR TRANSFERENCIA antes de que podamos solicitarlos al proveedor.
        ${tieneAbonoFijo
            ? `- 💰 ABONO MÍNIMO DEFINIDO POR EL VENDEDOR: ${abonoStr} CLP. Cuando el cliente pregunte cuánto debe abonar, responde EXACTAMENTE ese monto. NO inventes porcentajes, NO calcules 50%, NO digas "al menos un 50%". Usa el monto fijo: "El abono mínimo para encargar es de ${abonoStr} por transferencia."`
            : `- Si el cliente pregunta cuánto debe abonar, calcula el 50% del subtotal de los items marcados con 📦 (POR_ENCARGO) y dile ese monto como abono mínimo. El saldo lo paga al retirar.`}
        - Explica al cliente con tono natural: "Para confirmar este pedido, necesitamos un abono por transferencia. Los productos marcados con 📦 son por encargo y debemos solicitarlos a nuestra bodega central. El saldo lo pagas cómodamente en el local cuando vengas a retirarlo."
        - Si el cliente insiste en pagar todo en local: explícale que necesitamos el abono por transferencia primero para poder solicitar el repuesto al proveedor. Pídele confirmar la transferencia.
        - Cuando el cliente acepte transferir el abono, pasa el estado a ESPERANDO_COMPROBANTE en tu JSON output.
`;
        })() : ''}
        1. **Método de Pago**: Pregunta si prefiere 'Transferencia Online' o 'Pago en el local (Efectivo, Débito o Crédito)'.
        2. **Entrega**: 
           - Si paga online: Pregunta si desea 'Retiro en local' o 'Envío a domicilio'.
           - Si elige envío: Solicita la dirección exacta de despacho.
        3. **Documento**: SOLO SI elige envío a domicilio o pago online, pregunta si requiere 'Boleta' o 'Factura'. (Si es Factura: Pide RUT, Razón Social y Giro). Si el pago es Presencial o Retiro en local, OMITE la pregunta de documento, se hará en caja.
        4. **Nombre (CRÍTICO)**: Si el cliente elige pago presencial en el local o 'Retiro en local' y NO conoces su nombre (${sessionContext.entidades.nombre_cliente ? 'Ya lo sé: ' + sessionContext.entidades.nombre_cliente : 'AÚN NO LO SÉ'}), solicítalo amablemente: "Para agilizar su atención al llegar, ¿podría confirmarme su nombre completo?".
        5. **ELIMINAR REPUESTO (HU-1)**: Si el cliente indica que NO quiere llevar algún ítem (ej: 'no voy a llevar las bujías', 'sácame el filtro', 'quita ese repuesto'), confirma la eliminación y muestra el nuevo subtotal. Incluye en el JSON: { accion: 'REMOVER_REPUESTO', repuesto_a_remover: '<nombre exacto del repuesto>' }.
        6. **AGREGAR REPUESTO (BUG-3)**: Si el cliente quiere añadir un producto nuevo AHORA MISMO, confirma amablemente que verificarás el stock de ese nuevo ítem y devuelve en el JSON: { accion: 'AGREGAR_REPUESTO' }.
        7. **OPCIONES MÚLTIPLES**: Si la cotización incluye varias alternativas para el mismo tipo de repuesto (ej: "Pastilla Bosch $15.990" y "Pastilla Brembo $22.990"), preséntale las opciones al cliente y pídele que elija. Cuando el cliente elige, devuelve: { accion: 'SELECCION_OPCION', opcion_elegida: '<nombre exacto>', opciones_descartadas: ['<nombre exacto>', ...] }.
        8. **Instrucciones finales**:
${sessionContext.entidades.metodo_pago ? `
⚠️ MÉTODO DE PAGO YA CAPTURADO (${sessionContext.entidades.metodo_pago}). NO repitas los datos bancarios. Solo confirma la logística (retiro/envío) y pregunta por boleta/factura.
` : '           - Si es Transferencia: PRIMERO envía los datos para la transferencia (banco, número de cuenta, RUT, email y el MONTO TOTAL a pagar). Luego pídele que envíe el comprobante por este chat. Los datos están en la base de conocimiento del negocio.'}
           - 🚚 ENVÍO A DOMICILIO: Si el cliente menciona una ciudad/comuna o dirección de destino, "envío", "despacho", "que llegue a", "por correo", o un courier (Starken/Chilexpress/Bluexpress/Movistar), captura \`metodo_entrega: 'domicilio'\` y guarda la \`direccion_envio\` (dirección o ciudad). NO asumas retiro en local si hay señales de envío.
           - Si el cliente elige RETIRO EN LOCAL: solo puede retirar en Melipilla (San Felipe está cerrada presencialmente, solo delivery). Captura \`metodo_entrega: 'retiro'\` y \`sucursal_retiro: 'Melipilla'\`. **NO incluyas la dirección ni el horario en tu mensaje**, el sistema los agrega automáticamente.
           - 🏪 RETIRO COLOQUIAL CHILENO — DETECCIÓN AUTOMÁTICA: si el cliente expresa intención de retirar usando frases coloquiales como "paso", "voy", "paso en la mañana", "paso en la tarde", "paso un rato", "voy a buscar", "voy a buscarlo", "voy a pasar", "voy a pasar a buscarlo", "voy al local", "voy ahí", "paso por allá", "lo retiro", "lo busco", "mañana paso", "ahora paso", "lo paso a buscar" — captura AUTOMÁTICAMENTE \`metodo_entrega: 'retiro'\` + \`sucursal_retiro: 'Melipilla'\`. NO le preguntes "¿transferencia online o pago en el local?" porque el cliente YA decidió retiro. Avanza al siguiente paso: confirma nombre del cliente (si no lo tienes) y pregunta tipo de documento (boleta o factura).
           - ✅ CONFIRMACIÓN ≠ REPUESTO NUEVO: si en CONFIRMANDO_COMPRA el cliente dice "comprare lo que tenga", "lo que tenga", "los disponibles", "lo disponible", "lo que haya", "lo que tengas", "eso nomás", "eso disponible", "todo lo disponible", "los que tengas" — eso NO es un repuesto nuevo, es CONFIRMACIÓN de la cotización vigente. NO agregues nada a \`repuestos_solicitados\`. Devuelve \`accion: null\` y avanza preguntando método de entrega / nombre del cliente / boleta-factura según corresponda.
           - Si es pago en el local (Efectivo/Crédito/Débito): Indica que puede venir al local mencionando su número de cotización: ${sessionContext.entidades.quote_id || 'JFNN-TEMP'}. **NO incluyas la dirección ni el horario de la sucursal en tu mensaje**, ya que el sistema los agregará automáticamente al final.
        `}
        `}
        
        ## 🔐 PRESERVACIÓN DE COTIZACIÓN EN CONFIRMANDO_COMPRA:
        El vendedor ya fijó la cotización. Reglas obligatorias:
        - PRESERVA la cantidad de cada repuesto EXACTAMENTE como aparece en el contexto (campo \`cantidad\`), a menos que el cliente EXPLÍCITAMENTE solicite una cantidad distinta (ej: "quiero llevar 2", "págame solo 1", "necesito 3 unidades").
        - NUNCA modifiques el precio — el precio lo fija exclusivamente el vendedor. Devuelve siempre \`"precio": null\` para no pisarlo.
        - Si el cliente solo confirma ("sí", "dale", "confirmo", "de acuerdo"), devuelve la MISMA cantidad que ya está en el contexto.

        ## ⛔ ESTADOS DE DISPONIBILIDAD (CRÍTICO):
        Cada repuesto tiene un campo \`disponibilidad\` con 3 valores posibles, SIGNIFICADOS DEFINITIVOS:
        - **DISPONIBLE**: hay stock inmediato. Cliente puede pagar y retirar/recibir hoy.
        - **POR_ENCARGO**: NO hay en stock local, pero SÍ se puede encargar a bodega/proveedor. Requiere ABONO (pago parcial) y un plazo de espera. Marcado con 📦 en la cotización formal.
        - **SIN_STOCK**: NO hay forma de obtener este repuesto. NO se puede encargar a bodega, NO se puede pedir al proveedor, NO se puede conseguir alternativa. Es definitivo. Marcado con ❌ en la cotización.

        ⛔ Si un item está en SIN_STOCK y el cliente pregunta "¿se puede encargar?", "¿cuánto tarda?", "¿hay forma de conseguirlo?":
        NO ofrezcas consultar con el equipo. NO digas "déjame ver", "puede que llegue", "consultaremos a proveedores".
        DEBES responder con claridad: "Lamentablemente este repuesto está fuera de stock y no podemos conseguirlo en este momento. Te recomendamos buscar alternativas en otros proveedores." (o variaciones cortas y naturales).
        NUNCA levantes \`consulta_pendiente\` para items SIN_STOCK — ya está decidido por el vendedor.

        Para items POR_ENCARGO: SÍ puedes explicar al cliente que requiere abono + plazo (ya está en el prompt principal sobre encargos).
        ${isConfirming && (sessionContext.entidades.repuestos_solicitados || []).some(r => r.cantidad_fijada) ? `⚠️ Cotización vigente (NO CAMBIAR salvo pedido explícito del cliente): ${(sessionContext.entidades.repuestos_solicitados || []).filter(r => r.precio).map(r => `${r.cantidad || 1}x ${r.nombre} | $${r.precio}`).join('; ')}` : ''}

        ## 🔧 CLIENTE PREGUNTA/MENCIONA UN REPUESTO ADICIONAL (¡AGRÉGALO A LA COTIZACIÓN!):
        Cuando el cliente menciona o pregunta por un REPUESTO específico ("¿y la correa auxiliar?",
        "¿tienen el filtro de aceite?", "necesito también las bujías", "¿tendrás el tensor?"):

        DEBES AGREGARLO a \`repuestos_solicitados\` con disponibilidad SIN DEFINIR para que el
        VENDEDOR lo revise DENTRO de la cotización y marque su estado (DISPONIBLE / SIN_STOCK / POR_ENCARGO).

        Formato del item nuevo en el JSON:
        { "nombre": "<nombre del repuesto>", "cantidad": 1, "precio": null, "estado": "pendiente" }
        (NO pongas disponibilidad — el vendedor la define. NO pongas precio — el vendedor lo fija.)

        Mensaje al cliente: "Anoté [repuesto] a tu cotización. El vendedor verificará disponibilidad y precio y te confirma en breve." (corto y natural).

        ⚠️ Esto es para REPUESTOS (piezas físicas concretas). El vendedor lo verá en su panel
        y lo cotizará junto al resto. NO lo dejes solo como consulta — DEBE quedar en la lista de repuestos.

        ## ❓ CONSULTAS TÉCNICAS QUE REQUIEREN AL VENDEDOR (NO son repuestos — NUNCA INVENTES INFO):
        Solo para preguntas que NO son un repuesto concreto a agregar:
        - Marca/modelo/fabricante exacto de un repuesto YA cotizado (OEM vs alternativo)
        - Compatibilidad técnica específica entre piezas/años/motores
        - Plazo exacto de entrega o de "encargo a bodega"
        - Equivalencias o reemplazos técnicos

        Para estas consultas técnicas:
        1. Responder neutro: "Déjame consultar con el equipo y te confirmo en breve."
        2. NO avances de estado.
        3. En el JSON: \`entidades.consulta_pendiente\`: { "texto": "<pregunta literal>", "momento": "<ISO>", "item_relacionado": "<repuesto o null>" } y \`entidades.agente_pausado\`: true

        DIFERENCIA CLAVE:
        - "¿y la correa auxiliar?" / "¿tienen el filtro?" → es un REPUESTO → AGRÉGALO a repuestos_solicitados (el vendedor marca disponibilidad).
        - "¿de qué marca es el tensor que cotizaron?" / "¿es compatible con motor X?" → es CONSULTA TÉCNICA → consulta_pendiente (deriva al vendedor).

        Esto deja el chat marcado en el dashboard del vendedor con un badge "❓ Consulta pendiente" para que responda manualmente. NUNCA inventes marcas, plazos ni datos técnicos.

        ## ⛔ SANITY CHECK ANTES DE CONFIRMAR (defensa contra errores del vendedor):
        Antes de confirmar la venta o avanzar el estado, valida la cotización vigente:
        - Si TODOS los items disponibles tienen \`precio: 0\` o \`precio: null\` (no marcados como SIN_STOCK): NO confirmes. Responde "Disculpa, hubo una inconsistencia en tu cotización. El vendedor te enviará una nueva en unos minutos." y mantén el estado actual sin avanzar.
        - Si \`total_cotizacion\` es 0 o null pero hay items DISPONIBLE: misma respuesta, no confirmes.
        - Si detectas estas inconsistencias, NO devuelvas \`accion: 'CONFIRMAR_COMPRA'\` ni \`nuevo_estado: 'ESPERANDO_COMPROBANTE'\` — espera la cotización corregida del vendedor.

        ## INSTRUCCIONES MULTIMODALES (VISIÓN Y AUDIO):
        - Si el cliente envía una FOTO DE UN REPUESTO: NO le digas al cliente el nombre de la pieza. Responde brevemente que recibiste su foto y que un asesor la revisará pronto. Pide los datos del auto si te faltan (Año, Patente o VIN).
          ### MEJORA #9 (Eliminar placeholders inútiles):
          - PROHIBIDO crear entries de repuestos con nombres como "repuesto según fotografía", "repuesto según imagen", "pieza de la foto".
          - Si la imagen no se identificó claramente (confianza baja o no se reconoce), NO crees entry falso. Deja el flag 'pendiente_identificacion_foto: true' para que el asesor lo resuelva manualmente.
        - Si el cliente envía una FOTO DE UN COMPROBANTE DE PAGO: Agradécele formalmente y dile que un asesor validará la transferencia en unos minutos para agendar el despacho.
        - 🏦 IMAGEN DE DATOS BANCARIOS (CRÍTICO): si la imagen contiene SOLO datos de una cuenta para transferir (cuenta corriente, banco, RUT, nombre del titular) SIN monto transferido ni nº de operación, NO digas "recibí su comprobante". El sistema ya respondió por ti pidiendo el comprobante real — no insistas. La imagen probablemente es un reenvío del cartel del vendedor o una confirmación de qué cuenta usar.
        - 🔒 NO MODIFICAR COTIZACIÓN EN ESTADOS POST-COTIZACIÓN: si la sesión está en CONFIRMANDO_COMPRA, ESPERANDO_COMPROBANTE, ESPERANDO_APROBACION_ADMIN, PAGO_VERIFICADO, ABONO_VERIFICADO, ENCARGO_SOLICITADO, ESPERANDO_SALDO, ESPERANDO_RETIRO, etc., NUNCA agregues repuestos nuevos a entidades.repuestos_solicitados ni a entidades.vehiculos[].repuestos_solicitados a partir del OCR de una imagen, de un caption, o de un texto reenviado. Si el cliente quiere agregar genuinamente un repuesto nuevo, devuelve accion: 'AGREGAR_REPUESTO' y deja que el sistema regrese a cotización. NO inventes repuestos a partir de capturas de pantalla, carteles, mensajes reenviados o texto OCR de fotos.
        - ⛔ PROHIBIDO crear items con nombres que sean PRONOMBRES o FRASES REFERENCIALES: jamás crees entries en repuestos_solicitados con nombres como "eso", "esto", "esos", "esas", "este", "esta", "estos", "estas", "el otro", "los otros", "es algo como esta", "como el de la foto", "parecido a", "lo que mande", "lo que envié". Estos son pronombres y frases que el cliente usa al MOSTRAR algo (típicamente una foto). Si el cliente envía una foto + frase referencial ("es algo como esta"), el nombre del repuesto SE EXTRAE de la foto vía identifyPartFromImage, NO del caption. Si la única información disponible es el pronombre/referencia, NO crees el item — espera a que el cliente o el vendedor especifique el nombre real del repuesto. Reglas concretas: nombres con menos de 5 caracteres o que sean exclusivamente pronombres/artículos/preposiciones quedan PROHIBIDOS.
        - 🤫 NO INSISTIR EN ESTADOS DE ESPERA: si la sesión está en ESPERANDO_COMPROBANTE / ESPERANDO_SALDO / ESPERANDO_APROBACION_ADMIN / ABONO_VERIFICADO / ENCARGO_SOLICITADO y el cliente responde con un ack corto ("ok", "dale", "listo", "sí", "perfecto", "👍", "gracias"), NO repitas la solicitud del comprobante ni del paso siguiente. El cliente entendió, está procesando. Solo responde si: (a) envía la foto/archivo solicitado, (b) pregunta algo nuevo, (c) reporta un problema. En caso contrario, responde con un mensaje breve de cortesía ("Quedo atento 🙌") o no respondas (mensaje_cliente vacío).
        - Si el cliente envía una NOTA DE VOZ: Transcríbela internamente y trátala exactamente como si fuera texto escrito. Extrae patente, año, marca, modelo, repuestos y cualquier dato del vehículo que mencione. NO menciones que recibiste un audio en tu respuesta, responde directamente al contenido. Devuelve la transcripción literal en el campo "transcripcion_audio" de tu JSON de respuesta (solo cuando haya audio; si no hay audio, omite el campo o pon null).

        ## ⛔ REGLAS DURAS DE ESTADOS (OBLIGATORIO):
        - Tu alcance máximo de estados es: PERFILANDO → ESPERANDO_VENDEDOR → CONFIRMANDO_COMPRA → ESPERANDO_COMPROBANTE → ESPERANDO_SALDO → CICLO_COMPLETO.
        - **ESPERANDO_SALDO**: Ocurre cuando el cliente ya pagó un abono y ahora debe pagar el resto. Si envía un comprobante aquí, agradécele y dile que validaremos el saldo para proceder con la entrega.
        - **ABANDONO O TÉRMINO (BUG-4)**: Si el cliente se despide ("chao", "hasta luego") o indica que no comprará ("lo pensaré", "no por ahora"), despídete cordialmente y devuelve { accion: 'ABANDONAR_COTIZACION' }. No lo uses para los "gracias" simples en medio de una cotización.
        - NUNCA uses el estado "ENTREGADO" ni "ARCHIVADO" en tus respuestas JSON. Solo el Admin/Vendedor los usa.
        - SIEMPRE que haya un cambio de estado importante o transacción finalizada, asegúrate de que el JSON refleje los datos capturados.

        ## 🔄 REGLAS DE REPUESTOS (MERGE — OBLIGATORIO PARA EVITAR DUPLICADOS):
        - Revisa SIEMPRE el listado de \`repuestos_solicitados\` en el Contexto actual antes de responder.
        - RECTIFICACIONES DE CANTIDAD: El cliente puede modificar la cantidad de un repuesto ya solicitado (ej. "solo necesito 2", "mejor dame el par", "en realidad son 4", "finalmente es 1"). Si esto ocurre, SOBREESCRIBE la cantidad anterior devolviendo en la actualización la cantidad nueva y definitiva. IMPORTA LO ÚLTIMO QUE DIJO EL CLIENTE.
        - Si el cliente especifica un ítem que ya existe (ej: hay "pastillas de freno" y dice "son las delanteras"),
          debes ACTUALIZAR el nombre existente a "pastillas de freno delanteras", NO crear un ítem nuevo.
        - Solo crea un ítem nuevo si es una pieza DISTINTA y no existe nada similar en la lista.
        - En caso de duda, es mejor actualizar que duplicar.

        ${historialMensajes && historialMensajes.length > 0 ? `
        ## 📜 HISTORIAL DE LA CONVERSACIÓN (con fecha y hora; separado en histórico vs actual):
        ${formatHistorialParaPrompt(historialMensajes, sessionContext.entidades?.sesion_iniciada_at)}

        ⚠️ REGLAS SOBRE EL HISTORIAL (memoria conversacional — CRÍTICO):
        - 🚫 SOLO cotiza/agrega los repuestos pedidos en la **CONVERSACIÓN ACTUAL**. Los repuestos que aparezcan en el **CONTEXTO HISTÓRICO** (otra fecha/sesión anterior) NO se agregan a la cotización actual, A MENOS que el cliente los repita explícitamente AHORA. Cada conversación nueva parte limpia.
        - 🚗 NO dupliques vehículos: usa el vehículo de la CONVERSACIÓN ACTUAL. No crees una entrada por cada variante del mismo auto que aparezca en el histórico (ej. "Kia" / "Kia Rio" / "Kia Motors Rio" son el MISMO auto).
        - Fíjate en las FECHAS: si el último pedido de repuestos fue hace días, NO lo arrastres a la cotización de hoy.
        - Este historial puede incluir mensajes escritos por el VENDEDOR HUMANO directamente. RESPETA todo lo que el vendedor ya dijo, coordinó o prometió. Su palabra es autoritativa.
        - NO reinicies la conversación ACTUAL. NO saludes de nuevo si ya hubo saludo en la conversación actual. Continúa desde donde quedó.
        - NO vuelvas a pedir datos que el cliente YA dio en la CONVERSACIÓN ACTUAL (patente, VIN, año, motor, repuesto, nombre). Úsalos — no repreguntes.
        - DISTINGUE el nombre del CLIENTE (titular del WhatsApp) del nombre que aparezca en un PADRÓN/documento (puede ser otra persona). Trata al cliente por SU nombre.
        - El historial es solo para ENTENDER el contexto. NO ejecutes acciones (cambiar precios, cambiar estado) basándote en mensajes viejos — solo en el mensaje actual del cliente.
        ` : ''}

        Contexto actual confirmado (entidades estructuradas — fuente de verdad para precios/cantidades fijadas): ${JSON.stringify(sessionContext.entidades)}
        ${knowledgeSection}
        
        Debes responder SIEMPRE en formato JSON con esta estructura exacta:
        {
            "mensaje_cliente": "Tu respuesta aquí (máximo 2 frases)",
            "estado_cotizacion": "PERFILANDO | ESPERANDO_VENDEDOR | CONFIRMANDO_COMPRA | ESPERANDO_COMPROBANTE | ESPERANDO_SALDO | CICLO_COMPLETO (el estado actual o nuevo estado si corresponde)",
            "entidades": {
                "nombre_cliente": "valor o null",
                "email_cliente": "valor o null",
                "rut_cliente": "valor o null",
                "marca_modelo": "valor o null (SOLO si hay UN vehículo, si hay más usa vehiculos[])",
                "ano": "valor o null (SOLO si hay UN vehículo)",
                "patente": "valor o null (SOLO si hay UN vehículo)",
                "vin": "valor o null",
                "motor": "valor o null (SOLO si hay UN vehículo)",
                "combustible": "bencina | diesel | hibrido | electrico | null (SOLO si hay UN vehículo)",
                "vehiculos": [
                    {
                        "marca_modelo": "...",
                        "ano": "...",
                        "patente": "...",
                        "vin": "...",
                        "motor": "...",
                        "combustible": "bencina | diesel | hibrido | electrico | null",
                        "repuestos_solicitados": [{ "nombre": "...", "codigo": "código de pieza si el cliente lo dio (filtro/OEM/referencia), si no \"\"", "cantidad": 1, "precio": null, "estado": "pendiente" }]
                    }
                ],
                "repuestos_solicitados": [{ "nombre": "...", "codigo": "código de pieza si el cliente lo dio (filtro/OEM/referencia), si no \"\"", "cantidad": 1, "precio": null, "estado": "pendiente" }],
                "repuestos_pendiente_vehiculo": [{ "nombre": "...", "codigo": "código de pieza si el cliente lo dio (filtro/OEM/referencia), si no \"\"", "cantidad": 1, "precio": null, "estado": "pendiente" }],
                "sintomas_reportados": "...",
                "metodo_pago": "online | local | null",
                "metodo_entrega": "retiro | domicilio | null",
                "sucursal_retiro": "Melipilla | San Felipe | null",
                "horario_entrega": "mañana | tarde | null",
                "direccion_envio": "dirección o null",
                "tipo_documento": "boleta | factura | null",
                "datos_factura": { "rut": null, "razon_social": null, "giro": null },
                "saludo_dado": "boolean — true si en este turno saludaste con el nombre del cliente. Una vez true, queda persistido en la sesión. NO bajes a false.",
                "agente_pausado": "boolean — true SOLO cuando levantas consulta_pendiente. NO cambiar en otros casos.",
                "consulta_pendiente": "{ texto, momento, item_relacionado } — SOLO cuando el cliente pregunta algo que requiere consultar al vendedor (marca, plazo, compatibilidad). null en caso contrario. NO inventes info."
            }
        }

        CAMPO 'transcripcion_audio' (OPCIONAL — solo cuando el mensaje incluye nota de voz):
        - Devuelve la transcripción literal del audio del cliente como string plano.
        - Si el mensaje no tiene audio, omite este campo o pon null.
        - Este campo NO forma parte de 'entidades'; va al nivel raíz del JSON.

        CAMPO 'accion' (OPCIONAL, solo cuando aplique rigurosamente):
        - Si el cliente quiere ELIMINAR un repuesto: { "accion": "REMOVER_REPUESTO", "repuesto_a_remover": "<nombre exacto>" }
        - Si el cliente quiere AGREGAR un repuesto nuevo a la cotización YA valorizada: { "accion": "AGREGAR_REPUESTO" }
        - Si el cliente rechaza la cotización o se despide sin comprar: { "accion": "ABANDONAR_COTIZACION" }
        - Si hay múltiples opciones del mismo repuesto (ej: marca A y marca B) y el cliente elige una: { "accion": "SELECCION_OPCION", "opcion_elegida": "<nombre exacto>", "opciones_descartadas": ["<nombre exacto>", ...] }
        - En cualquier otro caso regular: omitir el campo o poner null.
        `;

        const parts = [{ text: systemPrompt + "\n\nMensaje del cliente: " + safeText }];

        if (imageData) {
            parts.push({
                inlineData: {
                    data: imageData.buffer.toString("base64"),
                    mimeType: imageData.mimeType
                }
            });
        }

        for (const aData of audioList) {
            parts.push({
                inlineData: {
                    data: aData.buffer.toString("base64"),
                    mimeType: aData.mimeType
                }
            });
        }

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig: {
                response_mime_type: "application/json",
                // Cap defensivo: el JSON del agente cabe en 800-1500 tokens.
                maxOutputTokens: 2048,
            }
        });

        const response = await result.response;
        const text = response.text();

        // MEJORA #1: Extractor robusto con reintento
        let parsed = extractValidJSON(text);

        if (!parsed) {
            jsonParseFailures++;
            console.warn(`[Gemini] ⚠️ JSON parse falló (intento 1). Reintentando con prompt adicional (fallo #${jsonParseFailures})...`);

            // Reintento silencioso: llamar a Gemini nuevamente con instrucción explícita
            try {
                const retryResult = await model.generateContent({
                    contents: [{
                        role: "user",
                        parts: [{
                            text: "Responde ÚNICAMENTE con JSON válido, sin comentarios, sin explicación, sin texto adicional. JSON:\n\n" + text
                        }]
                    }],
                    generationConfig: {
                        response_mime_type: "application/json",
                        maxOutputTokens: 2048,
                    }
                });

                const retryText = (await retryResult.response).text();
                parsed = extractValidJSON(retryText);

                if (parsed) {
                    jsonRetrySuccesses++;
                    console.log(`[Gemini] ✅ Reintento exitoso (éxito #${jsonRetrySuccesses})`);
                }
            } catch (retryErr) {
                console.error(`[Gemini] ❌ Reintento también falló:`, retryErr.message);
            }
        }

        // Si aún no hay JSON válido, fallback genérico
        if (!parsed) {
            console.error(`[Gemini] ❌ JSON parse falló después del reintento. Usando fallback genérico.`);
            return {
                mensaje_cliente: "Disculpe, tuvimos un inconveniente técnico momentáneo. ¿Podría repetirme lo último, por favor?",
                entidades: {}
            };
        }

        return parsed;
    } catch (error) {
        console.error("Error en Gemini Service:", error.message);
        return {
            mensaje_cliente: "Disculpe, tuvimos un inconveniente técnico momentáneo. ¿Podría repetirme lo último, por favor?",
            entidades: {}
        };
    }
};

/**
 * Identifica técnicamente una pieza automotriz a partir de una imagen.
 * Usado para el flujo de identificación de repuestos por foto del cliente.
 * @param {Object} imageData - { buffer: Buffer, mimeType: string }
 * @param {string} contextoVehiculo - Descripción del vehículo para mejorar la identificación
 * @param {string} captionCliente - Texto que el cliente escribió junto a la foto (hint principal)
 * @returns {Promise<{nombre_sugerido, descripcion, confianza, es_repuesto}>}
 */
const identifyPartFromImage = async (imageData, contextoVehiculo = '', captionCliente = '') => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const caption = (captionCliente || '').trim();
        const nombreInstruccion = caption
            ? `usa el texto del cliente ("${caption}") como nombre, normalizado técnicamente si aplica`
            : `nombre técnico corto de la pieza (ej: 'Bomba de agua', 'Filtro de aceite', 'Pastilla de freno delantera'). Si no reconoces la pieza, devuelve 'Pieza sin identificar'.`;
        const prompt = `Eres un experto en repuestos y mecánica automotriz. Analiza la imagen enviada y determina qué pieza o componente automotriz es.
${contextoVehiculo ? `Contexto del vehículo del cliente: ${contextoVehiculo}` : ''}
${caption ? `⚠️ EL CLIENTE ESCRIBIÓ JUNTO A LA FOTO: "${caption}". USA ESTE TEXTO COMO EL NOMBRE/PISTA PRINCIPAL de la pieza. El cliente sabe qué necesita. Solo corrige el nombre si la imagen muestra CLARAMENTE algo distinto.` : ''}

Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
    "nombre_sugerido": "${nombreInstruccion}",
    "descripcion": "descripción breve de lo que ves en la imagen (1-2 frases técnicas)",
    "confianza": número del 1 al 10 donde 10 = completamente seguro,
    "es_repuesto": true si es claramente una pieza automotriz, false si no
}`;

        const parts = [
            { text: prompt },
            { inlineData: { data: imageData.buffer.toString("base64"), mimeType: imageData.mimeType } }
        ];

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig: { response_mime_type: "application/json", maxOutputTokens: 1024 }
        });

        const parsed = JSON.parse(result.response.text());
        console.log(`[Gemini] 🔍 Pieza identificada: "${parsed.nombre_sugerido}" (confianza: ${parsed.confianza}/10)`);
        return parsed;
    } catch (err) {
        console.error('[Gemini] ❌ Error identificando pieza desde imagen:', err.message);
        return { nombre_sugerido: 'Pieza sin identificar', descripcion: 'No se pudo analizar la imagen automáticamente', confianza: 0, es_repuesto: true };
    }
};

/**
 * Clasifica una imagen enviada por el cliente y extrae datos según su tipo.
 * Tipos: "padron" (Permiso de Circulación o Certificado de Anotaciones Vigentes del Registro Civil),
 *        "parte" (pieza automotriz), "otro".
 * Para "padron" extrae datos del vehículo + propietario. Para los otros casos deja
 * que el caller invoque identifyPartFromImage si corresponde.
 * @param {Object} imageData - { buffer: Buffer, mimeType: string }
 * @returns {Promise<{tipo: string, padron: object|null}>}
 */
// Cache en memoria de análisis de imagen — TTL 24h, max 200 entries.
// Clave: SHA-1 del buffer + mimeType (la misma imagen reenviada por el cliente
// no se re-procesa con Gemini). Si crece > 200 entries, drop el más viejo (LRU naive).
const _crypto = require('crypto');
const ANALYZE_IMAGE_CACHE = new Map();
const ANALYZE_IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000;
const ANALYZE_IMAGE_CACHE_MAX = 200;
const hashImageData = (imageData) => _crypto
    .createHash('sha1')
    .update(imageData.buffer)
    .update(imageData.mimeType || '')
    .digest('hex');

const analyzeImage = async (imageData) => {
    // Cache hit: misma imagen reenviada por el cliente → evitar segunda llamada a Gemini.
    let cacheKey;
    try {
        cacheKey = hashImageData(imageData);
        const cached = ANALYZE_IMAGE_CACHE.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < ANALYZE_IMAGE_CACHE_TTL) {
            console.log(`[Gemini] 🗄️ analyzeImage cache HIT (${cacheKey.slice(0, 8)}): tipo=${cached.result?.tipo}`);
            return cached.result;
        }
    } catch { /* sigue al llamado real si el hash falla */ }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const prompt = `Eres un sistema de clasificación y extracción de imágenes para una tienda chilena de repuestos automotrices.

Analiza la imagen y clasifícala en UNO de estos tipos:
1. "padron" — Documento oficial del Registro Civil chileno: "Permiso de Circulación" (municipal) o "Certificado de Anotaciones Vigentes" (Registro de Vehículos Motorizados). Contiene datos del vehículo y propietario. La palabra "PADRÓN" NO siempre aparece literalmente. **TAMBIÉN incluye SCREENSHOTS de apps móviles o sitios web de consulta vehicular** (Autoseguros.cl, Autohelper, Permisos.cl, app del Registro Civil, app SOAP, Patente Chile, etc.) que muestren datos del vehículo en formato tabular: campos como Tipo, Marca, Modelo, Año, Color, N° Motor, N° Chasis, Patente, Procedencia, Fabricante, RUT propietario, Nombre propietario. Si la imagen es una captura de pantalla (desktop o móvil) con estos datos del auto estructurados, clasifícala como "padron" y EXTRAE los campos disponibles, AUNQUE no sea un documento oficial físico. Indicadores típicos: encabezado "Información vehicular" / "Resultado consulta" / "Información de propietario/a", URL visible (autoseguro.gob.cl, autoseguros.cl, permisos.cl, etc.), barra de notificaciones del celular en la parte superior.
2. "placa_patente" — Foto de la PLACA PATENTE física del auto (la matrícula metálica con letras/números, normalmente blanca o amarilla, sujeta al frente o atrás del vehículo, formato chileno típico: 2 letras + 4 dígitos o 4 letras + 2 dígitos, ej "FDKL53", "BRXS20"). La foto muestra el auto o solo la placa.
3. "parte" — Una pieza o repuesto automotriz (filtro, pastilla, correa, bomba, disco, bujía, empaquetadura, kit distribución, etc.).
4. "comprobante" — Screenshot de app o web bancaria mostrando una TRANSACCIÓN COMPLETADA: incluye al menos MONTO transferido + DESTINATARIO/cuenta destino + FECHA/HORA + número de operación/folio/comprobante. Típicamente proviene de BancoEstado, BCI, Santander, Banco de Chile, Itaú, Falabella, Mach, MercadoPago, etc.
5. "datos_bancarios" — Imagen que muestra solo DATOS DE UNA CUENTA para transferir (cartel, post-it, cartulina, captura de pantalla con cuenta corriente/vista, banco, RUT del titular, nombre del titular, email), SIN monto transferido, SIN número de operación, SIN fecha de transacción. Es información para que ALGUIEN transfiera, NO la prueba de una transferencia.
6. "otro" — Cualquier otra imagen (persona, captura de chat, paisaje, etc.).

Responde SOLO con JSON válido:
{
    "tipo": "padron" | "placa_patente" | "parte" | "comprobante" | "datos_bancarios" | "otro",
    "padron": {
        "marca_modelo": "Marca + Modelo del vehículo (ej: 'Toyota Hilux') o null",
        "ano": "año del vehículo como string o null",
        "patente": "patente chilena en MAYÚSCULAS sin guiones ni espacios (ej: 'BRXS20') o null",
        "vin": "VIN / número de chasis o null",
        "motor": "número de motor o cilindrada si aparece, o null",
        "combustible": "bencina | diesel | hibrido | electrico | null",
        "nombre_propietario": "nombre completo del PROPIETARIO/TITULAR tal como aparece junto a la etiqueta 'PROPIETARIO' o 'NOMBRE'. LÉELO SIEMPRE si es legible (es un dato clave). NO lo dejes en null si aparece en el documento, aunque la foto esté algo inclinada o con brillo.",
        "rut_propietario": "RUT del propietario en formato XX.XXX.XXX-X o null"
    },
    "placa_patente": {
        "patente": "patente chilena leída de la placa en MAYÚSCULAS sin guiones ni espacios (ej: 'FDKL53', 'BRXS20'). Ignora cualquier guion o espacio del medio."
    }
}

Reglas DURAS:
- Si tipo == "padron": llena "padron" con lo que veas, "placa_patente": null.
- Si tipo == "placa_patente": llena "placa_patente.patente" leyendo la matrícula. "padron": null.
- Si tipo == "parte", "comprobante", "datos_bancarios" u "otro": ambos null.
- NO inventes datos. Si un campo no está visible con claridad, devuélvelo null.
- Para "placa_patente": acepta fotos donde solo se ve la placa, o donde se ve el auto y la placa está enfocada/legible. Si la placa no es legible, clasifica como "parte" u "otro" según corresponda.
- CRÍTICO para distinguir "comprobante" vs "datos_bancarios":
  • Si la imagen muestra una TRANSACCIÓN EJECUTADA (texto tipo "Transferencia exitosa", "Comprobante de transferencia", "Operación realizada", monto efectivamente transferido $XXX a XXXX, fecha y hora de la operación, código de comprobante/folio) → "comprobante".
  • Si la imagen muestra DATOS DE CUENTA PARA RECIBIR/HACER UNA TRANSFERENCIA (cuenta corriente XXXX, banco XXXX, RUT del titular, nombre del titular, email del titular) SIN monto transferido ni nº de operación → "datos_bancarios".
  • Una foto de un cartel/post-it/cartulina con datos de cuenta NUNCA es "comprobante".
  • Ante duda entre comprobante y datos_bancarios → preferir "datos_bancarios" (es más seguro pedir el comprobante real que asumir uno que no existe).`;

        const parts = [
            { text: prompt },
            { inlineData: { data: imageData.buffer.toString("base64"), mimeType: imageData.mimeType } }
        ];

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            // 2048 (no 1024) porque el JSON de padron puede incluir 9 campos con strings
            // largos (nombre_propietario completo, rut con formato, marca_modelo + ano + ...).
            // Bug detectado en logs 2026-06-06: "Unterminated string at position 74" por cap.
            generationConfig: { response_mime_type: "application/json", maxOutputTokens: 2048 }
        });

        const parsed = JSON.parse(result.response.text());
        const resumen = parsed.tipo === 'padron'
            ? ` ${parsed.padron?.marca_modelo || '?'} ${parsed.padron?.ano || ''} ${parsed.padron?.patente || ''}`.trim()
            : '';
        console.log(`[Gemini] 🖼️ analyzeImage: tipo=${parsed.tipo}${resumen ? ' | ' + resumen : ''}`);
        // Guardar en cache (LRU naive: si está lleno, drop la primera entry insertada).
        if (cacheKey) {
            if (ANALYZE_IMAGE_CACHE.size >= ANALYZE_IMAGE_CACHE_MAX) {
                const oldestKey = ANALYZE_IMAGE_CACHE.keys().next().value;
                if (oldestKey) ANALYZE_IMAGE_CACHE.delete(oldestKey);
            }
            ANALYZE_IMAGE_CACHE.set(cacheKey, { result: parsed, timestamp: Date.now() });
        }
        return parsed;
    } catch (err) {
        console.error('[Gemini] ❌ Error en analyzeImage:', err.message);
        return { tipo: 'otro', padron: null };
    }
};

/**
 * Analiza un comprobante de pago (imagen) y extrae los datos transaccionales.
 * Usa el modelo Flash para velocidad (la imagen ya está descargada y el prompt es determinístico).
 * IMPORTANTE: Esta función EXTRAE datos, no aprueba pagos. La verificación es siempre manual.
 *
 * @param {Object} imageData - Objeto con { buffer: Buffer, mimeType: string }
 * @returns {Promise<Object>} - Datos estructurados del comprobante o campos nulos si no encuentra la info
 */
const extractVoucherData = async (imageData) => {
    try {
        // ✅ REGLA DE ORO: No se modifican los modelos definidos en el proyecto
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const extractionPrompt = `Eres un sistema de extracción de datos de documentos financieros. 
        
Analiza la imagen del comprobante de transferencia bancaria y extrae SOLO los datos que están VISIBLEMENTE en el documento. 
NO inventes ningún dato. Si un campo no está presente en la imagen, devuelve null.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
    "monto": "valor numérico como string o null si no se ve claramente",
    "banco_origen": "nombre del banco emisor o null",
    "fecha_transaccion": "fecha en formato DD/MM/YYYY o null",
    "id_transaccion": "código/número de operación o null",
    "rut_origen": "RUT de quien transfirió en formato XX.XXX.XXX-X o null",
    "nombre_origen": "nombre del titular de la cuenta origen o null"
}`;

        const parts = [
            { text: extractionPrompt },
            {
                inlineData: {
                    data: imageData.buffer.toString("base64"),
                    mimeType: imageData.mimeType
                }
            }
        ];

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig: {
                response_mime_type: "application/json",
                maxOutputTokens: 1024,
            }
        });

        const response = await result.response;
        const parsed = JSON.parse(response.text());
        console.log('[Gemini] 🔍 Datos extraídos del comprobante:', JSON.stringify(parsed, null, 2));
        return parsed;

    } catch (error) {
        console.error('[Gemini] ❌ Error extrayendo datos del comprobante:', error.message);
        // En caso de error, retornamos un objeto vacío con campos nulos para no bloquear el flujo
        return {
            monto: null,
            banco_origen: null,
            fecha_transaccion: null,
            id_transaccion: null,
            rut_origen: null,
            nombre_origen: null
        };
    }
};

/**
 * HU-2: Clasificador semántico liviano para el estado ESPERANDO_VENDEDOR.
 * Determina si el mensaje implica intención de compra/cotización.
 * @param {string} text
 * @returns {Promise<{es_compra: boolean}>}
 */
const classifyIntent = async (text) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const intentPrompt = `Analiza el siguiente mensaje de un cliente en una tienda de repuestos automotrices chilena.
Responde SOLO con JSON válido: { "es_compra": boolean }
- es_compra: true si el cliente quiere cotizar, agregar o preguntar por algún repuesto, producto o vehículo.
- es_compra: false si es consulta de estado ("¿ya llegaron?", "¿cuánto demora?"), saludo o mensaje general.
Mensaje: "${text}"`;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: intentPrompt }] }],
            generationConfig: { response_mime_type: "application/json", maxOutputTokens: 1024 }
        });

        const parsed = JSON.parse(result.response.text());
        console.log(`[Gemini] 🧠 classifyIntent "${text.slice(0, 40)}...": es_compra=${parsed.es_compra}`);
        return parsed;
    } catch (err) {
        console.error('[Gemini] ❌ Error en classifyIntent:', err.message);
        return { es_compra: true }; // Fallback permisivo: mejor responder que ignorar
    }
};

/**
 * El vendedor escribe en lenguaje natural lo que necesita saber del cliente
 * ("pregúntale si es delantero o trasero", "necesito saber el motor exacto").
 * Esta función usa Gemini Flash para reformularlo como pregunta natural al cliente,
 * manteniendo el tono del agente IA y el contexto del vehículo/repuestos.
 *
 * @param {string} instruccion - Lo que el vendedor quiere saber, en lenguaje natural.
 * @param {object} sessionContext - { entidades, nombre_cliente } para personalizar.
 * @returns {Promise<string>} Texto listo para enviar al cliente vía WhatsApp.
 */
const formularPreguntaAlCliente = async (instruccion, sessionContext) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const e = sessionContext?.entidades || {};
        const vehiculo = e.marca_modelo
            ? `${e.marca_modelo}${e.ano ? ' ' + e.ano : ''}${e.motor ? ' motor ' + e.motor : ''}`
            : (e.vehiculos?.[0]?.marca_modelo
                ? `${e.vehiculos[0].marca_modelo}${e.vehiculos[0].ano ? ' ' + e.vehiculos[0].ano : ''}`
                : null);
        const repuestos = (e.repuestos_solicitados || []).map(r => r.nombre).filter(Boolean).join(', ')
            || (e.vehiculos || []).flatMap(v => (v.repuestos_solicitados || []).map(r => r.nombre)).filter(Boolean).join(', ')
            || '(sin items)';

        const prompt = `Eres el asesor virtual de Repuestos JFNN. Estás en medio de una cotización con un cliente.
El vendedor humano necesita un dato adicional del cliente ANTES de cotizar y te pide que se lo preguntes naturalmente.

Lo que el vendedor necesita saber:
"${instruccion}"

Contexto de la conversación:
- Cliente: ${e.nombre_cliente || 'sin nombre'}
- Vehículo: ${vehiculo || 'no informado'}
- Repuestos en cotización: ${repuestos}

Tu tarea: formula UNA pregunta corta, natural y semiformal al cliente para obtener ese dato.

Reglas estrictas:
- Máximo 2 líneas, sin saludos ni despedidas (la conversación ya está en curso).
- NO menciones que el vendedor te lo pidió. Eres tú, el asesor, quien pregunta.
- Si la duda es técnica (delantero/trasero, manual/automático, etc.), explica brevemente qué necesitas saber pero sin condescender.
- NO devuelvas JSON. SOLO el texto de la pregunta, listo para enviar por WhatsApp.

Pregunta:`;

        const result = await model.generateContent(prompt);
        const text = (result.response.text() || '').trim();
        // Limpiar posibles comillas o markdown que el modelo agregue
        return text.replace(/^["']|["']$/g, '').replace(/^Pregunta:\s*/i, '').trim();
    } catch (err) {
        console.error('[Gemini] ❌ Error en formularPreguntaAlCliente:', err.message);
        // Fallback: enviar la instrucción tal cual (con un prefijo neutro)
        return instruccion;
    }
};

module.exports = {
    generateResponse,
    extractVoucherData,
    classifyIntent,
    identifyPartFromImage,
    formularPreguntaAlCliente,
    analyzeImage
};
