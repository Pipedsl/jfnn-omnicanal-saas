"use client";

import { Car, Hash, DollarSign, Archive, CheckCircle, Clock, User, Package, ChevronRight, Search } from 'lucide-react';

interface Quote {
    id: string;
    phone: string;
    estado: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entidades?: any;
    ultimo_mensaje?: string;
    created_at?: string;
}

interface HistorialTableProps {
    quotes: Quote[];
    filter: string;
    searchQuery: string;
    onOpenDetail: (quote: Quote) => void;
}

export default function HistorialTable({ quotes, filter, searchQuery, onOpenDetail }: HistorialTableProps) {
    const getStatusBadge = (estado: string) => {
        switch (estado) {
            case 'ENTREGADO':
                return { label: 'Entregado', icon: <CheckCircle size={12} />, class: 'bg-teal-500/10 text-teal-400 border-teal-500/20' };
            case 'ARCHIVADO':
                return { label: 'Archivado', icon: <Archive size={12} />, class: 'bg-neutral-700/50 text-neutral-400 border-neutral-600' };
            default:
                return { label: estado, icon: null, class: 'bg-neutral-800 text-neutral-500 border-neutral-700' };
        }
    };

    const calcTotal = (entidades: Quote['entidades']) => {
        if (!entidades) return 0;
        const vehiculos = Array.isArray(entidades.vehiculos) ? entidades.vehiculos : [];
        const repuestos = Array.isArray(entidades.repuestos_solicitados) ? entidades.repuestos_solicitados : [];

        let total = 0;
        if (vehiculos.length > 0) {
            vehiculos.forEach((v: { repuestos_solicitados?: { precio?: number | string | null; cantidad?: number }[] }) => {
                (v.repuestos_solicitados || []).forEach((r) => {
                    const precio = r.precio ? parseInt(String(r.precio).replace(/[^\d]/g, '')) : 0;
                    total += precio * (r.cantidad || 1);
                });
            });
        } else {
            repuestos.forEach((r: { precio?: number | string | null; cantidad?: number }) => {
                const precio = r.precio ? parseInt(String(r.precio).replace(/[^\d]/g, '')) : 0;
                total += precio * (r.cantidad || 1);
            });
        }
        return total;
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
            return q.phone.includes(query) || name.includes(query) || quoteId.includes(query);
        })
        .sort((a, b) => new Date(b.ultimo_mensaje || 0).getTime() - new Date(a.ultimo_mensaje || 0).getTime());

    if (filtered.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 glass rounded-3xl border-dashed border-2 border-neutral-800">
                <Search size={32} className="text-neutral-800 mb-3" />
                <p className="text-neutral-500 font-medium text-sm">
                    {searchQuery ? 'No se encontraron resultados para tu búsqueda.' : 'No hay registros en esta categoría.'}
                </p>
            </div>
        );
    }

    return (
        <div className="glass rounded-2xl overflow-hidden border border-white/5">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-white/5 bg-white/[0.02]">
                <span className="col-span-1 text-[9px] font-bold uppercase tracking-widest text-neutral-600">ID</span>
                <span className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-neutral-600">Cliente</span>
                <span className="col-span-3 text-[9px] font-bold uppercase tracking-widest text-neutral-600">Vehículo</span>
                <span className="col-span-1 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-center">Items</span>
                <span className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-right">Monto</span>
                <span className="col-span-1 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-center">Estado</span>
                <span className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-neutral-600 text-right">Fecha</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-white/[0.03]">
                {filtered.map((quote) => {
                    const badge = getStatusBadge(quote.estado);
                    const total = calcTotal(quote.entidades);
                    const vehicleLabel = getVehicleLabel(quote.entidades);
                    const repCount = getRepuestosCount(quote.entidades);
                    const fecha = quote.ultimo_mensaje
                        ? new Date(quote.ultimo_mensaje).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—';
                    const hora = quote.ultimo_mensaje
                        ? new Date(quote.ultimo_mensaje).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
                        : '';

                    return (
                        <div
                            key={quote.id || quote.phone}
                            onClick={() => onOpenDetail(quote)}
                            className="grid grid-cols-12 gap-4 px-6 py-3.5 items-center hover:bg-white/[0.03] cursor-pointer transition-colors group"
                        >
                            {/* Quote ID */}
                            <div className="col-span-1 flex items-center gap-1.5">
                                <Hash size={11} className="text-accent/60" />
                                <span className="text-[11px] text-accent font-mono font-bold truncate">
                                    {quote.entidades?.quote_id?.replace('JFNN-2026-', '') || '—'}
                                </span>
                            </div>

                            {/* Cliente */}
                            <div className="col-span-2 flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-neutral-500 shrink-0">
                                    <User size={13} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-neutral-200 truncate">{quote.entidades?.nombre_cliente || 'Sin nombre'}</p>
                                    <p className="text-[10px] text-neutral-600 font-mono">{quote.phone}</p>
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

                            {/* Monto */}
                            <div className="col-span-2 text-right">
                                <span className={`text-sm font-bold ${total > 0 ? 'text-green-400' : 'text-neutral-600'}`}>
                                    {total > 0 ? `$${total.toLocaleString('es-CL')}` : '—'}
                                </span>
                            </div>

                            {/* Estado */}
                            <div className="col-span-1 flex justify-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter rounded-full border ${badge.class}`}>
                                    {badge.icon}
                                    {badge.label}
                                </span>
                            </div>

                            {/* Fecha */}
                            <div className="col-span-2 flex items-center justify-end gap-2">
                                <div className="text-right">
                                    <p className="text-[11px] text-neutral-400">{fecha}</p>
                                    <p className="text-[10px] text-neutral-600">{hora}</p>
                                </div>
                                <ChevronRight size={14} className="text-neutral-700 group-hover:text-accent transition-colors" />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                <span className="text-[10px] text-neutral-600 font-medium">
                    {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
                </span>
                <span className="text-[10px] text-neutral-600">
                    Total ventas: <span className="text-green-400 font-bold">
                        ${filtered.reduce((acc, q) => acc + calcTotal(q.entidades), 0).toLocaleString('es-CL')}
                    </span>
                </span>
            </div>
        </div>
    );
}
