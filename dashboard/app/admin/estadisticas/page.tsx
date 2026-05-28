"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
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
        api.get(`${BACKEND_URL}/api/dashboard/vendedores?incluir_inactivos=0&t=${Date.now()}`)
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
                api.get(`${BACKEND_URL}/api/dashboard/metrics?${qs}`),
                api.get(`${BACKEND_URL}/api/dashboard/ventas?${qs}&limit=20`),
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

                {/* Campaña HSM masiva */}
                <CampaignSection />

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

interface CampaignResult {
    total: number;
    enviados: number;
    errores: number;
    detalle?: { phone: string; nombre?: string | null; status: string; error?: string }[];
}

function CampaignSection() {
    const [plantilla, setPlantilla] = useState('actualizacion_numero_whatsapp');
    const [sucursal, setSucursal] = useState('Melipilla');
    const [limit, setLimit] = useState('100');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<CampaignResult | null>(null);

    const enviar = async () => {
        const max = parseInt(limit, 10) || 0;
        if (max <= 0 || max > 5000) {
            alert('Límite debe estar entre 1 y 5000');
            return;
        }
        const ok = confirm(
            `Vas a enviar la plantilla "${plantilla}" a hasta ${max} clientes` +
            (sucursal ? ` de ${sucursal}` : '') +
            `.\n\nMeta cobra por cada mensaje. ¿Confirmar envío?`
        );
        if (!ok) return;

        setSending(true);
        setResult(null);
        try {
            const res = await api.post(`${BACKEND_URL}/api/dashboard/campaign/hsm-masivo`, {
                plantilla_id: plantilla,
                sucursal: sucursal || undefined,
                limit: max
            }, { timeout: 300000 }); // 5 min — el envío masivo con throttle puede tardar
            setResult(res.data);
        } catch (err) {
            const e = err as { response?: { data?: { error?: string } } };
            alert('Error: ' + (e.response?.data?.error || 'desconocido'));
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="mb-6 p-5 rounded-2xl bg-purple-500/5 border border-purple-500/20">
            <div className="flex items-center gap-2 mb-3">
                <span className="text-purple-300 font-bold text-sm">📢 Campaña HSM masiva</span>
                <span className="text-[10px] text-neutral-500">Reactiva contactos cacheados tras cambio de número</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Plantilla</label>
                    <select
                        value={plantilla}
                        onChange={(e) => setPlantilla(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-neutral-300 focus:border-purple-500/50 focus:outline-none"
                    >
                        <option value="actualizacion_numero_whatsapp">actualizacion_numero (cambio de número)</option>
                        <option value="retomar_cotizacion">retomar_cotizacion</option>
                        <option value="seguimiento_postventa">seguimiento_postventa</option>
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Sucursal</label>
                    <select
                        value={sucursal}
                        onChange={(e) => setSucursal(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-neutral-300 focus:border-purple-500/50 focus:outline-none"
                    >
                        <option value="Melipilla">Melipilla</option>
                        <option value="San Felipe">San Felipe</option>
                        <option value="">Todas</option>
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Límite (max 5000)</label>
                    <input
                        type="number"
                        min="1"
                        max="5000"
                        value={limit}
                        onChange={(e) => setLimit(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-neutral-300 focus:border-purple-500/50 focus:outline-none"
                    />
                </div>
                <div className="flex items-end">
                    <button
                        onClick={enviar}
                        disabled={sending}
                        className="w-full py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                    >
                        {sending ? '⏳ Enviando...' : '🚀 Enviar campaña'}
                    </button>
                </div>
            </div>
            {result && (
                <div className={`text-xs p-3 rounded-lg ${result.errores > 0 ? 'bg-yellow-500/10 text-yellow-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                    ✅ {result.enviados} enviados | ❌ {result.errores} errores | Total: {result.total}
                </div>
            )}
        </div>
    );
}
