"use client";
import { useContext, useEffect, useRef } from "react";
import { AnimationFrameContext } from "@/context/AnimationFrameContext";
import type { AnimationFrameCallback } from "@/types/animationFrame";

export function useAnimationFrame(callback: AnimationFrameCallback): void {
    const callbacks = useContext(AnimationFrameContext);
    if (!callbacks) throw new Error("useAnimationFrame must be used inside AnimationFrameLoop");
    const callbackRef = useRef(callback);

    useEffect(() => {
        callbackRef.current = callback;
    });

    useEffect(() => {
        const stable: AnimationFrameCallback = (state, deltaSeconds) =>
            callbackRef.current(state, deltaSeconds);
        callbacks.push(stable);

        return () => {
            const index = callbacks.indexOf(stable);
            if (index >= 0) callbacks.splice(index, 1);
        };
    }, [callbacks]);
}
