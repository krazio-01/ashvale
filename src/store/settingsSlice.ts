import {
    DEFAULT_SETTINGS,
    GRAPHICS_PRESET_KEYS,
    QUALITY_PRESETS,
    SETTING_CONTROLS,
} from "@/constants/ui";
import type {
    GraphicsPresetValues,
    GraphicsQuality,
    IGameSettings,
    ISettingsSlice,
    PresetQuality,
} from "@/types/ui";
import type { IStoreState, SetState } from "@/types/store";

export function isAllowedSetting(key: keyof IGameSettings, value: unknown): boolean {
    const descriptor = SETTING_CONTROLS[key];

    switch (descriptor.type) {
        case "choice":
            return descriptor.options.some((option) => option.value === value);
        case "slider":
            return typeof value === "number" && value >= descriptor.min && value <= descriptor.max;
        case "toggle":
            return true;
    }
}

function detectMatchingPreset(values: GraphicsPresetValues): GraphicsQuality {
    for (const tier of Object.keys(QUALITY_PRESETS) as PresetQuality[]) {
        const preset = QUALITY_PRESETS[tier];
        const matches = GRAPHICS_PRESET_KEYS.every((key) => values[key] === preset[key]);
        if (matches) return tier;
    }

    return "custom";
}

export function withSettingChange(
    current: IGameSettings,
    partial: Partial<IGameSettings>
): IGameSettings {
    const next = { ...current, ...partial };

    const touchedGraphics = GRAPHICS_PRESET_KEYS.some((key) => key in partial);
    if (touchedGraphics && !("qualityPreset" in partial)) {
        next.qualityPreset = detectMatchingPreset(next);
    }

    return next;
}

export function withQualityPreset(current: IGameSettings, preset: PresetQuality): IGameSettings {
    return { ...current, qualityPreset: preset, ...QUALITY_PRESETS[preset] };
}

export function areSettingsEqual(a: IGameSettings, b: IGameSettings): boolean {
    return (Object.keys(DEFAULT_SETTINGS) as (keyof IGameSettings)[]).every(
        (key) => a[key] === b[key]
    );
}

export function createSettingsSlice(set: SetState<IStoreState>): ISettingsSlice {
    return {
        values: { ...DEFAULT_SETTINGS },

        update(partial) {
            set((state) => ({
                settings: {
                    ...state.settings,
                    values: withSettingChange(state.settings.values, partial),
                },
            }));
        },
    };
}
