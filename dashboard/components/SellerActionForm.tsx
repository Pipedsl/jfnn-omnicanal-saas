"use client";

import { useState, useEffect } from "react";
import { Send, Hash, DollarSign, Car, Package, Trash2, Plus } from "lucide-react";
import axios from "axios";

interface Item {
    nombre: string;
    precio: number | null;
    codigo: string | null;
    cantidad?: number;
    disponibilidad?: "DISPONIBLE" | "SIN_STOCK" | "POR_ENCARGO";
    _isNew?: boolean; // Prop interna para saber si el item fue agregado manualmente por el vendedor
}

interface Vehiculo {
    marca_modelo: string | null;
    ano: string | null;
    patente: string | null;
    vin: string | null;
    repuestos_solicitados: Item[];
}

interface SellerActionFormProps {
    phone: string;
    items?: Item[];
    vehiculos?: Vehiculo[];
    onResponded: () => void;
}

const RenderItemInput = ({ item, isSinStock, onChange, onRemove }: { item: Item, isSinStock: boolean, onChange: (field: keyof Item, val: string | number | null | boolean) => void, onRemove?: () => void }) => (
    <div className="p-3 bg-neutral-900/50 rounded-xl border border-neutral-800 space-y-3 relative overflow-hidden transition-all duration-300">
        {isSinStock && <div className="absolute inset-0 bg-neutral-950/40 backdrop-blur-[1px] z-0 pointer-events-none" />}
        <div className="relative z-10 flex justify-between items-center">
            <div className="flex items-center gap-2">
                {!item._isNew && item.nombre ? (
                    <p className="text-[10px] font-bold uppercase text-accent tracking-wider">{item.nombre}</p>
                ) : (
                    <input
                        type="text"
                        placeholder="Nombre del repuesto..."
                        className="bg-transparent text-[10px] font-bold uppercase text-accent tracking-wider focus:outline-none border-b border-accent/30 w-40"
                        value={item.nombre}
                        onChange={(e) => onChange("nombre", e.target.value)}
                        required
                    />
                )}
                <div className="flex items-center gap-1 bg-neutral-800 border border-white/10 rounded px-1.5 py-0.5">
                    <Package className="h-3 w-3 text-neutral-500" />
                    <input
                        type="number"
                        min="1"
                        value={item.cantidad || 1}
                        onChange={(e) => onChange("cantidad", Math.max(1, Number(e.target.value)))}
                        className="w-8 bg-transparent text-[10px] text-white text-center font-bold focus:outline-none"
                    />
                    <span className="text-[10px] text-neutral-500">und</span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <select
                    value={item.disponibilidad || "DISPONIBLE"}
                    onChange={(e) => onChange("disponibilidad", e.target.value)}
                    className={`bg-neutral-800 text-[10px] border px-2 py-0.5 rounded font-bold uppercase tracking-wider ${isSinStock ? 'text-red-400 border-red-500/30 ring-1 ring-red-500/20' :
                            item.disponibilidad === "POR_ENCARGO" ? 'text-yellow-400 border-yellow-500/30' :
                                'text-green-400 border-green-500/30'
                        }`}
                >
                    <option value="DISPONIBLE" className="text-green-400 bg-neutral-900">🟢 En Stock</option>
                    <option value="POR_ENCARGO" className="text-yellow-400 bg-neutral-900">🟡 Encargo (+Abono)</option>
                    <option value="SIN_STOCK" className="text-red-400 bg-neutral-900">🔴 Agotado / No disp.</option>
                </select>
                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className="p-1 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-colors"
                        title="Eliminar repuesto"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        </div>
        {!isSinStock && (
            <div className="relative z-10 flex gap-2">
                <div className="relative w-1/3">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <Hash className="h-3 w-3 text-neutral-500" />
                    </div>
                    <input
                        type="text"
                        placeholder="Cód. Sistema"
                        className="bg-neutral-800/80 text-white text-xs border border-white/5 rounded-lg block w-full pl-6 p-2 focus:ring-accent focus:border-accent"
                        value={item.codigo || ""}
                        onChange={(e) => onChange("codigo", e.target.value)}
                    />
                </div>
                <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <DollarSign className="h-3 w-3 text-neutral-500" />
                    </div>
                    <input
                        type="number"
                        placeholder="Precio final c/u"
                        className="bg-neutral-800/80 text-white text-xs border border-white/5 rounded-lg block w-full pl-6 p-2 focus:ring-accent focus:border-accent"
                        value={item.precio ?? ""}
                        onChange={(e) => onChange("precio", Number(e.target.value))}
                    />
                </div>
            </div>
        )}
    </div>
);

export default function SellerActionForm({ phone, items = [], vehiculos = [], onResponded }: SellerActionFormProps) {
    const parseItems = (list: Item[]) => {
        return list.map((item) => {
            let precioLimpio = item.precio;
            if (typeof item.precio === 'string') {
                const soloNumeros = (item.precio as unknown as string).replace(/[^0-9]/g, '');
                const parsed = parseInt(soloNumeros, 10);
                precioLimpio = isNaN(parsed) ? null : parsed;
            }
            if (typeof item.precio === 'number') {
                precioLimpio = item.precio;
            }

            return {
                nombre: item.nombre,
                precio: precioLimpio !== null && precioLimpio !== undefined && precioLimpio !== 0
                    ? precioLimpio
                    : null,
                codigo: item.codigo || "",
                cantidad: item.cantidad || 1,
                disponibilidad: item.disponibilidad || "DISPONIBLE",
                _isNew: item._isNew || false
            };
        });
    };

    const [formItems, setFormItems] = useState<Item[]>(() => parseItems(items));
    const [formVehiculos, setFormVehiculos] = useState<Vehiculo[]>(() =>
        vehiculos.map(v => ({ ...v, repuestos_solicitados: parseItems(v.repuestos_solicitados || []) }))
    );
    const [note, setNote] = useState("");
    const [horarioEntrega, setHorarioEntrega] = useState("");
    const [loading, setLoading] = useState(false);

    // BUG-004: Persistir entidades sin enviar la cotización inmediatamente
    useEffect(() => {
        const timer = setTimeout(() => {
            const cleanItems = (list: Item[]) => list.filter(item => item.nombre.trim() !== "");
            const cleanVehiculos = formVehiculos.map(v => ({
                ...v,
                repuestos_solicitados: cleanItems(v.repuestos_solicitados)
            }));

            axios.patch(`http://localhost:4000/api/dashboard/sessions/${phone}/entidades`, {
                entidades: {
                    repuestos_solicitados: formVehiculos.length === 0 ? cleanItems(formItems) : null,
                    vehiculos: formVehiculos.length > 0 ? cleanVehiculos : null
                }
            }).catch(console.error);
        }, 1500);

        return () => clearTimeout(timer);
    }, [formItems, formVehiculos, phone]);
    const handleFlatItemChange = (index: number, field: keyof Item, value: string | number | null | boolean) => {
        setFormItems(prev => {
            const newItems = [...prev];
            newItems[index] = { ...newItems[index], [field]: value };
            if (field === "disponibilidad" && value === "SIN_STOCK") {
                newItems[index].precio = null;
                newItems[index].codigo = "";
            }
            return newItems;
        });
    };

    const handleVehiculoItemChange = (vIndex: number, rIndex: number, field: keyof Item, value: string | number | null | boolean) => {
        setFormVehiculos(prev => {
            const newVehiculos = [...prev];
            const newItems = [...newVehiculos[vIndex].repuestos_solicitados];
            newItems[rIndex] = { ...newItems[rIndex], [field]: value };
            if (field === "disponibilidad" && value === "SIN_STOCK") {
                newItems[rIndex].precio = null;
                newItems[rIndex].codigo = "";
            }
            newVehiculos[vIndex].repuestos_solicitados = newItems;
            return newVehiculos;
        });
    };

    // BUG-8: Eliminar repuesto del form
    const handleRemoveFlatItem = (index: number) => {
        setFormItems(prev => prev.filter((_, i) => i !== index));
    };

    const handleRemoveVehiculoItem = (vIndex: number, rIndex: number) => {
        setFormVehiculos(prev => {
            const newVehiculos = [...prev];
            newVehiculos[vIndex] = {
                ...newVehiculos[vIndex],
                repuestos_solicitados: newVehiculos[vIndex].repuestos_solicitados.filter((_, i) => i !== rIndex)
            };
            return newVehiculos;
        });
    };

    // BUG-9: Agregar nuevo repuesto
    const newEmptyItem = (): Item => ({
        nombre: "",
        precio: null,
        codigo: "",
        cantidad: 1,
        disponibilidad: "DISPONIBLE",
        _isNew: true
    });

    const handleAddFlatItem = () => {
        setFormItems(prev => [...prev, newEmptyItem()]);
    };

    const handleAddVehiculoItem = (vIndex: number) => {
        setFormVehiculos(prev => {
            const newVehiculos = [...prev];
            newVehiculos[vIndex] = {
                ...newVehiculos[vIndex],
                repuestos_solicitados: [...newVehiculos[vIndex].repuestos_solicitados, newEmptyItem()]
            };
            return newVehiculos;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Filtrar items vacíos (BUG-9: items nuevos sin nombre)
            const cleanItems = (list: Item[]) => list.filter(item => item.nombre.trim() !== "");
            const cleanVehiculos = formVehiculos.map(v => ({
                ...v,
                repuestos_solicitados: cleanItems(v.repuestos_solicitados)
            }));

            await axios.post("http://localhost:4000/api/dashboard/cotizaciones/responder", {
                phone,
                items: formVehiculos.length === 0 ? cleanItems(formItems) : null,
                vehiculos: formVehiculos.length > 0 ? cleanVehiculos : null,
                note,
                horario_entrega: horarioEntrega
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
                {formVehiculos.length > 0 ? (
                    formVehiculos.map((v, vIdx) => (
                        <div key={vIdx} className="space-y-3 bg-neutral-900/30 p-3 rounded-xl border border-white/5">
                            <div className="flex items-center gap-2 mb-2">
                                <Car size={14} className="text-accent" />
                                <span className="text-xs font-bold text-accent tracking-wide uppercase">{v.marca_modelo} {v.ano}</span>
                            </div>
                            {v.repuestos_solicitados.map((item, rIdx) => (
                                <RenderItemInput
                                    key={rIdx}
                                    item={item}
                                    isSinStock={item.disponibilidad === "SIN_STOCK"}
                                    onChange={(field, val) => handleVehiculoItemChange(vIdx, rIdx, field, val)}
                                    onRemove={() => handleRemoveVehiculoItem(vIdx, rIdx)}
                                />
                            ))}
                            <button
                                type="button"
                                onClick={() => handleAddVehiculoItem(vIdx)}
                                className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-accent/70 hover:text-accent border border-dashed border-accent/20 hover:border-accent/40 rounded-xl transition-colors"
                            >
                                <Plus size={12} /> Agregar repuesto
                            </button>
                        </div>
                    ))
                ) : (
                    <>
                        {formItems.map((item, idx) => (
                            <RenderItemInput
                                key={idx}
                                item={item}
                                isSinStock={item.disponibilidad === "SIN_STOCK"}
                                onChange={(field, val) => handleFlatItemChange(idx, field, val)}
                                onRemove={() => handleRemoveFlatItem(idx)}
                            />
                        ))}
                        <button
                            type="button"
                            onClick={handleAddFlatItem}
                            className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-accent/70 hover:text-accent border border-dashed border-accent/20 hover:border-accent/40 rounded-xl transition-colors"
                        >
                            <Plus size={12} /> Agregar repuesto
                        </button>
                    </>
                )}
            </div>

            <textarea
                placeholder="📝 Nota adicional (Opcional)... Ej: Repuestos alternativos japoneses"
                className="bg-neutral-800 text-white text-xs border border-white/10 rounded-xl block w-full p-3 focus:ring-accent focus:border-accent placeholder-neutral-500"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
            />

            <input
                type="text"
                placeholder="🚚 Logística (Opcional)... Ej: Retiros hoy hasta las 18:00 o Envíos mañana."
                className="bg-neutral-800 text-white text-xs border border-white/10 rounded-xl block w-full p-3 focus:ring-accent focus:border-accent placeholder-neutral-500"
                value={horarioEntrega}
                onChange={(e) => setHorarioEntrega(e.target.value)}
            />

            <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 text-white bg-accent hover:bg-accent/80 focus:ring-4 focus:ring-accent/20 font-bold rounded-xl text-sm px-5 py-3 transition-colors disabled:opacity-50"
            >
                {loading ? 'Enviando...' : 'Enviar Cotización Revisada'}
                <Send className="w-4 h-4" />
            </button>
        </form>
    );
}
