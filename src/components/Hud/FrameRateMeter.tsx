"use client";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/settings/SettingsStore";
import { getRenderedFrameCount } from "@/hooks/useFrameLimit";

const SAMPLE_WINDOW_MS = 500;

export const FrameRateMeter = () => {
    const { showFps } = useSettings();
    const [fps, setFps] = useState(60);
    const frameCountRef = useRef(0);
    const lastTimeRef = useRef(0);

    useEffect(() => {
        if (!showFps) return;

        let rafId: number;
        lastTimeRef.current = performance.now();
        frameCountRef.current = getRenderedFrameCount();

        const loop = (now: number) => {
            const elapsed = now - lastTimeRef.current;

            if (elapsed >= SAMPLE_WINDOW_MS) {
                const renderedFrames = getRenderedFrameCount() - frameCountRef.current;
                setFps(Math.round((renderedFrames * 1000) / elapsed));
                frameCountRef.current = getRenderedFrameCount();
                lastTimeRef.current = now;
            }

            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);

        return () => cancelAnimationFrame(rafId);
    }, [showFps]);

    if (!showFps) return null;

    return (
        <div
            style={{
                position: "fixed",
                top: "1rem",
                left: "1rem",
                zIndex: 90,
                pointerEvents: "none",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: fps < 30 ? "#ff5555" : fps < 55 ? "#ffaa00" : "#55ff99",
                background: "rgba(10, 8, 16, 0.75)",
                padding: "0.3rem 0.65rem",
                borderRadius: "4px",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                backdropFilter: "blur(8px)",
                letterSpacing: "0.04em",
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
            }}
        >
            <span>{fps}</span>
            <span style={{ fontSize: "0.65rem", opacity: 0.6 }}>FPS</span>
        </div>
    );
};

export default FrameRateMeter;
