"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Target, Zap, DollarSign, Clock, TrendingUp, ShoppingCart, UserPlus } from "lucide-react";
import { BACKEND_URL } from "@/lib/api";
import { safeGet } from "@/lib/storage";

interface Props {
    range?: 'hoy' | '7d' | '30d' | 'total';
}

interface MetricsData {
    totalVendidoHoy: number;
    cantidadVentasHoy: number;
    ticketPromedioHoy: number;
    sesionesActivas: number;
    tiempoPromedioEsperaVendedorMins: number;
    tasaConversionHoy: number;
    mensajesIa?: number;
    tiempoAhorradoMin?: number;
    cantidadEsperandoVendedor?: number;
    clientesNuevos?: number;
}

export default function DashboardMetrics({ range = '7d' }: Props) {
    const [metrics, setMetrics] = useState<MetricsData>({
        totalVendidoHoy: 0,
        cantidadVentasHoy: 0,
        ticketPromedioHoy: 0,
        sesionesActivas: 0,
        tiempoPromedioEsperaVendedorMins: 0,
        tasaConversionHoy: 0,
        mensajesIa: 0,
        tiempoAhorradoMin: 0,
        cantidadEsperandoVendedor: 0,
        clientesNuevos: 0
    });

    const formatMoney = (val: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(val);

    const formatTiempoAhorrado = (mins: number) => {
        if (mins < 60) return `${mins} min`;
        const hrs = Math.floor(mins / 60);
        const rest = mins % 60;
        return `${hrs}h ${rest}m`;
    };

    const fetchConversaciones = async () => {
        try {
            const params = new URLSearchParams();
            params.set("range", range);
            params.set("t", String(Date.now()));
            const res = await api.get(`${BACKEND_URL}/api/dashboard/metrics?${params.toString()}`);
            setMetrics(res.data);
        } catch (error) {
            console.error("Error fetching metrics:", error);
        }
    };

    useEffect(() => {
        fetchConversaciones();
        const interval = setInterval(fetchConversaciones, 15000); // 15s refresh
        return () => clearInterval(interval);
    }, [range]);

    const isSoporte = typeof window !== 'undefined' ? safeGet("jfnn_role") === "soporte" : false;

    const stats = [
        { label: `Ventas ${range === 'hoy' ? 'Hoy' : range === '7d' ? '7d' : range === '30d' ? '30d' : 'Total'}`, value: formatMoney(metrics.totalVendidoHoy), icon: <DollarSign size={15} />, trend: `${metrics.cantidadVentasHoy} confirmadas`, color: "green" },
        { label: "Conversión", value: `${metrics.tasaConversionHoy}%`, icon: <TrendingUp size={15} />, trend: "Entregados / Totales", color: "blue" },
        { label: "Tiempo Esp. Prom.", value: `${metrics.tiempoPromedioEsperaVendedorMins} min`, icon: <Clock size={15} />, trend: "Bandeja espera", color: "yellow" },
        { label: "Ticket Promedio", value: formatMoney(metrics.ticketPromedioHoy), icon: <ShoppingCart size={15} />, trend: "Por venta hoy", color: "purple" },
        { label: "Sesiones Live", value: metrics.sesionesActivas.toString(), icon: <Target size={15} />, trend: `${metrics.cantidadEsperandoVendedor || 0} esperan precio`, color: "red" },
        { label: "Ahorro IA", value: formatTiempoAhorrado(metrics.tiempoAhorradoMin || 0), icon: <Zap size={15} />, trend: `${metrics.mensajesIa || 0} msgs respondidos`, color: "orange" },
    ];

    if (isSoporte) {
        stats.push({
            label: "Clientes Nuevos",
            value: (metrics.clientesNuevos || 0).toString(),
            icon: <UserPlus size={15} />,
            trend: "Registrados en rango",
            color: "cyan"
        });
    }

    const colorMap: Record<string, { bg: string, text: string, border: string }> = {
        green: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
        blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
        yellow: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/20" },
        purple: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
        red: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
        orange: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
        cyan: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" }
    };

    return (
        <div className={`grid grid-cols-2 md:grid-cols-3 ${isSoporte ? 'lg:grid-cols-7' : 'lg:grid-cols-6'} gap-4 pt-8`}>
            {stats.map((stat, i) => {
                const colors = colorMap[stat.color] || colorMap.green;
                return (
                    <div key={i} className="relative group bg-neutral-900/25 hover:bg-neutral-900/50 border border-white/[0.05] hover:border-white/10 rounded-2xl p-4 flex flex-col justify-between transition-all duration-300 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
                        <div className="flex items-center gap-2 mb-3">
                            <div className={`w-7 h-7 rounded-lg ${colors.bg} ${colors.text} border ${colors.border} flex items-center justify-center flex-shrink-0 shadow-sm transition-all group-hover:scale-105`}>
                                {stat.icon}
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-neutral-400 line-clamp-1">{stat.label}</span>
                        </div>
                        <div>
                            <p className="text-2xl font-extrabold tracking-tight text-white truncate">{stat.value}</p>
                            <span className="text-[10px] text-neutral-500 mt-1 block truncate font-medium">
                                {stat.trend}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
