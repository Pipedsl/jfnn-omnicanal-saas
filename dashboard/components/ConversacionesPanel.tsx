"use client";

import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { MessageCircle, Image, Mic, Video, FileText, ArrowLeft, User, Bot, Clock, Timer, AlertTriangle, Send, ChevronDown, Plus, X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

interface Conversacion {
  phone: string;
  sucursal: string | null;
  estado: string | null;
  nombre_cliente: string | null;
  marca_modelo: string | null;
  ultimo_mensaje_at: string;
  ultimo_contenido: string | null;
  total_entrantes: number;
}

interface Mensaje {
  id: number;
  direccion: "entrante" | "saliente";
  tipo: "text" | "image" | "audio" | "video" | "document";
  contenido: string | null;
  media_url: string | null;
  media_mime: string | null;
  transcripcion: string | null;
  autor: "cliente" | "agente_ia" | "vendedor";
  autor_nombre: string | null;
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

interface ChatData {
  phone: string;
  estado: string | null;
  nombre_cliente: string | null;
  sucursal: string | null;
  agente_pausado: boolean;
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

export default function ConversacionesPanel({ sucursalFilter }: { sucursalFilter?: string | null }) {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatData | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef<number>(0);
  const [, setTick] = useState(0);
  const [plantillas, setPlantillas] = useState<PlantillaHSM[]>([]);
  const [showPlantillas, setShowPlantillas] = useState(false);
  const [sendingPlantilla, setSendingPlantilla] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/api/dashboard/plantillas-hsm`)
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
      const vendedorNombre = typeof window !== "undefined" ? localStorage.getItem("jfnn_vendedor_nombre") : null;
      await axios.post(`${API_URL}/api/dashboard/conversaciones/${selectedPhone}/plantilla`, {
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

  const sendMessage = async () => {
    if (!selectedPhone || !messageText.trim() || sendingMessage) return;
    setSendingMessage(true);
    try {
      const vendedorNombre = typeof window !== "undefined" ? localStorage.getItem("jfnn_vendedor_nombre") : null;
      await axios.post(`${API_URL}/api/dashboard/conversaciones/${selectedPhone}/mensaje`, {
        texto: messageText.trim(),
        vendedor_nombre: vendedorNombre,
      });
      setMessageText("");
      fetchChat(selectedPhone, false);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { code?: string } } };
      if (axiosErr.response?.data?.code === "WINDOW_CLOSED") {
        alert("Ventana de 24h cerrada. Usa una plantilla HSM para contactar al cliente.");
      } else {
        console.error("[Mensaje] Error:", err);
        alert("Error al enviar mensaje.");
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
      const vendedorNombre = typeof window !== "undefined" ? localStorage.getItem("jfnn_vendedor_nombre") : null;
      await axios.post(`${API_URL}/api/dashboard/conversaciones/${phone}/plantilla`, {
        plantilla_id: plantilla.id,
        params: {},
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
      params.set("t", String(Date.now()));
      const res = await axios.get(`${API_URL}/api/dashboard/conversaciones?${params.toString()}`);
      setConversaciones(res.data || []);
    } catch (err) {
      console.error("[Conversaciones] Error fetching list:", err);
    } finally {
      if (isInitial) setLoadingList(false);
    }
  };

  const fetchChat = async (phone: string, isInitial = false) => {
    if (isInitial) setLoadingChat(true);
    try {
      const res = await axios.get(`${API_URL}/api/dashboard/conversaciones/${phone}?t=${Date.now()}`);
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

  useEffect(() => {
    if (selectedPhone) {
      fetchChat(selectedPhone, true);
      const interval = setInterval(() => fetchChat(selectedPhone, false), 4000);
      return () => clearInterval(interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone]);

  useEffect(() => {
    const count = chat?.mensajes?.length ?? 0;
    if (count > 0 && count !== prevMsgCountRef.current) {
      prevMsgCountRef.current = count;
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat?.mensajes]);

  const handleSelectConv = (phone: string) => {
    setSelectedPhone(phone);
    setChat(null);
  };

  return (
    <div className="flex h-[calc(100vh-320px)] min-h-[500px] glass rounded-2xl overflow-hidden border border-white/5">
      {/* Lista de conversaciones */}
      <div className={`${selectedPhone ? "hidden md:flex" : "flex"} flex-col w-full md:w-96 border-r border-white/5`}>
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
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
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
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
                className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                  selectedPhone === conv.phone ? "bg-accent/10 border-l-2 border-l-accent" : ""
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
                <div className="flex items-center justify-between mt-1 pl-10">
                  <p className="text-xs text-neutral-500 truncate max-w-[200px]">
                    {conv.ultimo_contenido || "📎 Media"}
                  </p>
                  {conv.estado && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-neutral-400 flex-shrink-0 ml-2">
                      {ESTADO_LABELS[conv.estado] || conv.estado}
                    </span>
                  )}
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
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loadingChat ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
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
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          {TIPO_ICON[msg.tipo]}
                          <span className="text-xs capitalize">{msg.tipo}</span>
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className="flex items-center gap-1 mt-1">
                        <Clock size={9} className="text-neutral-600" />
                        <span className="text-[9px] text-neutral-600">{formatTime(msg.created_at)}</span>
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
