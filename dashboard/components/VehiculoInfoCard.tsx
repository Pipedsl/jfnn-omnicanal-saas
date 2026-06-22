"use client";

import { useState } from "react";
import { Car, Copy, Check } from "lucide-react";

interface VehiculoInfoCardProps {
    marcaModelo?: string | null;
    ano?: string | null;
    patente?: string | null;
    vin?: string | null;
    motor?: string | null;
    combustible?: string | null;
    label?: string;
}

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };
    return (
        <button
            type="button"
            onClick={handleCopy}
            title="Copiar"
            className="ml-1.5 p-0.5 rounded text-neutral-500 hover:text-neutral-200 active:scale-90 transition-all flex-shrink-0"
        >
            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
        </button>
    );
}

function Row({ label, value, copyable }: { label: string; value: string | null | undefined; copyable?: boolean }) {
    const display = value || "—";
    const isEmpty = !value;
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium flex-shrink-0 mr-2">{label}</span>
            <div className="flex items-center min-w-0">
                <span className={`text-xs font-mono text-right break-all ${isEmpty ? "text-neutral-600 italic" : "text-neutral-200"}`}>
                    {display}
                </span>
                {copyable && !isEmpty && <CopyButton value={value!} />}
            </div>
        </div>
    );
}

export default function VehiculoInfoCard({ marcaModelo, ano, patente, vin, motor, combustible, label }: VehiculoInfoCardProps) {
    const titulo = [marcaModelo, ano].filter(Boolean).join(" ") || "Vehículo sin identificar";

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-0">
            {/* Header */}
            <div className="flex items-start gap-2 pb-2 border-b border-white/5 mb-1">
                <Car size={13} className="text-accent mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                    {label && (
                        <p className="text-[9px] uppercase tracking-widest text-accent/70 font-bold mb-0.5">{label}</p>
                    )}
                    <p className="text-xs font-bold text-neutral-100 break-words leading-snug">{titulo}</p>
                </div>
            </div>

            {/* Filas label/valor */}
            <div className="px-0.5">
                <Row label="Patente" value={patente} copyable />
                <Row label="VIN / Chasis" value={vin} copyable />
                <Row label="Motor" value={motor} />
                <Row label="Combustible" value={combustible} />
            </div>
        </div>
    );
}
