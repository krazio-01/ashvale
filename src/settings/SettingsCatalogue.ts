import type { IGameSettings, ISettingControlDescriptor, SettingSection } from "@/types/settings";

export type SettingsCatalogueMap = {
    [K in keyof IGameSettings]: ISettingControlDescriptor<K>;
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
};

export const SETTING_SECTIONS: readonly SettingSection[] = [
    "Display",
    "Graphics",
    "Controls",
] as const;

export function getControlsForSection(section: SettingSection): ISettingControlDescriptor[] {
    return Object.values(SETTINGS_CATALOGUE).filter((descriptor) => descriptor.section === section);
}
