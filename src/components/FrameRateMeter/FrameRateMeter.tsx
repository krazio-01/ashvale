"use client";
import { useEffect, useState } from "react";
import { useGameStore } from "@/hooks/useGameStore";
import { store } from "@/store/store";
import { FRAME_RATE_METER } from "@/constants/ui";
import { HUD_TEXT } from "@/constants/strings";
import "./frameRateMeter.scss";

const SAMPLE_WINDOW_MS = 500;
export const FrameRateMeter = () => {
    const showFps = useGameStore((state) => state.settings.values.showFps);
    const [fps, setFps] = useState(60);

    useEffect(() => {
        if (!showFps) return;

        let rafId: number;
        let lastSampleTime = performance.now();
        const frame = store.getState().hud.frame;
        let lastFrameCount = frame.renderedFrames;

        const loop = (now: number) => {
            const elapsed = now - lastSampleTime;

            if (elapsed >= SAMPLE_WINDOW_MS) {
                const renderedFrames = frame.renderedFrames - lastFrameCount;
                setFps(Math.round((renderedFrames * 1000) / elapsed));
                lastFrameCount = frame.renderedFrames;
                lastSampleTime = now;
            }

            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);

        return () => cancelAnimationFrame(rafId);
    }, [showFps]);

    if (!showFps) return null;

    const tier =
        fps < FRAME_RATE_METER.strugglingBelow
            ? "struggling"
            : fps < FRAME_RATE_METER.smoothFrom
              ? "steady"
              : "smooth";

    return (
        <div className="frame-rate-meter" data-tier={tier}>
            <span>{fps}</span>
            <span className="frame-rate-unit">{HUD_TEXT.framesPerSecondUnit}</span>
        </div>
    );
};
