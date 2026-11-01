import { ChapterSeason } from "@/types/realm";
import type { ISeasonProfile } from "@/types/world";

export const SEASONS: Record<ChapterSeason, ISeasonProfile> = {
    [ChapterSeason.Spring]: {
        groundColorShift: { hueShift: -0.015, saturationScale: 1.2, lightnessShift: 0.05 },
        soilTint: { color: "#dff0cf", strength: 0.1, lightnessShift: 0.03 },
        skyTint: { color: "#e8f2ff", strength: 0.13 },
        lightTint: { color: "#f2ffe8", strength: 0.1 },
        keyIntensityScale: 1,
        hemisphereIntensityScale: 1.05,
        fogDensityScale: 0.8,
        sunElevationDelta: 0.03,
    },
    [ChapterSeason.Summer]: {
        groundColorShift: { hueShift: 0, saturationScale: 1.45, lightnessShift: -0.01 },
        soilTint: { color: "#ffeec0", strength: 0.12, lightnessShift: 0 },
        skyTint: { color: "#fff8e0", strength: 0.11 },
        lightTint: { color: "#fff2cc", strength: 0.09 },
        keyIntensityScale: 1.12,
        hemisphereIntensityScale: 1,
        fogDensityScale: 0.6,
        sunElevationDelta: 0.08,
    },
    [ChapterSeason.Autumn]: {
        groundColorShift: { hueShift: -0.2, saturationScale: 1.15, lightnessShift: -0.02 },
        soilTint: { color: "#d98f3f", strength: 0.24, lightnessShift: -0.02 },
        skyTint: { color: "#ffb877", strength: 0.18 },
        lightTint: { color: "#ffb96b", strength: 0.18 },
        keyIntensityScale: 0.95,
        hemisphereIntensityScale: 0.95,
        fogDensityScale: 0.95,
        sunElevationDelta: -0.05,
    },
    [ChapterSeason.Winter]: {
        groundColorShift: { hueShift: 0.11, saturationScale: 0.28, lightnessShift: 0.2 },
        soilTint: { color: "#e8f0f8", strength: 0.42, lightnessShift: 0.16 },
        skyTint: { color: "#c3d8ef", strength: 0.28 },
        lightTint: { color: "#b8d4f5", strength: 0.34 },
        keyIntensityScale: 0.8,
        hemisphereIntensityScale: 1.15,
        fogDensityScale: 1,
        sunElevationDelta: -0.15,
    },
};
