"use client";

import { useState, useEffect } from "react";
import { Send, Hash, DollarSign, Car, Package, Trash2, Plus, ChevronRight, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { BACKEND_URL } from "@/lib/api";
import { safeGet } from "@/lib/storage";

interface Item {
    nombre: string;
    precio: number | null;
    codigo: string | null;
    cantidad?: number;
    disponibilidad?: "DISPONIBLE" | "SIN_STOCK" | "POR_ENCARGO";
    _isNew?: boolean; // Prop interna para saber si el item fue agregado manualmente por el vendedor
    pendiente_identificacion?: boolean;
    imagen_url?: string | null;
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
    footerActions?: React.ReactNode;
    estado?: string;
}

const RenderItemInput = ({ item, isSinStock, onChange, onRemove }: { item: Item, isSinStock: boolean, onChange: (field: keyof Item, val: string | number | null | boolean) => void, onRemove?: () => void }) => (
    <div className="p-3 bg-neutral-900/50 rounded-xl border border-neutral-800 flex flex-col md:flex-row md:items-center gap-3 relative overflow-hidden transition-all duration-300">
        {isSinStock && <div className="absolute inset-0 bg-neutral-950/40 backdrop-blur-[1px] z-0 pointer-events-none" />}
        
        {/* PARTE 1: Nombre y Cantidad (Toma el 40% del ancho) */}
        <div className="relative z-10 flex items-center justify-between md:justify-start gap-2 md:w-[40%]">
            <div className="flex items-center gap-2 flex-grow">
                {/* Nombre SIEMPRE editable: el vendedor puede corregir piezas mal nombradas
                    por el agente/cliente (transcripción de audio, código sin nombre, etc.). */}
                <input
                    type="text"
                    placeholder="Nombre del repuesto..."
                    className="bg-transparent text-[10px] font-bold uppercase text-accent tracking-wider focus:outline-none border-b border-accent/30 w-full hover:border-accent/60 focus:border-accent transition-colors"
                    value={item.nombre}
                    onChange={(e) => onChange("nombre", e.target.value)}
                    title="Edita el nombre del repuesto si está mal escrito"
                    required
                />
            </div>
            <div className="flex items-center gap-1 bg-neutral-800 border border-white/10 rounded px-1.5 py-0.5 whitespace-nowrap">
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

        {/* PARTE 2: Cód Sistema y Precio (Visibles solo si hay stock, toman el 40%) */}
        <div className={`relative z-10 flex gap-2 flex-1 md:w-[40%] ${isSinStock ? 'opacity-0 pointer-events-none md:hidden' : ''}`}>
            <div className="relative flex-1 max-w-[120px]">
                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <Hash className="h-3 w-3 text-neutral-500" />
                </div>
                <input
                    type="text"
                    placeholder="Código (ej. K-12345)"
                    className={`bg-neutral-800/80 text-white text-xs rounded-lg block w-full pl-6 p-2 focus:ring-accent focus:border-accent border ${(!item.codigo && !isSinStock && item.precio) ? 'border-orange-500/40 focus:border-orange-400' : 'border-white/5'}`}
                    value={item.codigo || ""}
                    onChange={(e) => onChange("codigo", e.target.value)}
                    title={!item.codigo && !isSinStock && item.precio ? 'Falta el código del producto (recomendado)' : 'Código interno del producto'}
                />
            </div>
            <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <DollarSign className="h-3 w-3 text-neutral-500" />
                </div>
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Precio c/u"
                    title="Precio por unidad (el sistema calcula el total según la cantidad)"
                    className="bg-neutral-800/80 text-white text-xs border border-white/5 rounded-lg block w-full pl-6 p-2 focus:ring-accent focus:border-accent font-bold"
                    value={item.precio != null ? item.precio.toLocaleString('es-CL') : ""}
                    onChange={(e) => {
                        const raw = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                        onChange("precio", raw === '' ? null : parseInt(raw, 10));
                    }}
                />
                {item.precio && item.cantidad && item.cantidad > 1 && (
                    <div className="absolute -bottom-4 left-0 text-[9px] text-green-400 font-bold whitespace-nowrap">
                        Total: ${(item.precio * item.cantidad).toLocaleString('es-CL')}
                    </div>
                )}
            </div>
        </div>

        {/* PARTE 3: Disponibilidad y Basurero (Toman el 20%) */}
        <div className="relative z-10 flex items-center justify-end gap-2 md:w-[20%]">
            <select
                value={item.disponibilidad || "DISPONIBLE"}
                onChange={(e) => onChange("disponibilidad", e.target.value)}
                className={`w-full max-w-[160px] bg-neutral-800 text-[10px] border px-2 py-2 rounded font-bold uppercase tracking-wider ${isSinStock ? 'text-red-400 border-red-500/30 ring-1 ring-red-500/20' :
                        item.disponibilidad === "POR_ENCARGO" ? 'text-yellow-400 border-yellow-500/30' :
                            'text-green-400 border-green-500/30'
                    }`}
            >
                <option value="DISPONIBLE" className="text-green-400 bg-neutral-900">🟢 En Stock</option>
                <option value="POR_ENCARGO" className="text-yellow-400 bg-neutral-900">🟡 Abono</option>
                <option value="SIN_STOCK" className="text-red-400 bg-neutral-900">🔴 Agotado</option>
            </select>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    className="p-1.5 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-colors shrink-0"
                    title="Eliminar repuesto"
                >
                    <Trash2 size={14} />
                </button>
            )}
        </div>
    </div>
);

export default function SellerActionForm({ phone, items = [], vehiculos = [], onResponded, footerActions, estado }: SellerActionFormProps) {
    const esRectificacion = estado === 'CONFIRMANDO_COMPRA'
        || estado === 'ESPERANDO_COMPROBANTE'
        || estado === 'ESPERANDO_APROBACION_ADMIN';
    // Ajuste de venta final: estados posteriores a la confirmación de pago.
    // El vendedor agrega items extras vendidos en el local. NO envía mensaje al cliente.
    const esAjusteVentaFinal = estado === 'PAGO_VERIFICADO'
        || estado === 'ABONO_VERIFICADO'
        || estado === 'ESPERANDO_RETIRO'
        || estado === 'ENTREGADO'
        || estado === 'CICLO_COMPLETO';
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
    const [abonoMinimo, setAbonoMinimo] = useState<string>("");
    const [loading, setLoading] = useState(false);

    // BUG-004: Persistir entidades sin enviar la cotización inmediatamente
    useEffect(() => {
        const timer = setTimeout(() => {
            const cleanItems = (list: Item[]) => list.filter(item => item.nombre.trim() !== "");
            const cleanVehiculos = formVehiculos.map(v => ({
                ...v,
                repuestos_solicitados: cleanItems(v.repuestos_solicitados)
            }));

            api.patch(`${BACKEND_URL}/api/dashboard/sessions/${phone}/entidades`, {
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

    /**
     * Valida la consistencia de items antes de enviar.
     * Bloquea items DISPONIBLE sin precio. Avisa si la nota es negativa pero hay items disponibles.
     * Retorna true si está OK para enviar.
     */
    const validarConsistencia = (todosItems: Item[]): boolean => {
        const itemsValidos = todosItems.filter(i => i.nombre.trim() !== "");
        const disponiblesSinPrecio = itemsValidos.filter(i =>
            (i.disponibilidad || 'DISPONIBLE') === 'DISPONIBLE' &&
            (!i.precio || Number(i.precio) === 0)
        );

        if (disponiblesSinPrecio.length > 0) {
            const nombres = disponiblesSinPrecio.map(i => i.nombre).join(', ');
            alert(
                `⚠️ Hay items marcados como DISPONIBLES pero sin precio:\n\n${nombres}\n\n` +
                `Acciones posibles:\n` +
                `• Si NO hay stock, márcalos como "Sin stock"\n` +
                `• Si SÍ hay stock, agrega el precio\n\n` +
                `No se enviará la cotización hasta corregir esto.`
            );
            return false;
        }

        const notaNegativa = note && /\b(no hay|no disponible|sin stock|agotado|no tenemos)\b/i.test(note);
        const hayDisponibles = itemsValidos.some(i =>
            (i.disponibilidad || 'DISPONIBLE') === 'DISPONIBLE' && i.precio && Number(i.precio) > 0
        );
        if (notaNegativa && hayDisponibles) {
            const ok = confirm(
                `⚠️ Tu nota del asesor sugiere que no hay disponibilidad, pero hay items marcados como DISPONIBLES con precio.\n\n` +
                `¿Estás seguro que quieres enviar la cotización así? Esto puede confundir al cliente.`
            );
            if (!ok) return false;
        }

        // Validación BLANDA del código: items DISPONIBLES con precio pero sin código.
        // Es un recordatorio para entrenamiento del equipo y para que las cotizaciones
        // queden trazables al inventario. No bloquea el envío.
        const sinCodigo = itemsValidos.filter(i =>
            (i.disponibilidad || 'DISPONIBLE') === 'DISPONIBLE' &&
            i.precio && Number(i.precio) > 0 &&
            !(i.codigo || '').trim()
        );
        if (sinCodigo.length > 0) {
            const nombres = sinCodigo.map(i => i.nombre).join(', ');
            const ok = confirm(
                `💡 Hay ${sinCodigo.length} ítem(s) sin código de producto:\n\n${nombres}\n\n` +
                `Los códigos ayudan a:\n` +
                `• Entrenamiento de vendedores nuevos\n` +
                `• Identificar productos en el inventario / catálogo\n` +
                `• Trazabilidad de la venta\n\n` +
                `¿Enviar de todas formas?`
            );
            if (!ok) return false;
        }

        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Filtrar items vacíos (BUG-9: items nuevos sin nombre)
        const cleanItems = (list: Item[]) => list.filter(item => item.nombre.trim() !== "");
        const cleanVehiculos = formVehiculos.map(v => ({
            ...v,
            repuestos_solicitados: cleanItems(v.repuestos_solicitados)
        }));

        // Validar consistencia antes de enviar
        const todos = formVehiculos.length > 0
            ? cleanVehiculos.flatMap(v => v.repuestos_solicitados)
            : cleanItems(formItems);
        if (!validarConsistencia(todos)) return;

        setLoading(true);
        try {
            const vendedorNombre = safeGet('jfnn_vendedor_nombre');
            const itemsPayload = formVehiculos.length === 0 ? cleanItems(formItems) : null;
            const vehiculosPayload = formVehiculos.length > 0 ? cleanVehiculos : null;

            if (esAjusteVentaFinal) {
                // Ajuste interno: actualiza items finales y total. NO envía mensaje al cliente.
                await api.post(`${BACKEND_URL}/api/dashboard/cotizaciones/ajustar-venta-final`, {
                    phone,
                    items: itemsPayload,
                    vehiculos: vehiculosPayload
                });
            } else {
                const abonoMinimoNum = abonoMinimo ? parseInt(abonoMinimo.replace(/[^\d]/g, ''), 10) : 0;
                await api.post(`${BACKEND_URL}/api/dashboard/cotizaciones/responder`, {
                    phone,
                    items: itemsPayload,
                    vehiculos: vehiculosPayload,
                    note,
                    horario_entrega: horarioEntrega,
                    abono_minimo: Number.isFinite(abonoMinimoNum) && abonoMinimoNum > 0 ? abonoMinimoNum : null,
                    vendedor_nombre: vendedorNombre || undefined,
                    rectificacion: esRectificacion
                });
            }
            onResponded();
        } catch (error) {
            console.error("Error al guardar:", error);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = error as any;
            const status = err?.response?.status;
            const data = err?.response?.data;
            // Caso especial: backend bloqueó por ventana 24h cerrada (409 ventana_cerrada).
            // Educamos al vendedor con instrucciones paso a paso y le ofrecemos enviar la
            // plantilla retomar_cotizacion de un solo click.
            if (status === 409 && data?.error === 'ventana_cerrada') {
                const horas = data.horas_offline;
                const horasStr = horas ? `hace ~${horas}h` : 'hace más de 24h';
                const ok = confirm(
                    `⚠️ NO SE ENVIÓ LA COTIZACIÓN\n\n` +
                    `La ventana de WhatsApp de 24h está cerrada. El cliente lleva ${horasStr} sin responder, y si enviáramos la cotización ahora Meta la aceptaría pero NO llegaría al cliente (entrega silenciosa fallida).\n\n` +
                    `QUÉ HACER (paso a paso):\n` +
                    `1. Te enviaré ahora la plantilla 📨 "retomar_cotizacion" al cliente.\n` +
                    `2. La plantilla es un mensaje pre-aprobado por Meta que SÍ se entrega aunque la ventana esté cerrada.\n` +
                    `3. Cuando el cliente responda, la ventana de 24h se reabre.\n` +
                    `4. AHÍ recién podrás reenviar tu cotización.\n\n` +
                    `¿Envío la plantilla "retomar_cotizacion" ahora?`
                );
                if (ok) {
                    try {
                        const vendedorNombre = safeGet('jfnn_vendedor_nombre');
                        await api.post(`${BACKEND_URL}/api/dashboard/cotizaciones/template`, {
                            phone,
                            templateName: 'retomar_cotizacion',
                            nombre: 'cliente',
                            repuesto: 'los repuestos solicitados',
                            vendedor_nombre: vendedorNombre || undefined,
                        });
                        alert(`✅ Plantilla "retomar_cotizacion" enviada.\n\nEspera a que el cliente responda. Cuando lo haga, vuelve a entrar al chat y podrás enviar la cotización.`);
                        onResponded();
                    } catch (sendErr) {
                        console.error('Error enviando plantilla retomar:', sendErr);
                        alert('No se pudo enviar la plantilla. Intenta enviarla manualmente desde el chat (sección Plantillas HSM).');
                    }
                }
                return;
            }
            // Error genérico: distinguir 5xx de Meta (outage temporal) de otros errores
            // para dar instrucciones accionables al vendedor en vez de un alert opaco.
            const metaStatus: number | undefined = data?.meta_status;
            const detalle: string | undefined = data?.detalle;
            if (esAjusteVentaFinal) {
                alert("Error al guardar la venta final");
            } else if (metaStatus && metaStatus >= 500) {
                alert(
                    `⚠️ La cotización NO fue enviada.\n\n` +
                    `WhatsApp (Meta) respondió con error temporal (${metaStatus}) tras 3 reintentos.\n\n` +
                    `Esto suele ser un problema temporal de Meta. Espera 1-2 min y vuelve a pulsar "Enviar cotización".\n\n` +
                    `Si persiste >5 min, avisa al equipo técnico.`
                );
            } else if (detalle) {
                alert(`Error al enviar la cotización:\n\n${detalle}`);
            } else {
                alert("Error al enviar la cotización");
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePedirInfo = async () => {
        const instruccion = prompt(
            "💡 Pedir info adicional al cliente (sin pausar IA).\n\n" +
            "Escribe en lenguaje natural lo que necesitas saber. Ejemplos:\n" +
            "  • si la suspensión es delantera o trasera\n" +
            "  • qué tipo de transmisión (manual/automática)\n" +
            "  • el kilometraje aproximado del vehículo\n\n" +
            "La IA reformulará la pregunta y se la enviará al cliente:"
        );
        if (!instruccion || !instruccion.trim()) return;

        setLoading(true);
        try {
            const res = await api.post(`${BACKEND_URL}/api/dashboard/cotizaciones/pedir-info-cliente`, {
                phone,
                instruccion: instruccion.trim()
            });
            alert(`✅ Pregunta enviada al cliente:\n\n"${res.data?.pregunta_enviada || instruccion}"`);
            onResponded();
        } catch (error) {
            console.error("Error pidiendo info:", error);
            alert("Error al enviar la pregunta al cliente");
        } finally {
            setLoading(false);
        }
    };

    const handleAnular = async () => {
        const motivo = prompt(
            "Anular cotización y notificar al cliente.\n\n" +
            "Esto vaciará los items y mandará un mensaje de disculpa al cliente.\n" +
            "El estado vuelve a ESPERANDO_VENDEDOR y se pausa la IA.\n\n" +
            "Motivo (opcional, se incluye en el mensaje):"
        );
        if (motivo === null) return; // cancelado

        const ok = confirm("¿Confirmar anulación de cotización?");
        if (!ok) return;

        setLoading(true);
        try {
            const vendedorNombre = safeGet('jfnn_vendedor_nombre');
            await api.post(`${BACKEND_URL}/api/dashboard/cotizaciones/anular`, {
                phone,
                motivo: motivo || undefined,
                vendedor_nombre: vendedorNombre || undefined
            });
            onResponded();
        } catch (error) {
            console.error("Error al anular:", error);
            alert("Error al anular la cotización");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full bg-black/20">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                <h4 className="text-[10px] font-black text-accent uppercase tracking-widest mb-2">Completar Cotización</h4>
                <div className="mb-3 px-3 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[10px] text-amber-300/90 leading-relaxed">
                    💡 <strong>Tip:</strong> ingresa el <strong>código del producto</strong> en cada ítem disponible. Ayuda a los vendedores nuevos a aprender el catálogo y rastrear productos en el inventario.
                </div>
                {formVehiculos.length > 0 ? (
                    formVehiculos.map((v, vIdx) => (
                        <div key={vIdx} className="space-y-3 bg-neutral-900/30 p-3 rounded-xl border border-white/5">
                            <div className="flex items-center justify-between gap-2 mb-3 border-b border-white/5 pb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-6 h-6 rounded-lg bg-accent/20 flex items-center justify-center">
                                        <Car size={13} className="text-accent" />
                                    </div>
                                    <span className="text-xs font-bold text-accent tracking-wide uppercase">
                                        {v.marca_modelo || "Vehículo sin modelo"} {v.ano ? ` - ${v.ano}` : ""}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {v.patente && (
                                        <span className="px-2 py-0.5 bg-neutral-800 text-[10px] font-mono border border-white/10 rounded shadow-sm text-neutral-300">
                                            PAT: {v.patente.toUpperCase()}
                                        </span>
                                    )}
                                    {v.vin && (
                                        <span className="px-2 py-0.5 bg-neutral-800 text-[10px] font-mono border border-white/10 rounded shadow-sm text-neutral-300">
                                            VIN: {v.vin.toUpperCase()}
                                        </span>
                                    )}
                                </div>
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

            {/* Footer Fijo de Cotización — compacto para laptops pequeñas */}
            <div className="shrink-0 px-4 py-3 lg:px-6 lg:py-4 border-t border-white/5 bg-background/80 flex flex-col gap-2.5">
                {(() => {
                    const allItems = formVehiculos.length > 0
                        ? formVehiculos.flatMap(v => v.repuestos_solicitados)
                        : formItems;
                    const encargoItems = allItems.filter(i => i.disponibilidad === 'POR_ENCARGO');
                    const hasEncargo = encargoItems.length > 0;
                    const hasContent = !!(note || horarioEntrega || abonoMinimo);
                    const openByDefault = hasEncargo || hasContent;

                    const subtotalEncargo = encargoItems.reduce((acc, i) => acc + ((Number(i.precio) || 0) * (Number(i.cantidad) || 1)), 0);
                    const sugerido50 = Math.round(subtotalEncargo / 2);

                    return (
                        <details open={openByDefault} className="group">
                            <summary className="list-none cursor-pointer flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors select-none">
                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                                    <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                                    Opciones de cotización
                                    {hasContent && (
                                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-bold normal-case tracking-normal">
                                            {[note && 'nota', horarioEntrega && 'logística', abonoMinimo && 'abono'].filter(Boolean).length} activas
                                        </span>
                                    )}
                                    {hasEncargo && !abonoMinimo && (
                                        <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 text-[9px] font-bold normal-case tracking-normal">
                                            🟡 abono sugerido
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePedirInfo(); }}
                                    disabled={loading || esAjusteVentaFinal}
                                    className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 px-2 py-1 rounded-md hover:bg-cyan-500/10 transition-colors"
                                    title="Pide más info al cliente vía IA sin pausar el flujo"
                                >
                                    <Sparkles size={11} /> Pedir info
                                </button>
                            </summary>

                            <div className="mt-2 space-y-2">
                                <textarea
                                    placeholder="📝 Nota adicional (Opcional)... Ej: Repuestos alternativos japoneses"
                                    className="bg-neutral-900 border border-white/10 rounded-lg block w-full px-3 py-2 text-xs text-white focus:ring-1 focus:ring-accent focus:border-accent placeholder-neutral-500 resize-none"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={2}
                                />

                                <input
                                    type="text"
                                    placeholder="🚚 Logística (Opcional)... Ej: Retiros hoy hasta 18:00"
                                    className="bg-neutral-900 border border-white/10 rounded-lg block w-full px-3 py-2 text-xs text-white focus:ring-1 focus:ring-accent focus:border-accent placeholder-neutral-500"
                                    value={horarioEntrega}
                                    onChange={(e) => setHorarioEntrega(e.target.value)}
                                />

                                {hasEncargo && (
                                    <div className="flex items-center gap-2 bg-yellow-500/5 border border-yellow-500/30 rounded-lg px-2.5 py-2">
                                        <span className="text-yellow-400 text-xs flex-shrink-0">🟡</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder={`Abono mín. encargo · sugerido $${sugerido50.toLocaleString('es-CL')}`}
                                            className="bg-transparent border-0 block w-full px-1 py-0.5 text-xs text-white focus:ring-0 focus:outline-none placeholder-yellow-400/60"
                                            value={abonoMinimo}
                                            onChange={(e) => setAbonoMinimo(e.target.value.replace(/[^\d]/g, ''))}
                                            title={`Si dejas vacío, la IA usará 50% del subtotal de encargo ($${sugerido50.toLocaleString('es-CL')})`}
                                        />
                                    </div>
                                )}
                            </div>
                        </details>
                    );
                })()}

                {(() => {
                    const allItems = formVehiculos.length > 0
                        ? formVehiculos.flatMap(v => v.repuestos_solicitados)
                        : formItems;
                    const hasPending = allItems.some(item => item.pendiente_identificacion);
                    return hasPending ? (
                        <div className="w-full py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold text-center">
                            ⚠️ Confirma todas las piezas identificadas por IA antes de cotizar
                        </div>
                    ) : null;
                })()}

                {esRectificacion && (
                    <div className="w-full py-1.5 px-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] text-center">
                        ⚠️ Se enviará como <strong>RECTIFICACIÓN</strong> reemplazando la anterior.
                    </div>
                )}

                {esAjusteVentaFinal && (
                    <div className="w-full py-1.5 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] text-center">
                        💰 <strong>AJUSTE DE VENTA FINAL</strong> · NO se envía mensaje al cliente, solo KPIs internos.
                    </div>
                )}

                <div className="flex gap-2 w-full">
                    <button
                        type="submit"
                        disabled={loading || (() => {
                            const allItems = formVehiculos.length > 0
                                ? formVehiculos.flatMap(v => v.repuestos_solicitados)
                                : formItems;
                            return allItems.some(item => item.pendiente_identificacion);
                        })()}
                        className={`flex-1 py-2.5 rounded-xl font-bold uppercase tracking-widest text-[10px] focus:ring-4 transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                            esAjusteVentaFinal
                                ? 'bg-emerald-500 text-black hover:bg-emerald-400 focus:ring-emerald-500/20'
                                : esRectificacion
                                    ? 'bg-amber-500 text-black hover:bg-amber-400 focus:ring-amber-500/20'
                                    : 'bg-accent text-accent-foreground hover:bg-accent/90 focus:ring-accent/20'
                        }`}
                    >
                        {loading
                            ? (esAjusteVentaFinal ? 'Guardando...' : esRectificacion ? 'Rectificando...' : 'Calculando Precios...')
                            : (esAjusteVentaFinal ? '💰 Guardar Venta Final' : esRectificacion ? 'Rectificar y Reenviar' : 'Enviar Cotización')}
                    </button>

                    {esRectificacion && (
                        <button
                            type="button"
                            onClick={handleAnular}
                            disabled={loading}
                            className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-bold uppercase tracking-widest text-[10px] hover:bg-red-500/20 transition-all disabled:opacity-50"
                            title="Anular cotización: envía disculpa al cliente y vuelve a ESPERANDO_VENDEDOR"
                        >
                            ❌ Anular
                        </button>
                    )}
                </div>

                {footerActions}
            </div>
        </form>
    );
}
