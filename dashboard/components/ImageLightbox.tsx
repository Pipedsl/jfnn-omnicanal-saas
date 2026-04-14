"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { BACKEND_URL } from "@/lib/api";

interface ImageLightboxProps {
    src: string;
    onClose: () => void;
}

export default function ImageLightbox({ src, onClose }: ImageLightboxProps) {
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [onClose]);

    const fullSrc = src.startsWith("http") ? src : `${BACKEND_URL}${src}`;

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
                <X size={20} />
            </button>
            <img
                src={fullSrc}
                alt="Imagen de pieza"
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            />
        </div>
    );
}
