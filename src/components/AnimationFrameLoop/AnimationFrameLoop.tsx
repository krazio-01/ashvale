"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FrameCallbacksContext } from "@/context/FrameCallbacksContext";
import { store } from "@/store/store";
import type { AnimationFrameCallback } from "@/types/store";
import { RENDER } from "@/constants/world";

export const AnimationFrameLoop = ({ children }: { children: ReactNode }) => {
    const [callbacks] = useState<AnimationFrameCallback[]>(() => []);

    useEffect(() => {
        let previousTimestamp: number | null = null;
        let frameId = requestAnimationFrame(function tick(timestamp) {
            const deltaSeconds =
                previousTimestamp === null
                    ? 0
                    : Math.min(
                          (timestamp - previousTimestamp) / 1000,
                          RENDER.maximumFrameDeltaSeconds
                      );
            previousTimestamp = timestamp;

            const state = store.getState();
            for (const callback of callbacks) callback(state, deltaSeconds);
            frameId = requestAnimationFrame(tick);
        });

        return () => cancelAnimationFrame(frameId);
    }, [callbacks]);

    return (
        <FrameCallbacksContext.Provider value={callbacks}>
            {children}
        </FrameCallbacksContext.Provider>
    );
};
