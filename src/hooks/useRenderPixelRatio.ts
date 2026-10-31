"use client";
import { RENDER } from "@/constants/world";
import { useStoreState } from "@/hooks/useStoreState";
import { store } from "@/store/store";
import { clamp } from "@/lib/helpers";

export function useRenderPixelRatio(): number {
    const { resolutionScale } = useStoreState(store, (state) => state.settings.values);

    return clamp(window.devicePixelRatio * resolutionScale, ...RENDER.pixelRatioRange);
}
