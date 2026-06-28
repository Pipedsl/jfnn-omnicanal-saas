"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { safeGet, safeRemove } from "@/lib/storage";
import { LayoutDashboard, RefreshCcw, Bell, BellRing, Settings, ShieldCheck, Search, LogOut, BarChart3, Wrench, PackageSearch } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import QuoteCard from "@/components/QuoteCard";
import BandejaTable from "@/components/BandejaTable";
import HistorialTable from "@/components/HistorialTable";
import DashboardMetrics from "@/components/DashboardMetrics";
import AgentMetrics from "@/components/AgentMetrics";
import IdentitySelector from "@/components/IdentitySelector";
import ConversacionesPanel from "@/components/ConversacionesPanel";
import NotificationToast, { useToast } from "@/components/NotificationToast";
import Link from "next/link";

interface Quote {
  id: string;
  phone: string;
  estado: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entidades?: any; // Aceptamos any para el JSON dinámico
  ultimo_mensaje?: string;
  created_at?: string;
  sucursal?: 'Melipilla' | 'San Felipe' | null;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

export default function Home() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("pendientes"); // "pendientes" | "historial" | "conversaciones"
  const [filter, setFilter] = useState("todos");
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [chatTargetPhone, setChatTargetPhone] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('vendedor');
  const [userSucursal, setUserSucursal] = useState<'Melipilla' | 'San Felipe' | null>(null);
  const [vendedorNombre, setVendedorNombre] = useState<string>('');
  const [adminSucursalFilter, setAdminSucursalFilter] = useState<'todas' | 'Melipilla' | 'San Felipe'>('todas');
  const [identitySelectorOpen, setIdentitySelectorOpen] = useState(false);
  const { permission, requestPermission, notify } = useNotifications();
  const { toasts, addToast, removeToast } = useToast();

  const notifyAll = useCallback((title: string, body: string) => {
    notify(title, body);
    addToast(title, body);
  }, [notify, addToast]);
  // useRef para capturar el `view` y `fetchQuotesAndMetrics` actual sin closures stale
  const viewRef = useRef("pendientes");
  const fetchRef = useRef<(source?: string) => Promise<void>>(null!);
  const prevMsgTimesRef = useRef<Map<string, string>>(new Map());

  // Eliminado el estado 'metrics' local en favor del componente <DashboardMetrics />

  // Leer rol, sucursal e identidad del usuario desde localStorage al montar
  useEffect(() => {
    const storedRole = safeGet('jfnn_role') ?? 'vendedor';
    setUserRole(storedRole);

    const storedSucursal = safeGet('jfnn_sucursal') as 'Melipilla' | 'San Felipe' | null;
    const storedNombre = safeGet('jfnn_vendedor_nombre') ?? '';
    setVendedorNombre(storedNombre);

    // Abrir selector de identidad si es vendedor sin nombre asignado
    if (storedRole === 'vendedor') {
      if (!storedSucursal) {
        console.warn('[IdentitySelector] jfnn_sucursal vacío (JWT viejo). No se abrirá el selector de identidad.');
        return;
      }
      setUserSucursal(storedSucursal);
      if (!storedNombre) {
        setIdentitySelectorOpen(true);
      }
    }
  }, []);

  // Deep-link al chat: estadísticas (y otras vistas) navegan a /?chat=<phone> para
  // abrir directo la conversación de ese cliente. Lo leemos al montar y limpiamos
  // la URL para que un refresh no re-abra el chat.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const chatPhone = params.get('chat');
    if (chatPhone) {
      setChatTargetPhone(chatPhone);
      setView('conversaciones');
      const url = new URL(window.location.href);
      url.searchParams.delete('chat');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    safeRemove('jfnn_role');
    safeRemove('jfnn_token');
    safeRemove('jfnn_sucursal');
    safeRemove('jfnn_vendedor_nombre');
    window.location.href = '/login';
  };

  const handleIdentitySelect = (nombre: string) => {
    setVendedorNombre(nombre);
    setIdentitySelectorOpen(false);
  };

  const handleOpenIdentitySelector = () => {
    if (userSucursal) {
      setIdentitySelectorOpen(true);
    }
  };

  const fetchPendientes = async (source: string = "unknown") => {
    console.log(`[Fetch] Cotizaciones activas. Origen: ${source} a las ${new Date().toLocaleTimeString()}`);
    try {
      setLoading(true);
      const role = safeGet('jfnn_role') ?? 'vendedor';
      const sucursalLocal = safeGet('jfnn_sucursal') as 'Melipilla' | 'San Felipe' | null;
      let sucursalParam = '';
      if (role === 'vendedor' && sucursalLocal) {
        sucursalParam = `&sucursal=${encodeURIComponent(sucursalLocal)}`;
      } else if ((role === 'admin' || role === 'soporte') && adminSucursalFilter !== 'todas') {
        sucursalParam = `&sucursal=${encodeURIComponent(adminSucursalFilter)}`;
      }
      const resPend = await api.get(`${API_URL}/api/dashboard/cotizaciones?t=${Date.now()}${sucursalParam}`);
      const pend: Quote[] = resPend.data || [];

      // Notificar SOLO cuando aparece una cotización NUEVA en la bandeja
      // (un cliente que no estaba antes). Las notificaciones de "mensaje nuevo"
      // las maneja el chat panel comparando total_entrantes, no este polling
      // que ve cambios de cualquier tipo (incluyendo respuestas del agente IA).
      if (prevMsgTimesRef.current.size > 0) {
        for (const q of pend) {
          if (!prevMsgTimesRef.current.has(q.phone)) {
            notifyAll("Nueva cotización", `${q.entidades?.nombre_cliente || q.phone} entró a la bandeja`);
            break;
          }
        }
      }
      prevMsgTimesRef.current = new Map(pend.map(q => [q.phone, q.ultimo_mensaje || '']));

      if (viewRef.current === "pendientes") setQuotes(pend);
    } catch (error) {
      console.error("Error fetching cotizaciones:", error);
    } finally {
      setLoading(false);
      setIsSyncing(true);
      setTimeout(() => setIsSyncing(false), 2000);
    }
  };

  const fetchHistorial = async () => {
    console.log(`[Fetch] Historial bajo demanda a las ${new Date().toLocaleTimeString()}`);
    try {
      setLoading(true);
      const role = safeGet('jfnn_role') ?? 'vendedor';
      const sucursalLocal = safeGet('jfnn_sucursal') as 'Melipilla' | 'San Felipe' | null;
      let sucursalParam = '';
      if (role === 'vendedor' && sucursalLocal) {
        sucursalParam = `&sucursal=${encodeURIComponent(sucursalLocal)}`;
      } else if ((role === 'admin' || role === 'soporte') && adminSucursalFilter !== 'todas') {
        sucursalParam = `&sucursal=${encodeURIComponent(adminSucursalFilter)}`;
      }
      const resHist = await api.get(`${API_URL}/api/dashboard/cotizaciones/historial?t=${Date.now()}${sucursalParam}`);
      const hist: Quote[] = resHist.data || [];

      setQuotes(hist);
    } catch (error) {
      console.error("Error fetching historial:", error);
    } finally {
      setLoading(false);
    }
  };

  // Función unificada para compatibilidad con el ref de polling
  const fetchQuotesAndMetrics = async (source: string = "unknown") => {
    if (viewRef.current === "pendientes") {
      await fetchPendientes(source);
    }
    // El historial NO se recarga automáticamente, solo bajo demanda
  };


  // Mantener la ref siempre sincronizada con la función actual
  useEffect(() => {
    fetchRef.current = fetchQuotesAndMetrics;
  });

  useEffect(() => {
    viewRef.current = view; // Sync ref
    setFilter("todos"); // Reset filter on view change
    setSearchQuery(""); // Reset search on view change
    if (view === "pendientes") {
      fetchPendientes("useEffect[view=pendientes]");
    } else if (view === "historial") {
      fetchHistorial(); // Solo se llama cuando el usuario cambia a historial
    }
  }, [view]);

  // Re-fetch cuando admin cambia el filtro de sucursal
  useEffect(() => {
    if (view === 'pendientes') {
      fetchPendientes('adminSucursalFilter_change');
    } else if (view === 'historial') {
      fetchHistorial();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSucursalFilter]);

  // Polling cada 3s para pendientes (sin Supabase Realtime; necesario para lock pesimista)
  useEffect(() => {
    fetchPendientes("Initial_Load");
    const interval = setInterval(() => {
      if (viewRef.current === "pendientes") {
        fetchRef.current("Polling_3s");
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Ya no necesitamos 'stats' locales aquí.

  return (
    <main className="min-h-screen pb-20">
      {/* Header / Nav */}
      <nav className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-black italic text-white text-sm">JF</div>
            <h1 className="text-xl font-bold tracking-tight">JFNN <span className="text-neutral-500 font-medium">Omnicanal</span></h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Indicador de Actividad del Socket */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300 ${isSyncing ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
              <div className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-green-500 animate-pulse' : 'bg-neutral-600'}`}></div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isSyncing ? 'text-green-500' : 'text-neutral-500'}`}>
                {isSyncing ? 'Sincronizando' : 'Socket OK'}
              </span>
            </div>

            <button
              onClick={() => view === 'historial' ? fetchHistorial() : fetchPendientes("Boton_Actualizar_Manual")}
              className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors"
              title="Actualizar"
            >
              <RefreshCcw size={18} className={loading ? "animate-spin" : ""} />
            </button>
            <Link href="/verificacion" className="p-2 hover:bg-yellow-500/20 rounded-lg text-yellow-500 transition-colors" title="Verificación de Pagos">
              <ShieldCheck size={18} />
            </Link>
            {(userRole === 'admin' || userRole === 'soporte') && (
              <Link href="/admin/estadisticas" className="p-2 hover:bg-cyan-500/20 rounded-lg text-cyan-400 transition-colors" title="Estadísticas Admin">
                <BarChart3 size={18} />
              </Link>
            )}
            {userRole === 'soporte' && (
              <>
                <Link href="/soporte/logs" className="p-2 hover:bg-amber-500/20 rounded-lg text-amber-400 transition-colors" title="Auditoría (soporte)">
                  <ShieldCheck size={18} />
                </Link>
                <Link href="/soporte/herramientas" className="p-2 hover:bg-amber-500/20 rounded-lg text-amber-400 transition-colors" title="Herramientas de soporte">
                  <Wrench size={18} />
                </Link>
                <Link href="/soporte/productos" className="p-2 hover:bg-amber-500/20 rounded-lg text-amber-400 transition-colors" title="Productos solicitados (pesquisa de stock)">
                  <PackageSearch size={18} />
                </Link>
              </>
            )}
            <Link href="/settings" className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors" title="Ajustes">
              <Settings size={18} />
            </Link>
            <button
              onClick={requestPermission}
              className={`relative p-2 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer ${permission === 'granted' ? 'text-accent' : 'text-neutral-400'}`}
              title={permission === 'granted' ? 'Notificaciones activadas' : permission === 'denied' ? 'Notificaciones bloqueadas (revisa permisos del navegador)' : 'Activar notificaciones'}
            >
              {permission === 'granted' ? <BellRing size={18} /> : <Bell size={18} />}
              {quotes.length > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-background"></span>
              )}
            </button>
            <div className="h-8 w-[1px] bg-white/10 mx-2"></div>
            <div className="flex items-center gap-3">
              {userRole === 'vendedor' && vendedorNombre ? (
                <button
                  onClick={handleOpenIdentitySelector}
                  className="text-right hidden sm:block hover:opacity-80 transition-opacity"
                  title="Cambiar identidad"
                >
                  <p className="text-xs font-bold">👤 {vendedorNombre}</p>
                  <p className="text-[10px] text-neutral-500">📍 {userSucursal ?? ''}</p>
                </button>
              ) : (
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold">JFNN Repuestos</p>
                  <p className="text-[10px] text-neutral-500 capitalize">{userRole}</p>
                </div>
              )}
              <div
                className={`w-9 h-9 rounded-full bg-gradient-to-tr from-accent to-blue-300 flex items-center justify-center text-white text-xs font-bold ${userRole === 'vendedor' && vendedorNombre ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                onClick={userRole === 'vendedor' && vendedorNombre ? handleOpenIdentitySelector : undefined}
                title={userRole === 'vendedor' && vendedorNombre ? 'Cambiar identidad' : undefined}
              >
                {userRole === 'admin' ? '★' : vendedorNombre ? vendedorNombre.charAt(0).toUpperCase() : 'V'}
              </div>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-red-500/10 rounded-lg text-neutral-500 hover:text-red-400 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6">
        {/* KPI Panel (hidden in chat view) */}
        {view !== 'conversaciones' && (userRole === 'admin' || userRole === 'soporte') && (
          <>
            <DashboardMetrics />
            <AgentMetrics />
          </>
        )}

        {/* Hero Section */}
        <header className={view === 'conversaciones' ? 'py-6' : 'py-12'}>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <button
                  onClick={() => setView('pendientes')}
                  className={`text-3xl font-extrabold tracking-tight transition-all ${view === 'pendientes' ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'}`}
                >
                  Bandeja de Entrada
                </button>
                <span className="text-3xl font-extrabold text-neutral-800">/</span>
                <button
                  onClick={() => setView('historial')}
                  className={`text-3xl font-extrabold tracking-tight transition-all ${view === 'historial' ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'}`}
                >
                  Historial
                </button>
                <span className="text-3xl font-extrabold text-neutral-800">/</span>
                <button
                  onClick={() => setView('conversaciones')}
                  className={`text-3xl font-extrabold tracking-tight transition-all ${view === 'conversaciones' ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'}`}
                >
                  Chat
                </button>
              </div>
              <p className="text-neutral-500">
                {view === 'pendientes' ? 'Solicitudes activas y cierres automáticos.' :
                 view === 'historial' ? 'Registro de ventas finalizadas y entregadas.' :
                 'Mensajes de WhatsApp en tiempo real.'}
              </p>
            </div>

            {view !== 'conversaciones' && (
              <div className={`glass px-6 py-2 rounded-xl flex items-center gap-3 transition-all ${view === 'pendientes' ? 'opacity-100' : 'opacity-50'}`}>
                <div className={`w-2 h-2 rounded-full animate-pulse ${view === 'pendientes' ? 'bg-green-500' : 'bg-neutral-500'}`}></div>
                <span className="text-sm font-bold text-neutral-300">
                  {view === 'pendientes' ? `Live: ${quotes.length} alertas` : `${quotes.length} registros`}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Filters (hidden in conversaciones view) */}
        <div className={`flex items-center gap-2 pb-6 overflow-x-auto no-scrollbar ${view === 'conversaciones' ? 'hidden' : ''}`}>
          {(view === 'pendientes' ? [
            { id: 'todos', label: 'Todos' },
            { id: 'ESPERANDO_VENDEDOR', label: 'Esperando Precios' },
            { id: 'CONFIRMANDO_COMPRA', label: 'Cierres' },
            { id: 'ESPERANDO_APROBACION_ADMIN', label: 'Revisión Admin' },
            { id: 'POR_LLEGAR', label: '📦 Por Llegar' },
            { id: 'ESPERANDO_RETIRO', label: 'Esperando Retiro' },
            { id: 'CICLO_COMPLETO', label: 'Por Validar Pago' },
            { id: 'PAGO_VERIFICADO', label: 'Pagados' }
          ] : [
            { id: 'todos', label: 'Todos' },
            { id: 'ENTREGADO', label: '✅ Ventas Completas' },
            { id: 'ARCHIVADO', label: '📦 Archivados' },
          ]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${filter === f.id
                ? 'bg-accent border-accent text-white'
                : 'bg-white/5 border-white/10 text-neutral-500 hover:border-white/20'
                }`}
            >
              {f.label}
            </button>
          ))}

          {/* Selector de sucursal (admin y soporte) */}
          {(userRole === 'admin' || userRole === 'soporte') && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
              <span className="text-[9px] font-bold uppercase tracking-widest text-neutral-600">Sucursal:</span>
              {(['todas', 'Melipilla', 'San Felipe'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setAdminSucursalFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${adminSucursalFilter === s
                    ? 'bg-accent border-accent text-white'
                    : 'bg-white/5 border-white/10 text-neutral-500 hover:border-white/20'
                    }`}
                >
                  {s === 'todas' ? 'Todas' : s}
                </button>
              ))}
            </div>
          )}

          {/* Búsqueda */}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por teléfono, nombre o vehículo..."
              className="pl-9 pr-4 py-1.5 rounded-full text-xs bg-white/5 border border-white/10 text-neutral-300 placeholder:text-neutral-600 focus:border-accent/50 focus:outline-none transition-colors w-72"
            />
          </div>
        </div>

        {/* Grid / Table */}
        <section>
          {view === 'conversaciones' ? (
            /* ── Vista Conversaciones: Chat en tiempo real ── */
            <ConversacionesPanel
              sucursalFilter={
                userRole === 'vendedor' ? userSucursal :
                adminSucursalFilter !== 'todas' ? adminSucursalFilter : null
              }
              onNewMessage={notifyAll}
              targetPhone={chatTargetPhone}
            />
          ) : loading && quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 glass rounded-3xl animate-pulse">
              <div className="w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin mb-4"></div>
              <p className="text-neutral-500 font-medium">Sincronizando...</p>
            </div>
          ) : quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 glass rounded-3xl border-dashed border-2 border-neutral-800">
              <LayoutDashboard size={48} className="text-neutral-800 mb-4" />
              <p className="text-neutral-500 font-medium">No hay registros en esta sección.</p>
            </div>
          ) : view === 'pendientes' ? (
            /* ── Vista Pendientes: Tabla Compacta ── */
            <BandejaTable
              quotes={quotes}
              filter={filter}
              searchQuery={searchQuery}
              onOpenDetail={(quote) => setSelectedQuote(quote)}
              onOpenChat={(phone) => { setChatTargetPhone(phone); setView('conversaciones'); }}
              onRefresh={() => fetchPendientes('onRefresh_PauseToggle')}
            />
          ) : (
            /* ── Vista Historial: Tabla Compacta ── */
            <HistorialTable
              quotes={quotes}
              filter={filter}
              searchQuery={searchQuery}
              onOpenDetail={(quote) => setSelectedQuote(quote)}
            />
          )}
        </section>

        {/* Modal de detalle (funciona para ambas vistas) */}
        {selectedQuote && (
          <div className="fixed inset-0 z-50">
            <QuoteCard
              key={selectedQuote.id || selectedQuote.phone}
              phone={selectedQuote.phone}
              estado={selectedQuote.estado}
              entidades={selectedQuote.entidades}
              sucursal={selectedQuote.sucursal ?? null}
              ultimoMensaje={selectedQuote.ultimo_mensaje}
              pedidoId={/* eslint-disable-next-line @typescript-eslint/no-explicit-any */ (selectedQuote as any).isPedido && typeof (selectedQuote as any).id === 'number' ? (selectedQuote as any).id : null}
              onResponded={() => { setSelectedQuote(null); view === 'historial' ? fetchHistorial() : fetchPendientes('onResponded_Modal'); }}
              autoOpen={true}
              onClose={() => setSelectedQuote(null)}
            />
          </div>
        )}
      </div>

      <NotificationToast toasts={toasts} onRemove={removeToast} />

      {/* Selector de identidad de vendedor */}
      {userRole === 'vendedor' && userSucursal && (
        <IdentitySelector
          open={identitySelectorOpen}
          sucursal={userSucursal}
          onSelect={handleIdentitySelect}
          onClose={() => setIdentitySelectorOpen(false)}
          dismissible={!!vendedorNombre}
        />
      )}
    </main>
  );
}
