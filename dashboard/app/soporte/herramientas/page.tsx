"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, RefreshCcw, CheckCircle, Wrench, DollarSign, Plus, Trash2 } from "lucide-react";
import { api, BACKEND_URL } from "@/lib/api";
import { safeGet } from "@/lib/storage";

interface VentaSinCerrar {
  phone: string;
  estado: string;
  sucursal: string | null;
  nombre_cliente: string | null;
  vehiculo: string | null;
  items: string;
  total: number;
  vendedor: string | null;
  quote_id: string | null;
  ultimo_mensaje: string;
  pesquisa_pendiente: boolean;
  texto_cliente_pesquisa: string | null;
  quote_id_pesquisa: string | null;
}

const ESTADOS = [
  "PERFILANDO", "ESPERANDO_VENDEDOR", "CONFIRMANDO_COMPRA", "ESPERANDO_COMPROBANTE",
  "ESPERANDO_APROBACION_ADMIN", "PAGO_VERIFICADO", "ABONO_VERIFICADO", "ENCARGO_SOLICITADO",
  "ESPERANDO_SALDO", "ESPERANDO_RETIRO", "DESPACHADO", "ENTREGADO", "CICLO_COMPLETO", "ARCHIVADO",
];

export default function SoporteHerramientas() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [ventas, setVentas] = useState<VentaSinCerrar[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [fechasVenta, setFechasVenta] = useState<Record<string, string>>({});

  // Cambio manual de estado
  const [phone, setPhone] = useState("");
  const [estado, setEstado] = useState("ESPERANDO_VENDEDOR");
  const [motivo, setMotivo] = useState("");

  // Costos de infraestructura. USD se guarda en DB (Supabase/Vercel/Railway facturan USD),
  // pero la UI muestra y edita en CLP a tipo de cambio fijo de $1.000 CLP/USD.
  const USD_TO_CLP = 1000;
  const fmtCLP = (clp: number) => '$' + Math.round(clp).toLocaleString('es-CL');
  type Costo = { id: number; mes: string; servicio: string; monto_usd: number | string; nota: string | null };
  const [costosMes, setCostosMes] = useState<string>(new Date().toISOString().slice(0, 7));
  const [costos, setCostos] = useState<Costo[]>([]);
  const [totalCostos, setTotalCostos] = useState(0);
  const [nuevoServicio, setNuevoServicio] = useState("gemini");
  const [nuevoServicioNombre, setNuevoServicioNombre] = useState("");
  const [nuevoMonto, setNuevoMonto] = useState("");
  const [nuevaNota, setNuevaNota] = useState("");

  useEffect(() => {
    setAuthorized(safeGet("jfnn_role") === "soporte");
  }, []);

  const fetchVentas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`${BACKEND_URL}/api/dashboard/soporte/ventas-sin-cerrar`);
      setVentas(res.data.ventas || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (authorized) fetchVentas(); }, [authorized, fetchVentas]);

  const fetchCostos = useCallback(async () => {
    try {
      const res = await api.get(`${BACKEND_URL}/api/dashboard/soporte/costos?mes=${costosMes}`);
      setCostos(res.data.costos || []);
      setTotalCostos(Number(res.data.total_usd) || 0);
    } catch (err) { console.error(err); }
  }, [costosMes]);
  useEffect(() => { if (authorized) fetchCostos(); }, [authorized, fetchCostos]);

  const guardarCosto = async (id: number, monto_usd: number, nota: string) => {
    try {
      await api.patch(`${BACKEND_URL}/api/dashboard/soporte/costos/${id}`, { monto_usd, nota });
      fetchCostos();
    } catch (err) { console.error(err); alert("No se pudo guardar."); }
  };
  const agregarCosto = async () => {
    const montoCLP = Number(nuevoMonto);
    // Si eligió "otros", usar el nombre personalizado; si no, el servicio del select.
    const servicio = nuevoServicio === 'otros'
      ? nuevoServicioNombre.trim().toLowerCase()
      : nuevoServicio;
    if (!servicio || Number.isNaN(montoCLP) || montoCLP < 0) {
      alert("Indica un nombre de servicio y un monto válido.");
      return;
    }
    try {
      await api.post(`${BACKEND_URL}/api/dashboard/soporte/costos`, {
        mes: costosMes, servicio, monto_usd: montoCLP / USD_TO_CLP, nota: nuevaNota || null,
      });
      setNuevoMonto(""); setNuevaNota(""); setNuevoServicioNombre("");
      fetchCostos();
    } catch (err) { console.error(err); alert("No se pudo agregar."); }
  };
  const borrarCosto = async (id: number) => {
    if (!confirm("¿Borrar este costo?")) return;
    try { await api.delete(`${BACKEND_URL}/api/dashboard/soporte/costos/${id}`); fetchCostos(); }
    catch (err) { console.error(err); }
  };

  const cerrarVenta = async (v: VentaSinCerrar) => {
    const fechaVenta = fechasVenta[v.phone] || '';
    const fechaLabel = fechaVenta
      ? new Date(fechaVenta + 'T12:00:00').toLocaleDateString('es-CL')
      : 'hoy';
    if (!confirm(`¿Cerrar la venta de ${v.nombre_cliente || v.phone} ($${v.total.toLocaleString("es-CL")})? Quedará en KPIs con fecha ${fechaLabel}.`)) return;
    setBusy(v.phone);
    try {
      await api.post(`${BACKEND_URL}/api/dashboard/soporte/cerrar-venta`, {
        phone: v.phone,
        enviar_resena: true,
        motivo: "Cierre manual desde soporte",
        ...(fechaVenta ? { fecha_venta: fechaVenta } : {}),
      });
      await fetchVentas();
      alert("Venta cerrada y registrada en KPIs.");
    } catch (err) {
      console.error(err);
      alert("No se pudo cerrar la venta.");
    } finally {
      setBusy(null);
    }
  };

  const cambiarEstado = async () => {
    if (!phone.trim()) { alert("Indica el teléfono."); return; }
    if (!motivo.trim()) { alert("Indica el motivo."); return; }
    if (!confirm(`Forzar estado de ${phone} → ${estado}. No se notifica al cliente. ¿Confirmas?`)) return;
    setBusy("estado");
    try {
      await api.patch(`${BACKEND_URL}/api/dashboard/soporte/sesion/${encodeURIComponent(phone.trim())}/estado`, {
        estado, motivo: motivo.trim(),
      });
      alert(`Estado de ${phone} cambiado a ${estado}.`);
      setMotivo("");
      fetchVentas();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e.response?.data?.error || "No se pudo cambiar el estado.");
    } finally {
      setBusy(null);
    }
  };

  if (authorized === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-950 text-center px-6">
        <ShieldAlert size={48} className="text-red-400 mb-4" />
        <h1 className="text-lg font-bold text-neutral-100">Acceso restringido</h1>
        <p className="text-sm text-neutral-400 mt-2">Solo para el equipo de Soporte.</p>
        <button onClick={() => router.push("/")} className="mt-5 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-neutral-300 text-sm hover:bg-white/10">Volver</button>
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
            <h1 className="text-2xl font-extrabold flex items-center gap-2"><Wrench size={20} /> Herramientas de Soporte</h1>
            <p className="text-sm text-neutral-500">Recuperar/cerrar ventas y corregir estados de flujos atascados.</p>
          </div>
          <Link href="/soporte/logs" className="ml-auto text-xs text-amber-400 hover:underline">Ver auditoría →</Link>
        </div>

        {/* Cambio manual de estado */}
        <div className="rounded-2xl border border-white/10 p-4 mb-6 bg-white/[0.02]">
          <h2 className="text-sm font-bold text-neutral-100 mb-3">🛠️ Cambiar estado manual</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-[10px] uppercase text-neutral-500 block mb-1">Teléfono</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="56912345678"
                className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-neutral-500 block mb-1">Estado</label>
              <select value={estado} onChange={(e) => setEstado(e.target.value)}
                className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs">
                {ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] uppercase text-neutral-500 block mb-1">Motivo (obligatorio)</label>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se cambia…"
                className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs" />
            </div>
            <button onClick={cambiarEstado} disabled={busy === "estado"}
              className="px-4 py-2 rounded-lg bg-accent/15 text-accent border border-accent/30 text-xs font-bold hover:bg-accent/25 disabled:opacity-50">
              {busy === "estado" ? "Aplicando…" : "Aplicar"}
            </button>
          </div>
          <p className="text-[10px] text-neutral-600 mt-2">Override puro: solo cambia el estado, no notifica al cliente. Queda en auditoría.</p>
        </div>

        {/* Ventas sin cerrar */}
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-bold text-neutral-100">Ventas sin cerrar ({ventas.length})</h2>
          <button onClick={fetchVentas} className="p-1.5 rounded-lg hover:bg-white/5" title="Actualizar"><RefreshCcw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.03] text-neutral-500 uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Vehículo</th>
                <th className="text-left px-3 py-2">Items</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Vendedor</th>
                <th className="text-left px-3 py-2">Fecha venta</th>
                <th className="text-right px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {ventas.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-neutral-600">{loading ? "Cargando…" : "No hay ventas sin cerrar."}</td></tr>
              ) : ventas.map((v) => (
                <tr key={v.phone} className={`border-t border-white/5 hover:bg-white/[0.02] ${v.pesquisa_pendiente ? 'bg-amber-500/[0.03]' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="font-bold text-neutral-200 flex items-center gap-1">
                      {v.nombre_cliente || "Sin nombre"}
                      {v.pesquisa_pendiente && (
                        <span title={v.texto_cliente_pesquisa || 'Cliente mencionó compra presencial'} className="text-amber-400 cursor-help">🕵️</span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-neutral-500">{v.phone}</div>
                    {v.pesquisa_pendiente && v.texto_cliente_pesquisa && (
                      <div className="text-[10px] text-amber-400/70 mt-0.5 max-w-[180px] truncate" title={v.texto_cliente_pesquisa}>
                        {'“'}{v.texto_cliente_pesquisa}{'”'}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{v.vehiculo || "—"}</td>
                  <td className="px-3 py-2 text-neutral-400 max-w-[260px] truncate" title={v.items}>{v.items || "—"}</td>
                  <td className="px-3 py-2 text-neutral-400">{v.estado}</td>
                  <td className="px-3 py-2 text-right font-bold text-green-400">${v.total.toLocaleString("es-CL")}</td>
                  <td className="px-3 py-2 text-neutral-400">{v.vendedor || "—"}</td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={fechasVenta[v.phone] || ''}
                      onChange={(e) => setFechasVenta(prev => ({ ...prev, [v.phone]: e.target.value }))}
                      className="bg-neutral-900 border border-white/10 rounded px-2 py-1 text-[10px] w-[120px]"
                      title="Dejar vacío para usar fecha de hoy"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => cerrarVenta(v)} disabled={busy === v.phone}
                      className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 text-xs font-bold hover:bg-green-500/25 disabled:opacity-50 inline-flex items-center gap-1">
                      <CheckCircle size={12} /> {busy === v.phone ? "…" : "Cerrar venta"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Costos de infraestructura */}
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-sm font-bold text-neutral-100 flex items-center gap-2"><DollarSign size={14} /> Costos de infraestructura</h2>
            <input type="month" value={costosMes} onChange={(e) => setCostosMes(e.target.value)}
              className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-1 text-xs" />
            <div className="ml-auto text-xs text-neutral-500">Total mes: <span className="text-green-400 font-bold text-sm">{fmtCLP(totalCostos * USD_TO_CLP)} CLP</span> <span className="text-neutral-600">(${totalCostos.toFixed(2)} USD · TC fijo $1.000)</span></div>
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden mb-3">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.03] text-neutral-500 uppercase text-[10px]">
                <tr>
                  <th className="text-left px-3 py-2">Servicio</th>
                  <th className="text-left px-3 py-2 w-[160px]">Monto CLP</th>
                  <th className="text-left px-3 py-2">Nota</th>
                  <th className="text-right px-3 py-2 w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {costos.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-6 text-neutral-600">Cargando…</td></tr>
                ) : costos.map((c) => (
                  <tr key={c.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-bold text-neutral-200 uppercase">{c.servicio}</td>
                    <td className="px-3 py-2">
                      <input type="number" step="500" defaultValue={Math.round(Number(c.monto_usd) * USD_TO_CLP)}
                        onBlur={(e) => guardarCosto(c.id, Number(e.target.value) / USD_TO_CLP, c.nota || "")}
                        className="w-full bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs"
                        placeholder="CLP" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" defaultValue={c.nota || ""}
                        onBlur={(e) => guardarCosto(c.id, Number(c.monto_usd), e.target.value)}
                        className="w-full bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs"
                        placeholder="Nota (opcional)" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => borrarCosto(c.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400/60 hover:text-red-400" title="Eliminar">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-2xl border border-white/10 p-3 bg-white/[0.02]">
            <h3 className="text-xs font-bold text-neutral-300 mb-2 flex items-center gap-1"><Plus size={12} /> Agregar costo del mes</h3>
            <div className="flex flex-wrap gap-2">
              <select value={nuevoServicio} onChange={(e) => setNuevoServicio(e.target.value)}
                className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs">
                <option value="gemini">Gemini</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="otros">Otros (escribir nombre)</option>
              </select>
              {nuevoServicio === 'otros' && (
                <input type="text" value={nuevoServicioNombre} onChange={(e) => setNuevoServicioNombre(e.target.value)}
                  placeholder="Nombre del servicio (ej: Sentry)"
                  className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs w-[200px]" />
              )}
              <input type="number" step="500" value={nuevoMonto} onChange={(e) => setNuevoMonto(e.target.value)}
                placeholder="Monto CLP" className="bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs w-[140px]" />
              <input type="text" value={nuevaNota} onChange={(e) => setNuevaNota(e.target.value)}
                placeholder="Nota (opcional)" className="flex-1 min-w-[180px] bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs" />
              <button onClick={agregarCosto} className="px-4 py-2 rounded-lg bg-accent/15 text-accent border border-accent/30 text-xs font-bold hover:bg-accent/25">
                Agregar
              </button>
            </div>
            <p className="text-[10px] text-neutral-600 mt-2">Vercel/Railway/Supabase se cargan automáticos cada mes — solo edita el monto si cambió. Gemini y WhatsApp los agregas a mano cuando llegue la factura. Para "Otros" escribe el nombre (ej. Sentry, Cloudflare, dominio). Todo en CLP a TC fijo $1.000/USD.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
