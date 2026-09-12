"use client";
import { useSyncExternalStore } from "react";
import type { GraphicsQuality, IGameSettings } from "@/types/settings";
import { QUALITY_PRESETS, detectMatchingPreset, GRAPHICS_PRESET_KEYS } from "./QualityPresets";
import { SETTINGS_CATALOGUE } from "./SettingsCatalogue";

const STORAGE_KEY = "ashvale_game_settings_v1";

export const DEFAULT_SETTINGS: IGameSettings = {
    frameRateLimit: 60,
    showFps: false,
    resolutionScale: 1.0,

    qualityPreset: "high",
    ...QUALITY_PRESETS.high,

    mouseSensitivity: 1.0,
    invertY: false,
};

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

        // Only adopt keys the current build knows about, so settings removed in
        // an earlier version don't linger in storage and get written back out.
        // Storage is user-editable, so a stored value is only trusted when its type
        // matches the default it replaces and, for enum/ranged controls, when it is
        // actually one of the values the catalogue still offers.
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

export const settings: IGameSettings = loadStored();

let snapshot: IGameSettings = { ...settings };
const listeners = new Set<() => void>();

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

export function setQualityPreset(preset: Exclude<GraphicsQuality, "custom">): void {
    const presetValues = QUALITY_PRESETS[preset];
    Object.assign(settings, {
        qualityPreset: preset,
        ...presetValues,
    });
    notify();
}

export function resetSettings(): void {
    Object.assign(settings, DEFAULT_SETTINGS);
    notify();
}

// The pause menu stages edits in a local draft and only commits on save, so
// these helpers mirror the mutating functions above without touching the store.

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

const SERVER_SNAPSHOT = { ...DEFAULT_SETTINGS };

export function useSettings(): IGameSettings {
    return useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => SERVER_SNAPSHOT
    );
}
