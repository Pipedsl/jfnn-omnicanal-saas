/**
 * Tests Unitarios: whatsapp.controller.js
 * Verifica el comportamiento del handler POST /webhook ante distintos tipos de payloads.
 */

// --- Mocks de módulos (DEBEN ir antes de cualquier require) ---

// Mock de Supabase para evitar que config/supabase.js lance error por URL vacía
jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }))
}));

jest.mock('../services/gemini.service');
jest.mock('../services/whatsapp.service');
jest.mock('../services/sessions.service');

const geminiService = require('../services/gemini.service');
const whatsappService = require('../services/whatsapp.service');
const sessionsService = require('../services/sessions.service');
const { receiveMessage } = require('../controllers/whatsapp.controller');

// Helper para construir un objeto req de Express falso
const buildReq = (payload) => ({ body: payload });
// Helper para construir un objeto res de Express falso con spies
const buildRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
};

// ─────────────────────────────────────────────
// Suite 1: Payloads sin mensajes (Read Receipts)
// ─────────────────────────────────────────────
describe('receiveMessage — Guard de payloads inválidos', () => {
    beforeEach(() => jest.clearAllMocks());

    test('T01: Payload vacío (sin entry) → responde 200 EVENT_RECEIVED sin procesar', async () => {
        const req = buildReq({});
        const res = buildRes();

        await receiveMessage(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
        // Confirma que NO se llamó a Gemini ni a WhatsApp
        expect(geminiService.generateResponse).not.toHaveBeenCalled();
        expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });

    test('T02: Read Receipt (messages = undefined) → responde 200 sin procesar', async () => {
        const req = buildReq({
            entry: [{
                changes: [{
                    value: {
                        statuses: [{ id: 'abc123', status: 'read' }]
                        // ⚠️ Sin campo "messages"
                    }
                }]
            }]
        });
        const res = buildRes();

        await receiveMessage(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
        expect(geminiService.generateResponse).not.toHaveBeenCalled();
    });

    test('T03: Mensaje de audio (type: audio) → ignorado por el guard', async () => {
        const req = buildReq({
            entry: [{
                changes: [{
                    value: {
                        messages: [{ type: 'audio', from: '56912345678', audio: { id: 'media_123' } }]
                    }
                }]
            }]
        });
        const res = buildRes();

        await receiveMessage(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
        expect(geminiService.generateResponse).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────
// Suite 2: Procesamiento correcto de texto
// ─────────────────────────────────────────────
describe('receiveMessage — Procesamiento de mensajes de texto', () => {
    const MOCK_PHONE = '56912345678';

    beforeEach(() => {
        jest.clearAllMocks();
        // Configurar mocks por defecto para el happy path
        sessionsService.STATES = {
            PERFILANDO: 'PERFILANDO',
            ESPERANDO_VENDEDOR: 'ESPERANDO_VENDEDOR',
            CONFIRMANDO_COMPRA: 'CONFIRMANDO_COMPRA',
            PAGO_VERIFICADO: 'PAGO_VERIFICADO',
            CICLO_COMPLETO: 'CICLO_COMPLETO',
            ENTREGADO: 'ENTREGADO',
            ARCHIVADO: 'ARCHIVADO',
        };
        sessionsService.getSession.mockResolvedValue({
            phone: MOCK_PHONE,
            estado: 'PERFILANDO',
            entidades: {
                repuestos_solicitados: [],
                ano: null,
                patente: null,
                vin: null,
            }
        });
        sessionsService.updateEntidades.mockResolvedValue({
            phone: MOCK_PHONE,
            estado: 'PERFILANDO',
            entidades: { repuestos_solicitados: [], ano: null, patente: null, vin: null }
        });
        geminiService.generateResponse.mockResolvedValue({
            mensaje_cliente: 'Hola, ¿en qué le puedo ayudar?',
            entidades: {}
        });
        whatsappService.sendTextMessage.mockResolvedValue({ success: true });
    });

    test('T04: Mensaje de texto válido → llama a Gemini y envía respuesta por WhatsApp', async () => {
        const req = buildReq({
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            type: 'text',
                            from: MOCK_PHONE,
                            text: { body: 'Necesito pastillas de freno para un Hyundai Accent 2018' }
                        }]
                    }
                }]
            }]
        });
        const res = buildRes();

        await receiveMessage(req, res);

        // Verificar que se procesó correctamente
        expect(sessionsService.getSession).toHaveBeenCalledWith(MOCK_PHONE);
        expect(geminiService.generateResponse).toHaveBeenCalledTimes(1);
        expect(whatsappService.sendTextMessage).toHaveBeenCalledWith(
            MOCK_PHONE,
            'Hola, ¿en qué le puedo ayudar?'
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
    });

    test('T05: Error en Gemini → responde 200 EVENT_RECEIVED_WITH_ERROR sin crashear el servidor', async () => {
        geminiService.generateResponse.mockRejectedValue(new Error('API timeout'));
        const req = buildReq({
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            type: 'text',
                            from: MOCK_PHONE,
                            text: { body: 'Hola' }
                        }]
                    }
                }]
            }]
        });
        const res = buildRes();

        await receiveMessage(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED_WITH_ERROR');
    });
});
