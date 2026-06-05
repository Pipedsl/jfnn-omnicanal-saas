'use client';
import { useEffect, useState, useRef } from 'react';
import { api } from "@/lib/api";
import { BACKEND_URL } from '@/lib/api';
import { isObservador } from '@/lib/observadores';

interface UseQuoteLockResult {
    isLocked: boolean;      // true si OTRO vendedor lo tiene
    lockedBy: string | null; // nombre del que lo tiene
    lockToken: string | null; // token propio si lo agarramos
    loading: boolean;
    error: string | null;
}

export function useQuoteLock(phone: string | null, vendedor: string | null): UseQuoteLockResult {
    const [state, setState] = useState<UseQuoteLockResult>({
        isLocked: false,
        lockedBy: null,
        lockToken: null,
        loading: false,
        error: null
    });
    const tokenRef = useRef<string | null>(null);

    useEffect(() => {
        if (!phone || !vendedor) return;
        // Vendedor observador (entrenamiento) → no genera lock. Puede abrir el card
        // sin bloquear a otros vendedores que realmente quieran cotizar.
        if (isObservador(vendedor)) return;
        let mounted = true;
        let renewInterval: ReturnType<typeof setInterval> | undefined;

        const claim = async () => {
            setState((s) => ({ ...s, loading: true }));
            try {
                const res = await api.post(
                    `${BACKEND_URL}/api/dashboard/cotizaciones/${encodeURIComponent(phone)}/claim`,
                    { vendedor }
                );
                if (!mounted) return;
                if (res.data.success) {
                    tokenRef.current = res.data.lock_token;
                    setState({
                        isLocked: false,
                        lockedBy: null,
                        lockToken: res.data.lock_token,
                        loading: false,
                        error: null
                    });
                }
            } catch (e: unknown) {
                if (!mounted) return;
                const err = e as {
                    response?: { status?: number; data?: { lock_vendedor?: string } };
                    message?: string;
                };
                if (err.response?.status === 409) {
                    setState({
                        isLocked: true,
                        lockedBy: err.response.data?.lock_vendedor || 'otro vendedor',
                        lockToken: null,
                        loading: false,
                        error: null
                    });
                } else {
                    setState((s) => ({ ...s, loading: false, error: err.message || 'Error al reservar' }));
                }
            }
        };

        claim();

        // Renovar cada 4 min mientras el card está montado
        renewInterval = setInterval(() => { claim(); }, 4 * 60 * 1000);

        const handleBeforeUnload = () => {
            if (tokenRef.current) {
                navigator.sendBeacon(
                    `${BACKEND_URL}/api/dashboard/cotizaciones/${encodeURIComponent(phone)}/release`,
                    new Blob([JSON.stringify({ lock_token: tokenRef.current })], { type: 'application/json' })
                );
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            mounted = false;
            if (renewInterval) clearInterval(renewInterval);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (tokenRef.current) {
                api
                    .post(
                        `${BACKEND_URL}/api/dashboard/cotizaciones/${encodeURIComponent(phone)}/release`,
                        { lock_token: tokenRef.current }
                    )
                    .catch(() => {});
                tokenRef.current = null;
            }
        };
    }, [phone, vendedor]);

    return state;
}
