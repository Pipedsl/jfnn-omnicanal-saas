/**
 * Tests para derivarSucursal (T5.2 — Oleada 5)
 * Valida la lógica de derivación de columna sucursal a partir de entidades de sesión.
 */

// Mock db para que el require de sessions.service no abra conexión real
jest.mock('../config/db', () => ({
    query: jest.fn()
}));

const { derivarSucursal } = require('../services/sessions.service');

describe('derivarSucursal', () => {
    test('retiro + sucursal_retiro conocida → devuelve esa sucursal', () => {
        const entidades = { metodo_entrega: 'retiro', sucursal_retiro: 'San Felipe' };
        expect(derivarSucursal(entidades)).toBe('San Felipe');
    });

    test('retiro + sucursal_retiro Melipilla → devuelve Melipilla', () => {
        const entidades = { metodo_entrega: 'retiro', sucursal_retiro: 'Melipilla' };
        expect(derivarSucursal(entidades)).toBe('Melipilla');
    });

    test('domicilio → devuelve Melipilla (regla provisional)', () => {
        const entidades = { metodo_entrega: 'domicilio', sucursal_retiro: null };
        expect(derivarSucursal(entidades)).toBe('Melipilla');
    });

    test('sin metodo_entrega → null (aún no se puede determinar)', () => {
        const entidades = { metodo_entrega: null };
        expect(derivarSucursal(entidades)).toBeNull();
    });

    test('retiro sin sucursal_retiro → null (falta el dato)', () => {
        const entidades = { metodo_entrega: 'retiro', sucursal_retiro: null };
        expect(derivarSucursal(entidades)).toBeNull();
    });

    test('entidades null → null', () => {
        expect(derivarSucursal(null)).toBeNull();
    });

    test('entidades undefined → null', () => {
        expect(derivarSucursal(undefined)).toBeNull();
    });
});
