"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Loader2, Plus, Trash2 } from "lucide-react";
import axios from "axios";
import { BACKEND_URL } from "@/lib/api";

const API = `${BACKEND_URL}/api/dashboard`;

interface Vendedor {
  id: number;
  nombre: string;
  sucursal: "Melipilla" | "San Felipe";
  activo: boolean;
  created_at: string;
}

export default function EquipoSection() {
  const [role, setRole] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form states por sucursal
  const [formMelipilla, setFormMelipilla] = useState("");
  const [formSanFelipe, setFormSanFelipe] = useState("");

  // Toggle "Mostrar inactivos"
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  // Leer rol del localStorage en el cliente
  useEffect(() => {
    const storedRole = localStorage.getItem("jfnn_role");
    setRole(storedRole);
  }, []);

  const fetchVendedores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Sin parámetro de sucursal = lista todas
      const res = await axios.get(`${API}/vendedores?t=${Date.now()}`);
      setVendedores(res.data.vendedores || []);
    } catch (err) {
      console.error("Error cargando vendedores:", err);
      setError("Error al cargar vendedores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "admin") {
      fetchVendedores();
    }
  }, [role, fetchVendedores]);

  const handleAgregarVendedor = async (sucursal: "Melipilla" | "San Felipe") => {
    const nombre = sucursal === "Melipilla" ? formMelipilla.trim() : formSanFelipe.trim();

    if (!nombre) {
      setError("El nombre del vendedor no puede estar vacío");
      return;
    }

    if (nombre.length < 2) {
      setError("El nombre debe tener al menos 2 caracteres");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await axios.post(`${API}/vendedores`, {
        nombre,
        sucursal,
      });

      // Limpiar form
      if (sucursal === "Melipilla") {
        setFormMelipilla("");
      } else {
        setFormSanFelipe("");
      }

      // Refresar lista
      await fetchVendedores();
    } catch (err) {
      console.error("Error agregando vendedor:", err);
      setError("Error al agregar vendedor");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDesactivar = async (id: number) => {
    if (!window.confirm("¿Estás seguro de que deseas desactivar este vendedor?")) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await axios.patch(`${API}/vendedores/${id}`, { activo: false });
      await fetchVendedores();
    } catch (err) {
      console.error("Error desactivando vendedor:", err);
      setError("Error al desactivar vendedor");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivar = async (id: number) => {
    setSubmitting(true);
    setError(null);
    try {
      await axios.patch(`${API}/vendedores/${id}`, { activo: true });
      await fetchVendedores();
    } catch (err) {
      console.error("Error reactivando vendedor:", err);
      setError("Error al reactivar vendedor");
    } finally {
      setSubmitting(false);
    }
  };

  // Si no es admin, no mostrar
  if (role !== "admin") {
    return null;
  }

  const vendedoresMelipilla = vendedores.filter((v) => v.sucursal === "Melipilla");
  const vendedoresSanFelipe = vendedores.filter((v) => v.sucursal === "San Felipe");

  const activos_melipilla = vendedoresMelipilla.filter((v) => v.activo);
  const inactivos_melipilla = vendedoresMelipilla.filter((v) => !v.activo);

  const activos_sanfelipe = vendedoresSanFelipe.filter((v) => v.activo);
  const inactivos_sanfelipe = vendedoresSanFelipe.filter((v) => !v.activo);

  return (
    <section className="glass p-8 rounded-3xl space-y-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MELIPILLA */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
            <h4 className="text-base font-bold text-neutral-100">📍 Melipilla</h4>

            {/* Lista activos */}
            <div className="space-y-2">
              {activos_melipilla.length === 0 ? (
                <p className="text-xs text-neutral-600 py-2">
                  No hay vendedores activos en esta sucursal
                </p>
              ) : (
                activos_melipilla.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between bg-neutral-800/50 rounded-lg px-3 py-2"
                  >
                    <span className="text-sm text-neutral-200">{v.nombre}</span>
                    <button
                      onClick={() => handleDesactivar(v.id)}
                      disabled={submitting}
                      className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                    >
                      Desactivar
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Toggle "Mostrar inactivos" */}
            <div className="pt-2 border-t border-neutral-700">
              <button
                onClick={() => setMostrarInactivos(!mostrarInactivos)}
                className="text-xs text-neutral-500 hover:text-neutral-400 font-medium"
              >
                {mostrarInactivos ? "▼" : "▶"} Mostrar inactivos (
                {inactivos_melipilla.length})
              </button>

              {mostrarInactivos && inactivos_melipilla.length > 0 && (
                <div className="mt-2 space-y-2 bg-neutral-900 rounded-lg p-3">
                  {inactivos_melipilla.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between bg-neutral-800/30 rounded px-2 py-1.5 opacity-60"
                    >
                      <span className="text-xs text-neutral-400">{v.nombre}</span>
                      <button
                        onClick={() => handleReactivar(v.id)}
                        disabled={submitting}
                        className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50 transition-colors"
                      >
                        Reactivar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form agregar */}
            <div className="pt-4 border-t border-neutral-700 flex gap-2">
              <input
                type="text"
                value={formMelipilla}
                onChange={(e) => setFormMelipilla(e.target.value)}
                placeholder="Nombre del vendedor"
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-green-500/50 transition-colors disabled:opacity-50"
                disabled={submitting}
              />
              <button
                onClick={() => handleAgregarVendedor("Melipilla")}
                disabled={submitting || !formMelipilla.trim()}
                className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:bg-neutral-700 disabled:text-neutral-600 text-black font-bold px-3 py-2 rounded-lg text-xs transition-all active:scale-[0.98]"
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Agregar
              </button>
            </div>
          </div>

          {/* SAN FELIPE */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
            <h4 className="text-base font-bold text-neutral-100">🏪 San Felipe</h4>

            {/* Lista activos */}
            <div className="space-y-2">
              {activos_sanfelipe.length === 0 ? (
                <p className="text-xs text-neutral-600 py-2">
                  No hay vendedores activos en esta sucursal
                </p>
              ) : (
                activos_sanfelipe.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between bg-neutral-800/50 rounded-lg px-3 py-2"
                  >
                    <span className="text-sm text-neutral-200">{v.nombre}</span>
                    <button
                      onClick={() => handleDesactivar(v.id)}
                      disabled={submitting}
                      className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                    >
                      Desactivar
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Toggle "Mostrar inactivos" */}
            <div className="pt-2 border-t border-neutral-700">
              <button
                onClick={() => setMostrarInactivos(!mostrarInactivos)}
                className="text-xs text-neutral-500 hover:text-neutral-400 font-medium"
              >
                {mostrarInactivos ? "▼" : "▶"} Mostrar inactivos (
                {inactivos_sanfelipe.length})
              </button>

              {mostrarInactivos && inactivos_sanfelipe.length > 0 && (
                <div className="mt-2 space-y-2 bg-neutral-900 rounded-lg p-3">
                  {inactivos_sanfelipe.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between bg-neutral-800/30 rounded px-2 py-1.5 opacity-60"
                    >
                      <span className="text-xs text-neutral-400">{v.nombre}</span>
                      <button
                        onClick={() => handleReactivar(v.id)}
                        disabled={submitting}
                        className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50 transition-colors"
                      >
                        Reactivar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form agregar */}
            <div className="pt-4 border-t border-neutral-700 flex gap-2">
              <input
                type="text"
                value={formSanFelipe}
                onChange={(e) => setFormSanFelipe(e.target.value)}
                placeholder="Nombre del vendedor"
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-green-500/50 transition-colors disabled:opacity-50"
                disabled={submitting}
              />
              <button
                onClick={() => handleAgregarVendedor("San Felipe")}
                disabled={submitting || !formSanFelipe.trim()}
                className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:bg-neutral-700 disabled:text-neutral-600 text-black font-bold px-3 py-2 rounded-lg text-xs transition-all active:scale-[0.98]"
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
