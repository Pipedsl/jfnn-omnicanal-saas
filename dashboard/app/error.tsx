"use client";

import { useEffect } from "react";
import { BACKEND_URL } from "@/lib/api";
import { safeGet } from "@/lib/storage";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reportar el error real al backend para diagnosticarlo (el mensaje en pantalla
    // está minificado en prod). No usamos axios para no depender del interceptor.
    try {
      fetch(`${BACKEND_URL}/api/client-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error?.message || "unknown",
          stack: error?.stack || null,
          digest: error?.digest || null,
          url: typeof window !== "undefined" ? window.location.href : null,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          role: safeGet("jfnn_role"),
          sucursal: safeGet("jfnn_sucursal"),
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // no-op
    }
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 px-6 text-center">
      <div className="max-w-md space-y-5">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-lg font-bold text-neutral-100">Algo falló al cargar el panel</h1>
        <p className="text-sm text-neutral-400">
          Tuvimos un problema mostrando esta sección. Puedes reintentar sin perder tu sesión.
        </p>
        {error?.digest && (
          <p className="text-[11px] text-neutral-600">
            Código de error: <span className="font-mono text-neutral-500">{error.digest}</span>
          </p>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors"
          >
            Reintentar
          </button>
          <button
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-white/5 text-neutral-300 border border-white/10 hover:bg-white/10 transition-colors"
          >
            Recargar página
          </button>
        </div>
      </div>
    </div>
  );
}
