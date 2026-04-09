"use client";

import { Car, Hash, User, Package, ChevronRight, Search, Bot, MessageSquareOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { BACKEND_URL } from "@/lib/api";

interface Quote {
    id: string;
    phone: string;
    estado: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entidades?: any;
    ultimo_mensaje?: string;
    created_at?: string;
}

interface BandejaTableProps {
    quotes: Quote[];
    filter: string;
    searchQuery: string;
    onOpenDetail: (quote: Quote) => void;
    onRefresh: () => void;
}

function ElapsedBadge({ since }: { since?: string }) {
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

    if (!elapsed) return <span className="text-[10px] text-neutral-700">—</span>;

    const urgencyClass = elapsed.includes('d')
        ? 'text-red-400 bg-red-500/10 border-red-500/20'
        : elapsed.includes('h')
            ? 'text-orange-400 bg-orange-500/10 border-orange-500/20'
            : 'text-neutral-500 bg-white/5 border-white/10';

    return (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${urgencyClass}`}>
            ⏱ {elapsed}
        </span>
    );
}

function PauseToggle({ phone, paused, onToggled }: { phone: string; paused: boolean; onToggled: () => void }) {
    const [isPaused, setIsPaused] = useState(paused);
    const [loading, setLoading] = useState(false);

    const toggle = async (e: React.MouseEvent) => {
        e.stopPropagation(); // No abrir el modal
        setLoading(true);
        const nuevoEstado = !isPaused;
        try {
            await axios.patch(`${BACKEND_URL}/api/dashboard/sessions/${phone}/pausa`, { pausado: nuevoEstado });
            setIsPaused(nuevoEstado);
            onToggled(); // Recargar la tabla
        } catch (err) {
            console.error("Error al cambiar pausa:", err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="col-span-1 flex items-center justify-center">
            <button
                onClick={toggle}
                disabled={loading}
                title={isPaused ? "Reactivar Agente IA" : "Pausar Agente IA"}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all text-[9px] font-black uppercase tracking-widest ${isPaused
                    ? 'bg-orange-500/10 border-orange-500/30 text-orange-400 hover:bg-orange-500/20'
                    : 'bg-white/5 border-white/10 text-neutral-500 hover:bg-white/10 hover:text-green-400 hover:border-green-500/30'}`}
            >
                {isPaused ? <MessageSquareOff size={10} /> : <Bot size={10} />}
                {loading ? '...' : isPaused ? 'Off' : 'On'}
            </button>
        </div>
    );
}

export default function BandejaTable({ quotes, filter, searchQuery, onOpenDetail, onRefresh }: BandejaTableProps) {
    const getStatusConfig = (status: string) => {
        switch (status) {
            case 'PENDIENTE': return { label: 'Nuevo', class: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20', action: null };
            case 'ESPERANDO_VENDEDOR': return { label: 'Esperando Precios', class: 'bg-blue-400/10 text-blue-400 border-blue-400/20', action: 'Cotizar' };
            case 'CONFIRMANDO_COMPRA': return { label: 'Cierre', class: 'bg-purple-400/10 text-purple-400 border-purple-400/20', action: null };
            case 'ESPERANDO_APROBACION_ADMIN': return { label: 'Revisión Admin', class: 'bg-orange-400/10 text-orange-400 border-orange-400/20 ring-1 ring-orange-500/50', action: 'Aprobar' };
            case 'PAGO_VERIFICADO': return { label: 'Pago OK', class: 'bg-green-400/10 text-green-400 border-green-500/20', action: 'Logística' };
            case 'ABONO_VERIFICADO': return { label: 'Abono OK', class: 'bg-yellow-400/10 text-yellow-500 border-yellow-500/20 ring-1 ring-yellow-500/50', action: 'Encargo' };
            case 'ENCARGO_SOLICITADO': return { label: 'Proveedor', class: 'bg-indigo-400/10 text-indigo-400 border-indigo-500/20', action: 'Validar' };
            case 'ESPERANDO_SALDO': return { label: 'Saldo', class: 'bg-rose-400/10 text-rose-400 border-rose-500/20 ring-1 ring-rose-500/50', action: 'Cobrar' };
            case 'ESPERANDO_RETIRO': return { label: 'Retiro', class: 'bg-blue-400/10 text-blue-400 border-blue-400/20', action: 'Entregar' };
            case 'CICLO_COMPLETO': return { label: 'Pago Caja', class: 'bg-pink-500/20 text-pink-400 border-pink-500/30 ring-1 ring-pink-500/40', action: 'Validar Pago' };
            case 'ENTREGADO': return { label: 'Entregado', class: 'bg-teal-400/10 text-teal-400 border-teal-500/20', action: null };
            case 'ARCHIVADO': return { label: 'Archivado', class: 'bg-neutral-800 text-neutral-500 border-neutral-700', action: null };
            default: return { label: status, class: 'bg-neutral-800 text-neutral-400 border-neutral-700', action: null };
        }
    };

    const getVehicleLabel = (entidades: Quote['entidades']) => {
        if (!entidades) return 'N/A';
        const vehiculos = Array.isArray(entidades.vehiculos) ? entidades.vehiculos : [];
        if (vehiculos.length > 0) {
            return vehiculos.map((v: { marca_modelo?: string; ano?: string }) =>
                [v.marca_modelo, v.ano].filter(Boolean).join(' ')
            ).join(' · ');
        }
        return [entidades.marca_modelo, entidades.ano].filter(Boolean).join(' ') || 'N/A';
    };

    const getRepuestosCount = (entidades: Quote['entidades']) => {
        if (!entidades) return 0;
        const vehiculos = Array.isArray(entidades.vehiculos) ? entidades.vehiculos : [];
        if (vehiculos.length > 0) {
            return vehiculos.reduce((acc: number, v: { repuestos_solicitados?: { cantidad?: number }[] }) =>
                acc + (v.repuestos_solicitados?.reduce((q: number, r: { cantidad?: number }) => q + (r.cantidad || 1), 0) || 0), 0);
        }
        const repuestos = Array.isArray(entidades.repuestos_solicitados) ? entidades.repuestos_solicitados : [];
        return repuestos.reduce((acc: number, r: { cantidad?: number }) => acc + (r.cantidad || 1), 0);
    };

    // Filtrar y buscar
    const filtered = quotes
        .filter((q) => filter === 'todos' || q.estado === filter)
        .filter((q) => {
            if (!searchQuery.trim()) return true;
            const query = searchQuery.toLowerCase();
            const name = q.entidades?.nombre_cliente?.toLowerCase() || '';
            const quoteId = q.entidades?.quote_id?.toLowerCase() || '';
            const vehicle = getVehicleLabel(q.entidades).toLowerCase();
            return q.phone.includes(query) || name.includes(query) || quoteId.includes(query) || vehicle.includes(query);
        })
        // Ordenar: los que necesitan acción primero, luego por antigüedad (más antiguos arriba)
        .sort((a, b) => new Date(a.created_at || a.ultimo_mensaje || 0).getTime() - new Date(b.created_at || b.ultimo_mensaje || 0).getTime());

    if (filtered.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 glass rounded-3xl border-dashed border-2 border-neutral-800">
                <Search size={32} className="text-neutral-800 mb-3" />
                <p className="text-neutral-500 font-medium text-sm">
                    {searchQuery ? 'No se encontraron resultados para tu búsqueda.' : 'No hay cotizaciones en esta categoría.'}
                </p>
            </div>
        );
    }

    return (
        <div className="glass rounded-2xl overflow-hidden border border-white/5">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-white/5 bg-white/[0.02]">
                <span className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-neutral-600">Cliente</span>
                <span className="col-span-3 text-[9px] font-bold uppercase tracking-widest text-neutral-600">Vehículo</span>
                <span className="col-span-1 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-center">Items</span>
                <span className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-center">Estado</span>
                <span className="col-span-1 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-center">Tiempo</span>
                <span className="col-span-1 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-center">AI</span>
                <span className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-right">Acción</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-white/[0.03]">
                {filtered.map((quote) => {
                    const config = getStatusConfig(quote.estado);
                    const vehicleLabel = getVehicleLabel(quote.entidades);
                    const repCount = getRepuestosCount(quote.entidades);
                    const isPaused = quote.entidades?.agente_pausado || false;

                    return (
                        <div
                            key={quote.id || quote.phone}
                            onClick={() => onOpenDetail(quote)}
                            className={`grid grid-cols-12 gap-4 px-6 py-3.5 items-center hover:bg-white/[0.03] cursor-pointer transition-colors group ${config.action ? 'border-l-2 border-l-accent/30' : ''}`}
                        >
                            {/* Cliente */}
                            <div className="col-span-2 flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0 relative">
                                    <User size={13} />
                                    {isPaused && (
                                        <div className="absolute -bottom-0.5 -right-0.5 bg-orange-500 rounded-full p-[2px] border border-background">
                                            <MessageSquareOff size={6} className="text-white" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-neutral-200 truncate">
                                        {quote.entidades?.nombre_cliente || 'Sin nombre'}
                                    </p>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-neutral-600 font-mono">{quote.phone}</span>
                                        {quote.entidades?.quote_id && (
                                            <span className="text-[9px] text-accent/60 font-mono flex items-center gap-0.5">
                                                <Hash size={8} />{quote.entidades.quote_id.replace('JFNN-2026-', '')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Vehículo */}
                            <div className="col-span-3 flex items-center gap-1.5 min-w-0">
                                <Car size={12} className="text-neutral-500 shrink-0" />
                                <span className="text-xs text-neutral-400 truncate">{vehicleLabel}</span>
                            </div>

                            {/* Items count */}
                            <div className="col-span-1 flex items-center justify-center gap-1">
                                <Package size={11} className="text-neutral-600" />
                                <span className="text-xs text-neutral-400 font-bold">{repCount}</span>
                            </div>

                            {/* Estado */}
                            <div className="col-span-2 flex justify-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter rounded-full border whitespace-nowrap ${config.class}`}>
                                    {config.label}
                                </span>
                            </div>

                            {/* Tiempo transcurrido */}
                            <div className="col-span-1 flex items-center justify-center">
                                <ElapsedBadge since={quote.ultimo_mensaje} />
                            </div>

                            {/* AI Pause Toggle */}
                            <PauseToggle phone={quote.phone} paused={isPaused} onToggled={onRefresh} />

                            {/* Acción / Flecha */}
                            <div className="col-span-2 flex items-center justify-end gap-2">
                                {config.action ? (
                                    <span className="text-[10px] text-accent font-bold uppercase tracking-widest">
                                        {config.action}
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-neutral-600">Abrir</span>
                                )}
                                <ChevronRight size={14} className="text-neutral-700 group-hover:text-accent transition-colors" />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                <span className="text-[10px] text-neutral-600 font-medium">
                    {filtered.length} cotización{filtered.length !== 1 ? 'es' : ''} activa{filtered.length !== 1 ? 's' : ''}
                </span>
                <div className="flex items-center gap-3">
                    <span className="text-[10px] text-neutral-600">
                        Requieren acción: <span className="text-accent font-bold">
                            {filtered.filter(q => getStatusConfig(q.estado).action).length}
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}
