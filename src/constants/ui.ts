import { metresToUnits, range, vec3 } from "@/lib/helpers";
import type {
    GraphicsPresetValues,
    IGameSettings,
    IHudVitalDescriptor,
    ISettingControlDescriptor,
    OutlineQuality,
    PresetQuality,
    SettingControlsMap,
    SettingSection,
    ShadowQuality,
} from "@/types/ui";
import { HUD_TEXT, OPTION_TEXT, SETTINGS_TEXT } from "@/constants/strings";
import { ATMOSPHERE, LIGHT } from "@/constants/world";
import type { IEnvironmentOverrides } from "@/types/world";

export const PALETTE = {
    ember: "#ff7a3c",
    gold: "#d4af37",
};

export const HUD = {
    chaseCatchUpPerSecond: 5,
    chaseSnapThreshold: 0.002,
    vignetteHitGain: 2.4,
    vignetteDecayPerSecond: 5,
    vignetteLowFraction: 0.35,
    vignetteLowStrength: 0.45,
    damageNumberSeconds: 0.9,
    damageNumberRise: 0.06,
    damageNumberPool: 20,
    alertMarkerPool: 12,
    alertMarkerRange: metresToUnits(40),
    alertMarkerScreenMargin: 1.05,
    damageNumberScreenMargin: 1.1,
    alertMarkerLift: 0.62,
    alertFlashSeconds: 1.6,
    styleRoundingSteps: 1000,
};

export const HUD_VITALS: IHudVitalDescriptor[] = [
    {
        id: "health",
        label: HUD_TEXT.vitality,
        lowFraction: 0.3,
    },
    {
        id: "stamina",
        label: HUD_TEXT.stamina,
        lowFraction: 0.25,
    },
];

export const LANDING_ISLAND = {
    topRadius: metresToUnits(6),
    radialSegments: 14,
    ringRadiusRatios: [1, 0.82, 0.5, 0.22],
    ringDepths: [0, metresToUnits(1), metresToUnits(2.4), metresToUnits(3.6)],
    apexDepth: metresToUnits(4.6),
    edgeJitterRatio: 0.18,
    craggingGrowthPerRing: 0.06,
    noiseSeed: 1337,
    surfaceNoiseScale: 0.16,
    surfaceNoiseAmplitude: metresToUnits(0.3),
    edgeNoiseScale: 0.22,
};

export const LANDING_PROPS = {
    seed: 4242,
    scatterRadius: metresToUnits(4.4),
    minSpacing: metresToUnits(2.8),
    placementAttempts: 80,
    instanceCount: 7,
    modelPaths: [
        "/models/woodland/CommonTree_1.gltf",
        "/models/woodland/CommonTree_3.gltf",
        "/models/woodland/Pine_2.gltf",
        "/models/woodland/Bush_Common_Flowers.gltf",
        "/models/woodland/Rock_Medium_2.gltf",
        "/models/woodland/Flower_3_Group.gltf",
        "/models/woodland/Grass_Wispy_Tall.gltf",
    ],
    scaleRange: range(0.85, 1.2),
};

export const LANDING_CHARACTER = {
    position: vec3(0, 0, metresToUnits(2.6)),
    reservedClearance: metresToUnits(2.2),
    reactionClipName: "Interact",
    reactionFadeSeconds: 0.18,
    hoverBounceAmplitude: 0.018,
    hoverBounceSpeed: 8,
};

export const LANDING_EMBERS = {
    count: 42,
    seed: 917,
    color: PALETTE.ember,
    radius: metresToUnits(5.5),
    minHeight: 0,
    maxHeight: metresToUnits(7),
    riseSpeed: metresToUnits(0.35),
    driftAmplitude: metresToUnits(0.5),
    driftSpeed: 0.6,
    size: 0.16,
};

export const LANDING_FIREFLIES = {
    count: 24,
    seed: 2831,
    color: PALETTE.gold,
    radius: metresToUnits(4.6),
    minHeight: metresToUnits(0.15),
    maxHeight: metresToUnits(1.5),
    wanderSpeed: 0.45,
    wanderAmplitude: metresToUnits(0.9),
    size: 0.1,
};

export const LANDING_ENVIRONMENT: IEnvironmentOverrides = {
    sky: {
        zenith: "#0a0e1c",
        middle: "#161d38",
        horizon: "#2b3a66",
        belowHorizonColor: "#07090f",
        glow: PALETTE.ember,
        sun: "#fff0dc",
        sunElevation: 0.4,
        sunAzimuth: 0.9,
        sunSize: 0.03,
        glowFalloff: 28,
        hazeStrength: 3.4,
    },
    lighting: {
        sunLightColor: "#d8e2ff",
        sunLightIntensity: 1.1,
        rimColor: PALETTE.ember,
        rimIntensity: 0.6,
        hemisphereSkyColor: "#4b5a8c",
        hemisphereGroundColor: "#14152a",
        hemisphereIntensity: 0.6,
    },
    fogDensity: 0.0022,
    outlineColor: "#0a0c16",
};

export const LANDING_MOUNTAINS = {
    layers: [
        {
            radius: metresToUnits(70),
            segments: 26,
            peakHeightMin: metresToUnits(6),
            peakHeightMax: metresToUnits(16),
            baseY: -metresToUnits(30),
            color: "#0b0f1f",
            noiseSeed: 5501,
            noiseScale: 0.42,
        },
        {
            radius: metresToUnits(115),
            segments: 30,
            peakHeightMin: metresToUnits(10),
            peakHeightMax: metresToUnits(24),
            baseY: -metresToUnits(30),
            color: "#374a82",
            noiseSeed: 7703,
            noiseScale: 0.3,
        },
    ],
};

export const LANDING_CLOUDS = {
    count: 7,
    seed: 4471,
    radiusMin: metresToUnits(55),
    radiusMax: metresToUnits(95),
    minHeight: metresToUnits(6),
    maxHeight: metresToUnits(14),
    puffsPerClusterMin: 3,
    puffsPerClusterMax: 6,
    clusterSpread: metresToUnits(3.5),
    puffRadiusMin: metresToUnits(1.6),
    puffRadiusMax: metresToUnits(3.2),
    color: "#3a4570",
    opacity: 0.85,
    driftSpeed: 0.012,
};

export const LANDING_STARS = {
    count: 220,
    seed: 6161,
    radius: metresToUnits(220),
    minElevationAngle: -0.05,
    size: 1.1,
    color: "#fdf6ff",
    twinkleSpeedRange: range(0.5, 2.2),
    twinkleFloor: 0.35,
};

export const LANDING_CAMERA = {
    fov: 42,
    near: 0.1,
    far: ATMOSPHERE.skyRadius + 50,
    orbitRadius: metresToUnits(16),
    orbitHeight: metresToUnits(2.4),
    lookHeight: metresToUnits(0.2),
    orbitSpeed: 0.045,
    parallaxYaw: 0.3,
    parallaxHeight: metresToUnits(1),
    smoothing: 2.2,
    wheelSensitivity: 0.0022,
    dragSensitivity: 0.006,
    inputVelocityDecay: 2.4,
    maxInputVelocity: 4.5,
    diveDuration: 0.85,
    diveRadius: metresToUnits(2.2),
    diveHeight: metresToUnits(1.4),
    diveSwoopSpeed: 0.09,
};

export const GRAPHICS_PRESET_KEYS = [
    "shadows",
    "bloom",
    "antiAliasing",
    "outlines",
    "atmosphere",
] as const satisfies readonly (keyof GraphicsPresetValues)[];

export const QUALITY_PRESETS: Record<PresetQuality, GraphicsPresetValues> = {
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

export const FOLIAGE_OUTLINE_MASK_SCALES: Record<OutlineQuality, number> = {
    off: 0,
    low: 0.25,
    high: 1.0,
};

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

export const SETTING_CONTROLS: SettingControlsMap = {
    frameRateLimit: {
        section: "Display",
        type: "choice",
        ...SETTINGS_TEXT.frameRateLimit,
        options: ([30, 60, 120] as const).map((value) => ({ label: `${value}`, value })),
    },
    showFps: {
        section: "Display",
        type: "toggle",
        ...SETTINGS_TEXT.showFps,
        onLabel: OPTION_TEXT.shown,
        offLabel: OPTION_TEXT.hidden,
    },
    resolutionScale: {
        section: "Display",
        type: "choice",
        ...SETTINGS_TEXT.resolutionScale,
        options: ([0.75, 1, 1.25, 1.5] as const).map((value) => ({
            label: `${value * 100}%`,
            value,
        })),
    },

    qualityPreset: {
        section: "Graphics",
        type: "choice",
        ...SETTINGS_TEXT.qualityPreset,
        options: [
            { label: OPTION_TEXT.low, value: "low" },
            { label: OPTION_TEXT.medium, value: "medium" },
            { label: OPTION_TEXT.high, value: "high" },
            { label: OPTION_TEXT.ultra, value: "ultra" },
            { label: OPTION_TEXT.custom, value: "custom" },
        ],
    },
    shadows: {
        section: "Graphics",
        type: "choice",
        ...SETTINGS_TEXT.shadows,
        options: [
            { label: OPTION_TEXT.off, value: "off" },
            { label: OPTION_TEXT.low, value: "low" },
            { label: OPTION_TEXT.medium, value: "medium" },
            { label: OPTION_TEXT.high, value: "high" },
        ],
    },
    bloom: {
        section: "Graphics",
        type: "toggle",
        ...SETTINGS_TEXT.bloom,
        onLabel: OPTION_TEXT.on,
        offLabel: OPTION_TEXT.off,
    },
    antiAliasing: {
        section: "Graphics",
        type: "choice",
        ...SETTINGS_TEXT.antiAliasing,
        options: [
            { label: OPTION_TEXT.off, value: "off" },
            { label: OPTION_TEXT.smaa, value: "smaa" },
        ],
    },
    outlines: {
        section: "Graphics",
        type: "choice",
        ...SETTINGS_TEXT.outlines,
        options: [
            { label: OPTION_TEXT.off, value: "off" },
            { label: OPTION_TEXT.low, value: "low" },
            { label: OPTION_TEXT.high, value: "high" },
        ],
    },
    atmosphere: {
        section: "Graphics",
        type: "toggle",
        ...SETTINGS_TEXT.atmosphere,
        onLabel: OPTION_TEXT.on,
        offLabel: OPTION_TEXT.off,
    },

    mouseSensitivity: {
        section: "Controls",
        type: "slider",
        ...SETTINGS_TEXT.mouseSensitivity,
        min: 0.2,
        max: 3.0,
        step: 0.1,
        formatValue: (val: number) => `${val.toFixed(1)}x`,
    },
    invertY: {
        section: "Controls",
        type: "toggle",
        ...SETTINGS_TEXT.invertY,
        onLabel: OPTION_TEXT.inverted,
        offLabel: OPTION_TEXT.normal,
    },
    fov: {
        section: "Controls",
        type: "slider",
        ...SETTINGS_TEXT.fov,
        min: 55,
        max: 80,
        step: 1,
        formatValue: (val: number) => `${val}°`,
    },
};

export const SETTING_SECTIONS: readonly SettingSection[] = ["Display", "Graphics", "Controls"];

export function getControlsForSection(section: SettingSection): ISettingControlDescriptor[] {
    return Object.entries(SETTING_CONTROLS)
        .filter(([, descriptor]) => descriptor.section === section)
        .map(([key, descriptor]) => ({ ...descriptor, key }) as ISettingControlDescriptor);
}
