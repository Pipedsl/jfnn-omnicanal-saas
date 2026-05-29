"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, RefreshCcw } from "lucide-react";
import { api, BACKEND_URL } from "@/lib/api";
import { safeGet } from "@/lib/storage";

interface AuditLog {
  id: number;
  created_at: string;
  actor_role: string | null;
  actor_nombre: string | null;
  actor_sucursal: string | null;
  action: string;
  target_phone: string | null;
  target_quote_id: string | null;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  motivo: string | null;
  ip: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  archivar: "🗄️ Archivar",
  cambiar_estado: "🔄 Cambio estado",
  rectificar: "✏️ Rectificar",
  verificar_pago: "💳 Verificar pago",
  asignar_vendedor: "👤 Asignar vendedor",
  reactivar: "♻️ Reactivar",
};

export default function SoporteLogsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [accionFilter, setAccionFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");

  useEffect(() => {
    const role = safeGet("jfnn_role");
    if (role !== "soporte") {
      setAuthorized(false);
      return;
    }
    setAuthorized(true);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (accionFilter) params.set("action", accionFilter);
      if (phoneFilter.trim()) params.set("phone", phoneFilter.trim());
      params.set("limit", "300");
      const res = await api.get(`${BACKEND_URL}/api/dashboard/audit-logs?${params.toString()}`);
      setLogs(res.data.logs || []);
    } catch (err) {
      console.error("Error cargando logs:", err);
    } finally {
      setLoading(false);
    }
  }, [accionFilter, phoneFilter]);

  useEffect(() => {
    if (authorized) fetchLogs();
  }, [authorized, fetchLogs]);

  if (authorized === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-950 text-center px-6">
        <ShieldAlert size={48} className="text-red-400 mb-4" />
        <h1 className="text-lg font-bold text-neutral-100">Acceso restringido</h1>
        <p className="text-sm text-neutral-400 mt-2">Esta sección es solo para el equipo de Soporte.</p>
        <button onClick={() => router.push("/")} className="mt-5 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-neutral-300 text-sm hover:bg-white/10">
          Volver al inicio
        </button>
      </div>
    );
  }

  if (authorized === null) return null;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="p-2 rounded-lg hover:bg-white/5"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">🛠️ Auditoría <span className="text-xs font-normal text-neutral-500">solo soporte</span></h1>
            <p className="text-sm text-neutral-500">Trazabilidad de acciones sensibles (quién archivó, cambió estado, verificó pago, etc.).</p>
          </div>
          <button onClick={fetchLogs} className="ml-auto p-2 rounded-lg hover:bg-white/5" title="Actualizar"><RefreshCcw size={16} className={loading ? "animate-spin" : ""} /></button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <select value={accionFilter} onChange={(e) => setAccionFilter(e.target.value)}
            className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs">
            <option value="">Todas las acciones</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value)} placeholder="Filtrar por teléfono…"
            className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs flex-1 min-w-[180px]" />
        </div>

        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.03] text-neutral-500 uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Acción</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Motivo / detalle</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-neutral-600">{loading ? "Cargando…" : "Sin registros."}</td></tr>
              ) : logs.map((l) => (
                <tr key={l.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{new Date(l.created_at).toLocaleString("es-CL")}</td>
                  <td className="px-3 py-2">
                    <span className="font-bold text-neutral-200">{l.actor_nombre || "—"}</span>
                    <span className="text-[10px] text-neutral-500 ml-1">({l.actor_role}{l.actor_sucursal ? " · " + l.actor_sucursal : ""})</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{ACTION_LABELS[l.action] || l.action}</td>
                  <td className="px-3 py-2 font-mono text-neutral-400">{l.target_phone || "—"}</td>
                  <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">{l.estado_anterior || "—"}{l.estado_nuevo ? ` → ${l.estado_nuevo}` : ""}</td>
                  <td className="px-3 py-2 text-neutral-300">{l.motivo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
