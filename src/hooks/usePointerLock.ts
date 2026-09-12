"use client";
import { useCallback, useEffect, useState, useRef } from "react";

export interface UsePointerLockOptions {
    onLock?: () => void;
    onUnlock?: () => void;
}

export function usePointerLock(options?: UsePointerLockOptions) {
    const [isLocked, setIsLocked] = useState(false);
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    });

    useEffect(() => {
        const handleLockChange = () => {
            const locked = document.pointerLockElement !== null;
            setIsLocked(locked);
            if (locked) {
                optionsRef.current?.onLock?.();
            } else {
                optionsRef.current?.onUnlock?.();
            }
        };

        document.addEventListener("pointerlockchange", handleLockChange);
        document.addEventListener("pointerlockerror", handleLockChange);

        return () => {
            document.removeEventListener("pointerlockchange", handleLockChange);
            document.removeEventListener("pointerlockerror", handleLockChange);
        };
    }, []);

    const requestLock = useCallback((targetElement?: Element | null) => {
        const element = targetElement || document.querySelector("canvas");
        if (element && typeof element.requestPointerLock === "function") {
            element.requestPointerLock();
        }
    }, []);

    const releaseLock = useCallback(() => {
        if (typeof document !== "undefined" && document.pointerLockElement) {
            document.exitPointerLock();
        }
    }, []);

    return {
        isLocked,
        requestLock,
        releaseLock,
    };
}

export default usePointerLock;
