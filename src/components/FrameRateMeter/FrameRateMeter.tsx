"use client";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/settings/SettingsStore";
import { getRenderedFrameCount } from "@/hooks/useFrameLimit";
import type { CSSProperties } from "react";
import "./frameRateMeter.scss";

const SAMPLE_WINDOW_MS = 500;
const GLASS_BLUR: CSSProperties = {
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
};

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

    const tier = fps < 30 ? "struggling" : fps < 55 ? "steady" : "smooth";

    return (
        <div className="frame-rate-meter" data-tier={tier} style={GLASS_BLUR}>
            <span>{fps}</span>
            <span className="frame-rate-unit">FPS</span>
        </div>
    );
};

export default FrameRateMeter;
