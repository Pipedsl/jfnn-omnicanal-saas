"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Loader2, Plus } from "lucide-react";
import axios from "axios";
import { BACKEND_URL } from "@/lib/api";

const API = `${BACKEND_URL}/api/dashboard`;

type Sucursal = "Melipilla" | "San Felipe";

interface Vendedor {
  id: number;
  nombre: string;
  sucursal: Sucursal;
  activo: boolean;
  created_at: string;
}

export default function EquipoSection() {
  const [role, setRole] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setRole(localStorage.getItem("jfnn_role"));
  }, []);

  const fetchVendedores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/vendedores?incluir_inactivos=1&t=${Date.now()}`);
      setVendedores(res.data.vendedores || []);
    } catch (err) {
      console.error("Error cargando vendedores:", err);
      setError("Error al cargar vendedores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "admin") fetchVendedores();
  }, [role, fetchVendedores]);

  const handleAgregar = async (sucursal: Sucursal, nombre: string, onDone: () => void) => {
    const trimmed = nombre.trim();
    if (trimmed.length < 2) {
      setError("El nombre debe tener al menos 2 caracteres");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await axios.post(`${API}/vendedores`, { nombre: trimmed, sucursal });
      onDone();
      await fetchVendedores();
    } catch (err) {
      console.error("Error agregando vendedor:", err);
      setError("Error al agregar vendedor");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActivo = async (id: number, activo: boolean) => {
    if (!activo && !window.confirm("¿Desactivar este vendedor?")) return;
    setSubmitting(true);
    setError(null);
    try {
      await axios.patch(`${API}/vendedores/${id}`, { activo });
      await fetchVendedores();
    } catch (err) {
      console.error("Error actualizando vendedor:", err);
      setError("Error al actualizar vendedor");
    } finally {
      setSubmitting(false);
    }
  };

  if (role !== "admin") return null;

  return (
    <section className="glass p-6 sm:p-8 rounded-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
          <Users size={20} className="text-green-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold mb-1">👥 Equipo</h3>
          <p className="text-sm text-neutral-500">
            Gestiona los vendedores de cada sucursal.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-500 text-sm py-4">
          <Loader2 size={16} className="animate-spin" />
          Cargando vendedores...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <SucursalCard
            titulo="📍 Melipilla"
            sucursal="Melipilla"
            vendedores={vendedores.filter((v) => v.sucursal === "Melipilla")}
            submitting={submitting}
            onAgregar={handleAgregar}
            onToggleActivo={handleToggleActivo}
          />
          <SucursalCard
            titulo="🏪 San Felipe"
            sucursal="San Felipe"
            vendedores={vendedores.filter((v) => v.sucursal === "San Felipe")}
            submitting={submitting}
            onAgregar={handleAgregar}
            onToggleActivo={handleToggleActivo}
          />
        </div>
      )}
    </section>
  );
}

interface SucursalCardProps {
  titulo: string;
  sucursal: Sucursal;
  vendedores: Vendedor[];
  submitting: boolean;
  onAgregar: (sucursal: Sucursal, nombre: string, onDone: () => void) => void;
  onToggleActivo: (id: number, activo: boolean) => void;
}

function SucursalCard({ titulo, sucursal, vendedores, submitting, onAgregar, onToggleActivo }: SucursalCardProps) {
  const [nombre, setNombre] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  const activos = vendedores.filter((v) => v.activo);
  const inactivos = vendedores.filter((v) => !v.activo);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onAgregar(sucursal, nombre, () => setNombre(""));
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4 min-w-0">
      <h4 className="text-base font-bold text-neutral-100">{titulo}</h4>

      {/* Lista activos */}
      <div className="space-y-2">
        {activos.length === 0 ? (
          <p className="text-xs text-neutral-600 py-2">No hay vendedores activos.</p>
        ) : (
          activos.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-2 bg-neutral-800/50 rounded-lg px-3 py-2 min-w-0"
            >
              <span className="text-sm text-neutral-200 flex-1 truncate min-w-0">
                {v.nombre}
              </span>
              <button
                type="button"
                onClick={() => onToggleActivo(v.id, false)}
                disabled={submitting}
                className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors flex-shrink-0 whitespace-nowrap"
              >
                Desactivar
              </button>
            </div>
          ))
        )}
      </div>

      {/* Toggle inactivos */}
      <div className="pt-2 border-t border-neutral-800">
        <button
          type="button"
          onClick={() => setMostrarInactivos(!mostrarInactivos)}
          className="text-xs text-neutral-500 hover:text-neutral-400 font-medium"
        >
          {mostrarInactivos ? "▼" : "▶"} Mostrar inactivos ({inactivos.length})
        </button>

        {mostrarInactivos && inactivos.length > 0 && (
          <div className="mt-2 space-y-2">
            {inactivos.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 bg-neutral-800/30 rounded-lg px-3 py-2 min-w-0"
              >
                <span className="text-xs text-neutral-400 flex-1 truncate min-w-0 line-through">
                  {v.nombre}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleActivo(v.id, true)}
                  disabled={submitting}
                  className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50 transition-colors flex-shrink-0 whitespace-nowrap"
                >
                  Reactivar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form agregar */}
      <form onSubmit={submit} className="pt-4 border-t border-neutral-800 flex flex-col sm:flex-row gap-2 min-w-0">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del vendedor"
          maxLength={60}
          className="w-full sm:flex-1 min-w-0 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-green-500/50 transition-colors disabled:opacity-50"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || nombre.trim().length < 2}
          className="flex items-center justify-center gap-1 bg-green-500 hover:bg-green-400 disabled:bg-neutral-800 disabled:text-neutral-600 text-black font-bold px-3 py-2 rounded-lg text-xs transition-all active:scale-[0.98] flex-shrink-0 whitespace-nowrap"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Agregar
        </button>
      </form>
    </div>
  );
}
