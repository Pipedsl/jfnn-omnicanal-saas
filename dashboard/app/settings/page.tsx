"use client";

import { useState } from "react";
import { Settings, Brain, Sparkles, ChevronLeft, Save } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
    const [rubro, setRubro] = useState("repuestos");

    const rubros = [
        { id: "repuestos", name: "Repuestos Automotrices", icon: "🚗" },
        { id: "pizzeria", name: "Pizzería / Restaurant", icon: "🍕" },
        { id: "medicina", name: "Centro Médico / Salud", icon: "🏥" },
        { id: "inmobiliaria", name: "Bienes Raíces", icon: "🏠" },
    ];

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

                    <button className="bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all active:scale-[0.98]">
                        <Save size={16} />
                        Guardar Cambios
                    </button>
                </div>
            </nav>

            <div className="max-w-4xl mx-auto px-6 py-12">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Sidebar Config */}
                    <div className="space-y-2">
                        <button className="w-full text-left px-4 py-2 bg-accent/10 border border-accent/20 text-accent rounded-lg text-sm font-bold flex items-center gap-3">
                            <Brain size={18} />
                            Personalidad
                        </button>
                        <button className="w-full text-left px-4 py-2 hover:bg-white/5 text-neutral-500 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors">
                            <Sparkles size={18} />
                            Entrenamiento (Beta)
                        </button>
                    </div>

                    {/* Main Form */}
                    <div className="md:col-span-2 space-y-8">
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

                            <div className="pt-6 border-t border-white/5">
                                <div className="flex items-center gap-2 text-yellow-400 mb-4">
                                    <Sparkles size={16} />
                                    <span className="text-xs font-bold uppercase tracking-widest">IA Training Cloud</span>
                                </div>
                                <div className="p-12 border-2 border-dashed border-neutral-800 rounded-2xl flex flex-col items-center justify-center text-center space-y-3">
                                    <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center text-neutral-400 italic font-black text-xs">PDF</div>
                                    <p className="text-sm font-medium text-neutral-500">Arrastra archivos aquí para entrenar la memoria del Agente.</p>
                                    <p className="text-[10px] text-neutral-700">Compatible con Catálogos, PDF y listas de precio CSV.</p>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </main>
    );
}
