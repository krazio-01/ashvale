"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AnimationFrameContext } from "@/context/AnimationFrameContext";
import { store } from "@/store/store";
import type { AnimationFrameCallback } from "@/types/animationFrame";

const MAXIMUM_FRAME_DELTA_SECONDS = 0.1;

export const AnimationFrameLoop = ({ children }: { children: ReactNode }) => {
    const [callbacks] = useState<AnimationFrameCallback[]>(() => []);

    useEffect(() => {
        let previousTimestamp: number | null = null;
        const frameCallbacks: AnimationFrameCallback[] = [];
        let frameId = requestAnimationFrame(function tick(timestamp) {
            const deltaSeconds =
                previousTimestamp === null
                    ? 0
                    : Math.min((timestamp - previousTimestamp) / 1000, MAXIMUM_FRAME_DELTA_SECONDS);
            previousTimestamp = timestamp;

            const state = store.getState();
            frameCallbacks.length = callbacks.length;
            for (let index = 0; index < callbacks.length; index += 1)
                frameCallbacks[index] = callbacks[index]!;
            for (const callback of frameCallbacks) callback(state, deltaSeconds);
            frameId = requestAnimationFrame(tick);
        });

        return () => cancelAnimationFrame(frameId);
    }, [callbacks]);

    return (
        <AnimationFrameContext.Provider value={callbacks}>
            {children}
        </AnimationFrameContext.Provider>
    );
};
