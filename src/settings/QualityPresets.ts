import { LIGHT } from "@/constants/rendering";
import type { GraphicsQuality, IGameSettings, ShadowQuality, OutlineQuality } from "@/types/settings";

export type GraphicsPresetValues = Pick<
    IGameSettings,
    "shadows" | "bloom" | "antiAliasing" | "outlines" | "atmosphere"
>;

export const GRAPHICS_PRESET_KEYS = [
    "shadows",
    "bloom",
    "antiAliasing",
    "outlines",
    "atmosphere",
] as const satisfies readonly (keyof GraphicsPresetValues)[];

export const QUALITY_PRESETS: Record<Exclude<GraphicsQuality, "custom">, GraphicsPresetValues> = {
    low: {
        shadows: "off",
        bloom: false,
        antiAliasing: "off",
        outlines: "off",
        atmosphere: false,
    },
    medium: {
        shadows: "low",
        bloom: true,
        antiAliasing: "smaa",
        outlines: "low",
        atmosphere: true,
    },
    high: {
        shadows: "medium",
        bloom: true,
        antiAliasing: "smaa",
        outlines: "high",
        atmosphere: true,
    },
    ultra: {
        shadows: "high",
        bloom: true,
        antiAliasing: "smaa",
        outlines: "high",
        atmosphere: true,
    },
};

export const SHADOW_MAP_SIZES: Record<ShadowQuality, number> = {
    off: 0,
    low: Math.floor(LIGHT.shadowMapSize / 2),
    medium: LIGHT.shadowMapSize,
    high: LIGHT.shadowMapSize * 2,
};

// Resolution of the foliage mask the outline pass samples. This is what makes
// "low" and "high" outlines actually differ.
export const OUTLINE_MASK_SCALES: Record<OutlineQuality, number> = {
    off: 0,
    low: 0.25,
    high: 1.0,
};

export function detectMatchingPreset(values: GraphicsPresetValues): GraphicsQuality {
    const tiers: Exclude<GraphicsQuality, "custom">[] = ["low", "medium", "high", "ultra"];

    for (const tier of tiers) {
        const preset = QUALITY_PRESETS[tier];
        const matches = GRAPHICS_PRESET_KEYS.every((key) => values[key] === preset[key]);
        if (matches) return tier;
    }

    return "custom";
}
