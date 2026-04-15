const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

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
const generateResponse = async (userText, sessionContext, imageData = null, audioDataList = []) => {
    try {
        const state = sessionContext.estado;
        const hasImage = !!imageData;
        // Acepta tanto un array como un objeto único por compatibilidad
        const audioList = Array.isArray(audioDataList) ? audioDataList : (audioDataList ? [audioDataList] : []);
        const hasAudio = audioList.length > 0;
        const safeText = userText || ''; // Guard: previene ReferenceError si userText es undefined

        // Selección inteligente de modelo:
        // - Pro: Para razonamiento profundo (diagnósticos, síntomas, cierre de venta complejo, y SIEMPRE con audio)
        // - Flash: Para velocidad y procesamiento visual estándar
        const isComplex = hasAudio || state === 'CONFIRMANDO_COMPRA' || (safeText.length > 100 || safeText.toLowerCase().includes('calienta') || safeText.toLowerCase().includes('ruido') || safeText.toLowerCase().includes('falla'));
        const modelName = isComplex ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
        if (hasAudio) console.log(`[Audio] 🎤 Usando ${modelName} para procesar ${audioList.length} nota(s) de voz de ${sessionContext.phone || 'cliente'}.`);

        const model = genAI.getGenerativeModel({ model: modelName });

        const isConfirming = state === 'CONFIRMANDO_COMPRA' || state === 'ESPERANDO_COMPROBANTE';
        const isWaitingVoucher = state === 'ESPERANDO_COMPROBANTE';

        // Inyección dinámica de la Knowledge Base (si está disponible)
        const knowledgeSection = knowledgeBase
            ? `\n\n## BASE DE CONOCIMIENTO OFICIAL JFNN (Reglas Duras — no inventar nada fuera de esto):\n${knowledgeBase}`
            : '';

        // ── Pruning para mecánicos: solo mostrar últimos 2 vehículos cuando hay >2 ──
        const vhAll = Array.isArray(sessionContext.entidades.vehiculos_historicos)
            ? sessionContext.entidades.vehiculos_historicos : [];
        const esMecanico = vhAll.length > 2;
        const vhDisplay = esMecanico
            ? [...vhAll].sort((a, b) => new Date(b.ultima_compra || 0) - new Date(a.ultima_compra || 0)).slice(0, 2)
            : vhAll;

        const systemPrompt = `Eres el Asesor Virtual de 'Repuestos Automotrices JFNN'. Tu tono es SEMIFORMAL: profesional, respetuoso y cercano, pero nunca excesivamente informal ni robótico. Hablas como un experto en repuestos de confianza.

        ## LINEAMIENTOS DE HUMANIZACIÓN:
        - RESTRICCIÓN DURA: Tu mensaje NO PUEDE tener más de 2 líneas de longitud. Debe ser extremadamente conciso. Si puedes decirlo en 1, mucho mejor.
        - NO uses muletillas repetitivas ("Perfecto", "Anotado", "Entendido", "Claro que sí"). Varía o elimínalas.
        - NO repitas lo que el cliente acaba de decir. Solo avanza al siguiente dato faltante.
        - Sé concreto y directo: "¿De qué año es el V16?" en vez de "¿Me podría confirmar el año del vehículo para asegurar la compatibilidad?".
        - Usa expresiones naturales cuando encajen: "listo", "dale", "ya tengo eso", "perfecto" (solo ocasionalmente).
        - Tutea moderadamente si el cliente tutea, por defecto trato respetuoso.

        TONO CORRECTO: "Listo, tengo la Hilux. ¿De qué año es el V16 y tiene la patente?"
        TONO INCORRECTO: "¡Perfecto! He registrado su Toyota Hilux. Para continuar con la cotización, ¿me podría indicar el año y la patente del segundo vehículo?"
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
        - Saluda usando su nombre SOLO en el PRIMER mensaje de la sesión ("Hola ${sessionContext.entidades.nombre_cliente || ''}, qué bueno verte de nuevo 🙌"). En turnos siguientes, NO repitas el saludo — continúa directamente con la gestión del repuesto.
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
        Tu misión es ser extremadamente EFICIENTE y TÉCNICO. Para buscar las piezas exactas y evitar errores de compatibilidad, necesitas consolidar la información en el menor número de mensajes posible.

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
        - Puedes pedir la patente UNA SOLA VEZ si la pieza parece crítica de compatibilidad (bandejas, soportes, cremalleras, embragues complejos, bombas, distribución, inyectores, alternadores).
        - Si el cliente no da la patente en el siguiente turno, AVANZA NORMALMENTE con los datos que tengas (marca/modelo/año/motor). NO vuelvas a preguntarla.
        - Para piezas no-críticas (filtros, bujías, frenos básicos, aceite, correas accesorios) NI SIQUIERA pidas la patente — avanza directo.
        - NO menciones "VIN" al cliente en modo suave, intimida. Solo "patente" si es estrictamente necesario.
        - Con los datos disponibles, puedes avanzar a ESPERANDO_VENDEDOR aunque NO tengas patente ni VIN.
        `}

        Si faltan datos del vehículo, solicítalos de forma agrupada y profesional:
        1. Marca y Modelo (si no los conoces).
        2. Año exacto del vehículo.
        3. Especificaciones del Motor — SOLO para piezas críticas de compatibilidad. Ver lista abajo.
        4. Listado claro de los repuestos que busca.

        ### PIEZAS NO-CRÍTICAS-MOTOR (Mejora #10):
        Para estas piezas, NO preguntes cilindrada ni combustible (solo marca/modelo/año):
        - Filtros (aire, aceite, combustible, polen)
        - Bujías estándar / Cables de bujía
        - Escobillas / Limpiaparabrisas
        - Aceite de motor (genérico)
        - Bombillas / Ampolletas
        - Pastillas de freno (genéricas) / Discos de freno comunes
        - Correas de accesorios (auxiliares)
        - Pastillas de embrague (básicas)

        Para piezas críticas (bandejas, soportes, cremalleras, embragues complejos, bombas, distribución, inyectores, alternadores), SÍ solicita motor/cilindrada.

        EJEMPLO DE RESPUESTA EXPERTA: "Para asegurar la compatibilidad exacta, ¿podría indicarme el año? Si es repuesto crítico como bandeja o soporte, también necesitaría la cilindrada y si es bencinero o diesel."
        
        Si el cliente describe una falla, actúa como mecánico experto: explica brevemente la causa probable y sugiere la pieza.
        Si el repuesto suele requerir múltiples unidades (ej: bujías, bobinas, litros de aceite), sugiere o pregunta por la cantidad correcta según el motor (ej: "Para un motor de 4 cilindros, ¿le cotizo las 4 bujías orignales?").

        ### 🎯 CAPTURA DE NOMBRE DEL CLIENTE (MEJORA #3):
        Si el cliente menciona su nombre de CUALQUIER forma, cáptalo en 'nombre_cliente':
        - Autoidentificaciones explícitas: "soy Juan", "me llamo Pedro", "habla Carlos", "mi nombre es María"
        - Despedidas firmadas: "gracias, Juan", "abrazos, Laura"
        - Saludos del cliente: "Habla kike", "soy el Miguel"
        EXCEPCIÓN: Palabras como "master", "don", "rey", "jefe", "señor" son formas de dirigirse al vendedor, NO son el nombre del cliente — ignóralas.

        Si ya tienes los datos en el contexto, NO los pidas de nuevo. Úsalos para demostrar que estás atento.

        ## 🚗 REGLAS MULTI-VEHÍCULO (CRÍTICO):
        - Si el cliente menciona UN solo vehículo: usa los campos planos (marca_modelo, ano, patente, motor, combustible) y el array raíz repuestos_solicitados[]. Deja vehiculos: [].
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
           - Si es Transferencia: PRIMERO envía los datos para la transferencia (banco, número de cuenta, RUT, email y el MONTO TOTAL a pagar). Luego pídele que envíe el comprobante por este chat. Los datos están en la base de conocimiento del negocio.
           - Si es pago en el local (Efectivo/Crédito/Débito): Indica que puede venir al local mencionando su número de cotización: ${sessionContext.entidades.quote_id || 'JFNN-TEMP'}.
        `}
        `}
        
        ## 🔐 PRESERVACIÓN DE COTIZACIÓN EN CONFIRMANDO_COMPRA:
        El vendedor ya fijó la cotización. Reglas obligatorias:
        - PRESERVA la cantidad de cada repuesto EXACTAMENTE como aparece en el contexto (campo \`cantidad\`), a menos que el cliente EXPLÍCITAMENTE solicite una cantidad distinta (ej: "quiero llevar 2", "págame solo 1", "necesito 3 unidades").
        - NUNCA modifiques el precio — el precio lo fija exclusivamente el vendedor. Devuelve siempre \`"precio": null\` para no pisarlo.
        - Si el cliente solo confirma ("sí", "dale", "confirmo", "de acuerdo"), devuelve la MISMA cantidad que ya está en el contexto.
        ${isConfirming && (sessionContext.entidades.repuestos_solicitados || []).some(r => r.cantidad_fijada) ? `⚠️ Cotización vigente (NO CAMBIAR salvo pedido explícito del cliente): ${(sessionContext.entidades.repuestos_solicitados || []).filter(r => r.precio).map(r => `${r.cantidad || 1}x ${r.nombre} | $${r.precio}`).join('; ')}` : ''}

        ## INSTRUCCIONES MULTIMODALES (VISIÓN Y AUDIO):
        - Si el cliente envía una FOTO DE UN REPUESTO: NO le digas al cliente el nombre de la pieza. Responde brevemente que recibiste su foto y que un asesor la revisará pronto. Pide los datos del auto si te faltan (Año, Patente o VIN).
          ### MEJORA #9 (Eliminar placeholders inútiles):
          - PROHIBIDO crear entries de repuestos con nombres como "repuesto según fotografía", "repuesto según imagen", "pieza de la foto".
          - Si la imagen no se identificó claramente (confianza baja o no se reconoce), NO crees entry falso. Deja el flag 'pendiente_identificacion_foto: true' para que el asesor lo resuelva manualmente.
        - Si el cliente envía una FOTO DE UN COMPROBANTE DE PAGO: Agradécele formalmente y dile que un asesor validará la transferencia en unos minutos para agendar el despacho.
        - Si el cliente envía una NOTA DE VOZ: Transcríbela internamente y trátala exactamente como si fuera texto escrito. Extrae patente, año, marca, modelo, repuestos y cualquier dato del vehículo que mencione. NO menciones que recibiste un audio en tu respuesta, responde directamente al contenido.

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

        Contexto actual (lo que ya sabes): ${JSON.stringify(sessionContext.entidades)}
        ${knowledgeSection}
        
        Debes responder SIEMPRE en formato JSON con esta estructura exacta:
        {
            "mensaje_cliente": "Tu respuesta aquí (máximo 2 frases)",
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
                        "repuestos_solicitados": [{ "nombre": "...", "cantidad": 1, "precio": null, "estado": "pendiente" }]
                    }
                ],
                "repuestos_solicitados": [{ "nombre": "...", "cantidad": 1, "precio": null, "estado": "pendiente" }],
                "repuestos_pendiente_vehiculo": [{ "nombre": "...", "cantidad": 1, "precio": null, "estado": "pendiente" }],
                "sintomas_reportados": "...",
                "metodo_pago": "online | local | null",
                "metodo_entrega": "retiro | domicilio | null",
                "horario_entrega": "mañana | tarde | null",
                "direccion_envio": "dirección o null",
                "tipo_documento": "boleta | factura | null",
                "datos_factura": { "rut": null, "razon_social": null, "giro": null }
            }
        }

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
 * @returns {Promise<{nombre_sugerido, descripcion, confianza, es_repuesto}>}
 */
const identifyPartFromImage = async (imageData, contextoVehiculo = '') => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const prompt = `Eres un experto en repuestos y mecánica automotriz. Analiza la imagen enviada y determina qué pieza o componente automotriz es.
${contextoVehiculo ? `Contexto del vehículo del cliente: ${contextoVehiculo}` : ''}

Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
    "nombre_sugerido": "nombre técnico corto de la pieza (ej: 'Bomba de agua', 'Filtro de aceite', 'Pastilla de freno delantera', 'Correa de distribución'). Si no reconoces la pieza, devuelve 'Pieza sin identificar'.",
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
            generationConfig: { response_mime_type: "application/json" }
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
const analyzeImage = async (imageData) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const prompt = `Eres un sistema de clasificación y extracción de imágenes para una tienda chilena de repuestos automotrices.

Analiza la imagen y clasifícala en UNO de estos tipos:
1. "padron" — Documento oficial del Registro Civil chileno: "Permiso de Circulación" (municipal) o "Certificado de Anotaciones Vigentes" (Registro de Vehículos Motorizados). Contiene datos del vehículo y propietario. La palabra "PADRÓN" NO siempre aparece literalmente.
2. "parte" — Una pieza o repuesto automotriz (filtro, pastilla, correa, bomba, disco, bujía, etc.).
3. "otro" — Cualquier otra imagen (persona, captura de chat, paisaje, etc.).

Responde SOLO con JSON válido:
{
    "tipo": "padron" | "parte" | "otro",
    "padron": {
        "marca_modelo": "Marca + Modelo del vehículo (ej: 'Toyota Hilux') o null",
        "ano": "año del vehículo como string o null",
        "patente": "patente chilena en MAYÚSCULAS sin guiones ni espacios (ej: 'BRXS20') o null",
        "vin": "VIN / número de chasis o null",
        "motor": "número de motor o cilindrada si aparece, o null",
        "combustible": "bencina | diesel | hibrido | electrico | null",
        "nombre_propietario": "nombre completo del propietario tal como aparece en el documento, o null",
        "rut_propietario": "RUT en formato XX.XXX.XXX-X o null"
    }
}

Reglas DURAS:
- Si tipo != "padron", devuelve "padron": null.
- NO inventes datos. Si un campo no está visible con claridad, devuélvelo null.
- Si solo ves una parte del documento y no distingues patente ni VIN, igual puedes clasificar como "padron" y devolver lo que sí veas.`;

        const parts = [
            { text: prompt },
            { inlineData: { data: imageData.buffer.toString("base64"), mimeType: imageData.mimeType } }
        ];

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig: { response_mime_type: "application/json" }
        });

        const parsed = JSON.parse(result.response.text());
        const resumen = parsed.tipo === 'padron'
            ? ` ${parsed.padron?.marca_modelo || '?'} ${parsed.padron?.ano || ''} ${parsed.padron?.patente || ''}`.trim()
            : '';
        console.log(`[Gemini] 🖼️ analyzeImage: tipo=${parsed.tipo}${resumen ? ' | ' + resumen : ''}`);
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
            generationConfig: { response_mime_type: "application/json" }
        });

        const parsed = JSON.parse(result.response.text());
        console.log(`[Gemini] 🧠 classifyIntent "${text.slice(0, 40)}...": es_compra=${parsed.es_compra}`);
        return parsed;
    } catch (err) {
        console.error('[Gemini] ❌ Error en classifyIntent:', err.message);
        return { es_compra: true }; // Fallback permisivo: mejor responder que ignorar
    }
};

module.exports = {
    generateResponse,
    extractVoucherData,
    classifyIntent,
    identifyPartFromImage,
    analyzeImage
};
