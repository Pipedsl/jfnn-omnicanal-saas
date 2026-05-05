const SUCURSALES = {
    'Melipilla': {
        direccion: 'Serrano 98, 9580000 Melipilla, Región Metropolitana',
        horario: 'Lunes a Viernes 9:00 a 18:00 hrs',
    },
    'San Felipe': {
        direccion: 'Maipú 381, 2171543 San Felipe, Región de Valparaíso',
        horario: 'Lunes a Viernes 9:00 a 18:00 hrs',
    },
};

/**
 * Retorna el bloque de texto con dirección y horario de la sucursal.
 * Devuelve null si la sucursal no existe en el catálogo.
 */
function getDireccionSucursal(sucursal) {
    const s = SUCURSALES[sucursal];
    if (!s) return null;
    return `📍 Sucursal ${sucursal}: ${s.direccion}\n🕐 Horario: ${s.horario}`;
}

/**
 * Determina si el método de pago implica presencia física en el local.
 * Retorna true para efectivo, tarjeta, débito, crédito, local, presencial.
 */
function esPagoPresencial(metodoPago) {
    if (!metodoPago) return false;
    const lower = String(metodoPago).toLowerCase().trim();
    return ['local', 'efectivo', 'debito', 'débito', 'tarjeta', 'credito', 'crédito', 'presencial'].some(k => lower.includes(k));
}

module.exports = { SUCURSALES, getDireccionSucursal, esPagoPresencial };
