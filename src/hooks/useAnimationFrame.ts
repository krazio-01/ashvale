"use client";
import { useContext, useEffect } from "react";
import { useLatestRef } from "@/hooks/useLatestRef";
import { FrameCallbacksContext } from "@/context/FrameCallbacksContext";
import type { AnimationFrameCallback } from "@/types/store";
import { ERRORS } from "@/constants/strings";

export function useAnimationFrame(callback: AnimationFrameCallback): void {
    const callbacks = useContext(FrameCallbacksContext);
    if (!callbacks) throw new Error(ERRORS.animationFrameOutsideLoop);
    const callbackRef = useLatestRef(callback);

    useEffect(() => {
        const forwardToLatest: AnimationFrameCallback = (state, deltaSeconds) =>
            callbackRef.current(state, deltaSeconds);
        callbacks.push(forwardToLatest);

        return () => {
            const index = callbacks.indexOf(forwardToLatest);
            if (index >= 0) callbacks.splice(index, 1);
        };
    }, [callbacks, callbackRef]);
}
