"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AnimationFrameContext } from "@/context/AnimationFrameContext";
import { store } from "@/store/store";
import type { AnimationFrameCallback } from "@/types/store";

export const AnimationFrameLoop = ({ children }: { children: ReactNode }) => {
    const [callbacks] = useState<AnimationFrameCallback[]>(() => []);

    useEffect(() => {
        let frameId = requestAnimationFrame(function tick() {
            const state = store.getState();
            for (let index = 0; index < callbacks.length; index += 1) callbacks[index]?.(state);
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
