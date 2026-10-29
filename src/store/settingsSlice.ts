"use client";

import { LIGHT } from "@/constants/world";
import type {
    GraphicsQuality,
    IGameSettings,
    ShadowQuality,
    OutlineQuality,
    ISettingControlDescriptor,
    SettingSection,
} from "@/types/ui";
import { useSyncExternalStore } from "react";

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

export const OUTLINE_MASK_SCALES: Record<OutlineQuality, number> = {
    off: 0,
    low: 0.25,
    high: 1.0,
};

export const SETTINGS_CATALOGUE: SettingsCatalogueMap = {
    frameRateLimit: {
        key: "frameRateLimit",
        section: "Display",
        type: "choice",
        label: "Frame rate limit",
        description: "Caps how many frames are drawn each second",
        options: [
            { label: "30", value: 30 },
            { label: "60", value: 60 },
            { label: "120", value: 120 },
        ],
    },
    showFps: {
        key: "showFps",
        section: "Display",
        type: "toggle",
        label: "Frame rate counter",
        description: "Shows the current frame rate on screen",
        onLabel: "Shown",
        offLabel: "Hidden",
    },
    resolutionScale: {
        key: "resolutionScale",
        section: "Display",
        type: "choice",
        label: "Resolution scale",
        description: "Renders above or below your display resolution, then scales to fit",
        options: [
            { label: "75%", value: 0.75 },
            { label: "100%", value: 1.0 },
            { label: "125%", value: 1.25 },
            { label: "150%", value: 1.5 },
        ],
    },

    qualityPreset: {
        key: "qualityPreset",
        section: "Graphics",
        type: "choice",
        label: "Quality preset",
        description: "Sets every graphics option below at once",
        options: [
            { label: "Low", value: "low" },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" },
            { label: "Ultra", value: "ultra" },
            { label: "Custom", value: "custom" },
        ],
    },
    shadows: {
        key: "shadows",
        section: "Graphics",
        type: "choice",
        label: "Shadows",
        description: "Resolution of shadows cast by the sun",
        options: [
            { label: "Off", value: "off" },
            { label: "Low", value: "low" },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" },
        ],
    },
    bloom: {
        key: "bloom",
        section: "Graphics",
        type: "toggle",
        label: "Bloom",
        description: "Spreads a soft glow from the brightest parts of the scene",
        onLabel: "On",
        offLabel: "Off",
    },
    antiAliasing: {
        key: "antiAliasing",
        section: "Graphics",
        type: "choice",
        label: "Anti-aliasing",
        description: "Smooths jagged edges along geometry",
        options: [
            { label: "Off", value: "off" },
            { label: "SMAA", value: "smaa" },
        ],
    },
    outlines: {
        key: "outlines",
        section: "Graphics",
        type: "choice",
        label: "Outlines",
        description: "Draws ink lines around objects and foliage",
        options: [
            { label: "Off", value: "off" },
            { label: "Low", value: "low" },
            { label: "High", value: "high" },
        ],
    },
    atmosphere: {
        key: "atmosphere",
        section: "Graphics",
        type: "toggle",
        label: "Atmosphere",
        description: "Adds distance haze and horizon glow",
        onLabel: "On",
        offLabel: "Off",
    },

    mouseSensitivity: {
        key: "mouseSensitivity",
        section: "Controls",
        type: "slider",
        label: "Look sensitivity",
        description: "How far the camera turns for a given mouse movement",
        min: 0.2,
        max: 3.0,
        step: 0.1,
        formatValue: (val: number) => `${val.toFixed(1)}x`,
    },
    invertY: {
        key: "invertY",
        section: "Controls",
        type: "toggle",
        label: "Invert vertical look",
        description: "Moving the mouse up looks down instead",
        onLabel: "Inverted",
        offLabel: "Normal",
    },
    fov: {
        key: "fov",
        section: "Controls",
        type: "slider",
        label: "Field of view",
        description: "Widens or narrows the camera's view angle",
        min: 55,
        max: 80,
        step: 1,
        formatValue: (val: number) => `${val}°`,
    },
};

export const SETTING_SECTIONS: readonly SettingSection[] = [
    "Display",
    "Graphics",
    "Controls",
] as const;

const STORAGE_KEY = "ashvale_game_settings_v1";

export const DEFAULT_SETTINGS: IGameSettings = {
    frameRateLimit: 60,
    showFps: false,
    resolutionScale: 1.0,

    qualityPreset: "high",
    ...QUALITY_PRESETS.high,

    mouseSensitivity: 1.0,
    invertY: false,
    fov: 55,
};

export const settings: IGameSettings = loadStored();

let snapshot: IGameSettings = { ...settings };

const listeners = new Set<() => void>();

const SERVER_SNAPSHOT = { ...DEFAULT_SETTINGS };

type GraphicsPresetValues = Pick<
    IGameSettings,
    "shadows" | "bloom" | "antiAliasing" | "outlines" | "atmosphere"
>;

type SettingsCatalogueMap = {
    [K in keyof IGameSettings]: ISettingControlDescriptor<K>;
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

export function getControlsForSection(section: SettingSection): ISettingControlDescriptor[] {
    return Object.values(SETTINGS_CATALOGUE).filter((descriptor) => descriptor.section === section);
}

function isAllowedValue<K extends keyof IGameSettings>(key: K, value: unknown): boolean {
    const descriptor = SETTINGS_CATALOGUE[key];

    switch (descriptor.type) {
        case "choice":
            return descriptor.options.some((option) => option.value === value);
        case "slider":
            return typeof value === "number" && value >= descriptor.min && value <= descriptor.max;
        case "toggle":
            return true;
    }
}

function loadStored(): IGameSettings {
    if (typeof window === "undefined") {
        return { ...DEFAULT_SETTINGS };
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };

        const restored: IGameSettings = { ...DEFAULT_SETTINGS };
        const writable = restored as unknown as Record<string, unknown>;
        const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;

        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            const candidate = parsed[key];
            if (typeof candidate !== typeof defaults[key]) continue;
            if (!isAllowedValue(key as keyof IGameSettings, candidate)) continue;
            writable[key] = candidate;
        }

        return restored;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function persist(data: IGameSettings): void {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
}

function notify(): void {
    snapshot = { ...settings };
    persist(settings);
    for (const listener of listeners) {
        listener();
    }
}

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function updateSettings(partial: Partial<IGameSettings>): void {
    Object.assign(settings, partial);

    const touchedGraphics = GRAPHICS_PRESET_KEYS.some((k) => k in partial);
    if (touchedGraphics && !("qualityPreset" in partial)) {
        settings.qualityPreset = detectMatchingPreset(settings);
    }

    notify();
}

export function draftWithChange(
    draft: IGameSettings,
    partial: Partial<IGameSettings>
): IGameSettings {
    const next = { ...draft, ...partial };

    const touchedGraphics = GRAPHICS_PRESET_KEYS.some((k) => k in partial);
    if (touchedGraphics && !("qualityPreset" in partial)) {
        next.qualityPreset = detectMatchingPreset(next);
    }

    return next;
}

export function draftWithPreset(
    draft: IGameSettings,
    preset: Exclude<GraphicsQuality, "custom">
): IGameSettings {
    return { ...draft, qualityPreset: preset, ...QUALITY_PRESETS[preset] };
}

export function settingsMatch(a: IGameSettings, b: IGameSettings): boolean {
    return (Object.keys(DEFAULT_SETTINGS) as (keyof IGameSettings)[]).every(
        (key) => a[key] === b[key]
    );
}

export function useSettings(): IGameSettings {
    return useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => SERVER_SNAPSHOT
    );
}
