"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { ArrowLeft, CheckCircle, XCircle, FileSearch, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface PendingApproval {
    phone: string;
    estado: string;
    ultimo_mensaje: string;
    quote_id: string | null;
    vehiculo: {
        marca_modelo: string;
        ano: string;
        patente: string;
        vin: string;
        motor: string | null;
        combustible: string | null;
    };
    repuestos: Record<string, unknown>[];
    total_cotizacion: number | null;
    metodo_entrega: string | null;
    horario_entrega: string | null;
    direccion_envio: string | null;
    tipo_documento: string | null;
    comprobante_url: string | null;
    pago_pendiente: {
        monto: string | null;
        banco_origen: string | null;
        fecha_transaccion: string | null;
        id_transaccion: string | null;
        rut_origen: string | null;
        nombre_origen: string | null;
        datos_extraidos_por_ia: boolean;
    } | null;
}

export default function VerificacionPage() {
    const [approvals, setApprovals] = useState<PendingApproval[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<PendingApproval | null>(null);
    const [processing, setProcessing] = useState(false);
    const [rejectReason, setRejectReason] = useState("");

    const fetchApprovals = async (source: string = "unknown") => {
        console.log(`[Fetch Trigger Verificacion] Origen: ${source} a las ${new Date().toLocaleTimeString()}`);
        try {
            setLoading(true);
            const res = await axios.get("http://localhost:4000/api/dashboard/pending-approvals");
            setApprovals(res.data.aprobaciones_pendientes || []);
        } catch (error) {
            console.error("Error fetching approvals:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchApprovals("useEffect[]_mount");

        const channel = supabase
            .channel('verificacion-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'user_sessions' },
                (payload) => fetchApprovals(`realtime_user_sessions: ${payload.eventType}`)
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const handleAction = async (accion: "approve" | "reject") => {
        if (!selected) return;
        if (accion === "reject" && !rejectReason.trim()) {
            alert("Por favor ingresa un motivo de rechazo.");
            return;
        }

        try {
            setProcessing(true);
            await axios.post("http://localhost:4000/api/dashboard/verify-payment", {
                phone: selected.phone,
                accion,
                nota_admin: accion === "reject" ? rejectReason : undefined,
            });
            setSelected(null);
            setRejectReason("");
            fetchApprovals("handleAction_post");
        } catch (error) {
            console.error("Error processing payment:", error);
            alert("Hubo un error al procesar el pago.");
        } finally {
            setProcessing(false);
        }
    };

    const formatCurrency = (val: number | string | null) => {
        if (!val) return "No detectado";
        const num = typeof val === "string" ? parseInt(val.replace(/[^\d]/g, ""), 10) : val;
        if (isNaN(num)) return String(val);
        return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(num);
    };

    return (
        <main className="min-h-screen pb-20 bg-background text-foreground">
            {/* Header */}
            <nav className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors">
                            <ArrowLeft size={20} />
                        </Link>
                        <h1 className="text-xl font-bold tracking-tight">Verificación de Pagos</h1>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-6 pt-8">
                <div className="flex items-center gap-3 mb-8">
                    <ShieldCheck className="text-yellow-500" size={28} />
                    <h2 className="text-2xl font-black tracking-tight">Comprobantes en Revisión</h2>
                    <span className="ml-4 bg-accent/20 text-accent px-3 py-1 rounded-full text-sm font-bold border border-accent/30">
                        {approvals.length} pendientes
                    </span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-64 glass rounded-3xl animate-pulse">
                        <p className="text-neutral-500 font-medium">Cargando comprobantes...</p>
                    </div>
                ) : approvals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 glass rounded-3xl border-dashed border-2 border-neutral-800">
                        <FileSearch size={48} className="text-neutral-800 mb-4" />
                        <p className="text-neutral-500 font-medium">No hay comprobantes pendientes de verificación.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {approvals.map((item) => (
                            <div
                                key={item.phone}
                                onClick={() => setSelected(item)}
                                className="glass p-5 rounded-2xl border border-white/10 hover:border-accent/50 transition-colors cursor-pointer flex justify-between items-center group"
                            >
                                <div>
                                    <p className="text-xs text-neutral-500 mb-1">Cotización: {item.quote_id || "N/A"}</p>
                                    <p className="text-lg font-bold">{item.phone}</p>
                                    <p className="text-sm text-neutral-400 mt-1">Total: {formatCurrency(item.total_cotizacion)}</p>
                                </div>
                                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                                    <ArrowLeft size={20} className="text-accent rotate-180" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal / Sidepanel de Detalle */}
            {selected && (
                <div className="fixed inset-0 z-[100] flex">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelected(null)}></div>
                    <div className="relative w-full max-w-2xl ml-auto bg-neutral-900 h-full shadow-2xl overflow-y-auto border-l border-white/10 p-8">
                        <button
                            onClick={() => setSelected(null)}
                            className="absolute top-6 right-6 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <h3 className="text-2xl font-black mb-6">Verificar Comprobante</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
                            {/* Imagen del comprobante */}
                            <div>
                                <p className="text-sm font-bold text-neutral-400 mb-3 uppercase tracking-wide">Comprobante Adjunto</p>
                                <div className="bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden aspect-[3/4] flex items-center justify-center relative">
                                    {selected.comprobante_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={selected.comprobante_url}
                                            alt="Comprobante"
                                            className="w-full h-full object-contain"
                                        />
                                    ) : (
                                        <span className="text-neutral-600">No hay imagen URL</span>
                                    )}
                                </div>
                            </div>

                            {/* Comparativa y Acciones */}
                            <div className="flex flex-col">
                                <p className="text-sm font-bold text-neutral-400 mb-3 uppercase tracking-wide">Análisis IA vs Sistema</p>

                                <div className="glass p-5 rounded-2xl space-y-4 flex-1">
                                    <div className="flex justify-between items-center pb-4 border-b border-white/5">
                                        <span className="text-neutral-400">Total Cotización</span>
                                        <span className="text-xl font-bold">{formatCurrency(selected.total_cotizacion)}</span>
                                    </div>

                                    <div className="flex justify-between items-center pb-4 border-b border-white/5">
                                        <span className="text-neutral-400">Monto IA <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded ml-1">Extraído</span></span>
                                        <span className="text-xl font-bold text-yellow-500">
                                            {formatCurrency(selected.pago_pendiente?.monto || null)}
                                        </span>
                                    </div>

                                    <div className="space-y-2 pt-2">
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">RUT Emisor</span>
                                            <span className="text-xs font-medium">{selected.pago_pendiente?.rut_origen || "No detectado"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">Banco</span>
                                            <span className="text-xs font-medium">{selected.pago_pendiente?.banco_origen || "No detectado"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">ID Transacción</span>
                                            <span className="text-xs font-medium">{selected.pago_pendiente?.id_transaccion || "No detectado"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">Nombre</span>
                                            <span className="text-xs font-medium">{selected.pago_pendiente?.nombre_origen || "No detectado"}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-2 pt-2 mt-4 border-t border-white/5">
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">Logística</span>
                                            <span className="text-xs font-medium">{selected.metodo_entrega?.toUpperCase() || "N/A"} - {selected.horario_entrega || "A coordinar"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">Vehículo</span>
                                            <span className="text-xs font-medium">{selected.vehiculo?.marca_modelo || "N/A"} ({selected.vehiculo?.ano || "N/A"})</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">Motor</span>
                                            <span className="text-xs font-medium">{selected.vehiculo?.motor || "N/A"} • {selected.vehiculo?.combustible || "N/A"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs text-neutral-500">VIN / PATENTE</span>
                                            <span className="text-xs font-medium uppercase">{selected.vehiculo?.vin || selected.vehiculo?.patente || "N/A"}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-6 space-y-3">
                                    <button
                                        onClick={() => handleAction("approve")}
                                        disabled={processing}
                                        className="w-full py-4 bg-green-500 hover:bg-green-600 text-black font-black rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        <CheckCircle size={20} />
                                        {processing ? "Procesando..." : "APROBAR PAGO"}
                                    </button>

                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Motivo del rechazo..."
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-500/50"
                                            value={rejectReason}
                                            onChange={(e) => setRejectReason(e.target.value)}
                                        />
                                        <button
                                            onClick={() => handleAction("reject")}
                                            disabled={processing || !rejectReason.trim()}
                                            className="w-full mt-2 py-3 bg-neutral-900 border border-red-500/30 hover:bg-red-500/10 text-red-500 font-bold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                        >
                                            <XCircle size={18} />
                                            RECHAZAR COMPROBANTE
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
