"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MessageCircle, X } from "lucide-react";

interface Toast {
  id: number;
  title: string;
  body: string;
  timestamp: number;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const addToast = useCallback((title: string, body: string) => {
    const toast: Toast = { id: nextId++, title, body, timestamp: Date.now() };
    setToasts(prev => [toast, ...prev].slice(0, 5));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toast.id));
    }, 6000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

export default function NotificationToast({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-24 right-6 z-[60] flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => setVisible(false), 5500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-accent/30 bg-neutral-900/95 backdrop-blur-md shadow-lg shadow-accent/10 transition-all duration-300 ${
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <MessageCircle size={14} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-neutral-200">{toast.title}</p>
        <p className="text-xs text-neutral-400 truncate">{toast.body}</p>
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="p-1 hover:bg-white/10 rounded-lg text-neutral-500 flex-shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}
