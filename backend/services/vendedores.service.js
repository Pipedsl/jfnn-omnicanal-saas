/**
 * Servicio de gestión de vendedores por sucursal.
 * Tabla: vendedores (id, nombre, sucursal, activo, created_at)
 */
const db = require('../config/db');

const SUCURSALES_VALIDAS = ['Melipilla', 'San Felipe'];

/**
 * Lista los vendedores activos de una sucursal específica.
 * @param {string} sucursal - 'Melipilla' o 'San Felipe'
 * @returns {Promise<Array>}
 */
async function listarPorSucursal(sucursal) {
    console.log(`[VendedoresService] 🔍 Listando vendedores activos de sucursal: ${sucursal}`);
    const { rows } = await db.query(
        `SELECT id, nombre, sucursal, activo, created_at
         FROM vendedores
         WHERE sucursal = $1 AND activo = true
         ORDER BY nombre ASC`,
        [sucursal]
    );
    console.log(`[VendedoresService] ✅ ${rows.length} vendedor(es) encontrado(s) en ${sucursal}`);
    return rows;
}

/**
 * Lista todos los vendedores (activos e inactivos), ordenados por sucursal y nombre.
 * Para uso exclusivo del admin.
 * @returns {Promise<Array>}
 */
async function listarTodos() {
    console.log('[VendedoresService] 🔍 Listando todos los vendedores (admin)');
    const { rows } = await db.query(
        `SELECT id, nombre, sucursal, activo, created_at
         FROM vendedores
         ORDER BY sucursal ASC, nombre ASC`
    );
    console.log(`[VendedoresService] ✅ ${rows.length} vendedor(es) total en la tabla`);
    return rows;
}

/**
 * Crea un nuevo vendedor.
 * @param {{ nombre: string, sucursal: string }} param0
 * @returns {Promise<Object>} fila completa del vendedor creado
 */
async function crear({ nombre, sucursal }) {
    if (!SUCURSALES_VALIDAS.includes(sucursal)) {
        throw new Error(`Sucursal inválida: "${sucursal}". Debe ser una de: ${SUCURSALES_VALIDAS.join(', ')}`);
    }
    console.log(`[VendedoresService] ➕ Creando vendedor: ${nombre} (${sucursal})`);
    const { rows } = await db.query(
        `INSERT INTO vendedores (nombre, sucursal)
         VALUES ($1, $2)
         RETURNING id, nombre, sucursal, activo, created_at`,
        [nombre.trim(), sucursal]
    );
    console.log(`[VendedoresService] ✅ Vendedor creado — id=${rows[0].id}, nombre="${rows[0].nombre}", sucursal=${rows[0].sucursal}`);
    return rows[0];
}

/**
 * Activa o desactiva un vendedor (soft-delete cuando activo=false).
 * @param {number} id
 * @param {boolean} activo
 * @returns {Promise<Object|null>} fila actualizada o null si no existe
 */
async function actualizarEstado(id, activo) {
    const accion = activo ? 'activando' : 'desactivando';
    console.log(`[VendedoresService] 🔄 ${accion} vendedor id=${id}`);
    const { rows } = await db.query(
        `UPDATE vendedores
         SET activo = $1
         WHERE id = $2
         RETURNING id, nombre, sucursal, activo, created_at`,
        [activo, id]
    );
    if (rows.length === 0) {
        console.log(`[VendedoresService] ⚠️ Vendedor id=${id} no encontrado`);
        return null;
    }
    const emoji = activo ? '✅' : '🚫';
    console.log(`[VendedoresService] ${emoji} Vendedor "${rows[0].nombre}" ahora activo=${rows[0].activo}`);
    return rows[0];
}

/**
 * Obtiene un vendedor por su id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function obtenerPorId(id) {
    const { rows } = await db.query(
        `SELECT id, nombre, sucursal, activo, created_at
         FROM vendedores
         WHERE id = $1`,
        [id]
    );
    return rows.length > 0 ? rows[0] : null;
}

module.exports = {
    listarPorSucursal,
    listarTodos,
    crear,
    actualizarEstado,
    obtenerPorId,
    SUCURSALES_VALIDAS
};
