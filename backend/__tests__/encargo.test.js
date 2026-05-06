const { tieneRepuestosPorEncargo } = require('../services/sessions.service');

describe('tieneRepuestosPorEncargo', () => {
  test('null o undefined → false', () => {
    expect(tieneRepuestosPorEncargo(null)).toBe(false);
    expect(tieneRepuestosPorEncargo(undefined)).toBe(false);
    expect(tieneRepuestosPorEncargo({})).toBe(false);
  });

  test('repuestos_solicitados sin POR_ENCARGO → false', () => {
    const entidades = { repuestos_solicitados: [{ disponibilidad: 'DISPONIBLE' }, { disponibilidad: 'SIN_STOCK' }] };
    expect(tieneRepuestosPorEncargo(entidades)).toBe(false);
  });

  test('repuestos_solicitados con POR_ENCARGO → true', () => {
    const entidades = { repuestos_solicitados: [{ disponibilidad: 'DISPONIBLE' }, { disponibilidad: 'POR_ENCARGO' }] };
    expect(tieneRepuestosPorEncargo(entidades)).toBe(true);
  });

  test('vehiculos[].repuestos_solicitados con POR_ENCARGO → true', () => {
    const entidades = {
      repuestos_solicitados: [],
      vehiculos: [
        { repuestos_solicitados: [{ disponibilidad: 'DISPONIBLE' }] },
        { repuestos_solicitados: [{ disponibilidad: 'POR_ENCARGO' }] }
      ]
    };
    expect(tieneRepuestosPorEncargo(entidades)).toBe(true);
  });
});
