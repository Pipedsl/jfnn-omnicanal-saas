"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Target, Zap, DollarSign, Clock, TrendingUp, ShoppingCart } from "lucide-react";

interface MetricsData {
    totalVendidoHoy: number;
    cantidadVentasHoy: number;
    ticketPromedioHoy: number;
    sesionesActivas: number;
    tiempoPromedioEsperaVendedorMins: number;
    tasaConversionHoy: number;
}

export default function DashboardMetrics() {
    const [metrics, setMetrics] = useState<MetricsData>({
        totalVendidoHoy: 0,
        cantidadVentasHoy: 0,
        ticketPromedioHoy: 0,
        sesionesActivas: 0,
        tiempoPromedioEsperaVendedorMins: 0,
        tasaConversionHoy: 0,
    });

    const formatMoney = (val: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(val);

    const fetchMetrics = async () => {
        try {
            const res = await axios.get(`http://localhost:4000/api/dashboard/metrics?t=${Date.now()}`);
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
    }, []);

    const stats = [
        { label: "Ventas Hoy", value: formatMoney(metrics.totalVendidoHoy), icon: <DollarSign className="text-green-500" size={16} />, trend: `${metrics.cantidadVentasHoy} confirmadas` },
        { label: "Conversión", value: `${metrics.tasaConversionHoy}%`, icon: <TrendingUp className="text-blue-500" size={16} />, trend: "Entregados / Totales" },
        { label: "Tiempo Esp. Prom.", value: `${metrics.tiempoPromedioEsperaVendedorMins} min`, icon: <Clock className="text-yellow-500" size={16} />, trend: "Bandeja espera" },
        { label: "Ticket Promedio", value: formatMoney(metrics.ticketPromedioHoy), icon: <ShoppingCart className="text-purple-500" size={16} />, trend: "Por venta hoy" },
        { label: "Sesiones Live", value: metrics.sesionesActivas.toString(), icon: <Target className="text-red-500" size={16} />, trend: "Conversando" },
        { label: "Ahorro IA", value: `${(metrics.sesionesActivas * 15 / 60).toFixed(1)} hrs`, icon: <Zap className="text-orange-500" size={16} />, trend: "Filtro automatizado" },
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
