"use client";

import { Car, Package, User, CheckCircle, Truck, Archive, Edit3, MessageSquareOff, Bot, X, ChevronRight, Hash, Clock, Send } from 'lucide-react';
import { useState, useEffect } from "react";
import SellerActionForm from "./SellerActionForm";
import axios from "axios";
import { BACKEND_URL } from "@/lib/api";

interface Repuesto {
    nombre: string;
    precio: number | null;
    codigo: string | null;
    cantidad?: number;
}

interface Vehiculo {
    marca_modelo: string | null;
    ano: string | null;
    patente: string | null;
    vin: string | null;
    motor?: string | null;
    combustible?: string | null;
    repuestos_solicitados: Repuesto[];
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
    agente_pausado?: boolean;
    nombre_cliente?: string | null;
    vehiculos?: Vehiculo[];
}

interface QuoteCardProps {
    phone: string;
    estado: string;
    entidades: Entidades;
    ultimoMensaje?: string;
    onResponded: () => void;
    autoOpen?: boolean;
    onClose?: () => void;
}

function useElapsed(since?: string) {
    const [elapsed, setElapsed] = useState("");
    useEffect(() => {
        if (!since) return;
        const update = () => {
            const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
            if (diff < 60) setElapsed(`${diff}s`);
            else if (diff < 3600) setElapsed(`${Math.floor(diff / 60)}m`);
            else if (diff < 86400) setElapsed(`${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`);
            else setElapsed(`${Math.floor(diff / 86400)}d`);
        };
        update();
        const id = setInterval(update, 30000);
        return () => clearInterval(id);
    }, [since]);
    return elapsed;
}

export default function QuoteCard({ phone, estado, entidades, ultimoMensaje, onResponded, autoOpen = false, onClose }: QuoteCardProps) {
    const elapsed = useElapsed(ultimoMensaje);
    const arrivalTime = ultimoMensaje ? new Date(ultimoMensaje).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : null;
    const arrivalDate = ultimoMensaje ? new Date(ultimoMensaje).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : null;
    const [isModalOpen, setIsModalOpen] = useState(autoOpen);
    const closeModal = () => { setIsModalOpen(false); onClose?.(); };
    const [isEditing, setIsEditing] = useState(false);
    const [showLogisticsModal, setShowLogisticsModal] = useState(false);
    const [mensajeLogistica, setMensajeLogistica] = useState("");
    const [loadingPago, setLoadingPago] = useState(false);

    const [showEtaModal, setShowEtaModal] = useState(false);
    const [diasEta, setDiasEta] = useState("3");
    const [loadingEncargo, setLoadingEncargo] = useState(false);
    const [numeroSeguimiento, setNumeroSeguimiento] = useState("");

    const [solicitandoVinId, setSolicitandoVinId] = useState<string | null>(null);

    const handleSolicitarVin = async (itemName: string) => {
        setSolicitandoVinId(itemName);
        try {
            await axios.post("${BACKEND_URL}/api/dashboard/solicitar-vin", {
                phone,
                itemName
            });
            alert(`Se ha solicitado VIN al cliente para: ${itemName}`);
        } catch (error) {
            console.error("Error solicitando VIN:", error);
            alert("No se pudo enviar la solicitud de VIN.");
        } finally {
            setSolicitandoVinId(null);
        }
    };

    const [isPaused, setIsPaused] = useState(entidades.agente_pausado || false);
    const [loadingPausa, setLoadingPausa] = useState(false);

    const repuestos = Array.isArray(entidades.repuestos_solicitados) ? entidades.repuestos_solicitados : [];
    const vehiculos = Array.isArray(entidades.vehiculos) ? entidades.vehiculos : [];
    const esEnvio = entidades.metodo_entrega === 'domicilio' || entidades.metodo_entrega === 'envio';
    const esRetiro = !esEnvio;

    const quoteId = entidades.quote_id || `ID-TEMP-${phone.slice(-4)}`;

    const TEMPLATE_RETIRO = `Estimado cliente, puede pasar a retirar su pedido por nuestro local desde hoy.
📋 Número de Cotización: ${quoteId}
📍 Dirección: [Dirección Tienda]
🕐 Horario: Lunes a Viernes de 9:00 a 18:00 hrs.`;

    const TEMPLATE_ENVIO = entidades.direccion_envio
        ? `Estimado cliente, su pedido fue despachado a domicilio.
📋 Número de Cotización: ${quoteId}
📍 Dirección: ${entidades.direccion_envio}
🕐 Tiempo estimado de entrega: 24 a 48 hrs hábiles.`
        : `Estimado cliente, su pedido está en camino.
📋 Número de Cotización: ${quoteId}
🕐 Tiempo estimado de entrega: 24 a 48 hrs hábiles.`;

    const getStatusConfig = (status: string) => {
        switch (status) {
            case 'PENDIENTE': return { label: 'Nuevo', class: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' };
            case 'ESPERANDO_VENDEDOR': return { label: 'Esperando Precios', class: 'bg-blue-400/10 text-blue-400 border-blue-400/20' };
            case 'CONFIRMANDO_COMPRA': return { label: 'Confirmando Cierre', class: 'bg-purple-400/10 text-purple-400 border-purple-400/20' };
            case 'ESPERANDO_APROBACION_ADMIN': return { label: 'Revisión Admin', class: 'bg-orange-400/10 text-orange-400 border-orange-400/20 ring-1 ring-orange-500/50 animate-pulse-slow' };
            case 'PAGO_VERIFICADO': return { label: 'Pago Verificado', class: 'bg-green-400/10 text-green-400 border-green-500/20' };
            case 'ABONO_VERIFICADO': return { label: 'Abono Recibido', class: 'bg-yellow-400/10 text-yellow-500 border-yellow-500/20 ring-1 ring-yellow-500/50' };
            case 'ENCARGO_SOLICITADO': return { label: 'En Proveedor', class: 'bg-indigo-400/10 text-indigo-400 border-indigo-500/20' };
            case 'ESPERANDO_SALDO': return { label: 'Cobrando Saldo', class: 'bg-rose-400/10 text-rose-400 border-rose-500/20 ring-1 ring-rose-500/50 animate-pulse-slow' };
            case 'ESPERANDO_RETIRO': return { label: 'Esperando Retiro', class: 'bg-blue-400/10 text-blue-400 border-blue-400/20' };
            case 'ENTREGADO': return { label: 'Entregado', class: 'bg-teal-400/10 text-teal-400 border-teal-500/20' };
            case 'CICLO_COMPLETO': return { label: 'Pago Presencial', class: 'bg-pink-500/20 text-pink-400 border-pink-500/30 ring-1 ring-pink-500/40 animate-pulse' };
            case 'ARCHIVADO': return { label: 'Archivado', class: 'bg-neutral-800 text-neutral-500 border-neutral-700' };
            default: return { label: status, class: 'bg-neutral-800 text-neutral-400 border-neutral-700' };
        }
    };

    const handleStatusUpdate = async (nuevoEstado: string, notify: boolean = true) => {
        try {
            await axios.patch("${BACKEND_URL}/api/dashboard/cotizaciones/estado", {
                phone,
                estado: nuevoEstado,
                notify
            });
            closeModal();
            onResponded();
        } catch (error) {
            console.error("Error actualizando estado:", error);
            alert("No se pudo actualizar el estado.");
        }
    };

    const handleConfirmarLogistica = async () => {
        setLoadingPago(true);
        try {
            const estadoFinal = esRetiro ? 'ESPERANDO_RETIRO' : 'ENTREGADO';
            await axios.patch("${BACKEND_URL}/api/dashboard/cotizaciones/estado", {
                phone,
                estado: estadoFinal,
                notify: true,
                mensaje_logistica: mensajeLogistica.trim() || null,
                numero_seguimiento: esEnvio ? numeroSeguimiento.trim() || null : null
            });
            setShowLogisticsModal(false);
            setMensajeLogistica("");
            setNumeroSeguimiento("");
            closeModal();
            onResponded();
        } catch (error) {
            console.error("Error confirmando logística:", error);
            alert("No se pudo confirmar la logística.");
        } finally {
            setLoadingPago(false);
        }
    };

    const togglePausa = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setLoadingPausa(true);
        const nuevoEstado = !isPaused;
        try {
            await axios.patch(`${BACKEND_URL}/api/dashboard/sessions/${phone}/pausa`, {
                pausado: nuevoEstado
            });
            setIsPaused(nuevoEstado);
        } catch (error) {
            console.error("Error al cambiar modo pausa:", error);
            alert("No se pudo cambiar el modo pausa del agente.");
        } finally {
            setLoadingPausa(false);
        }
    };

    const statusConfig = getStatusConfig(estado);

    // Summary helpers for compact card
    // Si hay vehiculos, suma de sus cantidades. Si no, suma del array repuestos plano.
    const totalQuantity = vehiculos.length > 0
        ? vehiculos.reduce((acc, v) => acc + (v.repuestos_solicitados?.reduce((q, r) => q + (r.cantidad || 1), 0) || 0), 0)
        : repuestos.reduce((acc, r) => acc + (r.cantidad || 1), 0);
    const vehiculoLabel = vehiculos.length > 0
        ? vehiculos.map(v => [v.marca_modelo, v.ano].filter(Boolean).join(' ')).join(' · ')
        : [entidades.marca_modelo, entidades.ano].filter(Boolean).join(' ');
    const needsAction = ['ESPERANDO_VENDEDOR', 'ESPERANDO_APROBACION_ADMIN', 'PAGO_VERIFICADO', 'ABONO_VERIFICADO', 'ENCARGO_SOLICITADO', 'CICLO_COMPLETO', 'ESPERANDO_SALDO'].includes(estado);

    return (
        <>
            {/* ── Compact Card ─────────────────────────────────────── */}
            {!autoOpen && (
            <div
                onClick={() => setIsModalOpen(true)}
                className={`glass rounded-2xl p-4 cursor-pointer transition-all duration-200 hover:border-accent/40 group relative ${needsAction ? 'ring-1 ring-accent/20' : ''}`}
            >
                <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0 relative">
                        <User size={18} />
                        {isPaused && (
                            <div className="absolute -bottom-1 -right-1 bg-orange-500 rounded-full p-[3px] border-2 border-background">
                                <MessageSquareOff size={7} className="text-white" />
                            </div>
                        )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-foreground truncate">
                                {entidades.nombre_cliente || phone}
                            </span>
                            {entidades.nombre_cliente && (
                                <span className="text-[10px] text-neutral-500 font-mono">{phone}</span>
                            )}
                            <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded flex items-center gap-0.5 font-mono font-bold">
                                <Hash size={10} /> {quoteId}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-neutral-500 text-[10px]">
                            {vehiculoLabel && (
                                <span className="flex items-center gap-1">
                                    <Car size={10} />
                                    {vehiculoLabel}
                                </span>
                            )}
                            {totalQuantity > 0 && (
                                <span className="flex items-center gap-1">
                                    <Package size={10} />
                                    {totalQuantity} unidad{totalQuantity !== 1 ? 'es' : ''}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Right side */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-tighter rounded-full border ${statusConfig.class}`}>
                            {statusConfig.label}
                        </span>

                        <div className="flex items-center gap-2">
                            {/* Pause toggle */}
                            <button
                                onClick={togglePausa}
                                disabled={loadingPausa}
                                title={isPaused ? "Reactivar Agente IA" : "Pausar Agente IA"}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all text-[9px] font-black uppercase tracking-widest ${isPaused
                                    ? 'bg-orange-500/10 border-orange-500/30 text-orange-500 hover:bg-orange-500/20'
                                    : 'bg-white/5 border-white/10 text-neutral-500 hover:bg-white/10'}`}
                            >
                                {isPaused ? <MessageSquareOff size={10} /> : <Bot size={10} />}
                                {loadingPausa ? '...' : isPaused ? 'Pausado' : 'AI'}
                            </button>

                            <ChevronRight size={14} className="text-neutral-600 group-hover:text-accent transition-colors" />
                        </div>
                    </div>
                </div>

                {/* Timestamp + elapsed counter */}
                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-neutral-600">
                        <Clock size={10} />
                        {arrivalTime && (
                            <span className="text-[10px]">{arrivalDate} {arrivalTime}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {elapsed && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                elapsed.includes('d') ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                                elapsed.includes('h') ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' :
                                'text-neutral-500 bg-white/5 border-white/10'
                            }`}>
                                ⏱ {elapsed}
                            </span>
                        )}
                        {needsAction && (
                            <span className="text-[10px] text-accent font-bold uppercase tracking-widest">
                                {estado === 'ESPERANDO_VENDEDOR' ? 'Cotizar' :
                                 estado === 'ESPERANDO_APROBACION_ADMIN' ? 'Aprobar pago' :
                                 estado === 'PAGO_VERIFICADO' ? 'Logística' :
                                 estado === 'ABONO_VERIFICADO' ? 'Encargo' :
                                 estado === 'CICLO_COMPLETO' ? 'Pago en caja' :
                                 estado === 'ESPERANDO_SALDO' ? 'Cobrar saldo' :
                                 'Abrir'}
                            </span>
                        )}
                    </div>
                </div>
            </div>
            )}

            {/* ── Full Detail Modal ─────────────────────────────────── */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/70 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
                >
                    <div className="relative w-full w-[95vw] sm:max-w-4xl md:max-w-6xl lg:max-w-7xl max-h-[95vh] flex flex-col glass rounded-2xl">
                        {/* Modal Header */}
                        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-sm border-b border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-accent relative">
                                    <User size={18} />
                                    {isPaused && (
                                        <div className="absolute -bottom-1 -right-1 bg-orange-500 rounded-full p-[3px] border-2 border-background">
                                            <MessageSquareOff size={7} className="text-white" />
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-foreground font-bold">{entidades.nombre_cliente || phone}</h3>
                                        <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded flex items-center gap-1 font-mono font-bold">
                                            <Hash size={10} /> {entidades.quote_id || `ID-TEMP-${phone.slice(-4)}`}
                                        </span>
                                        {isPaused && (
                                            <span className="text-[9px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded border border-orange-500/30 font-bold animate-pulse">
                                                🔇 PAUSADO
                                            </span>
                                        )}
                                    </div>
                                    {entidades.nombre_cliente && (
                                        <p className="text-[10px] text-neutral-500 font-medium">{phone}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-tighter rounded-full border ${statusConfig.class}`}>
                                    {statusConfig.label}
                                </span>
                                {/* Pause/Resume Agent Toggle */}
                                <button
                                    onClick={togglePausa}
                                    disabled={loadingPausa}
                                    title={isPaused ? "Reactivar Agente IA" : "Pausar Agente IA"}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-wider ${isPaused
                                        ? 'bg-orange-500/10 border-orange-500/30 text-orange-400 hover:bg-orange-500/20'
                                        : 'bg-white/5 border-white/10 text-neutral-500 hover:bg-white/10 hover:text-green-400 hover:border-green-500/30'}`}
                                >
                                    {isPaused ? <MessageSquareOff size={12} /> : <Bot size={12} />}
                                    {loadingPausa ? '...' : isPaused ? 'Pausado' : 'AI Activa'}
                                </button>
                                <button
                                    onClick={() => closeModal()}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-500 hover:text-white transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Modal Body container for Grid */}
                        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
                            {/* Columna Izquierda: Información */}
                            <div className={`p-6 space-y-5 overflow-y-auto custom-scrollbar ${ (estado === 'ESPERANDO_VENDEDOR' || isEditing) ? 'w-full md:w-5/12 lg:w-1/3 border-r border-white/5' : 'w-full' }`}>
                                {/* Síntomas */}
                            {entidades.sintomas_reportados && (
                                <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                                    <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Síntoma Técnico</p>
                                    <p className="text-xs text-neutral-400 italic">&quot;{entidades.sintomas_reportados}&quot;</p>
                                </div>
                            )}

                            {/* Vehículos / Repuestos */}
                            {vehiculos.length > 0 ? (
                                <div className="space-y-4">
                                    {vehiculos.map((v: Vehiculo, idx: number) => (
                                        <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                                            <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                                                <Car size={14} className="text-accent" />
                                                <span className="text-xs font-bold uppercase text-accent tracking-wider">Vehículo {idx + 1}</span>
                                            </div>
                                            <div className="grid grid-cols-5 gap-2">
                                                <div className="space-y-1">
                                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Marca/Modelo</p>
                                                    <p className="text-xs text-neutral-300 font-medium">{v.marca_modelo || "N/A"}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Año</p>
                                                    <p className="text-xs text-neutral-300 font-medium">{v.ano || "N/A"}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Patente/VIN</p>
                                                    <p className="text-xs text-neutral-300 font-medium truncate">{v.patente || v.vin || "N/A"}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Motor</p>
                                                    <p className="text-xs text-neutral-300 font-medium">{v.motor || "N/A"}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[9px] text-neutral-500 uppercase font-bold">Combustible</p>
                                                    <p className="text-xs text-neutral-300 font-medium">{v.combustible || "N/A"}</p>
                                                </div>
                                            </div>
                                            <div className="pt-2">
                                                <div className="flex items-center gap-1.5 text-neutral-500 mb-2">
                                                    <Package size={12} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">Repuestos</span>
                                                </div>
                                                <div className="space-y-1.5">
                                                    {v.repuestos_solicitados?.length > 0 ? (
                                                        v.repuestos_solicitados.map((r: Repuesto, rIdx: number) => (
                                                            <div key={rIdx} className="flex items-center justify-between text-xs bg-black/20 p-2 rounded-lg hover:bg-black/40 transition-colors">
                                                                <div className="flex flex-col">
                                                                    <span className="text-neutral-300 font-bold">• {r.cantidad && r.cantidad > 1 ? `${r.cantidad}x ` : ''}{r.nombre}</span>
                                                                    {r.codigo && <span className="text-[10px] text-neutral-500 font-mono">Código: {r.codigo}</span>}
                                                                    {estado === 'ESPERANDO_VENDEDOR' && !v.vin && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); handleSolicitarVin(r.nombre); }}
                                                                            disabled={solicitandoVinId === r.nombre || !v.patente}
                                                                            className="mt-2 w-max text-xs px-3 py-1.5 rounded-lg border border-green-500/50 bg-green-500/20 text-green-400 font-bold hover:bg-green-500/30 disabled:opacity-30 disabled:border-neutral-700 disabled:text-neutral-500 transition-colors cursor-pointer"
                                                                            title={!v.patente ? "Se requiere patente para solicitar VIN" : ""}
                                                                        >
                                                                            {solicitandoVinId === r.nombre ? 'Enviando...' : 'Solicitar VIN'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="text-right">
                                                                    <span className={`font-bold ${r.precio ? 'text-green-400' : 'text-neutral-600 italic'}`}>
                                                                        {r.precio ? `$${(Number(String(r.precio).replace(/[^\d]/g, "")) * (r.cantidad || 1)).toLocaleString('es-CL')}` : 'Sin precio'}
                                                                    </span>
                                                                    {r.precio && r.cantidad && r.cantidad > 1 && (
                                                                        <div className="text-[10px] text-neutral-500 mt-0.5">
                                                                            ${Number(String(r.precio).replace(/[^\d]/g, "")).toLocaleString('es-CL')} c/u
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-xs text-neutral-500 italic">No especificado</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-5 gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Vehículo</p>
                                            <p className="text-xs text-neutral-300">{entidades.marca_modelo || "N/A"}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Año</p>
                                            <p className="text-xs text-neutral-300">{entidades.ano || "N/A"}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Patente/VIN</p>
                                            <p className="text-xs text-neutral-300 truncate">{entidades.patente || entidades.vin || "N/A"}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Motor</p>
                                            <p className="text-xs text-neutral-300">{entidades.motor || "N/A"}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Combustible</p>
                                            <p className="text-xs text-neutral-300">{entidades.combustible || "N/A"}</p>
                                        </div>
                                    </div>

                                    {repuestos.length > 0 && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center gap-1.5 text-neutral-500 mb-2">
                                                <Package size={12} />
                                                <span className="text-[9px] font-bold uppercase tracking-wider">Repuestos</span>
                                            </div>
                                            {repuestos.map((r, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs bg-white/5 p-2 rounded-lg hover:bg-white/10 transition-colors">
                                                    <div className="flex flex-col">
                                                        <span className="text-neutral-300 font-bold">• {r.cantidad && r.cantidad > 1 ? `${r.cantidad}x ` : ''}{r.nombre}</span>
                                                        {r.codigo && <span className="text-[10px] text-neutral-500 font-mono">Código: {r.codigo}</span>}
                                                        {estado === 'ESPERANDO_VENDEDOR' && !entidades.vin && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleSolicitarVin(r.nombre); }}
                                                                disabled={solicitandoVinId === r.nombre || !entidades.patente}
                                                                className="mt-2 w-max text-xs px-3 py-1.5 rounded-lg border border-green-500/50 bg-green-500/20 text-green-400 font-bold hover:bg-green-500/30 disabled:opacity-30 disabled:border-neutral-700 disabled:text-neutral-500 transition-colors cursor-pointer"
                                                                title={!entidades.patente ? "Se requiere patente para solicitar VIN" : ""}
                                                            >
                                                                {solicitandoVinId === r.nombre ? 'Enviando...' : 'Solicitar VIN'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={`font-bold ${r.precio ? 'text-green-400' : 'text-neutral-600 italic'}`}>
                                                            {r.precio ? `$${(Number(String(r.precio).replace(/[^\d]/g, "")) * (r.cantidad || 1)).toLocaleString('es-CL')}` : 'Sin precio'}
                                                        </span>
                                                        {r.precio && r.cantidad && r.cantidad > 1 && (
                                                            <div className="text-[10px] text-neutral-500 mt-0.5">
                                                                ${Number(String(r.precio).replace(/[^\d]/g, "")).toLocaleString('es-CL')} c/u
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Logística */}
                            {(entidades.metodo_pago || entidades.metodo_entrega) && (
                                <div className="bg-white/5 border border-white/5 rounded-xl p-4">
                                    <div className="flex items-center gap-1.5 text-neutral-500 mb-3">
                                        <Truck size={14} className="text-accent" />
                                        <span className="text-[10px] font-bold uppercase">Logística y Entrega</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Método Entrega</p>
                                            <p className="text-xs text-neutral-300">
                                                {entidades.metodo_entrega === 'domicilio' ? '🏠 Envío a Domicilio' : '🏪 Retiro en Local'}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] text-neutral-500 uppercase font-bold">Método Pago</p>
                                            <p className="text-xs text-neutral-300">
                                                {entidades.metodo_pago === 'online' ? '💳 Transferencia/Link' : entidades.metodo_pago === 'local' ? '💵 Efectivo/Débito' : 'Pendiente'}
                                            </p>
                                        </div>
                                        {entidades.metodo_entrega === 'domicilio' && (
                                            <div className="space-y-1 col-span-2">
                                                <p className="text-[9px] text-neutral-500 uppercase font-bold">Dirección de Despacho</p>
                                                <p className={`text-xs p-2 rounded-lg border ${entidades.direccion_envio ? 'text-neutral-300 bg-accent/5 border-accent/20' : 'text-yellow-500 bg-yellow-500/5 border-yellow-500/20'}`}>
                                                    {entidades.direccion_envio || "⚠️ Pendiente por confirmar"}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Datos Factura */}
                            {entidades.tipo_documento === 'factura' && entidades.datos_factura?.rut && (
                                <div className="bg-neutral-900/50 border border-white/5 rounded-xl p-3">
                                    <p className="text-[10px] font-bold text-neutral-500 uppercase mb-2">Datos de Facturación</p>
                                    <div className="text-[11px] text-neutral-400 space-y-0.5">
                                        <p>RUT: {entidades.datos_factura.rut}</p>
                                        <p>Razón: {entidades.datos_factura.razon_social}</p>
                                    </div>
                                </div>
                            )}

                            </div> {/* Cierra Columna Izquierda */}

                            {/* Formulario de Vendedor (Columna Derecha) */}
                            {(estado === 'ESPERANDO_VENDEDOR' || isEditing) && (
                                <div className="flex-1 flex flex-col overflow-hidden relative animate-in fade-in slide-in-from-right-4 duration-300">
                                    <SellerActionForm
                                        phone={phone}
                                        items={repuestos}
                                        vehiculos={vehiculos}
                                        onResponded={() => {
                                            setIsEditing(false);
                                            closeModal();
                                            onResponded();
                                        }}
                                        footerActions={
                                            <>
                                                {isEditing && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsEditing(false)}
                                                        className="w-full mb-2 py-2 rounded-xl text-[10px] text-neutral-500 font-bold uppercase hover:bg-red-500/10 hover:text-red-400 transition-colors"
                                                    >
                                                        Cancelar edición
                                                    </button>
                                                )}
                                                <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                                                    {(estado === 'ARCHIVADO' || estado === 'ESPERANDO_VENDEDOR') && (
                                                        <>
                                                            <p className="text-[10px] text-neutral-500 text-center uppercase tracking-wider font-bold">
                                                                📨 Re-enganche (si pasaron +24h)
                                                            </p>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        try {
                                                                            await axios.post("${BACKEND_URL}/api/dashboard/cotizaciones/template", {
                                                                                phone,
                                                                                templateName: 'cotizacion_lista',
                                                                                nombre: entidades.nombre_cliente || "Cliente",
                                                                                repuesto: "los repuestos solicitados"
                                                                            });
                                                                            alert("✅ Plantilla 'Cotización Lista' enviada.");
                                                                            closeModal();
                                                                            onResponded();
                                                                        } catch (err) {
                                                                            console.error(err);
                                                                            alert("Error al enviar la plantilla.");
                                                                        }
                                                                    }}
                                                                    className="flex-1 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-bold hover:bg-green-500/20 transition-colors flex items-center justify-center gap-1.5"
                                                                    title="Notifica al cliente que su cotización está lista para revisión."
                                                                >
                                                                    <Send size={12} /> Cotización Lista
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        try {
                                                                            await axios.post("${BACKEND_URL}/api/dashboard/cotizaciones/template", {
                                                                                phone,
                                                                                templateName: 'retomar_cotizacion',
                                                                                nombre: entidades.nombre_cliente || "Cliente",
                                                                                repuesto: "los repuestos solicitados"
                                                                            });
                                                                            alert("✅ Plantilla 'Retomar Cotización' enviada.");
                                                                            closeModal();
                                                                            onResponded();
                                                                        } catch (err) {
                                                                            console.error(err);
                                                                            alert("Error al enviar la plantilla.");
                                                                        }
                                                                    }}
                                                                    className="flex-1 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[10px] font-bold hover:bg-purple-500/20 transition-colors flex items-center justify-center gap-1.5"
                                                                    title="Envía un recordatorio al cliente para que retome una cotización abandonada."
                                                                >
                                                                    <MessageSquareOff size={12} /> Retomar Conversación
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                    {estado !== 'ARCHIVADO' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const confirmed = confirm('¿Estás seguro de que deseas archivar esta cotización? La podrás ver luego en la pestaña "Cierres".');
                                                                if (confirmed) {
                                                                    handleStatusUpdate('ARCHIVADO', false);
                                                                }
                                                            }}
                                                            className="w-full mt-1 py-1.5 rounded-lg bg-neutral-800/50 border border-neutral-700/50 text-neutral-500 text-[10px] font-medium hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-1.5"
                                                            title="Archiva esta cotización. Aparecerá en la pestaña Cierres."
                                                        >
                                                            <Archive size={11} /> Archivar / Descartar
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        }
                                    />
                                </div>
                            )}
                        </div>

                        {/* ── Footer: Acciones (visible solo cuando NO se está cotizando/editando) ── */}
                        {!(estado === 'ESPERANDO_VENDEDOR' || isEditing) && (
                            <div className="shrink-0 px-6 py-4 border-t border-white/5 bg-background/80 backdrop-blur-sm rounded-b-2xl flex flex-col gap-2">
                            {estado === 'CONFIRMANDO_COMPRA' && !isEditing && (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="w-full py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-400 text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-700 hover:text-white transition-all flex items-center justify-center gap-2"
                                >
                                    <Edit3 size={12} /> Corregir Precios / Stock
                                </button>
                            )}

                                {(estado === 'PAGO_VERIFICADO' || estado === 'ABONO_VERIFICADO') && !showLogisticsModal && !showEtaModal && (
                                    <button
                                        onClick={() => {
                                            if (estado === 'ABONO_VERIFICADO') {
                                                setShowEtaModal(true);
                                            } else {
                                                setShowLogisticsModal(true);
                                                setMensajeLogistica(esRetiro ? TEMPLATE_RETIRO : TEMPLATE_ENVIO);
                                            }
                                        }}
                                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 ${estado === 'ABONO_VERIFICADO' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-green-500 text-white hover:bg-green-600'}`}
                                    >
                                        <Truck size={14} /> {estado === 'ABONO_VERIFICADO' ? 'Marcar Encargo Listo y Notificar' : 'Confirmar Logística para Cliente'}
                                    </button>
                                )}

                                {showLogisticsModal && (
                                    <div className="w-full animate-in fade-in slide-in-from-top-2 duration-300 space-y-3 bg-neutral-900/80 border border-green-500/30 rounded-xl p-4">
                                        <p className="text-[10px] font-bold uppercase text-green-400 tracking-widest">📦 Mensaje al cliente</p>
                                        <p className="text-[10px] text-neutral-500">Este mensaje se enviará por WhatsApp al confirmar el pago.</p>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setMensajeLogistica(TEMPLATE_RETIRO)}
                                                className="flex-1 py-1.5 text-[10px] rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-all">
                                                🏪 Template Retiro
                                            </button>
                                            <button type="button" onClick={() => setMensajeLogistica(TEMPLATE_ENVIO)}
                                                className="flex-1 py-1.5 text-[10px] rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-all">
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
                                        {esEnvio && (
                                            <div className="space-y-2">
                                                <label className="text-[10px] text-neutral-500 font-bold uppercase">Número de Seguimiento (Opcional)</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: CHI123456789 (Chilexpress)"
                                                    value={numeroSeguimiento}
                                                    onChange={(e) => setNumeroSeguimiento(e.target.value)}
                                                    className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-green-500/50"
                                                />
                                            </div>
                                        )}
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setShowLogisticsModal(false)}
                                                className="flex-1 py-2 rounded-xl bg-neutral-800 text-neutral-400 text-[10px] font-bold hover:bg-neutral-700 transition-colors">
                                                Cancelar
                                            </button>
                                            <button type="button" disabled={loadingPago} onClick={handleConfirmarLogistica}
                                                className="flex-1 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:bg-green-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                                                {loadingPago ? 'Enviando...' : <><CheckCircle size={13} /> Confirmar y Notificar</>}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {showEtaModal && (
                                    <div className="w-full animate-in fade-in slide-in-from-top-2 duration-300 space-y-3 bg-neutral-900/80 border border-yellow-500/30 rounded-xl p-4">
                                        <p className="text-[10px] font-bold uppercase text-yellow-500 tracking-widest">⏳ ETA Proveedor</p>
                                        <p className="text-[10px] text-neutral-400">Indica cuántos días hábiles tardarán los repuestos. Se enviará un WhatsApp automático avisando al cliente.</p>
                                        <div className="flex items-center gap-2">
                                            <label className="text-[10px] text-neutral-500 font-bold">Días Hábiles:</label>
                                            <input type="number" min="1" max="30" value={diasEta}
                                                onChange={(e) => setDiasEta(e.target.value)}
                                                className="w-20 bg-neutral-950 border border-neutral-700 rounded-lg p-2 text-xs text-center text-white focus:outline-none focus:border-yellow-500/50"
                                            />
                                        </div>
                                        <div className="flex gap-2 mt-2">
                                            <button type="button" onClick={() => setShowEtaModal(false)}
                                                className="flex-1 py-1.5 rounded-xl bg-neutral-800 text-neutral-400 text-[10px] font-bold hover:bg-neutral-700 transition-colors">
                                                Cancelar
                                            </button>
                                            <button type="button" disabled={loadingEncargo}
                                                onClick={async () => {
                                                    setLoadingEncargo(true);
                                                    try {
                                                        const response = await axios.post('${BACKEND_URL}/api/dashboard/encargos/solicitar', { phone, dias_eta: diasEta });
                                                        if (response.data.success) { setShowEtaModal(false); closeModal(); onResponded(); }
                                                    } catch (error) {
                                                        console.error(error);
                                                        alert("Error al solicitar encargo");
                                                    } finally {
                                                        setLoadingEncargo(false);
                                                    }
                                                }}
                                                className="flex-1 py-1.5 rounded-xl bg-yellow-500 text-black text-xs font-bold hover:bg-yellow-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                                                {loadingEncargo ? '...' : 'Notificar al Cliente'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {estado === 'ENCARGO_SOLICITADO' && (
                                    <button
                                        disabled={loadingEncargo}
                                        onClick={async () => {
                                            if (!confirm('¿Los repuestos ya llegaron al local? Se calculará el saldo y se notificará al cliente.')) return;
                                            setLoadingEncargo(true);
                                            try {
                                                const response = await axios.post('${BACKEND_URL}/api/dashboard/encargos/recibido', { phone });
                                                if (response.data.success) { closeModal(); onResponded(); }
                                            } catch (error) {
                                                console.error(error);
                                                alert("Error al validar llegada de encargo");
                                            } finally {
                                                setLoadingEncargo(false);
                                            }
                                        }}
                                        className="flex-1 py-2 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold hover:bg-green-500/40 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Package size={14} /> {loadingEncargo ? 'Procesando...' : '🛬 Repuestos Llegaron (Cobrar Saldo)'}
                                    </button>
                                )}

                                {estado === 'CICLO_COMPLETO' && (
                                    <button
                                        onClick={async () => {
                                            if (!confirm(`¿Confirmas que se recibió el pago presencial en caja${entidades.nombre_cliente ? ` de ${entidades.nombre_cliente}` : ''}? El sistema avanzará al flujo de logística.`)) return;
                                            try {
                                                await axios.patch("${BACKEND_URL}/api/dashboard/cotizaciones/estado", {
                                                    phone, estado: 'PAGO_VERIFICADO', notify: false
                                                });
                                                closeModal();
                                                onResponded();
                                            } catch (error) {
                                                console.error("Error confirmando pago presencial:", error);
                                                alert("No se pudo confirmar el pago.");
                                            }
                                        }}
                                        className="flex-1 py-2 rounded-xl bg-pink-500 text-white text-xs font-bold hover:bg-pink-600 transition-colors flex items-center justify-center gap-2 animate-pulse"
                                    >
                                        <CheckCircle size={14} /> ✅ Confirmar Pago Recibido en Caja
                                    </button>
                                )}

                                {estado === 'ESPERANDO_RETIRO' && (
                                    <button
                                        onClick={() => handleStatusUpdate('ENTREGADO', true)}
                                        className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-xs font-bold hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <CheckCircle size={14} /> ✅ Productos Retirados
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

                                {(estado === 'ARCHIVADO' || estado === 'ESPERANDO_VENDEDOR') && (
                                    <div className={`flex flex-col gap-2 ${estado === 'ESPERANDO_VENDEDOR' ? 'mt-4' : ''}`}>
                                        <p className="text-[10px] text-neutral-500 text-center uppercase tracking-wider font-bold">
                                            📨 Re-enganche (si pasaron +24h)
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await axios.post("${BACKEND_URL}/api/dashboard/cotizaciones/template", {
                                                            phone,
                                                            templateName: 'cotizacion_lista',
                                                            nombre: entidades.nombre_cliente || "Cliente",
                                                            repuesto: "los repuestos solicitados"
                                                        });
                                                        alert("✅ Plantilla 'Cotización Lista' enviada.");
                                                        closeModal();
                                                        onResponded();
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert("Error al enviar la plantilla.");
                                                    }
                                                }}
                                                className="flex-1 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-bold hover:bg-green-500/20 transition-colors flex items-center justify-center gap-1.5"
                                                title="Notifica al cliente que su cotización está lista para revisión."
                                            >
                                                <Send size={12} /> Cotización Lista
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await axios.post("${BACKEND_URL}/api/dashboard/cotizaciones/template", {
                                                            phone,
                                                            templateName: 'retomar_cotizacion',
                                                            nombre: entidades.nombre_cliente || "Cliente",
                                                            repuesto: "los repuestos solicitados"
                                                        });
                                                        alert("✅ Plantilla 'Retomar Cotización' enviada.");
                                                        closeModal();
                                                        onResponded();
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert("Error al enviar la plantilla.");
                                                    }
                                                }}
                                                className="flex-1 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[10px] font-bold hover:bg-purple-500/20 transition-colors flex items-center justify-center gap-1.5"
                                                title="Envía un recordatorio al cliente para que retome una cotización abandonada."
                                            >
                                                <MessageSquareOff size={12} /> Retomar Conversación
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Botón universal de archivado - visible en TODOS los estados excepto ARCHIVADO */}
                                {estado !== 'ARCHIVADO' && (
                                    <button
                                        onClick={() => {
                                            const confirmed = confirm('¿Estás seguro de que deseas archivar esta cotización? La podrás ver luego en la pestaña "Cierres".');
                                            if (confirmed) {
                                                handleStatusUpdate('ARCHIVADO', false);
                                            }
                                        }}
                                        className="w-full mt-3 py-1.5 rounded-lg bg-neutral-800/50 border border-neutral-700/50 text-neutral-500 text-[10px] font-medium hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-1.5"
                                        title="Archiva esta cotización. Aparecerá en la pestaña Cierres."
                                    >
                                        <Archive size={11} /> Archivar / Descartar
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
