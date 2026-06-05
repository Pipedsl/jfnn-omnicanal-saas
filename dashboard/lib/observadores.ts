/**
 * Vendedores con permisos de SOLO LECTURA (entrenamiento).
 * Espejo del archivo backend/utils/observadores.js — mantener sincronizado.
 */

const OBSERVADORES = new Set<string>(["Kano"]);

export function isObservador(nombre: string | null | undefined): boolean {
    if (!nombre) return false;
    return OBSERVADORES.has(nombre.trim());
}

/**
 * Lee el vendedor actual del localStorage y devuelve true si es observador.
 * Safe para SSR (devuelve false fuera del navegador).
 */
export function isCurrentUserObservador(): boolean {
    if (typeof window === "undefined") return false;
    try {
        const nombre = localStorage.getItem("jfnn_vendedor_nombre");
        return isObservador(nombre);
    } catch {
        return false;
    }
}
