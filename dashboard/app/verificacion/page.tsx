"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { ArrowLeft, CheckCircle, XCircle, FileSearch, ShieldCheck, X, Clock } from "lucide-react";
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
    repuestos: {nombre?: string, codigo?: string, precio?: string|number|null}[];
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
        es_saldo?: boolean;
        abono_previo?: number | null;
    } | null;
}

function ElapsedBadge({ since }: { since?: string }) {
    const [elapsed, setElapsed] = useState("");
    useEffect(() => {
        if (!since) return;
        const update = () => {
            const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
            if (diff < 60) setElapsed(`${diff}s`);
            else if (diff < 3600) setElapsed(`${Math.floor(diff / 60)}m`);
            else if (diff < 86400) setElapsed(`${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`);
            else setElapsed(`${Math.floor(diff / 86400)}d`);
        };
        update();
        const id = setInterval(update, 30000);
        return () => clearInterval(id);
    }, [since]);

    const arrivalTime = since ? new Date(since).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : null;
    const arrivalDate = since ? new Date(since).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : null;

    return (
        <div className="flex items-center gap-2 mt-2">
            {arrivalTime && (
                <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                    <Clock size={10} /> {arrivalDate} {arrivalTime}
                </span>
            )}
            {elapsed && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    elapsed.includes('d') ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                    elapsed.includes('h') ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' :
                    'text-neutral-500 bg-white/5 border-white/10'
                }`}>
                    ⏱ {elapsed}
                </span>
            )}
        </div>
    );
}

export default function VerificacionPage() {
    const [approvals, setApprovals] = useState<PendingApproval[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<PendingApproval | null>(null);
    const [processing, setProcessing] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [montoEditado, setMontoEditado] = useState<string>("");

    useEffect(() => {
        if (selected && selected.pago_pendiente?.monto) {
            setMontoEditado(selected.pago_pendiente.monto.toString());
        } else {
            setMontoEditado("");
        }
    }, [selected]);

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

    const handleAction = async (accion: "approve" | "approve_abono" | "reject") => {
        if (!selected) return;
        if (accion === "reject" && !rejectReason.trim()) {
            alert("Por favor ingresa un motivo de rechazo.");
            return;
        }

        try {
            setProcessing(true);
            const bodyPayload: { phone: string; accion: string; nota_admin?: string; monto_corregido?: number } = {
                phone: selected.phone,
                accion,
                nota_admin: accion === "reject" ? rejectReason : undefined,
            };

            if (accion === "approve" || accion === "approve_abono") {
                const montoParseado = parseInt(montoEditado.replace(/[^\d]/g, ""), 10);
                if (!isNaN(montoParseado) && montoParseado > 0) {
                    bodyPayload.monto_corregido = montoParseado;
                }
            }

            await axios.post("http://localhost:4000/api/dashboard/verify-payment", bodyPayload);
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
        if (val === null || val === undefined || val === "") return "$0";
        const num = typeof val === "string" ? parseInt(val.replace(/[^\d]/g, ""), 10) : val;
        if (isNaN(num)) return "$0";
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
                                    <ElapsedBadge since={item.ultimo_mensaje} />
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

                        <h3 className="text-2xl font-black mb-6">
                            {selected.pago_pendiente?.es_saldo ? "Verificación de Pago de Saldo" : "Verificar Comprobante"}
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
                            {/* Imagen del comprobante */}
                            <div>
                                <p className="text-sm font-bold text-neutral-400 mb-3 uppercase tracking-wide">Comprobante Adjunto</p>
                                <div className="bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden aspect-[3/4] flex items-center justify-center relative">
                                    {selected.comprobante_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={selected.comprobante_url.startsWith('/') ? `http://localhost:4000${selected.comprobante_url}` : selected.comprobante_url}
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

                                    {selected.pago_pendiente?.es_saldo && (
                                        <>
                                            <div className="flex justify-between items-center pb-4 border-b border-white/5">
                                                <span className="text-neutral-400">Abono Previo</span>
                                                <span className="text-lg font-medium text-green-500">-{formatCurrency(selected.pago_pendiente?.abono_previo || 0)}</span>
                                            </div>
                                            <div className="flex justify-between items-center pb-4 border-b border-white/5 bg-accent/5 p-3 rounded-xl mt-2 mb-4">
                                                <span className="text-accent font-bold">Saldo a Pagar</span>
                                                <span className="text-xl font-black text-accent">{formatCurrency(Math.max(0, (selected.total_cotizacion || 0) - (selected.pago_pendiente?.abono_previo || 0)))}</span>
                                            </div>
                                        </>
                                    )}

                                    <div className="flex justify-between items-center pb-4 border-b border-white/5">
                                        <div className="flex flex-col">
                                            <span className="text-neutral-400">Monto IA <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded ml-1">Extraído</span></span>
                                            <span className="text-[10px] text-yellow-500/70 mt-1 uppercase font-bold tracking-wider">Puedes corregir este valor</span>
                                        </div>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
                                            <input 
                                                type="text" 
                                                inputMode="numeric"
                                                className="w-36 bg-neutral-900 border border-yellow-500/40 hover:border-yellow-500/80 focus:border-yellow-500 rounded-lg py-2 pl-7 pr-3 text-right text-xl font-bold text-yellow-500 focus:outline-none transition-colors shadow-inner"
                                                value={montoEditado}
                                                onChange={(e) => setMontoEditado(e.target.value.replace(/[^\d]/g, ""))}
                                            />
                                        </div>
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

                                    <div className="space-y-2 pt-2 mt-4 border-t border-white/5 text-sm">
                                        <div className="flex justify-between items-start">
                                            <span className="text-xs text-neutral-500">Logística</span>
                                            <div className="text-right">
                                                <span className="text-xs font-medium block">{selected.metodo_entrega?.toUpperCase() || "N/A"}</span>
                                                <span className="text-[10px] text-neutral-400">{selected.horario_entrega || "Horario por coordinar"}</span>
                                            </div>
                                        </div>
                                        {selected.metodo_entrega === 'domicilio' && (
                                            <div className="flex justify-between items-start">
                                                <span className="text-xs text-neutral-500">Dirección</span>
                                                <span className="text-xs font-medium text-accent max-w-[150px] text-right">
                                                    {selected.direccion_envio || "⚠️ No proporcionada"}
                                                </span>
                                            </div>
                                        )}

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
                                    <div className="mt-4 pt-4 border-t border-white/5">
                                        <p className="text-[10px] font-bold text-neutral-500 uppercase mb-2">Detalle de Productos</p>
                                        <div className="space-y-2">
                                            {selected.repuestos.map((r, idx) => (
                                                <div key={idx} className="flex justify-between text-xs items-start">
                                                    <div className="flex flex-col">
                                                        <span className="text-neutral-300 font-medium">{r.nombre}</span>
                                                        {r.codigo && (
                                                            <span className="text-[10px] text-neutral-500 font-mono mt-0.5">Cód: {r.codigo}</span>
                                                        )}
                                                    </div>
                                                    <span className="font-mono">{formatCurrency(r.precio)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>


                                <div className="mt-6 space-y-3">
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleAction("approve")}
                                            disabled={processing}
                                            className="flex-1 py-3 bg-green-500 hover:bg-green-600 text-black font-black rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 text-xs shadow-lg shadow-green-500/20"
                                        >
                                            <CheckCircle size={16} />
                                            {processing ? "..." : (selected.pago_pendiente?.es_saldo ? "APROBAR PAGO DE SALDO" : "PAGO COMPLETO")}
                                        </button>
                                        {!selected.pago_pendiente?.es_saldo && (
                                            <button
                                                onClick={() => handleAction("approve_abono")}
                                                disabled={processing}
                                                className="flex-1 py-3 bg-yellow-500 hover:bg-yellow-600 text-black font-black rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 text-xs shadow-lg shadow-yellow-500/20"
                                            >
                                                <ShieldCheck size={16} />
                                                {processing ? "..." : "ES ABONO"}
                                            </button>
                                        )}
                                    </div>

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
