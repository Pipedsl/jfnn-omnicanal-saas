"use client";
import { useRef, useCallback, useEffect, useState } from "react";

let audioInstance: HTMLAudioElement | null = null;

function getAudio() {
    if (!audioInstance && typeof window !== "undefined") {
        audioInstance = new Audio("/sounds/notification.wav");
        audioInstance.volume = 0.6;
    }
    return audioInstance;
}

export function useNotifications() {
    const [permission, setPermission] = useState<NotificationPermission>("default");
    const lastNotifTime = useRef(0);

    useEffect(() => {
        if (typeof window !== "undefined" && "Notification" in window) {
            setPermission(Notification.permission);
        }
    }, []);

    const playSound = useCallback(() => {
        const audio = getAudio();
        if (!audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => {});
    }, []);

    const requestPermission = useCallback(async () => {
        if (typeof window === "undefined" || !("Notification" in window)) return;
        const result = await Notification.requestPermission();
        setPermission(result);
        // Reproduce sonido de prueba para desbloquear autoplay policy de Chrome
        playSound();
        return result;
    }, [playSound]);

    const notify = useCallback((title: string, body: string) => {
        const now = Date.now();
        if (now - lastNotifTime.current < 3000) return;
        lastNotifTime.current = now;

        playSound();

        if (permission !== "granted") return;
        if (document.visibilityState === "visible" && document.hasFocus()) return;

        try {
            const n = new Notification(title, {
                body,
                icon: "/next.svg",
                tag: "jfnn-msg",
            } as NotificationOptions);
            setTimeout(() => n.close(), 5000);
        } catch {}
    }, [permission, playSound]);

    return { permission, requestPermission, notify, playSound };
}
