/**
 * Tests Unitarios: gemini.service.js
 * Verifica el cargador de knowledge-base y la función generateResponse.
 */

// ─────────────────────────────────────────────
// Configuración de mocks a nivel de módulo
// ─────────────────────────────────────────────

// Mock completo del SDK de Google Gemini para no hacer llamadas reales a la API
jest.mock('@google/generative-ai', () => {
    const mockGenerateContent = jest.fn();
    const mockGetGenerativeModel = jest.fn(() => ({
        generateContent: mockGenerateContent
    }));
    const MockGoogleGenerativeAI = jest.fn(() => ({
        getGenerativeModel: mockGetGenerativeModel
    }));

    return {
        GoogleGenerativeAI: MockGoogleGenerativeAI,
        // Exportar spies para acceder desde los tests
        __mockGenerateContent: mockGenerateContent,
        __mockGetGenerativeModel: mockGetGenerativeModel,
    };
});

// Mock de `fs` para controlar si knowledge-base.md "existe" o no
jest.mock('fs');
const fs = require('fs');

const { __mockGenerateContent } = require('@google/generative-ai');

// ─────────────────────────────────────────────
// Sesión de contexto mínima para las pruebas
// ─────────────────────────────────────────────
const mockSession = {
    estado: 'PERFILANDO',
    entidades: {
        marca_modelo: 'Hyundai Accent',
        ano: '2018',
        patente: 'ABCD12',
        vin: null,
        repuestos_solicitados: [],
        metodo_pago: null,
        metodo_entrega: null,
        tipo_documento: null,
        datos_factura: { rut: null, razon_social: null, giro: null },
        quote_id: null,
    }
};

// ─────────────────────────────────────────────
// Suite 1: Cargador de knowledge-base.md
// ─────────────────────────────────────────────
describe('geminiService — Cargador de knowledge-base.md', () => {

    test('T01: Si el archivo NO existe, el módulo carga sin lanzar excepciones', () => {
        // Simular que readFileSync lanza un error (archivo no encontrado)
        fs.readFileSync.mockImplementation(() => {
            throw new Error('ENOENT: no such file or directory');
        });

        // Re-cargar el módulo para forzar la ejecución del bloque try/catch
        jest.resetModules();
        jest.mock('fs');
        const fsMock = require('fs');
        fsMock.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

        // El require NO debe lanzar excepción
        expect(() => {
            require('../services/gemini.service');
        }).not.toThrow();
    });

    test('T02: Si el archivo existe, el módulo expone la función generateResponse', () => {
        fs.readFileSync.mockReturnValue('# Knowledge Base\n- Horario: 9am-6pm');

        jest.resetModules();
        jest.mock('fs');
        const fsMock = require('fs');
        fsMock.readFileSync.mockReturnValue('# Knowledge Base\n- Horario: 9am-6pm');

        jest.mock('@google/generative-ai', () => ({
            GoogleGenerativeAI: jest.fn(() => ({
                getGenerativeModel: jest.fn(() => ({ generateContent: jest.fn() }))
            }))
        }));

        const service = require('../services/gemini.service');
        expect(service.generateResponse).toBeDefined();
        expect(typeof service.generateResponse).toBe('function');
    });
});

// ─────────────────────────────────────────────
// Suite 2: generateResponse — Comportamiento
// ─────────────────────────────────────────────
describe('geminiService — generateResponse', () => {
    let generateResponse;
    const VALID_RESPONSE = JSON.stringify({
        mensaje_cliente: 'Entendido, voy a verificar la disponibilidad.',
        entidades: { marca_modelo: 'Hyundai Accent' }
    });

    beforeAll(() => {
        // Configurar fs mock para que la carga de knowledge-base sea exitosa
        fs.readFileSync.mockReturnValue('# Base de conocimiento de prueba');
        // Cargar el módulo una sola vez para esta suite
        jest.resetModules();
        jest.mock('fs');
        const fsMock = require('fs');
        fsMock.readFileSync.mockReturnValue('# Base de conocimiento de prueba');

        jest.mock('@google/generative-ai', () => {
            const mockGenContent = jest.fn();
            global.__mockGenContent = mockGenContent; // exponer globalmente para los tests
            return {
                GoogleGenerativeAI: jest.fn(() => ({
                    getGenerativeModel: jest.fn(() => ({ generateContent: mockGenContent }))
                }))
            };
        });

        generateResponse = require('../services/gemini.service').generateResponse;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('T03: Con userText válido, llama a generateContent y retorna mensaje_cliente + entidades', async () => {
        global.__mockGenContent.mockResolvedValue({
            response: { text: () => VALID_RESPONSE }
        });

        const result = await generateResponse('Necesito pastillas de freno', mockSession);

        expect(result).toHaveProperty('mensaje_cliente');
        expect(result).toHaveProperty('entidades');
        expect(result.mensaje_cliente).toBe('Entendido, voy a verificar la disponibilidad.');
    });

    test('T04: Con userText = undefined (edge case), no lanza ReferenceError', async () => {
        global.__mockGenContent.mockResolvedValue({
            response: { text: () => VALID_RESPONSE }
        });

        // No debe lanzar error aunque userText sea undefined
        await expect(generateResponse(undefined, mockSession)).resolves.toHaveProperty('mensaje_cliente');
    });

    test('T05: Si la API de Gemini falla, retorna el mensaje de fallback sin crashear', async () => {
        global.__mockGenContent.mockRejectedValue(new Error('API quota exceeded'));

        const result = await generateResponse('Hola', mockSession);

        // Verifica el mensaje de fallback definido en el catch del servicio
        expect(result.mensaje_cliente).toMatch(/inconveniente técnico/i);
        expect(result.entidades).toEqual({});
    });

    test('T06: Estado CONFIRMANDO_COMPRA → generateContent se invoca (modelo seleccionado correctamente)', async () => {
        global.__mockGenContent.mockResolvedValue({
            response: { text: () => VALID_RESPONSE }
        });

        const confirmingSession = { ...mockSession, estado: 'CONFIRMANDO_COMPRA' };
        const result = await generateResponse('Quiero pagar por transferencia', confirmingSession);

        // generateContent fue invocado indica que el modelo fue resuelto y la API llamada
        expect(global.__mockGenContent).toHaveBeenCalledTimes(1);
        // Y la respuesta llega correctamente
        expect(result).toHaveProperty('mensaje_cliente');
    });
});
