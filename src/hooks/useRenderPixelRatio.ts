"use client";
import { useEffect, useState } from "react";
import { RENDER } from "@/constants/world";
import { useGameStore } from "@/hooks/useGameStore";

export function useRenderPixelRatio(): number {
    const resolutionScale = useGameStore((state) => state.settings.values.resolutionScale);
    const [devicePixelRatio, setDevicePixelRatio] = useState(() => window.devicePixelRatio);

    useEffect(() => {
        const resolutionQuery = window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
        const handleChange = () => setDevicePixelRatio(window.devicePixelRatio);

        resolutionQuery.addEventListener("change", handleChange);
        return () => resolutionQuery.removeEventListener("change", handleChange);
    }, [devicePixelRatio]);

    return Math.min(
        Math.min(devicePixelRatio, RENDER.maximumPixelRatio) * resolutionScale,
        RENDER.maximumPixelRatio
    );
}
