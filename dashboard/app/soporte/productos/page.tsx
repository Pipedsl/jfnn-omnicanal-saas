"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, PackageSearch, RefreshCcw, Search } from "lucide-react";
import { api, BACKEND_URL } from "@/lib/api";
import { safeGet } from "@/lib/storage";

interface Producto {
    nombre: string;
    total_solicitudes: number;
    cantidad_total: number;
    disponible: number;
    sin_stock: number;
    por_encargo: number;
    sin_clasificar: number;
    vehiculos: string[];
    ultima_solicitud: string | null;
    en_activas: number;
    en_cerradas: number;
}

type Filtro = "sin_stock" | "con_stock" | "todos";

const FILTROS: { key: Filtro; label: string }[] = [
    { key: "sin_stock", label: "🔴 Sin stock" },
    { key: "con_stock", label: "🟢 Con stock" },
    { key: "todos", label: "Todos" },
];

const fmtFecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

export default function SoporteProductos() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState<boolean | null>(null);
    const [productos, setProductos] = useState<Producto[]>([]);
    const [loading, setLoading] = useState(true);
    const [filtro, setFiltro] = useState<Filtro>("sin_stock");
    const [busqueda, setBusqueda] = useState("");
    const [sucursal, setSucursal] = useState("");
    const [generadoEn, setGeneradoEn] = useState<string | null>(null);

    useEffect(() => {
        setAuthorized(safeGet("jfnn_role") === "soporte");
    }, []);

    const fetchProductos = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ t: String(Date.now()) });
            if (sucursal) params.set("sucursal", sucursal);
            const res = await api.get(`${BACKEND_URL}/api/dashboard/soporte/productos-solicitados?${params.toString()}`);
            setProductos(res.data.productos || []);
            setGeneradoEn(res.data.generado_en || null);
        } catch (err) {
            console.error("Error cargando productos solicitados:", err);
        } finally {
            setLoading(false);
        }
    }, [sucursal]);

    useEffect(() => {
        if (authorized) fetchProductos();
    }, [authorized, fetchProductos]);

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        let lista = productos.filter((p) => {
            if (q && !p.nombre.toLowerCase().includes(q)) return false;
            if (filtro === "sin_stock") return p.sin_stock > 0;
            if (filtro === "con_stock") return p.disponible > 0;
            return true;
        });
        // En vista "sin stock", priorizar mayor demanda no satisfecha.
        if (filtro === "sin_stock") lista = [...lista].sort((a, b) => b.sin_stock - a.sin_stock);
        return lista;
    }, [productos, busqueda, filtro]);

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
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <Link href="/" className="p-2 rounded-lg hover:bg-white/5"><ArrowLeft size={18} /></Link>
                    <div>
                        <h1 className="text-2xl font-extrabold flex items-center gap-2"><PackageSearch size={20} /> Productos solicitados</h1>
                        <p className="text-sm text-neutral-500">Pesquisa de stock — qué piden los clientes (sesiones activas + ventas cerradas).</p>
                    </div>
                    <button
                        onClick={fetchProductos}
                        disabled={loading}
                        className="ml-auto inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 disabled:opacity-50"
                    >
                        <RefreshCcw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
                    </button>
                </div>

                {/* Controles */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="flex items-center gap-1.5">
                        {FILTROS.map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFiltro(f.key)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all border ${
                                    filtro === f.key
                                        ? "bg-accent border-accent text-white"
                                        : "bg-white/5 border-white/10 text-neutral-400 hover:border-white/20"
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
                        <input
                            type="text"
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            placeholder="Buscar repuesto..."
                            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:border-accent/50 focus:outline-none"
                        />
                    </div>

                    <select
                        value={sucursal}
                        onChange={(e) => setSucursal(e.target.value)}
                        className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-200 focus:border-accent focus:outline-none"
                    >
                        <option value="">Todas las sucursales</option>
                        <option value="Melipilla">Melipilla</option>
                        <option value="San Felipe">San Felipe</option>
                    </select>
                </div>

                <p className="text-xs text-neutral-500 mb-3">
                    {visibles.length} producto{visibles.length === 1 ? "" : "s"}
                    {generadoEn && <span className="text-neutral-600"> · actualizado {new Date(generadoEn).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</span>}
                </p>

                {/* Tabla */}
                {loading && productos.length === 0 ? (
                    <div className="py-16 text-center text-neutral-500">Cargando…</div>
                ) : visibles.length === 0 ? (
                    <div className="rounded-2xl border-dashed border-2 border-neutral-800 py-12 text-center text-neutral-500">
                        No hay productos para este filtro.
                    </div>
                ) : (
                    <div className="rounded-2xl overflow-hidden border border-white/5">
                        <table className="w-full text-sm">
                            <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-neutral-500">
                                <tr>
                                    <th className="text-left px-4 py-3">Repuesto</th>
                                    <th className="text-right px-4 py-3">Pedidos</th>
                                    <th className="text-right px-4 py-3">Cant.</th>
                                    <th className="text-center px-4 py-3">🟢/🔴/🟡</th>
                                    <th className="text-left px-4 py-3">Vehículos</th>
                                    <th className="text-right px-4 py-3">Última vez</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibles.map((p, i) => (
                                    <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02]">
                                        <td className="px-4 py-3">
                                            <span className="text-neutral-200 font-medium">{p.nombre}</span>
                                            <span className="block text-[10px] text-neutral-600">
                                                {p.en_activas > 0 && `${p.en_activas} en curso`}
                                                {p.en_activas > 0 && p.en_cerradas > 0 && " · "}
                                                {p.en_cerradas > 0 && `${p.en_cerradas} cerradas`}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-neutral-200">{p.total_solicitudes}</td>
                                        <td className="px-4 py-3 text-right text-neutral-400">{p.cantidad_total}</td>
                                        <td className="px-4 py-3 text-center text-[11px] tabular-nums">
                                            <span className="text-green-400">{p.disponible}</span>
                                            <span className="text-neutral-700"> / </span>
                                            <span className={p.sin_stock > 0 ? "text-red-400 font-bold" : "text-neutral-600"}>{p.sin_stock}</span>
                                            <span className="text-neutral-700"> / </span>
                                            <span className="text-yellow-500">{p.por_encargo}</span>
                                        </td>
                                        <td className="px-4 py-3 text-[11px] text-neutral-500 max-w-[220px] truncate" title={p.vehiculos.join(", ")}>
                                            {p.vehiculos.length > 0 ? p.vehiculos.join(", ") : "—"}
                                        </td>
                                        <td className="px-4 py-3 text-right text-neutral-500 text-xs whitespace-nowrap">{fmtFecha(p.ultima_solicitud)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <p className="text-[10px] text-neutral-600 mt-3">
                    Leyenda: 🟢 disponible · 🔴 sin stock · 🟡 por encargo (conteo de veces que se pidió con esa disponibilidad).
                    El filtro &quot;Sin stock&quot; ordena por demanda no satisfecha.
                </p>
            </div>
        </div>
    );
}
