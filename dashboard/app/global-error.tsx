"use client";

import { useEffect } from "react";

// global-error reemplaza el root layout completo cuando el error ocurre en el layout
// mismo. Debe renderizar su propio <html>/<body>. Usamos estilos inline porque la hoja
// de estilos global puede no estar aplicada en este punto.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const backend =
        process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
      fetch(`${backend}/api/client-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error?.message || "unknown",
          stack: error?.stack || null,
          digest: error?.digest || null,
          url: typeof window !== "undefined" ? window.location.href : null,
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : null,
          scope: "global-error",
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // no-op
    }
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#e5e5e5",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>
            Algo falló al cargar el panel
          </h1>
          <p style={{ fontSize: 14, color: "#a3a3a3", margin: "0 0 16px" }}>
            Tuvimos un problema cargando la aplicación. Intenta recargar.
          </p>
          {error?.digest && (
            <p style={{ fontSize: 11, color: "#737373", margin: "0 0 16px" }}>
              Código de error:{" "}
              <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => reset()}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                background: "rgba(59,130,246,0.15)",
                color: "#60a5fa",
                border: "1px solid rgba(59,130,246,0.3)",
                cursor: "pointer",
              }}
            >
              Reintentar
            </button>
            <button
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                background: "rgba(255,255,255,0.05)",
                color: "#d4d4d4",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
              }}
            >
              Recargar página
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
