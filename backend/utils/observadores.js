/**
 * observadores.js — Lista de vendedores con permisos de SOLO LECTURA.
 *
 * Diseño minimalista: en lugar de agregar columna a la tabla `vendedores`
 * o emitir un PIN dedicado, simplemente mantenemos una lista de NOMBRES
 * que el sistema trata como observadores. El vendedor aparece normal en
 * el IdentitySelector (agregado por admin desde /settings), pero al
 * seleccionar ese nombre como identidad, el frontend bloquea acciones y
 * el backend rechaza mutations defensivamente.
 *
 * Para agregar/quitar observadores: editar este array y la copia en
 * dashboard/lib/observadores.ts. Cuando el entrenamiento termina, basta
 * con quitar el nombre de aquí (y opcionalmente borrar el vendedor desde
 * /settings).
 */

const OBSERVADORES = new Set(['Kano']);

const isObservador = (nombre) => {
    if (!nombre || typeof nombre !== 'string') return false;
    return OBSERVADORES.has(nombre.trim());
};

module.exports = { isObservador, OBSERVADORES };
