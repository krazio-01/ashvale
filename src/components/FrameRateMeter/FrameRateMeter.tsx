"use client";
import { useEffect, useState } from "react";
import { useStoreState } from "@/hooks/useStoreState";
import { store } from "@/store/store";
import { getRenderedFrameCount } from "@/components/FrameLimiter/FrameLimiter";
import "./frameRateMeter.scss";

const SAMPLE_WINDOW_MS = 500;
export const FrameRateMeter = () => {
    const { showFps } = useStoreState(store, (state) => state.settings.values);
    const [fps, setFps] = useState(60);

    useEffect(() => {
        if (!showFps) return;

        let rafId: number;
        let lastSampleTime = performance.now();
        let lastFrameCount = getRenderedFrameCount();

        const loop = (now: number) => {
            const elapsed = now - lastSampleTime;

            if (elapsed >= SAMPLE_WINDOW_MS) {
                const renderedFrames = getRenderedFrameCount() - lastFrameCount;
                setFps(Math.round((renderedFrames * 1000) / elapsed));
                lastFrameCount = getRenderedFrameCount();
                lastSampleTime = now;
            }

            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);

        return () => cancelAnimationFrame(rafId);
    }, [showFps]);

    if (!showFps) return null;

    const tier = fps < 30 ? "struggling" : fps < 55 ? "steady" : "smooth";

    return (
        <div className="frame-rate-meter" data-tier={tier}>
            <span>{fps}</span>
            <span className="frame-rate-unit">FPS</span>
        </div>
    );
};
