"use client";

import { Car, Calendar, Hash, Package, User, DollarSign, CheckCircle, Truck, Archive } from "lucide-react";
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
    const repuestos = Array.isArray(entidades.repuestos_solicitados) ? entidades.repuestos_solicitados : [];

    const getStatusConfig = (status: string) => {
        switch (status) {
            case 'PENDIENTE': return { label: 'Nuevo', class: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' };
            case 'ESPERANDO_VENDEDOR': return { label: 'Esperando Precios', class: 'bg-blue-400/10 text-blue-400 border-blue-400/20' };
            case 'CONFIRMANDO_COMPRA': return { label: 'Confirmando Cierre', class: 'bg-purple-400/10 text-purple-400 border-purple-400/20' };
            case 'PAGO_VERIFICADO': return { label: 'Pago Verificado', class: 'bg-green-400/10 text-green-400 border-green-500/20' };
            case 'ENTREGADO': return { label: 'Producto Entregado', class: 'bg-teal-400/10 text-teal-400 border-teal-500/20' };
            case 'CICLO_COMPLETO': return { label: 'POR VALIDAR PAGO', class: 'bg-pink-500/20 text-pink-400 border-pink-500/30 ring-1 ring-pink-500/50 animate-pulse-slow' };
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

    const statusConfig = getStatusConfig(estado);

    return (
        <div className="glass rounded-2xl overflow-hidden transition-all duration-300 hover:border-accent/40 group relative">
            {/* Quote ID Badge */}
            {entidades.quote_id && (
                <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] bg-accent/20 text-accent px-2 py-0.5 rounded-bl-lg font-mono font-bold">
                        {entidades.quote_id}
                    </span>
                </div>
            )}

            <div className="p-6 space-y-4">
                {/* Header */}
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                            <User size={20} />
                        </div>
                        <div>
                            <p className="text-xs text-neutral-500 uppercase tracking-widest font-bold">Cliente</p>
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
                    {(entidades.motor || entidades.combustible) && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-neutral-500">
                                <span className="text-[10px] font-bold uppercase">Motor</span>
                            </div>
                            <p className="text-[10px] text-neutral-400">
                                {entidades.motor || 'N/A'} | {entidades.combustible || 'N/A'}
                            </p>
                        </div>
                    )}

                    {/* Nuevos datos de cierre si existen */}
                    {(entidades.metodo_pago || entidades.metodo_entrega) && (
                        <div className="space-y-1 col-span-2">
                            <div className="flex items-center gap-1.5 text-neutral-500">
                                <DollarSign size={14} className="text-green-500" />
                                <span className="text-[10px] font-bold uppercase">Pago/Entrega</span>
                            </div>
                            <p className="text-[10px] text-neutral-400">
                                {entidades.metodo_pago === 'online' ? '💳 Pago Online' : entidades.metodo_pago === 'local' ? '💵 Pago Local' : ''}
                                {entidades.metodo_entrega && ` | ${entidades.metodo_entrega === 'domicilio' ? '🏠 Envío' : '🏪 Retiro'}`}
                            </p>
                        </div>
                    )}

                    <div className="space-y-1 col-span-2">
                        <div className="flex items-center gap-1.5 text-neutral-500">
                            <Package size={14} />
                            <span className="text-[10px] font-bold uppercase">Repuestos</span>
                        </div>
                        <div className="space-y-1 mt-1">
                            {repuestos.length > 0 ? (
                                repuestos.map((r, i) => (
                                    <p key={i} className="text-sm text-accent font-medium leading-tight">
                                        • {r.nombre}
                                    </p>
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
                <div className="pt-4 border-t border-white/5 flex gap-2">
                    {estado === 'ESPERANDO_VENDEDOR' && (
                        <SellerActionForm phone={phone} items={repuestos} onResponded={onResponded} />
                    )}

                    {(estado === 'CONFIRMANDO_COMPRA' || estado === 'CICLO_COMPLETO') && (
                        <button
                            onClick={() => handleStatusUpdate('PAGO_VERIFICADO')}
                            className="flex-1 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:bg-green-600 transition-colors flex items-center justify-center gap-2"
                        >
                            <CheckCircle size={14} /> Verificar Pago
                        </button>
                    )}

                    {estado === 'PAGO_VERIFICADO' && (
                        <button
                            onClick={() => handleStatusUpdate('ENTREGADO')}
                            className="flex-1 py-2 rounded-xl bg-teal-500 text-white text-xs font-bold hover:bg-teal-600 transition-colors flex items-center justify-center gap-2"
                        >
                            <Truck size={14} /> Marcar como Entregado
                        </button>
                    )}

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
