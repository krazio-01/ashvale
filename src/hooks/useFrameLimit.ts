"use client";
import { useEffect, useRef } from "react";
import { useStore } from "@react-three/fiber";
import { useSettings } from "@/settings/SettingsStore";

const VSYNC_TOLERANCE_MS = 2;
const MAXIMUM_ADVANCE_DELTA_MS = 100;
const UNCAPPED_FRAME_RATE_THRESHOLD = 240;
const FALLBACK_FRAME_RATE = 60;

let renderedFrameCount = 0;

export const getRenderedFrameCount = (): number => renderedFrameCount;

export const useFrameLimit = (): void => {
    const { frameRateLimit } = useSettings();
    const store = useStore();
    const targetIntervalMsRef = useRef(1000 / FALLBACK_FRAME_RATE);

    useEffect(() => {
        const isUncapped = frameRateLimit <= 0 || frameRateLimit >= UNCAPPED_FRAME_RATE_THRESHOLD;
        targetIntervalMsRef.current = isUncapped ? 0 : 1000 / frameRateLimit;
    }, [frameRateLimit]);

    useEffect(() => {
        let rafId = 0;
        let isDocumentVisible = document.visibilityState === "visible";
        let lastScheduleMs = performance.now();
        let lastRenderMs = lastScheduleMs;

        const resetTimers = () => {
            isDocumentVisible = document.visibilityState === "visible";
            const nowMs = performance.now();
            lastScheduleMs = nowMs;
            lastRenderMs = nowMs;
        };

        const tick = (nowMs: number) => {
            rafId = requestAnimationFrame(tick);

            if (!isDocumentVisible) {
                lastScheduleMs = nowMs;
                lastRenderMs = nowMs;
                return;
            }

            const targetIntervalMs = targetIntervalMsRef.current;
            const elapsedScheduleMs = nowMs - lastScheduleMs;

            if (elapsedScheduleMs < targetIntervalMs - VSYNC_TOLERANCE_MS) return;

            lastScheduleMs =
                elapsedScheduleMs > targetIntervalMs * 2
                    ? nowMs
                    : lastScheduleMs + targetIntervalMs;

            const deltaMs = nowMs - lastRenderMs;
            lastRenderMs = nowMs;
            renderedFrameCount += 1;

            const deltaSeconds = Math.min(Math.max(deltaMs, 0), MAXIMUM_ADVANCE_DELTA_MS) / 1000;
            const { advance, clock } = store.getState();
            advance(clock.elapsedTime + deltaSeconds);
        };

        document.addEventListener("visibilitychange", resetTimers);
        window.addEventListener("focus", resetTimers);
        rafId = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(rafId);
            document.removeEventListener("visibilitychange", resetTimers);
            window.removeEventListener("focus", resetTimers);
        };
    }, [store]);
};

export default useFrameLimit;
