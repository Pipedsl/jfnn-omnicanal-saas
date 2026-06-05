import axios from "axios";
import { safeGet } from "@/lib/storage";
import { isObservador } from "@/lib/observadores";

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export const api = axios.create({ baseURL: BACKEND_URL });

api.interceptors.request.use((config) => {
  const token = safeGet("jfnn_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Identidad del vendedor para que el backend pueda chequear si es observador
  // (cinturón de seguridad del bloqueo client-side).
  const vendedorNombre = safeGet("jfnn_vendedor_nombre");
  if (vendedorNombre) {
    config.headers["X-Vendedor-Nombre"] = vendedorNombre;
  }

  // Block early en frontend: si el vendedor logueado es observador, abortar
  // cualquier mutation (POST/PATCH/PUT/DELETE) antes de salir a la red. Si por
  // accidente algún botón quedó habilitado, esto lo neutraliza.
  const method = (config.method || "get").toLowerCase();
  if (["post", "patch", "put", "delete"].includes(method) && isObservador(vendedorNombre)) {
    return Promise.reject({
      response: { status: 403, data: { error: "Modo solo lectura", detalle: "Vendedor en entrenamiento — no puede ejecutar acciones." } },
      message: "Bloqueado por modo observador (cliente)",
      config,
    });
  }

  return config;
});
