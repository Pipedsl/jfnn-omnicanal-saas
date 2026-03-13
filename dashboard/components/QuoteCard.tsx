"use client";

import { Car, Calendar, Hash, Package, User, DollarSign, CheckCircle, Truck, Archive, MapPin, Edit3 } from "lucide-react";
import { useState } from "react";
import SellerActionForm from "./SellerActionForm";
import axios from "axios";

interface Repuesto {
    nombre: string;
    precio: number | null;
    codigo: string | null;
}

interface Entidades {
    marca_modelo: string | null;
    ano: string | null;
    patente: string | null;
    vin: string | null;
    motor: string | null;
    combustible: string | null;
    repuestos_solicitados: Repuesto[] | null;
    sintomas_reportados: string | null;
    metodo_pago: string | null;
    metodo_entrega: string | null;
    direccion_envio: string | null;
    tipo_documento: string | null;
    quote_id: string | null;
    datos_factura: {
        rut: string | null;
        razon_social: string | null;
        giro: string | null;
    };
}

interface QuoteCardProps {
    phone: string;
    estado: string;
    entidades: Entidades;
    onResponded: () => void;
}

export default function QuoteCard({ phone, estado, entidades, onResponded }: QuoteCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [showLogisticsModal, setShowLogisticsModal] = useState(false);
    const [mensajeLogistica, setMensajeLogistica] = useState("");
    const [loadingPago, setLoadingPago] = useState(false);
    const repuestos = Array.isArray(entidades.repuestos_solicitados) ? entidades.repuestos_solicitados : [];
    const esEnvio = entidades.metodo_entrega === 'domicilio' || entidades.metodo_entrega === 'envio';
    const esRetiro = !esEnvio;

    const TEMPLATE_RETIRO = `Estimado cliente, puede pasar a retirar su pedido por nuestro local desde hoy.
📍 Dirección: [Dirección Tienda]
🕐 Horario: Lunes a Viernes de 9:00 a 18:00 hrs.`;

    const TEMPLATE_ENVIO = entidades.direccion_envio
        ? `Estimado cliente, su pedido fue despachado a domicilio.
📍 Dirección: ${entidades.direccion_envio}
🕐 Tiempo estimado de entrega: 24 a 48 hrs hábiles.`
        : `Estimado cliente, su pedido está en camino.
🕐 Tiempo estimado de entrega: 24 a 48 hrs hábiles.`;

    const getStatusConfig = (status: string) => {
        switch (status) {
            case 'PENDIENTE': return { label: 'Nuevo', class: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' };
            case 'ESPERANDO_VENDEDOR': return { label: 'Esperando Precios', class: 'bg-blue-400/10 text-blue-400 border-blue-400/20' };
            case 'CONFIRMANDO_COMPRA': return { label: 'Confirmando Cierre', class: 'bg-purple-400/10 text-purple-400 border-purple-400/20' };
            case 'ESPERANDO_APROBACION_ADMIN': return { label: 'Revisión Admin', class: 'bg-orange-400/10 text-orange-400 border-orange-400/20 ring-1 ring-orange-500/50 animate-pulse-slow' };
            case 'PAGO_VERIFICADO': return { label: 'Pago Verificado', class: 'bg-green-400/10 text-green-400 border-green-500/20' };
            case 'ENTREGADO': return { label: 'Producto Entregado', class: 'bg-teal-400/10 text-teal-400 border-teal-500/20' };
            case 'CICLO_COMPLETO': return { label: 'POR VALIDAR PAGO', class: 'bg-pink-500/20 text-pink-400 border-pink-500/30' };
            case 'ARCHIVADO': return { label: 'Archivado', class: 'bg-neutral-800 text-neutral-500 border-neutral-700' };
            default: return { label: status, class: 'bg-neutral-800 text-neutral-400 border-neutral-700' };
        }
    };

    const handleStatusUpdate = async (nuevoEstado: string, notify: boolean = true) => {
        try {
            await axios.patch("http://localhost:4000/api/dashboard/cotizaciones/estado", {
                phone,
                estado: nuevoEstado,
                notify
            });
            onResponded();
        } catch (error) {
            console.error("Error actualizando estado:", error);
            alert("No se pudo actualizar el estado.");
        }
    };

    const handleConfirmarLogistica = async () => {
        setLoadingPago(true);
        try {
            await axios.patch("http://localhost:4000/api/dashboard/cotizaciones/estado", {
                phone,
                estado: 'ENTREGADO',
                notify: true,
                mensaje_logistica: mensajeLogistica.trim() || null
            });
            setShowLogisticsModal(false);
            setMensajeLogistica("");
            onResponded();
        } catch (error) {
            console.error("Error confirmando logística:", error);
            alert("No se pudo confirmar la logística.");
        } finally {
            setLoadingPago(false);
        }
    };

    const statusConfig = getStatusConfig(estado);

    return (
        <div className="glass rounded-2xl overflow-hidden transition-all duration-300 hover:border-accent/40 group relative">


            <div className="p-6 space-y-4">
                {/* Header */}
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                            <User size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-neutral-500 uppercase tracking-widest font-bold">Cliente</p>
                                <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded flex items-center gap-1 font-mono font-bold">
                                    <Hash size={10} /> {entidades.quote_id || `ID-TEMP-${phone.slice(-4)}`}
                                </span>
                            </div>
                            <h3 className="text-foreground font-medium">{phone}</h3>
                        </div>
                    </div>
                    <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-tighter rounded-full border ${statusConfig.class}`}>
                        {statusConfig.label}
                    </span>
                </div>


                {/* Síntomas / Notas Técnicas */}
                {entidades.sintomas_reportados && (
                    <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                        <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Síntoma Técnico</p>
                        <p className="text-xs text-neutral-400 italic">&quot;{entidades.sintomas_reportados}&quot;</p>
                    </div>
                )}

                {/* Data Grid */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Car size={14} />
                            <span className="text-[10px] font-bold uppercase">Vehículo</span>
                        </div>
                        <p className="text-sm text-neutral-300">{entidades.marca_modelo || "N/A"}</p>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Calendar size={14} />
                            <span className="text-[10px] font-bold uppercase">Año</span>
                        </div>
                        <p className="text-sm text-neutral-300">{entidades.ano || "N/A"}</p>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Hash size={14} />
                            <span className="text-[10px] font-bold uppercase">Patente/VIN</span>
                        </div>
                        <p className="text-sm text-neutral-300 truncate">{entidades.patente || entidades.vin || "N/A"}</p>
                    </div>
                    {/* Nuevos datos de cierre si existen */}
                    {(entidades.metodo_pago || entidades.metodo_entrega) && (
                        <div className="space-y-1 col-span-2 bg-white/5 p-3 rounded-xl border border-white/5">
                            <div className="flex items-center gap-1.5 text-neutral-500 mb-2">
                                <Truck size={14} className="text-accent" />
                                <span className="text-[10px] font-bold uppercase">Logística y Entrega</span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Método</p>
                                    <p className="text-xs text-neutral-300">
                                        {entidades.metodo_entrega === 'domicilio' ? '🏠 Envío a Domicilio' : '🏪 Retiro en Local'}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Pago</p>
                                    <p className="text-xs text-neutral-300">
                                        {entidades.metodo_pago === 'online' ? '💳 Transferencia/Link' : entidades.metodo_pago === 'local' ? '💵 Efectivo/Débito' : 'Pendiente'}
                                    </p>
                                </div>

                                {entidades.metodo_entrega === 'domicilio' && (
                                    <div className="space-y-1 col-span-2 pt-1">
                                        <p className="text-[9px] text-neutral-500 uppercase font-bold">Dirección de Despacho</p>
                                        <p className={`text-xs p-2 rounded-lg border ${entidades.direccion_envio ? 'text-neutral-300 bg-accent/5 border-accent/20' : 'text-yellow-500 bg-yellow-500/5 border-yellow-500/20'}`}>
                                            {entidades.direccion_envio || "⚠️ Pendiente por confirmar"}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}




                    <div className="space-y-1 col-span-2">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Package size={14} />
                            <span className="text-[10px] font-bold uppercase">Repuestos</span>
                        </div>
                        <div className="space-y-1.5 mt-2">
                            {repuestos.length > 0 ? (
                                repuestos.map((r, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded-lg group/item transition-colors hover:bg-white/10">
                                        <div className="flex flex-col">
                                            <span className="text-neutral-300 font-medium font-bold">• {r.nombre}</span>
                                            {r.codigo && (
                                                <span className="text-[10px] text-neutral-500 font-mono">Layla: {r.codigo}</span>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <span className={`font-bold ${r.precio ? 'text-green-400' : 'text-neutral-600 italic'}`}>
                                                {r.precio ? `$${Number(String(r.precio).replace(/[^\d]/g, "")).toLocaleString('es-CL')}` : 'Sin precio'}
                                            </span>
                                        </div>

                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-neutral-500 italic">No especificado</p>
                            )}
                        </div>
                    </div>

                    {/* Datos de Factura si es necesario */}
                    {entidades.tipo_documento === 'factura' && entidades.datos_factura?.rut && (
                        <div className="col-span-2 pt-2 border-t border-white/5">
                            <p className="text-[10px] font-bold text-neutral-500 uppercase mb-1">Datos de Facturación</p>
                            <div className="bg-neutral-900/50 rounded-lg p-2 text-[10px] text-neutral-400">
                                <p>RUT: {entidades.datos_factura.rut}</p>
                                <p>Razón: {entidades.datos_factura.razon_social}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Botones de acción dinámica según el estado */}
                <div className="pt-4 border-t border-white/5 flex flex-col gap-2">
                    {/* Botón de Rectificación solo en estados de cierre */}
                    {estado === 'CONFIRMANDO_COMPRA' && !isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="w-full py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-400 text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-700 hover:text-white transition-all flex items-center justify-center gap-2 mb-2"
                        >
                            <Edit3 size={12} /> Corregir Precios / Stock
                        </button>
                    )}

                    {(estado === 'ESPERANDO_VENDEDOR' || isEditing) && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                            <SellerActionForm
                                phone={phone}
                                items={repuestos}
                                onResponded={() => {
                                    setIsEditing(false);
                                    onResponded();
                                }}
                            />
                            {isEditing && (
                                <button
                                    onClick={() => setIsEditing(false)}
                                    className="w-full mt-2 py-2 text-[10px] text-neutral-500 font-bold uppercase hover:text-red-400 transition-colors"
                                >
                                    Cancelar edición
                                </button>
                            )}
                        </div>
                    )}

                    {estado === 'PAGO_VERIFICADO' && !showLogisticsModal && (
                        <button
                            onClick={() => {
                                setShowLogisticsModal(true);
                                setMensajeLogistica(esRetiro ? TEMPLATE_RETIRO : TEMPLATE_ENVIO);
                            }}
                            className="flex-1 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:bg-green-600 transition-colors flex items-center justify-center gap-2"
                        >
                            <Truck size={14} /> Confirmar Logística para Cliente
                        </button>
                    )}

                    {/* Modal Inline de Logística */}
                    {showLogisticsModal && (
                        <div className="w-full animate-in fade-in slide-in-from-top-2 duration-300 space-y-3 bg-neutral-900/80 border border-green-500/30 rounded-xl p-4">
                            <p className="text-[10px] font-bold uppercase text-green-400 tracking-widest">📦 Mensaje al cliente</p>
                            <p className="text-[10px] text-neutral-500">
                                Este mensaje se enviará por WhatsApp al confirmar el pago.
                            </p>

                            {/* Templates rápidos */}
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMensajeLogistica(TEMPLATE_RETIRO)}
                                    className="flex-1 py-1.5 text-[10px] rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-all"
                                >
                                    🏪 Template Retiro
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMensajeLogistica(TEMPLATE_ENVIO)}
                                    className="flex-1 py-1.5 text-[10px] rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-all"
                                >
                                    🚚 Template Envío
                                </button>
                            </div>

                            <textarea
                                value={mensajeLogistica}
                                onChange={(e) => setMensajeLogistica(e.target.value)}
                                rows={5}
                                placeholder="Escribe el mensaje de logística para el cliente..."
                                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-3 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-green-500/50 resize-none transition-all"
                            />

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowLogisticsModal(false)}
                                    className="flex-1 py-2 rounded-xl bg-neutral-800 text-neutral-400 text-[10px] font-bold hover:bg-neutral-700 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    disabled={loadingPago}
                                    onClick={handleConfirmarLogistica}
                                    className="flex-1 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:bg-green-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    {loadingPago ? 'Enviando...' : <><CheckCircle size={13} /> Confirmar y Notificar</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Se quitó el botón suelto de "Marcar como entregado", porque ahora es gestionado por handleConfirmarLogistica dentro del modal. */}
                    {estado === 'ENTREGADO' && (
                        <button
                            onClick={() => handleStatusUpdate('ARCHIVADO', false)}
                            className="flex-1 py-2 rounded-xl bg-neutral-700 text-white text-xs font-bold hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
                        >
                            <Archive size={14} /> Archivar Venta
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
