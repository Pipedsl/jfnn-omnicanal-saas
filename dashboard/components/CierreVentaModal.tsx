"use client";

import { CheckCircle2, AlertTriangle, UserCircle2 } from "lucide-react";

interface CierreVentaModalProps {
    vendedorCotizo: string | null;
    onClose: () => void;
}

export default function CierreVentaModal({ vendedorCotizo, onClose }: CierreVentaModalProps) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-neutral-900 border border-emerald-500/30 rounded-2xl shadow-2xl max-w-md w-[92%] p-6 space-y-5">
                <div className="flex items-center gap-3">
                    <CheckCircle2 size={32} className="text-emerald-400 flex-shrink-0" />
                    <div>
                        <h2 className="text-lg font-bold text-neutral-100">Venta cerrada</h2>
                        <p className="text-xs text-neutral-500">El cliente fue notificado automáticamente.</p>
                    </div>
                </div>

                {/* Recordatorio Layla — destacado */}
                <div className="bg-amber-500/10 border-2 border-amber-500/50 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={22} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-sm font-bold text-amber-300 leading-snug">
                            Recuerda asignar el centro de costos a <span className="text-amber-200 underline">Web</span> para esta compra en <span className="text-amber-200 underline">Layla</span>.
                        </p>
                    </div>
                </div>

                {/* Atribución */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-3">
                    <UserCircle2 size={20} className="text-accent flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Cotización realizada por</p>
                        <p className="text-sm font-bold text-neutral-100">
                            {vendedorCotizo || <span className="text-neutral-500 italic">Sin atribución registrada</span>}
                        </p>
                    </div>
                </div>

                <button
                    onClick={onClose}
                    className="w-full py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 font-bold text-sm transition-colors"
                >
                    Entendido
                </button>
            </div>
        </div>
    );
}
