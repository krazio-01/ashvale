"use client";
import { useEffect } from "react";
import { useLatestRef } from "@/hooks/useLatestRef";

export function useHotkey(
    key: string,
    onPress: (event: KeyboardEvent) => void,
    listenOn: "window" | "document" = "window"
): void {
    const onPressRef = useLatestRef(onPress);

    useEffect(() => {
        const target: GlobalEventHandlers = listenOn === "window" ? window : document;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === key) onPressRef.current(event);
        };

        target.addEventListener("keydown", handleKeyDown);
        return () => target.removeEventListener("keydown", handleKeyDown);
    }, [key, listenOn, onPressRef]);
}
