"use client";
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useSettings } from "@/settings/SettingsStore";

// rAF timestamps drift a fraction of a millisecond around the vsync boundary.
// Without this tolerance a frame arriving marginally early is deferred a whole
// refresh interval, halving the effective rate.
const VSYNC_TOLERANCE_MS = 2;

// Bounds the delta handed to the scene when rAF resumes after being suspended
// (backgrounded tab), where the elapsed wall-clock gap can span minutes.
const MAXIMUM_ADVANCE_DELTA_MS = 100;

let renderedFrameCount = 0;

export function getRenderedFrameCount(): number {
    return renderedFrameCount;
}

// Drives rendering only. `frameloop` and `dpr` are owned by the Canvas props:
// R3F re-applies both from props on every Canvas render, so setting them
// imperatively from in here gets silently reverted.
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

            // Carry the overshoot past the target interval into the next frame
            // instead of resetting to nowMs. Otherwise, on a display whose refresh
            // interval doesn't divide evenly into targetIntervalMs, the leftover
            // keeps accumulating each frame until a whole extra vsync is skipped,
            // pulling the effective rate well under the requested cap.
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
