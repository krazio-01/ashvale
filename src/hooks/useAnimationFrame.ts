"use client";
import { useContext, useEffect, useRef } from "react";
import { AnimationFrameContext } from "@/context/AnimationFrameContext";
import type { AnimationFrameCallback } from "@/types/store";

export function useAnimationFrame(callback: AnimationFrameCallback): void {
    const callbacks = useContext(AnimationFrameContext);
    const callbackRef = useRef(callback);

    useEffect(() => {
        callbackRef.current = callback;
    });

    useEffect(() => {
        if (!callbacks) return;

        const stable: AnimationFrameCallback = (state) => callbackRef.current(state);
        callbacks.push(stable);

        return () => {
            const index = callbacks.indexOf(stable);
            if (index >= 0) callbacks.splice(index, 1);
        };
    }, [callbacks]);
}
