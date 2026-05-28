// Acceso seguro a localStorage. Safari en modo privado (y algunos navegadores con
// almacenamiento deshabilitado) lanzan excepción al leer/escribir localStorage, lo que
// puede tumbar toda la app. Estos helpers degradan a null/no-op en vez de lanzar.

export function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // no-op
  }
}

export function safeRemove(key: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  } catch {
    // no-op
  }
}
