"use client";
import { useEffect, useRef } from "react";
import { useGameStore } from "@/hooks/useGameStore";
import { store } from "@/store/store";
import { isFrameHeld } from "@/lib/helpers";
import { hudWriter } from "@/lib/hud";
import { FRAME_RATE_METER } from "@/constants/ui";
import { HUD_TEXT } from "@/constants/strings";
import "./frameRateMeter.scss";

export const FrameRateMeter = ({
    rendersOnlyWhilePlaying,
}: {
    rendersOnlyWhilePlaying: boolean;
}) => {
    const showFps = useGameStore((state) => state.settings.values.showFps);
    const meterRef = useRef<HTMLDivElement>(null);
    const valueRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!showFps) return;

        let rafId: number;
        let lastSampleTime = performance.now();
        const frame = store.getState().hud.frame;
        let lastFrameCount = frame.renderedFrames;

        const loop = (now: number) => {
            rafId = requestAnimationFrame(loop);
            if (isFrameHeld(store.getState().session, rendersOnlyWhilePlaying)) {
                lastSampleTime = now;
                lastFrameCount = frame.renderedFrames;
                return;
            }

            const elapsed = now - lastSampleTime;
            if (elapsed < FRAME_RATE_METER.sampleWindowMs) return;

            const fps = Math.round(((frame.renderedFrames - lastFrameCount) * 1000) / elapsed);
            hudWriter.text(valueRef.current, fps);
            hudWriter.data(meterRef.current, "tier", frameRateTier(fps));
            lastFrameCount = frame.renderedFrames;
            lastSampleTime = now;
        };

        rafId = requestAnimationFrame(loop);

        return () => cancelAnimationFrame(rafId);
    }, [showFps, rendersOnlyWhilePlaying]);

    if (!showFps) return null;

    return (
        <div
            className="frame-rate-meter"
            data-tier={frameRateTier(FRAME_RATE_METER.startingFps)}
            ref={meterRef}
        >
            <span ref={valueRef}>{FRAME_RATE_METER.startingFps}</span>
            <span className="frame-rate-unit">{HUD_TEXT.framesPerSecondUnit}</span>
        </div>
    );
};

function frameRateTier(fps: number): string {
    if (fps < FRAME_RATE_METER.strugglingBelow) return "struggling";
    return fps < FRAME_RATE_METER.smoothFrom ? "steady" : "smooth";
}
