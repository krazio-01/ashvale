"use client";
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useSettings } from "@/settings/SettingsStore";

const VSYNC_TOLERANCE_MS = 2;
const MAXIMUM_ADVANCE_DELTA_MS = 100;

let renderedFrameCount = 0;

export function getRenderedFrameCount(): number {
    return renderedFrameCount;
}

export function useFrameLimit(): void {
    const { frameRateLimit } = useSettings();
    const advance = useThree((state) => state.advance);
    const clock = useThree((state) => state.clock);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const targetIntervalMs = 1000 / frameRateLimit;
        let rafId = 0;
        let lastAdvanceMs = performance.now();

        const tick = (nowMs: number) => {
            rafId = requestAnimationFrame(tick);

            if (document.visibilityState === "hidden") {
                lastAdvanceMs = nowMs;
                return;
            }

            const elapsedMs = nowMs - lastAdvanceMs;
            if (elapsedMs < targetIntervalMs - VSYNC_TOLERANCE_MS) return;

            lastAdvanceMs = nowMs - (elapsedMs % targetIntervalMs);
            renderedFrameCount += 1;

            const deltaSeconds = Math.min(elapsedMs, MAXIMUM_ADVANCE_DELTA_MS) / 1000;
            advance(clock.elapsedTime + deltaSeconds);
        };

        rafId = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafId);
    }, [frameRateLimit, advance, clock]);
}

export default useFrameLimit;
