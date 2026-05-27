const SUCURSALES = {
    'Melipilla': {
        direccion: 'Serrano 98, 9580000 Melipilla, Región Metropolitana',
        horario: 'Lunes a Viernes: 9:00 a 13:45 y 15:00 a 18:00 hrs (colación 13:45–15:00)',
        abierta: true,
        retiroPresencial: true,
    },
    'San Felipe': {
        direccion: 'Maipú 381, 2171543 San Felipe, Región de Valparaíso',
        horario: 'Solo delivery a ciudades cercanas (San Felipe, Los Andes, zona)',
        abierta: true,
        retiroPresencial: false,
        nota: 'Sucursal cerrada para atención presencial. Solo opera delivery. Contacto: Kano.',
    },
};

/**
 * Retorna el bloque de texto con dirección y horario de la sucursal.
 * Devuelve null si la sucursal no existe en el catálogo.
 */
function getDireccionSucursal(sucursal) {
    const s = SUCURSALES[sucursal];
    if (!s) return null;
    let texto = `📍 Sucursal ${sucursal}: ${s.direccion}\n🕐 Horario: ${s.horario}`;
    if (s.nota) texto += `\n⚠️ ${s.nota}`;
    return texto;
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
