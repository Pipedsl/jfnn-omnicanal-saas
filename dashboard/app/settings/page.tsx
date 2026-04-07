"use client";

import { useState, useEffect, useCallback } from "react";
import { Settings, Brain, Sparkles, ChevronLeft, Save, Loader2, X, Zap, BookOpen } from "lucide-react";
import Link from "next/link";
import axios from "axios";

const API = "http://localhost:4000/api/dashboard";

interface Regla {
    id: number;
    regla: string;
    categoria: string;
    fecha: string;
}

export default function SettingsPage() {
    const [rubro, setRubro] = useState("repuestos");
    const [seccion, setSeccion] = useState<"personalidad" | "entrenamiento">("personalidad");

    // HU-7: Entrenamiento
    const [historialTexto, setHistorialTexto] = useState("");
    const [entrenando, setEntrenando] = useState(false);
    const [reglas, setReglas] = useState<Regla[]>([]);
    const [cargandoReglas, setCargandoReglas] = useState(false);
    const [ultimasReglas, setUltimasReglas] = useState<{ regla: string; categoria: string }[]>([]);

    const rubros = [
        { id: "repuestos", name: "Repuestos Automotrices", icon: "🚗" },
        { id: "pizzeria", name: "Pizzería / Restaurant", icon: "🍕" },
        { id: "medicina", name: "Centro Médico / Salud", icon: "🏥" },
        { id: "inmobiliaria", name: "Bienes Raíces", icon: "🏠" },
    ];

    const fetchReglas = useCallback(async () => {
        setCargandoReglas(true);
        try {
            const res = await axios.get(`${API}/settings/knowledge`);
            setReglas(res.data.reglas || []);
        } catch {
            // silencioso si el backend aún no está disponible
        } finally {
            setCargandoReglas(false);
        }
    }, []);

    useEffect(() => {
        if (seccion === "entrenamiento") {
            fetchReglas();
        }
    }, [seccion, fetchReglas]);

    const handleEntrenar = async () => {
        if (!historialTexto.trim() || historialTexto.trim().length < 20) return;
        setEntrenando(true);
        setUltimasReglas([]);
        try {
            const res = await axios.post(`${API}/settings/train`, { texto: historialTexto });
            setUltimasReglas(res.data.reglas || []);
            setHistorialTexto("");
            await fetchReglas();
        } catch (err) {
            console.error("Error entrenando agente:", err);
        } finally {
            setEntrenando(false);
        }
    };

    const handleEliminarRegla = async (id: number) => {
        try {
            await axios.delete(`${API}/settings/knowledge/${id}`);
            setReglas(prev => prev.filter(r => r.id !== id));
        } catch (err) {
            console.error("Error eliminando regla:", err);
        }
    };

    const categoriaBadgeColor: Record<string, string> = {
        precio: "bg-green-500/10 text-green-400 border-green-500/20",
        tono: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        proceso: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        producto: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
        general: "bg-neutral-700/50 text-neutral-400 border-neutral-600",
    };

    return (
        <main className="min-h-screen pb-20">
            {/* Header */}
            <nav className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors">
                            <ChevronLeft size={20} />
                        </Link>
                        <div className="flex items-center gap-2">
                            <Settings size={20} className="text-accent" />
                            <h1 className="text-xl font-bold tracking-tight">Configuración del Agente</h1>
                        </div>
                    </div>

                    {seccion === "personalidad" && (
                        <button className="bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all active:scale-[0.98]">
                            <Save size={16} />
                            Guardar Cambios
                        </button>
                    )}
                </div>
            </nav>

            <div className="max-w-4xl mx-auto px-6 py-12">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Sidebar */}
                    <div className="space-y-2">
                        <button
                            onClick={() => setSeccion("personalidad")}
                            className={`w-full text-left px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-3 transition-colors ${seccion === "personalidad"
                                ? "bg-accent/10 border border-accent/20 text-accent"
                                : "hover:bg-white/5 text-neutral-500 border border-transparent"
                                }`}
                        >
                            <Brain size={18} />
                            Personalidad
                        </button>
                        <button
                            onClick={() => setSeccion("entrenamiento")}
                            className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${seccion === "entrenamiento"
                                ? "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
                                : "hover:bg-white/5 text-neutral-500 border border-transparent"
                                }`}
                        >
                            <Sparkles size={18} />
                            Entrenamiento IA
                            <span className="ml-auto text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-bold">BETA</span>
                        </button>
                    </div>

                    {/* Main Content */}
                    <div className="md:col-span-2 space-y-8">

                        {/* ── SECCIÓN PERSONALIDAD ── */}
                        {seccion === "personalidad" && (
                            <section className="glass p-8 rounded-3xl space-y-6">
                                <div>
                                    <h3 className="text-lg font-bold mb-1">Cerebro del Agente</h3>
                                    <p className="text-sm text-neutral-500">Define el rubro y comportamiento base de la IA.</p>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">Rubro del Negocio</label>
                                    <div className="grid grid-cols-1 gap-3">
                                        {rubros.map((item) => (
                                            <button
                                                key={item.id}
                                                onClick={() => setRubro(item.id)}
                                                className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${rubro === item.id
                                                    ? "bg-accent/5 border-accent text-accent shadow-[0_0_20px_rgba(59,130,246,0.1)]"
                                                    : "bg-neutral-900 border-neutral-800 text-neutral-400 opacity-60 hover:opacity-100"
                                                    }`}
                                            >
                                                <span className="text-2xl">{item.icon}</span>
                                                <span className="font-bold text-sm text-foreground">{item.name}</span>
                                                {rubro === item.id && <div className="ml-auto w-2 h-2 bg-accent rounded-full animate-pulse"></div>}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* ── SECCIÓN ENTRENAMIENTO HU-7 ── */}
                        {seccion === "entrenamiento" && (
                            <div className="space-y-6">
                                {/* Card de carga de historial */}
                                <section className="glass p-8 rounded-3xl space-y-6">
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 bg-yellow-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                                            <Zap size={20} className="text-yellow-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold mb-1">Entrenar al Agente IA</h3>
                                            <p className="text-sm text-neutral-500">
                                                Pega un historial de conversaciones de WhatsApp y Gemini extraerá reglas de negocio, precios y tono de venta de forma automática.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                                            Historial de Conversaciones
                                        </label>
                                        <textarea
                                            value={historialTexto}
                                            onChange={e => setHistorialTexto(e.target.value)}
                                            disabled={entrenando}
                                            placeholder={"Pega aquí el historial de WhatsApp...\n\nEjemplo:\n[15:30] Vendedor: Las bujías NGK para ese motor son $4.500 c/u\n[15:31] Cliente: perfecto, llevo las 4\n[15:31] Vendedor: Anotado, 4 bujías NGK = $18.000 total"}
                                            rows={10}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-sm text-neutral-300 placeholder-neutral-700 resize-none focus:outline-none focus:border-yellow-500/50 transition-colors font-mono disabled:opacity-50"
                                        />
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-neutral-600">
                                                {historialTexto.length > 0 ? `${historialTexto.length} caracteres` : "Mínimo 20 caracteres"}
                                            </span>
                                            <button
                                                onClick={handleEntrenar}
                                                disabled={entrenando || historialTexto.trim().length < 20}
                                                className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-neutral-800 disabled:text-neutral-600 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all active:scale-[0.98]"
                                            >
                                                {entrenando ? (
                                                    <>
                                                        <Loader2 size={16} className="animate-spin" />
                                                        Gemini analizando chat...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles size={16} />
                                                        Entrenar Agente
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Resultado del último entrenamiento */}
                                    {ultimasReglas.length > 0 && (
                                        <div className="pt-4 border-t border-white/5 space-y-3">
                                            <p className="text-xs font-bold uppercase tracking-widest text-green-400">
                                                ✅ {ultimasReglas.length} regla{ultimasReglas.length > 1 ? "s" : ""} aprendida{ultimasReglas.length > 1 ? "s" : ""}
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {ultimasReglas.map((r, i) => (
                                                    <span
                                                        key={i}
                                                        className={`text-xs px-3 py-1.5 rounded-full border font-medium ${categoriaBadgeColor[r.categoria] || categoriaBadgeColor.general}`}
                                                    >
                                                        {r.regla}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </section>

                                {/* Brain Review — Reglas activas */}
                                <section className="glass p-8 rounded-3xl space-y-5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <BookOpen size={18} className="text-yellow-400" />
                                            <div>
                                                <h3 className="text-base font-bold">Base de Conocimiento</h3>
                                                <p className="text-xs text-neutral-500">Reglas activas que el agente aplica en cada conversación.</p>
                                            </div>
                                        </div>
                                        {reglas.length > 0 && (
                                            <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2.5 py-1 rounded-full font-bold">
                                                {reglas.length} activa{reglas.length > 1 ? "s" : ""}
                                            </span>
                                        )}
                                    </div>

                                    {cargandoReglas ? (
                                        <div className="flex items-center gap-2 text-neutral-500 text-sm py-4">
                                            <Loader2 size={16} className="animate-spin" />
                                            Cargando reglas...
                                        </div>
                                    ) : reglas.length === 0 ? (
                                        <div className="py-8 text-center">
                                            <p className="text-sm text-neutral-600">Aún no hay reglas aprendidas.</p>
                                            <p className="text-xs text-neutral-700 mt-1">Entrena al agente con un historial de conversaciones para comenzar.</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {reglas.map((r) => (
                                                <div
                                                    key={r.id}
                                                    className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border font-medium group ${categoriaBadgeColor[r.categoria] || categoriaBadgeColor.general}`}
                                                >
                                                    <span className="max-w-[220px] truncate" title={r.regla}>{r.regla}</span>
                                                    <button
                                                        onClick={() => handleEliminarRegla(r.id)}
                                                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all ml-1 flex-shrink-0"
                                                        title="Eliminar regla"
                                                    >
                                                        <X size={11} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
