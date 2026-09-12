"use client";
import { useMemo } from "react";
import { RENDER } from "@/constants/rendering";
import { useSettings } from "@/settings/SettingsStore";

export function useRenderPixelRatio(): number {
    const { resolutionScale } = useSettings();

    return useMemo(() => {
        const [minimumRatio, maximumRatio] = RENDER.pixelRatioRange;
        if (typeof window === "undefined") return minimumRatio;

        const scaled = (window.devicePixelRatio || 1) * resolutionScale;
        return Math.min(Math.max(scaled, minimumRatio), maximumRatio);
    }, [resolutionScale]);
}

export default useRenderPixelRatio;
