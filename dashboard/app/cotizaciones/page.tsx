"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import Link from "next/link";
import { api, BACKEND_URL } from "@/lib/api";
import { ArrowLeft, FileText, Hash, MapPin, User, Calendar, DollarSign, Package, Archive, CheckCircle, XCircle, Clock } from "lucide-react";

interface Cotizacion {
    quote_id: string;
    phone: string;
    nombre_cliente: string | null;
    sucursal: string | null;
    vendedor_nombre: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repuestos: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vehiculos: any[];
    total_aproximado: number;
    tiene_encargo: boolean;
    abono_minimo: number | null;
    estado_cotizacion: "ACTIVA" | "ARCHIVADA" | "EXPIRADA" | "CERRADA" | "ACEPTADA" | "RECHAZADA";
    valida_hasta: string;
    cerrada_en: string | null;
    enviada_en: string;
    updated_at: string;
}

const ESTADO_STYLE: Record<string, string> = {
    ACTIVA: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    ACEPTADA: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    RECHAZADA: "bg-red-500/10 text-red-400 border-red-500/30",
    ARCHIVADA: "bg-purple-500/10 text-purple-300 border-purple-500/30",
    EXPIRADA: "bg-neutral-700/40 text-neutral-400 border-neutral-600/40",
    CERRADA: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

// Etiqueta legible por estado (la columna muestra esto en vez del enum crudo).
const ESTADO_LABEL: Record<string, string> = {
    ACTIVA: "Pendiente",
    ACEPTADA: "Aceptada",
    RECHAZADA: "Rechazada",
    ARCHIVADA: "Guardada",
    EXPIRADA: "Vencida",
    CERRADA: "Comprada",
};

function formatMoney(n: number): string {
    return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0);
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function diasRestantes(validaHasta: string): string {
    const diff = new Date(validaHasta).getTime() - Date.now();
    if (diff <= 0) return "vencida";
    const dias = Math.floor(diff / (24 * 60 * 60 * 1000));
    const horas = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (dias > 0) return `${dias}d ${horas}h`;
    return `${horas}h`;
}

export default function CotizacionesPage() {
    const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
    const [filtroEstado, setFiltroEstado] = useState<string>("ACTIVA");
    const [busqueda, setBusqueda] = useState("");
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Cotizacion | null>(null);
    const [agrupar, setAgrupar] = useState(true);

    const fetchList = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filtroEstado !== "TODAS") params.set("estado", filtroEstado);
            const res = await api.get(`${BACKEND_URL}/api/dashboard/cotizaciones-store?${params.toString()}`);
            setCotizaciones(res.data?.cotizaciones || []);
        } catch (e) {
            console.error("Error fetch cotizaciones:", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchList(); }, [filtroEstado]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(() => {
        const base = !busqueda.trim() ? cotizaciones : cotizaciones.filter(c =>
            c.quote_id.toLowerCase().includes(busqueda.toLowerCase()) ||
            (c.nombre_cliente || "").toLowerCase().includes(busqueda.toLowerCase()) ||
            c.phone.includes(busqueda) ||
            (c.vendedor_nombre || "").toLowerCase().includes(busqueda.toLowerCase())
        );
        if (!agrupar) return base;
        // Agrupar por cliente: ordenar por phone, y dentro por fecha de envío descendente.
        return [...base].sort((a, b) =>
            a.phone === b.phone
                ? new Date(b.enviada_en).getTime() - new Date(a.enviada_en).getTime()
                : a.phone.localeCompare(b.phone)
        );
    }, [cotizaciones, busqueda, agrupar]);

    const cambiarEstado = async (quoteId: string, nuevoEstado: string) => {
        try {
            await api.patch(`${BACKEND_URL}/api/dashboard/cotizaciones-store/${quoteId}/estado`, { estado: nuevoEstado });
            await fetchList();
            if (selected?.quote_id === quoteId) setSelected(null);
        } catch (e) {
            alert("No se pudo cambiar el estado");
            console.error(e);
        }
    };

    return (
        <div className="min-h-screen bg-background p-4 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1 mb-2">
                            <ArrowLeft size={12} /> Volver al inicio
                        </Link>
                        <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2">
                            <FileText size={22} className="text-accent" /> Cotizaciones
                        </h1>
                        <p className="text-xs text-neutral-500">Validez 5 días desde envío. Auto-expiración cada 1h.</p>
                    </div>
                    <input
                        type="text"
                        placeholder="🔎 Buscar quote_id, cliente, teléfono..."
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 w-72 focus:outline-none focus:border-accent/40"
                    />
                </div>

                {/* Filtros por estado + agrupación */}
                <div className="flex gap-2 flex-wrap items-center">
                    {["ACTIVA", "ACEPTADA", "RECHAZADA", "ARCHIVADA", "EXPIRADA", "CERRADA", "TODAS"].map(e => (
                        <button
                            key={e}
                            onClick={() => setFiltroEstado(e)}
                            className={`text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-colors ${
                                filtroEstado === e
                                    ? "bg-accent text-accent-foreground border-accent"
                                    : "bg-neutral-900 text-neutral-400 border-white/10 hover:bg-neutral-800"
                            }`}
                        >
                            {e === "TODAS" ? "TODAS" : (ESTADO_LABEL[e] || e)}
                        </button>
                    ))}
                    <button
                        onClick={() => setAgrupar(v => !v)}
                        className={`ml-auto text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-colors ${
                            agrupar ? "bg-accent/15 text-accent border-accent/40" : "bg-neutral-900 text-neutral-400 border-white/10 hover:bg-neutral-800"
                        }`}
                        title="Agrupar las cotizaciones por cliente"
                    >
                        👥 Agrupar por cliente
                    </button>
                </div>

                {/* Tabla */}
                <div className="glass rounded-xl border border-white/5 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-white/5 text-[10px] uppercase tracking-wider text-neutral-500">
                                <tr>
                                    <th className="text-left px-4 py-3">Quote ID</th>
                                    <th className="text-left px-4 py-3">Cliente</th>
                                    <th className="text-left px-4 py-3">Sucursal / Vendedor</th>
                                    <th className="text-right px-4 py-3">Total</th>
                                    <th className="text-center px-4 py-3">Items</th>
                                    <th className="text-center px-4 py-3">Estado</th>
                                    <th className="text-center px-4 py-3">Válida</th>
                                    <th className="text-left px-4 py-3">Enviada</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={8} className="text-center py-8 text-neutral-500 text-xs">Cargando...</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={8} className="text-center py-8 text-neutral-500 text-xs">Sin cotizaciones</td></tr>
                                ) : filtered.map((c, idx) => {
                                    const itemsCount = (c.repuestos?.length || 0) + (c.vehiculos || []).reduce((acc, v) => acc + (v?.repuestos_solicitados?.length || 0), 0);
                                    const nuevoCliente = agrupar && (idx === 0 || filtered[idx - 1].phone !== c.phone);
                                    return (
                                      <Fragment key={c.quote_id}>
                                        {nuevoCliente && (
                                            <tr className="bg-white/[0.04]">
                                                <td colSpan={8} className="px-4 py-1.5 text-[11px] font-bold text-neutral-300">
                                                    <User size={10} className="inline mr-1.5 text-accent" />
                                                    {c.nombre_cliente || <span className="text-neutral-500 italic">Sin nombre</span>}
                                                    <span className="text-[10px] text-neutral-500 font-mono ml-2">+{c.phone}</span>
                                                </td>
                                            </tr>
                                        )}
                                        <tr
                                            onClick={() => setSelected(c)}
                                            className="border-t border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                                            <td className="px-4 py-3 font-mono text-xs text-accent flex items-center gap-1">
                                                <Hash size={11} />{c.quote_id}
                                                {c.tiene_encargo && <span title="Por encargo" className="text-yellow-400">📦</span>}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-neutral-200">
                                                <div>{c.nombre_cliente || <span className="text-neutral-600 italic">Sin nombre</span>}</div>
                                                <div className="text-[10px] text-neutral-500 font-mono">+{c.phone}</div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-neutral-400">
                                                {c.sucursal && <div className="flex items-center gap-1"><MapPin size={9} />{c.sucursal}</div>}
                                                {c.vendedor_nombre && <div className="flex items-center gap-1 text-[10px]"><User size={9} />{c.vendedor_nombre}</div>}
                                            </td>
                                            <td className="px-4 py-3 text-xs font-bold text-emerald-400 text-right">{formatMoney(c.total_aproximado)}</td>
                                            <td className="px-4 py-3 text-xs text-neutral-400 text-center">{itemsCount}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${ESTADO_STYLE[c.estado_cotizacion] || ESTADO_STYLE.EXPIRADA}`}>
                                                    {ESTADO_LABEL[c.estado_cotizacion] || c.estado_cotizacion}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-neutral-400 text-center">
                                                <span className="flex items-center gap-1 justify-center"><Clock size={10} />{diasRestantes(c.valida_hasta)}</span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-neutral-500"><Calendar size={9} className="inline mr-1" />{formatDate(c.enviada_en)}</td>
                                        </tr>
                                      </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal detalle */}
            {selected && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
                    <div className="bg-neutral-900 border border-white/10 rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
                                    <Hash size={18} className="text-accent" />{selected.quote_id}
                                </h2>
                                <p className="text-xs text-neutral-500 mt-0.5">
                                    {selected.nombre_cliente || "Sin nombre"} · +{selected.phone}
                                </p>
                            </div>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${ESTADO_STYLE[selected.estado_cotizacion] || ESTADO_STYLE.EXPIRADA}`}>
                                {ESTADO_LABEL[selected.estado_cotizacion] || selected.estado_cotizacion}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="bg-white/5 rounded-lg p-3">
                                <p className="text-[10px] uppercase text-neutral-500 font-bold mb-1">Total</p>
                                <p className="text-emerald-400 font-bold flex items-center gap-1"><DollarSign size={12} />{formatMoney(selected.total_aproximado)}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-3">
                                <p className="text-[10px] uppercase text-neutral-500 font-bold mb-1">Válida hasta</p>
                                <p className="text-neutral-200">{formatDate(selected.valida_hasta)} ({diasRestantes(selected.valida_hasta)})</p>
                            </div>
                            {selected.vendedor_nombre && (
                                <div className="bg-white/5 rounded-lg p-3">
                                    <p className="text-[10px] uppercase text-neutral-500 font-bold mb-1">Cotizó</p>
                                    <p className="text-neutral-200">{selected.vendedor_nombre}</p>
                                </div>
                            )}
                            {selected.sucursal && (
                                <div className="bg-white/5 rounded-lg p-3">
                                    <p className="text-[10px] uppercase text-neutral-500 font-bold mb-1">Sucursal</p>
                                    <p className="text-neutral-200">{selected.sucursal}</p>
                                </div>
                            )}
                            {selected.tiene_encargo && (
                                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 col-span-2">
                                    <p className="text-[10px] uppercase text-yellow-400 font-bold mb-1">📦 Con encargo</p>
                                    {selected.abono_minimo && <p className="text-yellow-300 text-xs">Abono mínimo: {formatMoney(selected.abono_minimo)}</p>}
                                </div>
                            )}
                        </div>

                        {/* Items */}
                        <div className="space-y-2">
                            <p className="text-[10px] uppercase text-neutral-500 font-bold flex items-center gap-1"><Package size={11} />Repuestos cotizados</p>
                            <div className="space-y-1">
                                {(selected.repuestos || []).map((r, i) => (
                                    <div key={i} className="bg-white/5 rounded-lg p-2 text-xs flex justify-between items-center">
                                        <span className="text-neutral-200">{r.cantidad || 1}× {r.nombre}</span>
                                        <span className="text-emerald-400 font-bold">{r.precio ? formatMoney(r.precio) : "—"}</span>
                                    </div>
                                ))}
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                {(selected.vehiculos || []).flatMap((v: any, vi: number) => (v.repuestos_solicitados || []).map((r: any, ri: number) => (
                                    <div key={`${vi}-${ri}`} className="bg-white/5 rounded-lg p-2 text-xs flex justify-between items-center">
                                        <span className="text-neutral-200">{r.cantidad || 1}× {r.nombre} <span className="text-neutral-500">({v.marca_modelo})</span></span>
                                        <span className="text-emerald-400 font-bold">{r.precio ? formatMoney(r.precio) : "—"}</span>
                                    </div>
                                )))}
                            </div>
                        </div>

                        {/* Acciones */}
                        <div className="flex gap-2 pt-3 border-t border-white/5">
                            {selected.estado_cotizacion === "ACTIVA" && (
                                <>
                                    <button
                                        onClick={() => cambiarEstado(selected.quote_id, "ARCHIVADA")}
                                        className="flex-1 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <Archive size={12} />Archivar
                                    </button>
                                    <button
                                        onClick={() => cambiarEstado(selected.quote_id, "CERRADA")}
                                        className="flex-1 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <CheckCircle size={12} />Cerrar
                                    </button>
                                </>
                            )}
                            {selected.estado_cotizacion === "ARCHIVADA" && (
                                <button
                                    onClick={() => cambiarEstado(selected.quote_id, "ACTIVA")}
                                    className="flex-1 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 transition-colors"
                                >
                                    ♻️ Reactivar
                                </button>
                            )}
                            <button
                                onClick={() => setSelected(null)}
                                className="px-4 py-2 rounded-lg bg-neutral-800 text-neutral-400 text-xs font-bold hover:bg-neutral-700 transition-colors flex items-center gap-1.5"
                            >
                                <XCircle size={12} />Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
