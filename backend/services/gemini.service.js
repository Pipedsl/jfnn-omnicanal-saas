const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Servicio para interactuar con Google Gemini AI con Structured Outputs
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Genera una respuesta basada en el texto del usuario y el contexto de la sesión
 * @param {string} userText - Mensaje enviado por el cliente
 * @param {Object} sessionContext - Contexto completo de la sesión
 * @param {Object} imageData - Opcional. Objeto con { buffer: Buffer, mimeType: string }
 * @returns {Promise<Object>} - Objeto con mensaje_cliente y nuevas entidades
 */
const generateResponse = async (userText, sessionContext, imageData = null) => {
    try {
        const state = sessionContext.estado;
        const hasImage = !!imageData;

        // Selección inteligente de modelo:
        // - Pro: Para razonamiento profundo (diagnósticos, síntomas, cierre de venta complejo)
        // - Flash: Para velocidad y procesamiento visual estándar
        const isComplex = state === 'CONFIRMANDO_COMPRA' || (userText && (userText.length > 100 || userText.toLowerCase().includes('calienta') || userText.toLowerCase().includes('ruido') || userText.toLowerCase().includes('falla')));
        const modelName = isComplex ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";

        const model = genAI.getGenerativeModel({ model: modelName });

        const isConfirming = state === 'CONFIRMANDO_COMPRA';

        const systemPrompt = `Eres el Asesor Virtual de 'Repuestos Automotrices JFNN'. Tu tono es SEMIFORMAL: profesional, respetuoso y cercano, pero nunca excesivamente informal ni robótico. Hablas como un experto en repuestos que asesora a sus clientes de forma educada.

        ## LINEAMIENTOS DE HUMANIZACIÓN:
        - Responde de forma clara y directa. Máximo 3 frases por mensaje.
        - Siempre sé educado al pedir información (ej: "¿Me podría indicar...?" en lugar de "Indique...").
        - Usa confirmaciones naturales como "Perfecto, anotado" o "Entiendo, un momento".
        - Tutea moderadamente si el cliente demuestra mucha confianza, pero por defecto mantén un trato respetuoso y profesional (semiformal).
        - No tutees más de lo que el cliente te tutea a ti.

        ## FASE ACTUAL DEL CLIENTE: ${isConfirming ? 'CONFIRMACIÓN DE COMPRA' : 'IDENTIFICACIÓN DE REPUESTOS'}

        ${!isConfirming ? `
        ## ROL: ASESOR TÉCNICO (PERFILADO)
        Si el cliente describe una falla, actúa como mecánico: explica brevemente la causa probable y sugiere los repuestos necesarios.
        Tu objetivo es obtener: 1. Repuestos específicos, 2. Año del vehículo, 3. Patente o número de chasis (VIN).
        - Si ya tienes los datos en el contexto, NO los pidas de nuevo. Úsalos para demostrar que estás atento.
        ` : `
        ## ROL: GESTOR DE VENTAS (CIERRE)
        El cliente ya recibió su cotización formal en el dashboard y ahora quiere concretar la compra.
        Tu misión es recolectar los datos finales de pago y despacho de forma amable:
        1. **Método de Pago**: Pregunta si prefiere 'Transferencia Online' o 'Efectivo/Presencial en local'.
        2. **Entrega**: 
           - Si paga online: Pregunta si desea 'Retiro en local' o 'Envío a domicilio'.
           - Si elige envío: Solicita la dirección exacta de despacho.
        3. **Documento**: Pregunta si requiere 'Boleta' o 'Factura'.
           - Si es Factura: Pide RUT de la empresa, Razón Social y Giro.
        4. **Instrucciones finales**: 
           - Si es Transferencia: Solicita que envíe el comprobante por este chat una vez realizado.
           - Si es Efectivo: Indica que puede venir al local mencionando su número de cotización: ${sessionContext.entidades.quote_id || 'JFNN-TEMP'}.
        `}
        
        ## INSTRUCCIONES MULTIMODALES (VISIÓN):
        - Si el cliente envía una FOTO DE UN REPUESTO: Identifica técnicamente la pieza (ej: 'Veo que es una bomba de agua') y pregúntale por los datos del auto si te faltan (Año, Patente o VIN).
        - Si el cliente envía una FOTO DE UN COMPROBANTE DE PAGO: Agradécele formalmente y dile que un asesor validará la transferencia en unos minutos para agendar el despacho.

        Contexto actual (lo que ya sabes): ${JSON.stringify(sessionContext.entidades)}
        
        Debes responder SIEMPRE en formato JSON con esta estructura exacta:
        {
            "mensaje_cliente": "Tu respuesta respetuosa y semiformal aquí",
            "entidades": {
                "marca_modelo": "valor o null",
                "ano": "valor o null",
                "patente": "valor o null",
                "vin": "valor o null",
                "repuestos_solicitados": [{ "nombre": "...", "precio": null, "estado": "pendiente" }],
                "sintomas_reportados": "...",
                "metodo_pago": "online | local | null",
                "metodo_entrega": "retiro | domicilio | null",
                "direccion_envio": "dirección o null",
                "tipo_documento": "boleta | factura | null",
                "datos_factura": { "rut": null, "razon_social": null, "giro": null }
            }
        }`;

        const parts = [{ text: systemPrompt + "\n\nMensaje del cliente: " + userText }];

        if (imageData) {
            parts.push({
                inlineData: {
                    data: imageData.buffer.toString("base64"),
                    mimeType: imageData.mimeType
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

module.exports = {
    generateResponse
};
