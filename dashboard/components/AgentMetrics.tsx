"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Target, Zap, TrendingUp, MessageSquare, Users } from "lucide-react";
import { BACKEND_URL } from "@/lib/api";

interface MetricsData {
    total_sesiones: number;
    conversion_rate: number;
    eficiencia_ia: number;
    funnel: Record<string, number>;
    mensajes: {
        ia: number;
        vendedor: number;
        total: number;
    };
}

export default function AgentMetrics() {
    const [metrics, setMetrics] = useState<MetricsData | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchMetrics = async () => {
        try {
            const res = await axios.get(`${BACKEND_URL}/api/dashboard/metrics/agent?t=${Date.now()}`);
            if (res.data.success) {
                setMetrics(res.data.metrics);
            }
            setLoading(false);
        } catch (error) {
            console.error("Error fetching agent metrics:", error);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 30000); // Refresh cada 30s
        return () => clearInterval(interval);
    }, []);

    if (loading || !metrics) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="glass p-4 rounded-2xl animate-pulse h-24 border-white/5"></div>
                ))}
            </div>
        );
    }

    const stats = [
        { 
            label: "Total Sesiones", 
            value: metrics.total_sesiones.toString(), 
            icon: <Users className="text-blue-500" size={16} />, 
            trend: "Conversaciones totales" 
        },
        { 
            label: "Conversión", 
            value: `${metrics.conversion_rate}%`, 
            icon: <TrendingUp className="text-green-500" size={16} />, 
            trend: "Éxito (Abono/Entregado)" 
        },
        { 
            label: "Eficiencia IA", 
            value: `${metrics.eficiencia_ia}%`, 
            icon: <Zap className="text-orange-500" size={16} />, 
            trend: "Mensajes respondidos por IA" 
        },
        { 
            label: "Msgs IA", 
            value: metrics.mensajes.ia.toString(), 
            icon: <MessageSquare className="text-purple-500" size={16} />, 
            trend: `De un total de ${metrics.mensajes.total}` 
        },
        { 
            label: "Msgs Vendedor", 
            value: metrics.mensajes.vendedor.toString(), 
            icon: <MessageSquare className="text-red-500" size={16} />, 
            trend: "Atención manual" 
        },
    ];

    return (
        <div className="space-y-4 pt-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">Métricas del Agente (Conversión y Eficiencia)</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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

            {/* Mini Funnel Section */}
            <div className="glass p-4 rounded-2xl border-white/5">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-3">Estado del Embudo (Sesiones Activas)</h3>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {Object.entries(metrics.funnel).map(([estado, count]) => (
                        <div key={estado} className="bg-white/5 p-2 rounded-lg text-center">
                            <p className="text-xs font-bold text-neutral-300">{count}</p>
                            <p className="text-[8px] uppercase tracking-wider text-neutral-600 mt-1 truncate">{estado}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
