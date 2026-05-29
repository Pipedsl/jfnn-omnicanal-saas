"use client";

import { useEffect, useState, useRef } from "react";
import { MessageCircle, Image, Mic, Video, FileText, ArrowLeft, User, Bot, Clock, Timer, AlertTriangle, Send, ChevronDown, Plus, X, PauseCircle, PlayCircle, Bookmark, BookmarkCheck, Paperclip, Ban, FileSpreadsheet, Search, PencilLine } from "lucide-react";
import { api } from "@/lib/api";
import { safeGet } from "@/lib/storage";
import SellerActionForm from "./SellerActionForm";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

interface ConsultaPendiente {
  texto: string;
  momento?: string;
  item_relacionado?: string | null;
}

interface MarcaConversacion {
  vendedor: string;
  momento: string;
  nota?: string | null;
}

interface Conversacion {
  phone: string;
  sucursal: string | null;
  estado: string | null;
  nombre_cliente: string | null;
  marca_modelo: string | null;
  ultimo_mensaje_at: string;
  ultimo_contenido: string | null;
  total_entrantes: number;
  agente_pausado: boolean;
  consulta_pendiente: ConsultaPendiente | null;
  marca: MarcaConversacion | null;
}

interface Mensaje {
  id: number | string; // string para mensajes optimistas pendientes
  direccion: "entrante" | "saliente";
  tipo: "text" | "image" | "audio" | "video" | "document";
  contenido: string | null;
  media_url: string | null;
  media_mime: string | null;
  transcripcion: string | null;
  autor: "cliente" | "agente_ia" | "vendedor";
  autor_nombre: string | null;
  // Flag local para UI optimista: 'pending' al crearse, 'sent' al confirmar, 'failed' si error
  _status?: "pending" | "sent" | "failed";
  // Si la imagen falló al subir pero el media_id sigue vigente en Meta, se puede reintentar
  media_recuperable?: boolean;
  created_at: string;
}

interface Ventana24h {
  ultimo_entrante_at: string;
  expira_at: string;
}

interface PlantillaHSM {
  id: string;
  nombre: string;
  descripcion: string;
  params: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntidadesSesion = any;

interface ChatData {
  phone: string;
  estado: string | null;
  nombre_cliente: string | null;
  sucursal: string | null;
  agente_pausado: boolean;
  consulta_pendiente: ConsultaPendiente | null;
  marca: MarcaConversacion | null;
  entidades: EntidadesSesion | null;
  ventana_24h: Ventana24h | null;
  mensajes: Mensaje[];
}

function formatPhone(phone: string): string {
  if (phone.length === 11 && phone.startsWith("56")) {
    return `+56 ${phone[2]} ${phone.slice(3, 7)} ${phone.slice(7)}`;
  }
  return `+${phone}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function getVentanaStatus(ventana: Ventana24h | null): { label: string; color: "green" | "yellow" | "red"; expired: boolean } {
  if (!ventana) return { label: "Sin mensajes", color: "red", expired: true };
  const remaining = new Date(ventana.expira_at).getTime() - Date.now();
  if (remaining <= 0) return { label: "Expirada", color: "red", expired: true };
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  if (hours < 4) return { label: `${hours}h ${mins}m`, color: "yellow", expired: false };
  return { label: `${hours}h ${mins}m`, color: "green", expired: false };
}

const ESTADO_LABELS: Record<string, string> = {
  PERFILANDO: "Perfilando",
  ESPERANDO_VENDEDOR: "Esperando Precios",
  CONFIRMANDO_COMPRA: "Confirmando",
  ESPERANDO_COMPROBANTE: "Esp. Comprobante",
  ESPERANDO_APROBACION_ADMIN: "Rev. Admin",
  PAGO_VERIFICADO: "Pagado",
  ESPERANDO_RETIRO: "Retiro",
  DESPACHADO: "Despachado",
  ENTREGADO: "Entregado",
  ARCHIVADO: "Archivado",
  ABONO_VERIFICADO: "Abono OK",
  ENCARGO_SOLICITADO: "Encargo",
  ESPERANDO_SALDO: "Esp. Saldo",
};

const TIPO_ICON: Record<string, React.ReactNode> = {
  image: <Image size={14} />,
  audio: <Mic size={14} />,
  video: <Video size={14} />,
  document: <FileText size={14} />,
};

export default function ConversacionesPanel({ sucursalFilter, onNewMessage, targetPhone }: { sucursalFilter?: string | null; onNewMessage?: (title: string, body: string) => void; targetPhone?: string | null }) {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatData | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef<number>(0);
  // Trackeamos total_entrantes (no timestamp) porque ultimo_mensaje_at cambia
  // también cuando la IA o el vendedor responden — eso disparaba falsas alertas.
  // Solo notificamos cuando aumenta el conteo de mensajes ENTRANTES del cliente.
  const prevEntrantesRef = useRef<Map<string, number>>(new Map());
  const [, setTick] = useState(0);
  const [plantillas, setPlantillas] = useState<PlantillaHSM[]>([]);
  const [showPlantillas, setShowPlantillas] = useState(false);
  const [sendingPlantilla, setSendingPlantilla] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const busquedaRef = useRef("");
  const [sendingImage, setSendingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [showCotizarModal, setShowCotizarModal] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api.get(`${API_URL}/api/dashboard/plantillas-hsm`)
      .then(res => setPlantillas(res.data || []))
      .catch(() => {});
  }, []);

  const sendPlantilla = async (plantilla: PlantillaHSM) => {
    if (!selectedPhone || !chat) return;
    setSendingPlantilla(plantilla.id);
    try {
      const params: Record<string, string> = {};
      if (plantilla.params.includes("nombre") && chat.nombre_cliente) {
        params.nombre = chat.nombre_cliente;
      }
      const vendedorNombre = safeGet("jfnn_vendedor_nombre");
      await api.post(`${API_URL}/api/dashboard/conversaciones/${selectedPhone}/plantilla`, {
        plantilla_id: plantilla.id,
        params,
        vendedor_nombre: vendedorNombre,
      });
      setShowPlantillas(false);
      fetchChat(selectedPhone, false);
    } catch (err) {
      console.error("[Plantilla] Error:", err);
      alert("Error al enviar plantilla. Puede que no esté aprobada en Meta aún.");
    } finally {
      setSendingPlantilla(null);
    }
  };

  const togglePausa = async () => {
    if (!selectedPhone || !chat) return;
    const nuevoPausado = !chat.agente_pausado;
    try {
      await api.patch(`${API_URL}/api/dashboard/sessions/${selectedPhone}/pausa`, { pausado: nuevoPausado });
      setChat(prev => prev ? { ...prev, agente_pausado: nuevoPausado } : prev);
    } catch (err) {
      console.error("[Pausa] Error:", err);
    }
  };

  const resolverConsulta = async () => {
    if (!selectedPhone) return;
    try {
      await api.post(`${API_URL}/api/dashboard/sessions/${selectedPhone}/consulta-resuelta`);
      setChat(prev => prev ? { ...prev, consulta_pendiente: null, agente_pausado: false } : prev);
    } catch (err) {
      console.error("[Consulta] Error resolviendo:", err);
    }
  };

  const cancelarRespuestaIA = async () => {
    if (!selectedPhone) return;
    try {
      const res = await api.post(`${API_URL}/api/dashboard/sessions/${selectedPhone}/cancelar-debounce`);
      if (res.data?.habia_pendiente) {
        alert("🛑 Respuesta IA pendiente cancelada. La IA no responderá a los últimos mensajes del cliente.");
      } else {
        alert("No había respuesta IA pendiente en este momento.");
      }
    } catch (err) {
      console.error("[Cancelar IA] Error:", err);
    }
  };

  const reprocesarMedia = async (mensajeId: number | string) => {
    try {
      const res = await api.post(`${API_URL}/api/dashboard/mensajes/${mensajeId}/reprocesar-media`);
      if (res.data?.media_url || res.data?.ya_tenia) {
        if (selectedPhone) fetchChat(selectedPhone, false);
      } else {
        alert("No se pudo recuperar la imagen.");
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert("No se pudo recuperar: " + (e.response?.data?.error || "error desconocido"));
    }
  };

  const handleImageSelect = async (file: File) => {
    if (!selectedPhone || !file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("Imagen demasiado grande. Máximo 10MB.");
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert("Formato no soportado. Usa JPEG, PNG o WebP.");
      return;
    }
    const caption = prompt("Texto opcional para acompañar la imagen (caption):", "");
    setSendingImage(true);
    try {
      // Convertir a base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const vendedorNombre = safeGet("jfnn_vendedor_nombre");
      await api.post(`${API_URL}/api/dashboard/conversaciones/${selectedPhone}/imagen`, {
        imagen_base64: base64,
        mime_type: file.type,
        caption: caption || undefined,
        vendedor_nombre: vendedorNombre
      });
      fetchChat(selectedPhone, false);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { code?: string; error?: string } } };
      if (axiosErr.response?.data?.code === 'WINDOW_CLOSED') {
        alert("Ventana de 24h cerrada. Usa una plantilla HSM primero.");
      } else {
        console.error("[Imagen] Error:", err);
        alert("Error al enviar imagen: " + (axiosErr.response?.data?.error || 'desconocido'));
      }
    } finally {
      setSendingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const toggleMarca = async () => {
    if (!selectedPhone || !chat) return;
    try {
      if (chat.marca) {
        // Desmarcar
        await api.post(`${API_URL}/api/dashboard/sessions/${selectedPhone}/desmarcar`);
        setChat(prev => prev ? { ...prev, marca: null } : prev);
      } else {
        // Marcar — pedir nota opcional
        const nota = prompt(
          "Marcar conversación para seguimiento (tipo pin).\n\nNota opcional (qué estabas hablando, en qué quedó):",
          ""
        );
        if (nota === null) return; // cancelado
        const vendedor = safeGet("jfnn_vendedor_nombre") || "Sistema";
        const res = await api.post(`${API_URL}/api/dashboard/sessions/${selectedPhone}/marcar`, {
          vendedor_nombre: vendedor,
          nota: nota || undefined
        });
        setChat(prev => prev ? { ...prev, marca: res.data.marca } : prev);
      }
    } catch (err) {
      console.error("[Marca] Error:", err);
    }
  };

  const sendMessage = async () => {
    if (!selectedPhone || !messageText.trim() || sendingMessage) return;
    const texto = messageText.trim();
    const vendedorNombre = safeGet("jfnn_vendedor_nombre");
    const tempId = `temp_${Date.now()}`;

    // UI optimista: mostrar el mensaje inmediatamente con estado "pending"
    const optimisticMsg: Mensaje = {
      id: tempId,
      direccion: "saliente",
      tipo: "text",
      contenido: texto,
      media_url: null,
      media_mime: null,
      transcripcion: null,
      autor: "vendedor",
      autor_nombre: vendedorNombre,
      created_at: new Date().toISOString(),
      _status: "pending"
    };
    setChat(prev => prev ? { ...prev, mensajes: [...prev.mensajes, optimisticMsg] } : prev);
    setMessageText("");
    setSendingMessage(true);

    try {
      await api.post(`${API_URL}/api/dashboard/conversaciones/${selectedPhone}/mensaje`, {
        texto,
        vendedor_nombre: vendedorNombre,
      });
      // Marcar como enviado y luego refrescar (el refetch lo reemplazará con el real)
      setChat(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          mensajes: prev.mensajes.map(m => m.id === tempId ? { ...m, _status: "sent" } : m)
        };
      });
      if (chat && !chat.agente_pausado) {
        api.patch(`${API_URL}/api/dashboard/sessions/${selectedPhone}/pausa`, { pausado: true }).catch(() => {});
        setChat(prev => prev ? { ...prev, agente_pausado: true } : prev);
      }
      // Refresh en background para reemplazar el optimista con el real
      fetchChat(selectedPhone, false);
    } catch (err: unknown) {
      // Marcar mensaje como failed
      setChat(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          mensajes: prev.mensajes.map(m => m.id === tempId ? { ...m, _status: "failed" } : m)
        };
      });
      const axiosErr = err as { response?: { data?: { code?: string } } };
      if (axiosErr.response?.data?.code === "WINDOW_CLOSED") {
        alert("Ventana de 24h cerrada. Usa una plantilla HSM para contactar al cliente.");
      } else {
        console.error("[Mensaje] Error:", err);
      }
    } finally {
      setSendingMessage(false);
    }
  };

  const normalizePhone = (input: string): string => {
    const digits = input.replace(/\D/g, "");
    if (digits.startsWith("56") && digits.length >= 11) return digits;
    if (digits.startsWith("9") && digits.length === 9) return `56${digits}`;
    return digits;
  };

  const startNewConversation = async (plantilla: PlantillaHSM) => {
    const phone = normalizePhone(newPhone);
    if (phone.length < 10) { alert("Número inválido"); return; }
    setSendingPlantilla(plantilla.id);
    try {
      const vendedorNombre = safeGet("jfnn_vendedor_nombre");
      // Las plantillas HSM requieren rellenar TODOS los params declarados,
      // sino Meta rechaza. Como es conversación nueva (sin nombre conocido), usamos
      // placeholders neutros.
      const defaultParams: Record<string, string> = {
        nombre: "",
        sucursal: "Melipilla",
        cantidad: "tus repuestos"
      };
      const params: Record<string, string> = {};
      (plantilla.params || []).forEach(p => { params[p] = defaultParams[p] ?? ""; });
      await api.post(`${API_URL}/api/dashboard/conversaciones/${phone}/plantilla`, {
        plantilla_id: plantilla.id,
        params,
        vendedor_nombre: vendedorNombre,
      });
      setShowNewConv(false);
      setNewPhone("");
      setSelectedPhone(phone);
      fetchConversaciones(false);
      fetchChat(phone, true);
    } catch (err) {
      console.error("[NuevaConv] Error:", err);
      alert("Error al enviar plantilla. Verifica el número y que la plantilla esté aprobada en Meta.");
    } finally {
      setSendingPlantilla(null);
    }
  };

  const fetchConversaciones = async (isInitial = false) => {
    try {
      const params = new URLSearchParams();
      if (sucursalFilter) params.set("sucursal", sucursalFilter);
      if (busquedaRef.current.trim()) params.set("q", busquedaRef.current.trim());
      params.set("t", String(Date.now()));
      const res = await api.get(`${API_URL}/api/dashboard/conversaciones?${params.toString()}`);
      const list: Conversacion[] = res.data || [];

      // Notificar SOLO cuando aumenta el conteo de mensajes ENTRANTES del cliente.
      // Antes usábamos ultimo_mensaje_at que también cambia con respuestas IA/vendedor → falsas alertas.
      if (onNewMessage && prevEntrantesRef.current.size > 0) {
        for (const conv of list) {
          const prevCount = prevEntrantesRef.current.get(conv.phone);
          const currentCount = Number(conv.total_entrantes) || 0;
          if (typeof prevCount === 'number' && currentCount > prevCount && conv.phone !== selectedPhone) {
            onNewMessage("Mensaje nuevo", `${conv.nombre_cliente || formatPhone(conv.phone)}: ${conv.ultimo_contenido || "📎 Media"}`);
            break;
          }
        }
      }
      prevEntrantesRef.current = new Map(list.map(c => [c.phone, Number(c.total_entrantes) || 0]));

      setConversaciones(list);
    } catch (err) {
      console.error("[Conversaciones] Error fetching list:", err);
    } finally {
      if (isInitial) setLoadingList(false);
    }
  };

  const fetchChat = async (phone: string, isInitial = false) => {
    if (isInitial) setLoadingChat(true);
    try {
      const res = await api.get(`${API_URL}/api/dashboard/conversaciones/${phone}?t=${Date.now()}`);
      setChat(res.data);
    } catch (err) {
      console.error("[Conversaciones] Error fetching chat:", err);
    } finally {
      if (isInitial) setLoadingChat(false);
    }
  };

  useEffect(() => {
    fetchConversaciones(true);
    const interval = setInterval(() => fetchConversaciones(false), 4000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalFilter]);

  // Búsqueda con debounce: al cambiar `busqueda`, esperar 350ms y refrescar la lista
  useEffect(() => {
    busquedaRef.current = busqueda;
    const t = setTimeout(() => fetchConversaciones(true), 350);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  useEffect(() => {
    if (selectedPhone) {
      fetchChat(selectedPhone, true);
      const interval = setInterval(() => fetchChat(selectedPhone, false), 4000);
      return () => clearInterval(interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);

  // Abrir directamente la conversación indicada desde la bandeja (clic en nombre/teléfono).
  useEffect(() => {
    if (targetPhone) {
      setSelectedPhone(targetPhone);
    }
  }, [targetPhone]);

  useEffect(() => {
    const count = chat?.mensajes?.length ?? 0;
    if (count > 0 && count !== prevMsgCountRef.current) {
      prevMsgCountRef.current = count;
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat?.mensajes]);

  const handleSelectConv = (phone: string) => {
    if (phone !== selectedPhone) {
      setSelectedPhone(phone);
      setChat(null); // limpia para evitar mostrar chat anterior con datos viejos
    }
  };

  return (
    <div className="flex h-[calc(100vh-320px)] min-h-[500px] glass rounded-2xl overflow-hidden border border-white/5">
      {/* Lista de conversaciones */}
      <div className={`${selectedPhone ? "hidden md:flex" : "flex"} flex-col w-full md:w-96 border-r border-white/5`}>
        <div className="p-4 border-b border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
              <MessageCircle size={16} />
              Conversaciones ({conversaciones.length})
            </h3>
            <button
              onClick={() => setShowNewConv(true)}
              className="p-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent transition-colors"
              title="Nueva conversación"
            >
              <Plus size={14} />
            </button>
          </div>
          {/* Buscador: por número, nombre o palabra clave en los mensajes */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por número, nombre o palabra..."
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-accent/30"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-white/10 rounded"
                title="Limpiar"
              >
                <X size={12} className="text-neutral-500" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-white/5 flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/2 rounded bg-white/5" />
                    <div className="h-2 w-2/3 rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversaciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-neutral-600">
              <MessageCircle size={24} className="mb-2" />
              <p className="text-xs">Sin conversaciones</p>
            </div>
          ) : (
            conversaciones.map((conv) => (
              <button
                key={conv.phone}
                onClick={() => handleSelectConv(conv.phone)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors border-l-2 ${
                  selectedPhone === conv.phone
                    ? "bg-accent/10 border-l-accent"
                    : conv.consulta_pendiente
                      ? "border-l-red-500/60 bg-red-500/[0.04]"
                      : conv.marca
                        ? "border-l-purple-500/60 bg-purple-500/[0.03]"
                        : conv.agente_pausado
                          ? "border-l-yellow-500/50 bg-yellow-500/[0.02]"
                          : "border-l-transparent"
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-accent">
                        {conv.nombre_cliente ? conv.nombre_cliente.charAt(0).toUpperCase() : "#"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-200 truncate">
                        {conv.nombre_cliente || formatPhone(conv.phone)}
                      </p>
                      {conv.nombre_cliente && (
                        <p className="text-[10px] text-neutral-500">{formatPhone(conv.phone)}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-neutral-500 flex-shrink-0 ml-2">
                    {timeAgo(conv.ultimo_mensaje_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 pl-10 gap-2">
                  <p className="text-xs text-neutral-500 truncate max-w-[200px]">
                    {conv.ultimo_contenido || "📎 Media"}
                  </p>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {conv.marca && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1"
                        title={`Marcado por ${conv.marca.vendedor}${conv.marca.nota ? ': ' + conv.marca.nota : ''}`}
                      >
                        🔖
                      </span>
                    )}
                    {conv.consulta_pendiente && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 flex items-center gap-1 animate-pulse"
                        title={`Consulta del cliente: "${conv.consulta_pendiente.texto}"`}
                      >
                        ❓ Consulta
                      </span>
                    )}
                    {!conv.consulta_pendiente && conv.agente_pausado && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 flex items-center gap-1 animate-pulse"
                        title="IA pausada — requiere atención del vendedor"
                      >
                        ⏸ IA
                      </span>
                    )}
                    {conv.estado && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-neutral-400">
                        {ESTADO_LABELS[conv.estado] || conv.estado}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Timeline */}
      <div className={`${selectedPhone ? "flex" : "hidden md:flex"} flex-col flex-1`}>
        {!selectedPhone ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-600">
            <MessageCircle size={48} className="mb-4" />
            <p className="text-sm font-medium">Selecciona una conversación</p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <button
                onClick={() => setSelectedPhone(null)}
                className="md:hidden p-1 hover:bg-white/10 rounded-lg"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-sm font-bold text-accent">
                  {chat?.nombre_cliente ? chat.nombre_cliente.charAt(0).toUpperCase() : "#"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-200">
                  {chat?.nombre_cliente || formatPhone(selectedPhone)}
                </p>
                <div className="flex items-center gap-2">
                  {chat?.estado && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                      {ESTADO_LABELS[chat.estado] || chat.estado}
                    </span>
                  )}
                  {chat?.sucursal && (
                    <span className="text-[10px] text-neutral-500">📍 {chat.sucursal}</span>
                  )}
                  {chat?.agente_pausado && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500">
                      IA Pausada
                    </span>
                  )}
                  {(() => {
                    const v = getVentanaStatus(chat?.ventana_24h ?? null);
                    const colorMap = { green: "text-emerald-400 bg-emerald-500/10", yellow: "text-yellow-400 bg-yellow-500/10", red: "text-red-400 bg-red-500/10" };
                    return (
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 ${colorMap[v.color]}`}>
                        {v.expired ? <AlertTriangle size={9} /> : <Timer size={9} />}
                        {v.expired ? "Ventana cerrada" : v.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setShowCotizarModal(true)}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30 flex items-center gap-1.5 transition-colors"
                  title={["CONFIRMANDO_COMPRA", "ESPERANDO_COMPROBANTE"].includes(chat?.estado || "")
                    ? "Rectificar la cotización ya enviada (reemplaza la anterior y reenvía al cliente)"
                    : "Enviar cotización formal al cliente desde aquí (no requiere salir del chat)"}
                >
                  {["CONFIRMANDO_COMPRA", "ESPERANDO_COMPROBANTE"].includes(chat?.estado || "")
                    ? (<><PencilLine size={12} />Rectificar</>)
                    : (<><FileSpreadsheet size={12} />Cotizar</>)}
                </button>
                {!chat?.agente_pausado && (
                  <button
                    onClick={cancelarRespuestaIA}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/30 flex items-center gap-1.5 transition-colors"
                    title="Cancelar respuesta IA pendiente del cliente — útil si vas a contestar tú"
                  >
                    <Ban size={12} />
                    Stop IA
                  </button>
                )}
                <button
                  onClick={toggleMarca}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                    chat?.marca
                      ? "bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/30"
                      : "bg-white/5 text-neutral-400 hover:bg-white/10"
                  }`}
                  title={chat?.marca
                    ? `Marcado por ${chat.marca.vendedor}${chat.marca.nota ? ': ' + chat.marca.nota : ''} — click para desmarcar`
                    : "Marcar conversación para seguimiento (pin)"
                  }
                >
                  {chat?.marca ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                  {chat?.marca ? "Marcado" : "Marcar"}
                </button>
                <button
                  onClick={togglePausa}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                    chat?.agente_pausado
                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20"
                  }`}
                  title={chat?.agente_pausado ? "Reanudar respuestas automáticas" : "Pausar respuestas automáticas"}
                >
                  {chat?.agente_pausado ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                  {chat?.agente_pausado ? "Reanudar IA" : "Pausar IA"}
                </button>
              </div>
            </div>

            {/* Banner consulta pendiente */}
            {chat?.consulta_pendiente && (
              <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/30 flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle size={14} className="text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-0.5">Consulta del cliente — IA derivó al vendedor</p>
                  <p className="text-sm text-neutral-200 break-words">&ldquo;{chat.consulta_pendiente.texto}&rdquo;</p>
                  {chat.consulta_pendiente.item_relacionado && (
                    <p className="text-[11px] text-neutral-500 mt-1">📦 Sobre: {chat.consulta_pendiente.item_relacionado}</p>
                  )}
                </div>
                <button
                  onClick={resolverConsulta}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-500/25 transition-colors flex-shrink-0"
                  title="Marca la consulta resuelta y reanuda la IA"
                >
                  ✅ Resuelta
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loadingChat ? (
                <div className="space-y-3 animate-pulse">
                  <div className="flex justify-start"><div className="h-12 w-2/3 rounded-2xl bg-white/5" /></div>
                  <div className="flex justify-end"><div className="h-16 w-3/5 rounded-2xl bg-accent/10" /></div>
                  <div className="flex justify-start"><div className="h-10 w-1/2 rounded-2xl bg-white/5" /></div>
                  <div className="flex justify-end"><div className="h-14 w-2/3 rounded-2xl bg-accent/10" /></div>
                </div>
              ) : chat?.mensajes.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-neutral-600 text-xs">
                  Sin mensajes
                </div>
              ) : (
                chat?.mensajes.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direccion === "saliente" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                        msg.direccion === "saliente"
                          ? msg.autor === "vendedor"
                            ? "bg-blue-600/20 border border-blue-500/20"
                            : "bg-accent/20 border border-accent/20"
                          : "bg-white/5 border border-white/10"
                      }`}
                    >
                      {/* Author badge */}
                      <div className="flex items-center gap-1.5 mb-1">
                        {msg.autor === "cliente" && <User size={10} className="text-neutral-500" />}
                        {msg.autor === "agente_ia" && <Bot size={10} className="text-accent" />}
                        {msg.autor === "vendedor" && <User size={10} className="text-blue-400" />}
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${
                          msg.autor === "cliente" ? "text-neutral-500" :
                          msg.autor === "agente_ia" ? "text-accent" : "text-blue-400"
                        }`}>
                          {msg.autor === "cliente" ? "Cliente" :
                           msg.autor === "agente_ia" ? "IA" :
                           msg.autor_nombre || "Vendedor"}
                        </span>
                      </div>

                      {/* Media */}
                      {msg.tipo === "image" && msg.media_url && (
                        <img
                          src={msg.media_url}
                          alt="Imagen"
                          className="rounded-lg max-w-full max-h-64 mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(msg.media_url!, "_blank")}
                        />
                      )}
                      {msg.tipo === "audio" && msg.media_url && (
                        <audio controls className="max-w-full mb-2" preload="none">
                          <source src={msg.media_url} type={msg.media_mime || "audio/ogg"} />
                        </audio>
                      )}
                      {msg.tipo === "video" && msg.media_url && (
                        <video controls className="rounded-lg max-w-full max-h-64 mb-2" preload="none">
                          <source src={msg.media_url} type={msg.media_mime || "video/mp4"} />
                        </video>
                      )}
                      {msg.tipo === "document" && msg.media_url && (
                        <a
                          href={msg.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors mb-2"
                        >
                          <FileText size={16} className="text-neutral-400" />
                          <span className="text-xs text-neutral-300">Abrir documento</span>
                        </a>
                      )}

                      {/* Text / Caption */}
                      {msg.contenido && (
                        <p className="text-sm text-neutral-200 whitespace-pre-wrap break-words">{msg.contenido}</p>
                      )}

                      {/* Transcription */}
                      {msg.transcripcion && (
                        <p className="text-xs text-neutral-400 italic mt-1 border-t border-white/5 pt-1">
                          🎤 {msg.transcripcion}
                        </p>
                      )}

                      {/* Media type badge when no media_url */}
                      {msg.tipo !== "text" && !msg.media_url && !msg.contenido && (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5 text-neutral-500">
                            {TIPO_ICON[msg.tipo]}
                            <span className="text-xs capitalize">{msg.tipo}</span>
                          </div>
                          {msg.media_recuperable && (
                            <button
                              onClick={() => reprocesarMedia(msg.id)}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30 transition-colors flex items-center gap-1 w-fit"
                              title="Re-descargar la imagen desde WhatsApp (disponible ~14 días)"
                            >
                              🔄 Recuperar imagen
                            </button>
                          )}
                        </div>
                      )}

                      {/* Timestamp + status (estilo WhatsApp) */}
                      <div className="flex items-center gap-1 mt-1">
                        <Clock size={9} className="text-neutral-600" />
                        <span className="text-[9px] text-neutral-600">{formatTime(msg.created_at)}</span>
                        {msg._status === "pending" && (
                          <span className="text-[9px] text-neutral-600 ml-0.5" title="Enviando...">⏰</span>
                        )}
                        {msg._status === "sent" && (
                          <span className="text-[9px] text-accent ml-0.5" title="Enviado">✓</span>
                        )}
                        {msg._status === "failed" && (
                          <span className="text-[9px] text-red-400 ml-0.5" title="Error al enviar — toca para reintentar">⚠️</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Message Input + Template Toolbar */}
            <div className="border-t border-white/5 px-4 py-3 bg-white/[0.02] space-y-2">
              {(() => {
                const v = getVentanaStatus(chat?.ventana_24h ?? null);
                if (v.expired) {
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-red-400">
                        <AlertTriangle size={12} />
                        <span>Ventana de 24h cerrada — solo plantillas HSM</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {plantillas.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => sendPlantilla(p)}
                            disabled={sendingPlantilla !== null}
                            className="text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors disabled:opacity-50"
                          >
                            <p className="text-xs font-semibold text-neutral-200">{p.nombre}</p>
                            <p className="text-[10px] text-neutral-500">{p.descripcion}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <>
                    <div className="flex items-end gap-2">
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageSelect(file);
                        }}
                      />
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        disabled={sendingImage || sendingMessage}
                        className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 transition-colors"
                        title="Adjuntar imagen (JPEG/PNG/WebP, max 10MB)"
                      >
                        {sendingImage
                          ? <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                          : <Paperclip size={16} className="text-neutral-400" />}
                      </button>
                      <div className="relative flex-1">
                        <textarea
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                          }}
                          placeholder="Escribe un mensaje..."
                          rows={1}
                          className="w-full resize-none rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-accent/30 focus:ring-1 focus:ring-accent/20"
                        />
                      </div>
                      <button
                        onClick={sendMessage}
                        disabled={!messageText.trim() || sendingMessage}
                        className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent hover:bg-accent/80 disabled:opacity-30 disabled:hover:bg-accent transition-colors"
                      >
                        {sendingMessage
                          ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          : <Send size={16} className="text-white" />}
                      </button>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setShowPlantillas(!showPlantillas)}
                        className="flex items-center gap-2 px-3 py-1 rounded-lg hover:bg-white/5 transition-colors text-[10px] text-neutral-500"
                      >
                        Plantillas HSM
                        <ChevronDown size={10} className={`transition-transform ${showPlantillas ? "rotate-180" : ""}`} />
                      </button>
                      {showPlantillas && (
                        <div className="absolute bottom-full left-0 mb-2 w-80 bg-neutral-900 border border-white/10 rounded-xl shadow-xl p-2 space-y-1 z-10">
                          {plantillas.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => sendPlantilla(p)}
                              disabled={sendingPlantilla !== null}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                              <p className="text-xs font-semibold text-neutral-200">{p.nombre}</p>
                              <p className="text-[10px] text-neutral-500">{p.descripcion}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* New Conversation Modal */}
      {/* Modal: Cotizar desde el chat (SellerActionForm en overlay) */}
      {showCotizarModal && selectedPhone && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={() => setShowCotizarModal(false)}>
          <div
            className="bg-neutral-950 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <div>
                {["CONFIRMANDO_COMPRA", "ESPERANDO_COMPROBANTE"].includes(chat?.estado || "") ? (
                  <>
                    <h3 className="text-sm font-bold text-neutral-100">✏️ Rectificar cotización de {chat?.nombre_cliente || formatPhone(selectedPhone)}</h3>
                    <p className="text-[10px] text-neutral-500 mt-0.5">Se reemplazará la cotización anterior y se reenviará al cliente.</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-bold text-neutral-100">📋 Cotizar a {chat?.nombre_cliente || formatPhone(selectedPhone)}</h3>
                    <p className="text-[10px] text-neutral-500 mt-0.5">La cotización formal se enviará al cliente. La sesión pasará a CONFIRMANDO.</p>
                  </>
                )}
              </div>
              <button onClick={() => setShowCotizarModal(false)} className="p-1.5 hover:bg-white/10 rounded-lg">
                <X size={16} className="text-neutral-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SellerActionForm
                phone={selectedPhone}
                items={chat?.entidades?.repuestos_solicitados || []}
                vehiculos={chat?.entidades?.vehiculos || []}
                estado={chat?.estado || undefined}
                onResponded={() => {
                  setShowCotizarModal(false);
                  fetchChat(selectedPhone, false);
                  fetchConversaciones(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showNewConv && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowNewConv(false)}>
          <div className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-200">Nueva conversación</h3>
              <button onClick={() => setShowNewConv(false)} className="p-1 hover:bg-white/10 rounded-lg"><X size={16} className="text-neutral-400" /></button>
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Número de WhatsApp</label>
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+56 9 1234 5678"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-accent/30"
              />
              {newPhone && (
                <p className="text-[10px] text-neutral-500 mt-1">Se enviará a: +{normalizePhone(newPhone)}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-2">Selecciona una plantilla para iniciar</label>
              <div className="space-y-2">
                {plantillas.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => startNewConversation(p)}
                    disabled={!newPhone.trim() || sendingPlantilla !== null}
                    className="w-full text-left px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors disabled:opacity-30"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-neutral-200">{p.nombre}</p>
                        <p className="text-[10px] text-neutral-500">{p.descripcion}</p>
                      </div>
                      {sendingPlantilla === p.id
                        ? <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                        : <Send size={12} className="text-neutral-500" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
