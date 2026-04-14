const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

/**
 * Servicio para interactuar con Google Gemini AI con Structured Outputs
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Carga de Knowledge Base (una sola vez al arrancar el módulo) ---
let knowledgeBase = '';
try {
    const kbPath = path.join(__dirname, '../../knowledge-base.md');
    knowledgeBase = fs.readFileSync(kbPath, 'utf8');
    console.log('[Gemini] ✅ knowledge-base.md cargado correctamente.');
} catch (err) {
    console.warn('[Gemini] ⚠️ knowledge-base.md no encontrado. Usando prompt base sin contexto de negocio.');
}

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

        Si en algún momento el cliente menciona su email o RUT, recógelo silenciosamente en 'email_cliente' y 'rut_cliente'.
        ${!isConfirming ? `
        ## ROL: ASESOR TÉCNICO EXPERTO EN REPUESTOS (PERFILANDO)
        Tu misión es ser extremadamente EFICIENTE y TÉCNICO. Para buscar las piezas exactas y evitar errores de compatibilidad, necesitas consolidar la información en el menor número de mensajes posible.

        OBLIGATORIEDAD DE DATOS (REGLA CRÍTICA):
        - NO puedes avanzar en el flujo si no tienes la PATENTE o el VIN del vehículo. Debes exigirlo antes de finalizar el perfilamiento. Con uno de los dos datos (Patente o VIN) ya es suficiente.

        Si faltan datos, solicítalos de forma agrupada y profesional en tu primera respuesta. Los datos requeridos son:
        1. Marca y Modelo (si no los conoces).
        2. Año exacto del vehículo.
        3. Patente o número de chasis (VIN) — OBLIGATORIO para precisión.
        4. Especificaciones del Motor (cilindrada, ej: 1.6, 2.0) y tipo de Combustible (Bencina o Diesel).
        5. Listado claro de los repuestos que busca.
        
        EJEMPLO DE RESPUESTA EXPERTA: "Para asegurar la compatibilidad exacta, ¿podría indicarme el año, la cilindrada del motor y si es bencinero o diesel? Además, si tiene la patente o el VIN, nos ayudaría a ser 100% precisos con los repuestos que necesita."
        
        Si el cliente describe una falla, actúa como mecánico experto: explica brevemente la causa probable y sugiere la pieza.
        Si el repuesto suele requerir múltiples unidades (ej: bujías, bobinas, litros de aceite), sugiere o pregunta por la cantidad correcta según el motor (ej: "Para un motor de 4 cilindros, ¿le cotizo las 4 bujías orignales?").
        Si el cliente menciona su nombre (ej: "soy Juan", "me llamo Pedro"), cáptalo silenciosamente en 'nombre_cliente'.
        Si ya tienes los datos en el contexto, NO los pidas de nuevo. Úsalos para demostrar que estás atento.

        ## 🚗 REGLAS MULTI-VEHÍCULO (CRÍTICO):
        - Si el cliente menciona UN solo vehículo: usa los campos planos (marca_modelo, ano, patente, motor, combustible) y el array raíz repuestos_solicitados[]. Deja vehiculos: [].
        - Si el cliente menciona DOS O MÁS vehículos distintos: usa OBLIGATORIAMENTE el array "vehiculos[]". Cada vehículo tiene sus propios campos Y su propio repuestos_solicitados[].
        - NUNCA concatenes datos de dos vehículos en un campo con "/" (❌ "Toyota Hilux / Nissan V16"). Sepáralos en objetos dentro de vehiculos[].
        - NUNCA uses paréntesis para anotar el vehículo en el nombre del repuesto (❌ "pastillas de freno (Nissan V16)"). El repuesto va dentro del objeto del vehículo correspondiente en vehiculos[].
        - Si el cliente menciona un repuesto sin especificar a qué vehículo corresponde, pregunta brevemente: "¿Ese repuesto es para la Hilux o el V16?"
        - Si hay repuestos para vehículo desconocido, agrégalos temporalmente en repuestos_solicitados[] raíz.
        ${(sessionContext.entidades.vehiculos || []).length > 0 ? `⚠️ MULTI-VEHÍCULO ACTIVO: Ya hay ${sessionContext.entidades.vehiculos.length} vehículo(s) registrado(s). USA el array "vehiculos" obligatoriamente en tu respuesta.` : ''}
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
        return JSON.parse(text);
    } catch (error) {
        console.error("Error en Gemini Service:", error);
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

module.exports = {
    generateResponse
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
    identifyPartFromImage
};
