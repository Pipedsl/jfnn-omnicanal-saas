'use client';

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { X, User, RefreshCcw, AlertCircle } from 'lucide-react';

export interface Vendedor {
  id: number;
  nombre: string;
  sucursal: 'Melipilla' | 'San Felipe';
  activo: boolean;
}

interface IdentitySelectorProps {
  open: boolean;
  sucursal: 'Melipilla' | 'San Felipe';
  onSelect: (nombre: string) => void;
  onClose?: () => void;
  dismissible?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

export default function IdentitySelector({
  open,
  sucursal,
  onSelect,
  onClose,
  dismissible = false,
}: IdentitySelectorProps) {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVendedores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<{ vendedores: Vendedor[] }>(
        `${API_URL}/api/dashboard/vendedores?sucursal=${encodeURIComponent(sucursal)}&t=${Date.now()}`
      );
      setVendedores(res.data.vendedores ?? []);
    } catch (err) {
      console.error('[IdentitySelector] Error fetching vendedores:', err);
      setError('No se pudo conectar con el servidor. Verifica que el backend esté corriendo.');
    } finally {
      setLoading(false);
    }
  }, [sucursal]);

  useEffect(() => {
    if (open) {
      fetchVendedores();
    }
  }, [open, fetchVendedores]);

  const handleSelect = (nombre: string) => {
    localStorage.setItem('jfnn_vendedor_nombre', nombre);
    onSelect(nombre);
  };

  const handleClose = () => {
    if (dismissible && onClose) {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && dismissible && onClose) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">¿Quién está cotizando hoy?</h2>
              <p className="text-sm text-neutral-400 mt-1">
                Sucursal <span className="text-accent font-semibold">{sucursal}</span>
              </p>
            </div>
            {dismissible && onClose && (
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/10 rounded-lg text-neutral-400 hover:text-white transition-colors"
                title="Cerrar"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <p className="text-neutral-500 text-sm">Cargando equipo...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="flex items-center gap-2 text-red-400 text-sm text-center">
                <AlertCircle size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
              <button
                onClick={fetchVendedores}
                className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg text-accent text-sm font-medium transition-colors"
              >
                <RefreshCcw size={14} />
                Reintentar
              </button>
            </div>
          ) : vendedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <User size={32} className="text-neutral-700" />
              <p className="text-neutral-400 text-sm">
                No hay vendedores activos en esta sucursal.
              </p>
              <p className="text-neutral-600 text-xs max-w-xs">
                Pídele al admin que agregue al equipo en Settings.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {vendedores.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleSelect(v.nombre)}
                  className="flex flex-col items-center justify-center gap-2 min-h-[72px] px-3 py-4 bg-white/5 hover:bg-accent/10 border border-white/10 hover:border-accent/40 rounded-xl text-white font-semibold text-sm transition-all duration-150 active:scale-95"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent to-blue-300 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {v.nombre.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-center leading-tight">{v.nombre}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
