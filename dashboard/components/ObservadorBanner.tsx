"use client";

import { useEffect, useState } from "react";
import { isCurrentUserObservador } from "@/lib/observadores";
import { Eye } from "lucide-react";

/**
 * Banner persistente arriba del dashboard cuando el vendedor logueado es
 * observador (entrenamiento). Solo se renderiza en el cliente — depende de
 * localStorage. Si el nombre cambia (logout / cambio de identidad), se
 * recalcula al montar de nuevo en la siguiente navegación.
 */
export default function ObservadorBanner() {
    const [obs, setObs] = useState(false);

    useEffect(() => {
        setObs(isCurrentUserObservador());
        const handler = () => setObs(isCurrentUserObservador());
        window.addEventListener("storage", handler);
        return () => window.removeEventListener("storage", handler);
    }, []);

    if (!obs) return null;

    return (
        <div className="sticky top-0 z-[60] bg-red-600/95 backdrop-blur border-b border-red-500/60 text-white px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-lg">
            <Eye size={14} className="animate-pulse" />
            <span className="uppercase tracking-widest">Modo solo lectura</span>
            <span className="opacity-80 normal-case font-normal">· Vendedor en entrenamiento · No puedes responder ni cotizar</span>
        </div>
    );
}
