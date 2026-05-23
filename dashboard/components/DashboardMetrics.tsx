"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Target, Zap, DollarSign, Clock, TrendingUp, ShoppingCart } from "lucide-react";
import { BACKEND_URL } from "@/lib/api";

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
    });

    const formatMoney = (val: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(val);

    const formatTiempoAhorrado = (mins: number) => {
        if (mins < 60) return `${mins} min`;
        const horas = mins / 60;
        return `${horas.toFixed(1)} hrs`;
    };

    const fetchMetrics = async () => {
        try {
            const res = await api.get(`${BACKEND_URL}/api/dashboard/metrics?range=${range}&t=${Date.now()}`);
            setMetrics(res.data);
        } catch (error) {
            console.error("Error fetching metrics:", error);
        }
    };

    useEffect(() => {
        // fetchMetrics es async — el setState ocurre diferido, no sincrónico.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 15000); // 15s refresh
        return () => clearInterval(interval);
    }, [range]);

    const stats = [
        { label: `Ventas ${range === 'hoy' ? 'Hoy' : range === '7d' ? '7d' : range === '30d' ? '30d' : 'Total'}`, value: formatMoney(metrics.totalVendidoHoy), icon: <DollarSign className="text-green-500" size={16} />, trend: `${metrics.cantidadVentasHoy} confirmadas` },
        { label: `Conversión ${range === 'hoy' ? 'Hoy' : range === '7d' ? '7d' : range === '30d' ? '30d' : 'Total'}`, value: `${metrics.tasaConversionHoy}%`, icon: <TrendingUp className="text-blue-500" size={16} />, trend: "Entregados / Totales" },
        { label: "Tiempo Esp. Prom.", value: `${metrics.tiempoPromedioEsperaVendedorMins} min`, icon: <Clock className="text-yellow-500" size={16} />, trend: "Bandeja espera" },
        { label: "Ticket Promedio", value: formatMoney(metrics.ticketPromedioHoy), icon: <ShoppingCart className="text-purple-500" size={16} />, trend: "Por venta hoy" },
        { label: "Sesiones Live", value: metrics.sesionesActivas.toString(), icon: <Target className="text-red-500" size={16} />, trend: `${metrics.cantidadEsperandoVendedor || 0} esperan precio` },
        { label: `Ahorro IA ${range === 'hoy' ? 'Hoy' : range === '7d' ? '7d' : range === '30d' ? '30d' : 'Total'}`, value: formatTiempoAhorrado(metrics.tiempoAhorradoMin || 0), icon: <Zap className="text-orange-500" size={16} />, trend: `${metrics.mensajesIa || 0} msgs respondidos` },
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 pt-8">
            {stats.map((stat, i) => (
                <div key={i} className="glass p-4 rounded-2xl flex flex-col justify-between border-white/5 space-y-2">
                    <div className="flex items-center gap-2 text-neutral-500">
                        {stat.icon}
                        <span className="text-[9px] font-bold uppercase tracking-wider line-clamp-1">{stat.label}</span>
                    </div>
                    <div>
                        <p className="text-xl font-bold truncate">{stat.value}</p>
                        <span className="text-[10px] text-neutral-500 mt-1 block truncate">
                            {stat.trend}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
}
