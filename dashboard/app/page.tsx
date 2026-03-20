"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { LayoutDashboard, RefreshCcw, Bell, Settings, Target, Zap, DollarSign, ShieldCheck } from "lucide-react";
import QuoteCard from "@/components/QuoteCard";
import Link from "next/link";

interface Quote {
  id: string;
  phone: string;
  estado: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entidades?: any; // Aceptamos any para el JSON dinámico
}

export default function Home() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("pendientes"); // "pendientes" | "historial"
  const [filter, setFilter] = useState("todos");
  const [isSyncing, setIsSyncing] = useState(false);
  // useRef para capturar el `view` y `fetchQuotesAndMetrics` actual sin closures stale
  const viewRef = useRef("pendientes");
  const fetchRef = useRef<(source?: string) => Promise<void>>(null!);

  // Estado para Métrica
  const [metrics, setMetrics] = useState({
    cotizacionesHoy: 0,
    conversionRate: 0,
    ahorroHoras: 0
  });

  const fetchPendientes = async (source: string = "unknown") => {
    console.log(`[Fetch] Cotizaciones activas. Origen: ${source} a las ${new Date().toLocaleTimeString()}`);
    try {
      setLoading(true);
      const resPend = await axios.get(`http://localhost:4000/api/dashboard/cotizaciones?t=${Date.now()}`);
      const pend: Quote[] = resPend.data || [];

      if (viewRef.current === "pendientes") setQuotes(pend);

      const minutosAhorrados = pend.length * 15;
      setMetrics(prev => ({
        ...prev,
        cotizacionesHoy: pend.length,
        ahorroHoras: parseFloat((minutosAhorrados / 60).toFixed(1))
      }));
    } catch (error) {
      console.error("Error fetching cotizaciones:", error);
    } finally {
      setLoading(false);
      setIsSyncing(true);
      setTimeout(() => setIsSyncing(false), 2000);
    }
  };

  const fetchHistorial = async () => {
    console.log(`[Fetch] Historial bajo demanda a las ${new Date().toLocaleTimeString()}`);
    try {
      setLoading(true);
      const resHist = await axios.get(`http://localhost:4000/api/dashboard/cotizaciones/historial?t=${Date.now()}`);
      const hist: Quote[] = resHist.data || [];

      setQuotes(hist);

      const ventasCerradas = hist.filter((q: Quote) => q.estado === "ENTREGADO" || q.estado === "ARCHIVADO").length;
      const totalSesiones = metrics.cotizacionesHoy + hist.length;
      const tasaConversion = totalSesiones > 0 ? Math.round((ventasCerradas / totalSesiones) * 100) : 0;
      setMetrics(prev => ({ ...prev, conversionRate: tasaConversion }));
    } catch (error) {
      console.error("Error fetching historial:", error);
    } finally {
      setLoading(false);
    }
  };

  // Función unificada para compatibilidad con el ref de polling
  const fetchQuotesAndMetrics = async (source: string = "unknown") => {
    if (viewRef.current === "pendientes") {
      await fetchPendientes(source);
    }
    // El historial NO se recarga automáticamente, solo bajo demanda
  };


  // Mantener la ref siempre sincronizada con la función actual
  useEffect(() => {
    fetchRef.current = fetchQuotesAndMetrics;
  });

  useEffect(() => {
    viewRef.current = view; // Sync ref
    if (view === "pendientes") {
      fetchPendientes("useEffect[view=pendientes]");
    } else if (view === "historial") {
      fetchHistorial(); // Solo se llama cuando el usuario cambia a historial
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Polling cada 10s (sin Supabase Realtime)
  useEffect(() => {
    fetchPendientes("Initial_Load");
    const interval = setInterval(() => {
      if (viewRef.current === "pendientes") {
        fetchRef.current("Polling_10s");
      }
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = [
    { label: "Cotizaciones Activas", value: metrics.cotizacionesHoy.toString(), icon: <Target className="text-blue-500" size={16} />, trend: "Live" },
    { label: "Ahorro de Tiempo IA", value: `${metrics.ahorroHoras} hrs`, icon: <Zap className="text-yellow-500" size={16} />, trend: "Automatizado" },
    { label: "Tasa Conversión", value: `${metrics.conversionRate}%`, icon: <DollarSign className="text-green-500" size={16} />, trend: "Ventas / Total" },
  ];

  return (
    <main className="min-h-screen pb-20">
      {/* Header / Nav */}
      <nav className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-black italic text-white text-sm">JF</div>
            <h1 className="text-xl font-bold tracking-tight">JFNN <span className="text-neutral-500 font-medium">Omnicanal</span></h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Indicador de Actividad del Socket */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300 ${isSyncing ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
              <div className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-green-500 animate-pulse' : 'bg-neutral-600'}`}></div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isSyncing ? 'text-green-500' : 'text-neutral-500'}`}>
                {isSyncing ? 'Sincronizando' : 'Socket OK'}
              </span>
            </div>

            <button
              onClick={() => view === 'historial' ? fetchHistorial() : fetchPendientes("Boton_Actualizar_Manual")}
              className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors"
              title="Actualizar"
            >
              <RefreshCcw size={18} className={loading ? "animate-spin" : ""} />
            </button>
            <Link href="/verificacion" className="p-2 hover:bg-yellow-500/20 rounded-lg text-yellow-500 transition-colors" title="Verificación de Pagos">
              <ShieldCheck size={18} />
            </Link>
            <Link href="/settings" className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors" title="Ajustes">
              <Settings size={18} />
            </Link>
            <div className="relative p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 cursor-pointer">
              <Bell size={18} />
              {quotes.length > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-background"></span>
              )}
            </div>
            <div className="h-8 w-[1px] bg-white/10 mx-2"></div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold">Admin JFNN</p>
                <p className="text-[10px] text-neutral-500">Vendedor Senior</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-accent to-blue-300"></div>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6">
        {/* KPI Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-8">
          {stats.map((stat, i) => (
            <div key={i} className="glass p-5 rounded-2xl flex items-center justify-between border-white/5">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-neutral-500">
                  {stat.icon}
                  <span className="text-[10px] font-bold uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
              <span className="bg-green-500/10 text-green-500 text-[10px] font-black px-2 py-1 rounded-full border border-green-500/20">
                {stat.trend}
              </span>
            </div>
          ))}
        </div>

        {/* Hero Section */}
        <header className="py-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <button
                  onClick={() => setView('pendientes')}
                  className={`text-3xl font-extrabold tracking-tight transition-all ${view === 'pendientes' ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'}`}
                >
                  Bandeja de Entrada
                </button>
                <span className="text-3xl font-extrabold text-neutral-800">/</span>
                <button
                  onClick={() => setView('historial')}
                  className={`text-3xl font-extrabold tracking-tight transition-all ${view === 'historial' ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'}`}
                >
                  Historial
                </button>
              </div>
              <p className="text-neutral-500">
                {view === 'pendientes' ? 'Solicitudes activas y cierres automáticos.' : 'Registro de ventas finalizadas y entregadas.'}
              </p>
            </div>

            <div className={`glass px-6 py-2 rounded-xl flex items-center gap-3 transition-all ${view === 'pendientes' ? 'opacity-100' : 'opacity-50'}`}>
              <div className={`w-2 h-2 rounded-full animate-pulse ${view === 'pendientes' ? 'bg-green-500' : 'bg-neutral-500'}`}></div>
              <span className="text-sm font-bold text-neutral-300">
                {view === 'pendientes' ? `Live: ${quotes.length} alertas` : `${quotes.length} registros`}
              </span>
            </div>
          </div>
        </header>

        {/* Filters */}
        <div className="flex items-center gap-2 pb-6 overflow-x-auto no-scrollbar">
          {view === 'pendientes' && [
            { id: 'todos', label: 'Todos' },
            { id: 'ESPERANDO_VENDEDOR', label: 'Esperando Precios' },
            { id: 'CONFIRMANDO_COMPRA', label: 'Cierres' },
            { id: 'CICLO_COMPLETO', label: 'Por Validar Pago' },
            { id: 'PAGO_VERIFICADO', label: 'Pagados' }
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${filter === f.id
                ? 'bg-accent border-accent text-white'
                : 'bg-white/5 border-white/10 text-neutral-500 hover:border-white/20'
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Grid */}
        <section>
          {loading && quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 glass rounded-3xl animate-pulse">
              <div className="w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin mb-4"></div>
              <p className="text-neutral-500 font-medium">Sincronizando...</p>
            </div>
          ) : quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 glass rounded-3xl border-dashed border-2 border-neutral-800">
              <LayoutDashboard size={48} className="text-neutral-800 mb-4" />
              <p className="text-neutral-500 font-medium">No hay registros en esta sección.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {quotes
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((q: any) => filter === 'todos' || q.estado === filter)
                .map((quote: any) => (
                  <QuoteCard
                    key={quote.id || quote.phone}
                    phone={quote.phone}
                    estado={quote.estado}
                    entidades={quote.entidades}
                    onResponded={() => fetchQuotesAndMetrics("onResponded_QuoteCard")}
                  />
                ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
