"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Link from "next/link";
import {
    ArrowLeft,
    DollarSign,
    ShoppingCart,
    TrendingUp,
    Clock,
    Zap,
    MessageSquare,
    Users,
} from "lucide-react";
import { BACKEND_URL } from "@/lib/api";

type Range = "hoy" | "7d" | "30d" | "total";

interface MetricsData {
    range: Range;
    dineroRecaudado: number;
    cantidadVentas: number;
    ticketPromedio: number;
    tasaConversion: number;
    mensajesIa: number;
    mensajesVendedor: number;
    tiempoAhorradoMin: number;
    tiempoRespuestaSegConfig: number;
    tiempoPromedioCierreMin: number;
    sesionesActivas: number;
}

interface Venta {
    id: number;
    phone: string;
    quote_id: string | null;
    estado_final: string;
    marca_modelo: string | null;
    ano: string | null;
    total_cotizacion: number;
    mensajes_ia: number;
    mensajes_vendedor: number;
    duracion_min: number;
    archivado_en: string;
    vendedor_nombre: string | null;
    sucursal: string | null;
}

interface Vendedor {
    id: number;
    nombre: string;
    sucursal: string;
}

const RANGE_LABELS: Record<Range, string> = {
    hoy: "Hoy",
    "7d": "Últimos 7 días",
    "30d": "Últimos 30 días",
    total: "Histórico",
};

const formatMoney = (val: number) =>
    new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(val || 0);

const formatTiempo = (mins: number) => {
    if (!mins || mins < 1) return "0 min";
    if (mins < 60) return `${Math.round(mins)} min`;
    const horas = mins / 60;
    if (horas < 24) return `${horas.toFixed(1)} hrs`;
    return `${(horas / 24).toFixed(1)} días`;
};

export default function EstadisticasAdmin() {
    const [range, setRange] = useState<Range>("30d");
    const [metrics, setMetrics] = useState<MetricsData | null>(null);
    const [ventas, setVentas] = useState<Venta[]>([]);
    const [loading, setLoading] = useState(true);
    const [sucursalFilter, setSucursalFilter] = useState('');
    const [vendedorFilter, setVendedorFilter] = useState('');
    const [vendedores, setVendedores] = useState<Vendedor[]>([]);

    useEffect(() => {
        axios.get(`${BACKEND_URL}/api/dashboard/vendedores?incluir_inactivos=0&t=${Date.now()}`)
            .then(res => setVendedores(res.data.vendedores || []))
            .catch(err => console.error('Error cargando vendedores:', err));
    }, []);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ range, t: String(Date.now()) });
            if (sucursalFilter) params.set('sucursal', sucursalFilter);
            if (vendedorFilter) params.set('vendedor', vendedorFilter);
            const qs = params.toString();
            const [metricsRes, ventasRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/dashboard/metrics?${qs}`),
                axios.get(`${BACKEND_URL}/api/dashboard/ventas?${qs}&limit=20`),
            ]);
            setMetrics(metricsRes.data);
            setVentas(ventasRes.data.ventas || []);
        } catch (err) {
            console.error("Error cargando estadísticas:", err);
        } finally {
            setLoading(false);
        }
    }, [range, sucursalFilter, vendedorFilter]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const cards = metrics
        ? [
              {
                  label: "Dinero recaudado",
                  value: formatMoney(metrics.dineroRecaudado),
                  trend: `${metrics.cantidadVentas} ventas cerradas`,
                  icon: <DollarSign className="text-green-500" size={18} />,
              },
              {
                  label: "Ticket promedio",
                  value: formatMoney(metrics.ticketPromedio),
                  trend: "por venta",
                  icon: <ShoppingCart className="text-purple-500" size={18} />,
              },
              {
                  label: "Conversión",
                  value: `${metrics.tasaConversion}%`,
                  trend: "sesiones que cerraron",
                  icon: <TrendingUp className="text-blue-500" size={18} />,
              },
              {
                  label: "Tiempo promedio cierre",
                  value: formatTiempo(metrics.tiempoPromedioCierreMin),
                  trend: "primer mensaje → entrega",
                  icon: <Clock className="text-yellow-500" size={18} />,
              },
              {
                  label: "Mensajes IA",
                  value: metrics.mensajesIa.toLocaleString("es-CL"),
                  trend: `vs ${metrics.mensajesVendedor.toLocaleString("es-CL")} del vendedor`,
                  icon: <MessageSquare className="text-cyan-500" size={18} />,
              },
              {
                  label: "Tiempo ahorrado IA",
                  value: formatTiempo(metrics.tiempoAhorradoMin),
                  trend: `${metrics.tiempoRespuestaSegConfig}s estimados por mensaje`,
                  icon: <Zap className="text-orange-500" size={18} />,
              },
              {
                  label: "Sesiones activas ahora",
                  value: metrics.sesionesActivas.toLocaleString("es-CL"),
                  trend: "snapshot en vivo",
                  icon: <Users className="text-red-500" size={18} />,
              },
          ]
        : [];

    return (
        <main className="min-h-screen pb-20">
            <nav className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/"
                            className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors"
                            title="Volver"
                        >
                            <ArrowLeft size={18} />
                        </Link>
                        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-black italic text-white text-sm">
                            JF
                        </div>
                        <h1 className="text-xl font-bold tracking-tight">
                            Estadísticas <span className="text-neutral-500 font-medium">Admin</span>
                        </h1>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-6 pt-8">
                <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8">
                    <div>
                        <h2 className="text-3xl font-extrabold tracking-tight">Métricas del agente IA</h2>
                        <p className="text-neutral-500 mt-1">
                            Atribución real de ventas, dinero recaudado y tiempo ahorrado por el agente.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
                                    range === r
                                        ? "bg-accent border-accent text-white"
                                        : "bg-white/5 border-white/10 text-neutral-500 hover:border-white/20"
                                }`}
                            >
                                {RANGE_LABELS[r]}
                            </button>
                        ))}
                    </div>
                </header>

                {/* Filtros sucursal / vendedor */}
                <div className="flex items-center gap-6 pb-6">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Sucursal:</span>
                        <select
                            value={sucursalFilter}
                            onChange={(e) => { setSucursalFilter(e.target.value); setVendedorFilter(''); }}
                            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-neutral-300 focus:border-accent/30 focus:outline-none"
                        >
                            <option value="">Todas</option>
                            <option value="Melipilla">Melipilla</option>
                            <option value="San Felipe">San Felipe</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Vendedor:</span>
                        <select
                            value={vendedorFilter}
                            onChange={(e) => setVendedorFilter(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-neutral-300 focus:border-accent/30 focus:outline-none"
                        >
                            <option value="">Todos</option>
                            {vendedores
                                .filter(v => !sucursalFilter || v.sucursal === sucursalFilter)
                                .map(v => (
                                    <option key={v.id} value={v.nombre}>{v.nombre} ({v.sucursal})</option>
                                ))
                            }
                        </select>
                    </div>
                </div>

                {loading && !metrics ? (
                    <div className="flex flex-col items-center justify-center h-64 glass rounded-3xl animate-pulse">
                        <div className="w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin mb-4"></div>
                        <p className="text-neutral-500 font-medium">Cargando métricas...</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-10">
                            {cards.map((c, i) => (
                                <div
                                    key={i}
                                    className="glass p-5 rounded-2xl flex flex-col justify-between border-white/5 space-y-3"
                                >
                                    <div className="flex items-center gap-2 text-neutral-500">
                                        {c.icon}
                                        <span className="text-[10px] font-bold uppercase tracking-wider">
                                            {c.label}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold truncate">{c.value}</p>
                                        <span className="text-[11px] text-neutral-500 mt-1 block truncate">
                                            {c.trend}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <section>
                            <div className="flex items-center justify-between pb-4">
                                <h3 className="text-lg font-bold">
                                    Últimas ventas — atribución IA vs vendedor
                                </h3>
                                <span className="text-xs text-neutral-500">
                                    Mostrando {ventas.length} (rango: {RANGE_LABELS[range].toLowerCase()})
                                </span>
                            </div>

                            {ventas.length === 0 ? (
                                <div className="glass rounded-2xl border-dashed border-2 border-neutral-800 py-12 text-center text-neutral-500">
                                    No hay ventas cerradas en este rango.
                                </div>
                            ) : (
                                <div className="glass rounded-2xl overflow-hidden border border-white/5">
                                    <table className="w-full text-sm">
                                        <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-neutral-500">
                                            <tr>
                                                <th className="text-left px-4 py-3">Fecha</th>
                                                <th className="text-left px-4 py-3">Cliente</th>
                                                <th className="text-left px-4 py-3">Vehículo</th>
                                                <th className="text-left px-4 py-3">Sucursal</th>
                                                <th className="text-left px-4 py-3">Vendedor</th>
                                                <th className="text-right px-4 py-3">Monto</th>
                                                <th className="text-right px-4 py-3">Duración</th>
                                                <th className="text-right px-4 py-3">Msgs IA</th>
                                                <th className="text-right px-4 py-3">Msgs Vendedor</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ventas.map((v) => (
                                                <tr
                                                    key={v.id}
                                                    className="border-t border-white/5 hover:bg-white/[0.02]"
                                                >
                                                    <td className="px-4 py-3 text-neutral-400">
                                                        {new Date(v.archivado_en).toLocaleDateString("es-CL")}
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-neutral-300">
                                                        {v.phone}
                                                    </td>
                                                    <td className="px-4 py-3 text-neutral-400">
                                                        {v.marca_modelo || "—"}{" "}
                                                        {v.ano && (
                                                            <span className="text-neutral-600">{v.ano}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-neutral-400 text-xs">
                                                        {v.sucursal || "—"}
                                                    </td>
                                                    <td className="px-4 py-3 text-neutral-300 text-xs">
                                                        {v.vendedor_nombre || "—"}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-green-400">
                                                        {formatMoney(v.total_cotizacion)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-neutral-400">
                                                        {formatTiempo(v.duracion_min)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-cyan-400">
                                                        {v.mensajes_ia}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-purple-400">
                                                        {v.mensajes_vendedor}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
