import { ChapterSeason } from "@/types/realm";
import type { ISeasonProfile } from "@/types/theme";

export const SPRING_SEASON: ISeasonProfile = {
    season: ChapterSeason.Spring,
    ground: { hueShift: -0.015, saturationScale: 1.2, lightnessShift: 0.05 },
    groundTint: { color: "#dff0cf", strength: 0.18, lightnessShift: 0.03 },
    skyTint: { color: "#e8f2ff", strength: 0.25 },
    lightTint: { color: "#f2ffe8", strength: 0.18 },
    keyIntensityScale: 1,
    hemisphereIntensityScale: 1.05,
    fogDensityScale: 0.8,
    sunElevationDelta: 0.03,
};

export const SUMMER_SEASON: ISeasonProfile = {
    season: ChapterSeason.Summer,
    ground: { hueShift: 0, saturationScale: 1.45, lightnessShift: -0.01 },
    groundTint: { color: "#ffeec0", strength: 0.22, lightnessShift: 0 },
    skyTint: { color: "#fff8e0", strength: 0.2 },
    lightTint: { color: "#fff2cc", strength: 0.15 },
    keyIntensityScale: 1.12,
    hemisphereIntensityScale: 1,
    fogDensityScale: 0.6,
    sunElevationDelta: 0.08,
};

export const AUTUMN_SEASON: ISeasonProfile = {
    season: ChapterSeason.Autumn,
    ground: { hueShift: -0.2, saturationScale: 1.15, lightnessShift: -0.02 },
    groundTint: { color: "#d98f3f", strength: 0.45, lightnessShift: -0.02 },
    skyTint: { color: "#ffb877", strength: 0.35 },
    lightTint: { color: "#ffb96b", strength: 0.35 },
    keyIntensityScale: 0.95,
    hemisphereIntensityScale: 0.95,
    fogDensityScale: 1.05,
    sunElevationDelta: -0.05,
};

export const WINTER_SEASON: ISeasonProfile = {
    season: ChapterSeason.Winter,
    ground: { hueShift: 0.11, saturationScale: 0.28, lightnessShift: 0.2 },
    groundTint: { color: "#e8f0f8", strength: 0.85, lightnessShift: 0.16 },
    skyTint: { color: "#c3d8ef", strength: 0.55 },
    lightTint: { color: "#b8d4f5", strength: 0.68 },
    keyIntensityScale: 0.8,
    hemisphereIntensityScale: 1.15,
    fogDensityScale: 1.2,
    sunElevationDelta: -0.15,
};
