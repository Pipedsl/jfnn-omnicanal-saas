"use client";

import { useState, useEffect } from "react";
import { Send, Hash, DollarSign } from "lucide-react";
import axios from "axios";

interface Item {
    nombre: string;
    precio: number | null;
    codigo: string | null;
    disponibilidad?: "DISPONIBLE" | "SIN_STOCK" | "POR_ENCARGO";
}

interface SellerActionFormProps {
    phone: string;
    items: { nombre: string; precio: null; codigo: null }[];
    onResponded: () => void;
}

export default function SellerActionForm({ phone, items, onResponded }: SellerActionFormProps) {
    const [formItems, setFormItems] = useState<Item[]>([]);
    const [note, setNote] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Inicializar el estado local asegurando que cada item mantenga su identidad
        if (formItems.length === 0 && items.length > 0) {
            setFormItems(items.map(item => ({
                nombre: item.nombre,
                precio: null,
                codigo: "",
                disponibilidad: "DISPONIBLE"
            })));
        }
    }, [items, formItems.length]);

    const handleItemChange = (index: number, field: keyof Item, value: any) => {
        setFormItems(prevItems => {
            const newItems = [...prevItems];
            newItems[index] = { ...newItems[index], [field]: value };

            // Lógica automática: Si marca Sin Stock, limpiamos precio y código
            if (field === "disponibilidad" && value === "SIN_STOCK") {
                newItems[index].precio = null;
                newItems[index].codigo = "";
            }
            return newItems;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await axios.post("http://localhost:4000/api/dashboard/cotizaciones/responder", {
                phone,
                items: formItems,
                note
            });
            onResponded();
        } catch (error) {
            console.error("Error al responder:", error);
            alert("Error al enviar la cotización");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="pt-4 border-t border-white/5 space-y-4">
            <div className="space-y-4">
                {formItems.map((item, idx) => {
                    const disp = item.disponibilidad || "DISPONIBLE";
                    const isSinStock = disp === "SIN_STOCK";

                    return (
                        <div key={idx} className="p-3 bg-neutral-900/50 rounded-xl border border-neutral-800 space-y-3 relative overflow-hidden transition-all duration-300">
                            {isSinStock && (
                                <div className="absolute inset-0 bg-neutral-950/40 backdrop-blur-[1px] z-0 pointer-events-none" />
                            )}

                            <div className="relative z-10 flex justify-between items-center">
                                <p className="text-[10px] font-bold uppercase text-accent tracking-wider">{item.nombre}</p>
                                <select
                                    value={disp}
                                    onChange={(e) => handleItemChange(idx, "disponibilidad", e.target.value as any)}
                                    className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-accent"
                                >
                                    <option value="DISPONIBLE">✅ Disponible</option>
                                    <option value="POR_ENCARGO">📦 Por Encargo (Abono)</option>
                                    <option value="SIN_STOCK">❌ Sin Stock</option>
                                </select>
                            </div>

                            {!isSinStock && (
                                <div className="grid grid-cols-2 gap-2 relative z-10 animate-fade-in">
                                    <div className="relative">
                                        <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                                        <input
                                            type="number"
                                            required={!isSinStock}
                                            placeholder="Precio"
                                            value={item.precio || ""}
                                            onChange={(e) => handleItemChange(idx, "precio", e.target.value ? parseInt(e.target.value) : null)}
                                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:border-accent transition-all"
                                        />
                                    </div>
                                    <div className="relative">
                                        <Hash size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                                        <input
                                            type="text"
                                            required={!isSinStock}
                                            placeholder="Código Layla"
                                            value={item.codigo || ""}
                                            onChange={(e) => handleItemChange(idx, "codigo", e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:border-accent transition-all"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            <textarea
                placeholder="Nota adicional (opcional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs focus:outline-none focus:border-accent h-16 resize-none transition-all"
            />

            <button
                type="submit"
                disabled={loading}
                className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
                {loading ? "Enviando..." : (
                    <>
                        <Send size={16} />
                        Enviar Cotización Formal
                    </>
                )}
            </button>
        </form>
    );
}
