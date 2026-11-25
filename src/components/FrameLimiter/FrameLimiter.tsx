"use client";
import { useEffect, useRef } from "react";
import { useStore, useThree } from "@react-three/fiber";
import { store as gameStore } from "@/store/store";
import { useGameStore } from "@/hooks/useGameStore";
import { advanceBy, clamp, isFrameHeld } from "@/lib/helpers";
import { RENDER } from "@/constants/world";

const VSYNC_TOLERANCE_MS = 2;

export const FrameLimiter = ({ rendersOnlyWhilePlaying }: { rendersOnlyWhilePlaying: boolean }) => {
    const store = useStore();
    const sessionSnapshot = useGameStore((state) => state.session);
    const settingsSnapshot = useGameStore((state) => state.settings.values);
    const canvasSize = useThree((state) => state.size);
    const pixelRatio = useThree((state) => state.viewport.dpr);
    const isStillFrameDue = useRef(true);

    useEffect(() => {
        isStillFrameDue.current = true;
    }, [sessionSnapshot, settingsSnapshot, canvasSize, pixelRatio]);

    useEffect(() => {
        let rafId = 0;
        let lastScheduleMs = performance.now();
        let lastRenderMs = lastScheduleMs;

        const resetTimers = () => {
            const nowMs = performance.now();
            lastScheduleMs = nowMs;
            lastRenderMs = nowMs;
        };

        const tick = (nowMs: number) => {
            rafId = requestAnimationFrame(tick);

            const { settings, session, hud } = gameStore.getState();
            if (session.phase === "probing") return;

            const targetIntervalMs = 1000 / settings.values.frameRateLimit;
            const elapsedScheduleMs = nowMs - lastScheduleMs;

            if (elapsedScheduleMs < targetIntervalMs - VSYNC_TOLERANCE_MS) return;

            lastScheduleMs =
                elapsedScheduleMs > targetIntervalMs * 2
                    ? nowMs
                    : lastScheduleMs + targetIntervalMs;

            if (isFrameHeld(session, rendersOnlyWhilePlaying)) {
                if (!isStillFrameDue.current) {
                    lastRenderMs = nowMs;
                    return;
                }
                isStillFrameDue.current = false;
            }

            const deltaMs = nowMs - lastRenderMs;
            lastRenderMs = nowMs;
            hud.frame.renderedFrames += 1;

            advanceBy(
                store.getState(),
                clamp(deltaMs, 0, RENDER.maximumFrameDeltaSeconds * 1000) / 1000
            );
        };

        document.addEventListener("visibilitychange", resetTimers);
        window.addEventListener("focus", resetTimers);
        rafId = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(rafId);
            document.removeEventListener("visibilitychange", resetTimers);
            window.removeEventListener("focus", resetTimers);
        };
    }, [store, rendersOnlyWhilePlaying]);

    return null;
};
