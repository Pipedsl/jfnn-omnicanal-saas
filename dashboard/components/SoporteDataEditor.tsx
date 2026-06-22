"use client";

import { useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { api } from "@/lib/api";
import { BACKEND_URL } from "@/lib/api";

interface Part {
    nombre: string;
    cantidad: number;
}

interface SoporteDataEditorProps {
    phone: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entidades: any;
    onSaved: () => void;
}

export default function SoporteDataEditor({ phone, entidades, onSaved }: SoporteDataEditorProps) {
    const [marcaModelo, setMarcaModelo] = useState<string>(entidades?.marca_modelo || "");
    const [ano, setAno] = useState<string>(entidades?.ano || "");
    const [patente, setPatente] = useState<string>(entidades?.patente || "");
    const [vin, setVin] = useState<string>(entidades?.vin || "");
    const [motor, setMotor] = useState<string>(entidades?.motor || "");

    const initialParts: Part[] = (() => {
        const root: Part[] = (entidades?.repuestos_solicitados || []).map((r: Part) => ({
            nombre: r.nombre || "",
            cantidad: r.cantidad || 1,
        }));
        if (root.length > 0) return root;
        const fromVehiculos: Part[] = (entidades?.vehiculos || []).flatMap(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v: any) => (v.repuestos_solicitados || []).map((r: Part) => ({ nombre: r.nombre || "", cantidad: r.cantidad || 1 }))
        );
        return fromVehiculos.length > 0 ? fromVehiculos : [{ nombre: "", cantidad: 1 }];
    })();

    const [parts, setParts] = useState<Part[]>(initialParts);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const updatePart = (idx: number, field: keyof Part, value: string | number) => {
        setParts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
        setSaved(false);
    };

    const addPart = () => {
        setParts(prev => [...prev, { nombre: "", cantidad: 1 }]);
        setSaved(false);
    };

    const removePart = (idx: number) => {
        setParts(prev => prev.filter((_, i) => i !== idx));
        setSaved(false);
    };

    const handleSave = async () => {
        const cleanParts = parts.filter(p => p.nombre.trim() !== "");
        if (cleanParts.length === 0 && !marcaModelo.trim()) return;

        setSaving(true);
        try {
            const patch: Record<string, unknown> = {};
            if (marcaModelo.trim()) patch.marca_modelo = marcaModelo.trim();
            if (ano.trim()) patch.ano = ano.trim();
            if (patente.trim()) patch.patente = patente.trim().toUpperCase();
            if (vin.trim()) patch.vin = vin.trim().toUpperCase();
            if (motor.trim()) patch.motor = motor.trim();
            if (cleanParts.length > 0) patch.repuestos_solicitados = cleanParts;

            await api.patch(`${BACKEND_URL}/api/dashboard/sessions/${phone}/entidades`, {
                entidades: patch,
            });
            setSaved(true);
            onSaved();
        } catch {
            alert("Error al guardar. Intenta nuevamente.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">
                ✏️ Enriquecer datos para el vendedor
            </p>

            {/* Vehicle fields */}
            <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                    <label className="text-[9px] text-neutral-500 uppercase tracking-wider block mb-0.5">Marca / Modelo</label>
                    <input
                        type="text"
                        placeholder="ej: Toyota Yaris"
                        value={marcaModelo}
                        onChange={e => { setMarcaModelo(e.target.value); setSaved(false); }}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-[9px] text-neutral-500 uppercase tracking-wider block mb-0.5">Año</label>
                    <input
                        type="text"
                        placeholder="ej: 2003"
                        value={ano}
                        onChange={e => { setAno(e.target.value); setSaved(false); }}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-[9px] text-neutral-500 uppercase tracking-wider block mb-0.5">Patente</label>
                    <input
                        type="text"
                        placeholder="ej: AABB12"
                        value={patente}
                        onChange={e => { setPatente(e.target.value); setSaved(false); }}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-[9px] text-neutral-500 uppercase tracking-wider block mb-0.5">Motor / Versión</label>
                    <input
                        type="text"
                        placeholder="ej: 1.3 Gasolina"
                        value={motor}
                        onChange={e => { setMotor(e.target.value); setSaved(false); }}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-[9px] text-neutral-500 uppercase tracking-wider block mb-0.5">VIN / Chasis</label>
                    <input
                        type="text"
                        placeholder="ej: JN1FAAE15U0..."
                        value={vin}
                        onChange={e => { setVin(e.target.value); setSaved(false); }}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                    />
                </div>
            </div>

            {/* Parts list */}
            <div>
                <label className="text-[9px] text-neutral-500 uppercase tracking-wider block mb-1.5">Repuestos solicitados</label>
                <div className="space-y-1.5">
                    {parts.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                            <input
                                type="text"
                                placeholder="Nombre del repuesto"
                                value={p.nombre}
                                onChange={e => updatePart(idx, "nombre", e.target.value)}
                                className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                            />
                            <input
                                type="number"
                                min={1}
                                value={p.cantidad}
                                onChange={e => updatePart(idx, "cantidad", parseInt(e.target.value) || 1)}
                                className="w-12 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-white text-center focus:border-blue-500/50 focus:outline-none"
                                title="Cantidad"
                            />
                            <button
                                type="button"
                                onClick={() => removePart(idx)}
                                disabled={parts.length === 1}
                                className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={addPart}
                    className="mt-1.5 w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-blue-400/70 hover:text-blue-400 border border-dashed border-blue-500/20 hover:border-blue-500/40 rounded-lg transition-colors"
                >
                    <Plus size={11} /> Agregar repuesto
                </button>
            </div>

            <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest transition-all"
            >
                <Save size={12} />
                {saving ? "Guardando..." : saved ? "✓ Guardado" : "Guardar para el vendedor"}
            </button>
        </div>
    );
}
