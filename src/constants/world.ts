import type { IModelPack } from "@/types/world";
import { range } from "@/lib/helpers";
export const VIEW_DISTANCE = 700;

export const CHAPTER_SEED_OFFSETS = {
    corridors: 17,
    waterCourses: 29,
    settlement: 4,
    props: 3,
    perSettledRegion: 101,
};

export const FOLIAGE_LAYER = 1;

export const WIND = {
    heading: 0.95,
    bendSpread: 1.1,
    waveLength: 14,
    waveSpeed: 1.1,
    sway: 0.45,
    flutter: 0.15,
    flutterSpeed: 5.5,
};

export const SCALE = {
    unitsPerMetre: 2,
};

export const MODEL_PACKS = {
    woodland: { pack: "woodland", directory: "/models/woodland", unitScale: 1 },
    highlands: {
        pack: "quaternius-stylized-nature",
        directory: "/models/highlands",
        unitScale: 1,
    },
    medievalVillage: {
        pack: "medieval-village",
        directory: "/models/medieval-village",
        unitScale: SCALE.unitsPerMetre,
    },
    architecture: {
        pack: "architecture",
        directory: "/models/architecture",
        unitScale: SCALE.unitsPerMetre,
    },
} as const satisfies Record<string, IModelPack>;

const TRAIL_HALF_WIDTH = 1.6;
const TRAIL_WEAR_FALLOFF_WIDTH = 5.5;

export const WORLD = {
    gravity: -22,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

const WORLD_LAYER = 0x0001;
const CHARACTER_LAYER = 0x0002;

export const COLLISION_GROUPS = {
    character: (CHARACTER_LAYER << 16) | WORLD_LAYER,
    obstacleProbe: (0xffff << 16) | 0xffff,
    sightLine: (0xffff << 16) | WORLD_LAYER,
};

export const TERRAIN = {
    cliffCorridorRise: 1.5,
    waterCliffClearance: 5,
    targetCellSize: 4,
    minimumResolution: 64,
    maximumResolution: 256,
    pathLevel: 0,
    bankWidth: 12,
    corridorDrop: 0.4,
    corridorStepRatio: 0.5,
    corridorStepFaceWidth: 2,
    climbStyleWeights: [0.6, 0.17, 0.13, 0.1],
    macroSlopeGrainWavelengths: 4,
    peakColorSharpness: 0.7,
    propGroupCellSize: 220,
};

export const LANDFORM = {
    floorReliefHeight: 0.5,
    floorReliefScale: 0.028,
    minimumOpennessRatio: 0.5,
    openGroundRampRatio: 0.7,
    openGroundReliefHeight: 1.6,
    openGroundReliefScale: 0.05,
};

export const TRAIL = {
    halfWidth: TRAIL_HALF_WIDTH,
    wearFalloffWidth: TRAIL_WEAR_FALLOFF_WIDTH,
    wearFalloffExponent: 1.4,
    edgeWobbleAmplitude: 1.4,
    edgeWobbleScale: 0.055,
    distanceLimit: (TRAIL_HALF_WIDTH + TRAIL_WEAR_FALLOFF_WIDTH) * 2,
};

export const SOIL_COLOUR_SHIFTS = {
    loam: { hueShift: 0.01, saturationScale: 1, lightnessShift: 0 },
    driedEarth: { hueShift: -0.01, saturationScale: 0.9, lightnessShift: 0.12 },
    dust: { hueShift: -0.015, saturationScale: 0.62, lightnessShift: 0.3 },
    mud: { hueShift: 0.005, saturationScale: 1.15, lightnessShift: -0.17 },
    gritFromRock: { hueShift: 0, saturationScale: 0.45, lightnessShift: 0.06 },
};

export const GROUND_MATERIAL = {
    loamBaseWeight: 0.7,
    sharpness: 7,
    trailDustGain: 1.4,
    trailMudGain: 0.9,
    maskTextureSize: 256,
    maskTileCounts: [3, 4, 5, 7],
    broadTileSpan: 170,
    fineTileSpan: 43,
    broadMaskWeight: 0.65,
    fineMaskOffset: [0.37, 0.71],
    detailTileSpan: 14,
    detailTileCounts: [6, 16, 3, 34],
    detailStrengths: [0.18, 0.1, 0.32, 0.36],
};

export const WORLD_EDGE = {
    flatBorderWidth: 24,
    lipWidth: 20,
    dropDepth: 70,
    dropCurve: 2.6,
    barrierLipRatio: 0.3,
    barrierHeight: 30,
    barrierSink: 6,
};

export const WATER_COURSE = {
    cliffClearance: 8,
    cliffBankGap: 3,
    minimumRegionsInCourse: 1,
    minimumPointCount: 6,
    rimOffsetRatio: 0.88,
    arenaCoreRatio: 0.6,
    sideNoiseScale: 0.004,
    pointSpacing: 6,
    clearancePasses: 6,
    smoothingStrength: 0.28,
    meanderAmplitude: 7,
    meanderWavelength: 120,
    widthWavelength: 190,
    halfWidthNarrow: 5,
    halfWidthWide: 12,
    crossingHalfWidthRatio: 0.55,
    crossingDepthRatio: 0.45,
    waterlineDropBelowGround: 2.6,
    endTaperLength: 26,
    rimSafetyMargin: 4,
    shoreProbeMargin: 3,
};

export const WATER_CHANNEL = {
    bedDepth: 1.6,
    flatBedRatio: 0.2,
    bankWidth: 13,
    shoreReach: 4.5,
    dryDepth: -8,
    shoreWetBand: 0.9,
    shoreGrassBand: 1,
    shoreWetShade: 0.88,
    propBankMargin: 1.4,
};

export const WATER_SURFACE = {
    splineResampleStep: 1.0,
    lateralStep: 0.75,
    wetQuadMargin: 0.12,
    depthFadeRange: 1.8,
    depthColorCurve: 1.1,
    shallowAlpha: 0.55,
    deepAlpha: 0.88,
    flowSpeed: 1.0,
    rippleWavelengths: [4.5, 2.4, 1.1, 0.5] as const,
    rippleAmplitudes: [0.024, 0.018, 0.012, 0.008] as const,
    rippleDrifts: [1.0, 0.7, 1.3, 0.9] as const,
    reflectivityAtNormal: 0.04,
    grazingCurve: 4.0,
    shoreFoamStrength: 0.15,
    causticScale: 0.28,
    causticSpeed: 0.35,
    causticIntensity: 0.18,
    sunSpecularShininess: 140.0,
    sunSpecularIntensity: 0.55,
    skyReflectionStrength: 0.18,
};

export const WADING_RIPPLES = {
    immersionDepth: 0.35,
    channelGrace: 2,
    ringWavelength: 1.1,
    ringSpeed: 3.4,
    ringFalloff: 2.8,
    ringAmplitude: 0.18,
    contactFoamStrength: 0.8,
};

export const TERRAIN_DETAIL = {
    grainNoiseHeight: 0.55,
    grainNoiseScale: 0.42,
    rockSlopeStart: 0.32,
    rockSlopeEnd: 0.85,
};

export const GROUND_DEPTH_SHADE = {
    depthShadeStep: 0.05,
    minimumDepthShade: 0.72,
};

export const RENDER = {
    pixelRatioRange: range(1, 1.5),
    multisampling: 0,
    maximumFrameDeltaSeconds: 0.1,
};

export const SHADING = {
    toonShadingSteps: 6,
};

export const LIGHT = {
    sunLightDistance: 60,
    backLightDistance: 40,
    rimElevation: 0.45,
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowExtent: 60,
    shadowFar: 200,
};

export const ATMOSPHERE = {
    skyRadius: 650,
    middleAltitude: 0.32,
    skyDitherStrength: 0.6,
    hazeBaseHeight: 0,
    hazeHeightFadeRate: 0.022,
    hazeHeightInfluence: 0.75,
    sunGlowStrength: 0.5,
    sunGlowFalloff: 4,
    seasonalSunElevationRange: range(0.15, 1.3),
};

export const POST_PROCESSING = {
    exposure: 1.15,
    bloomIntensity: 0.55,
    bloomThreshold: 0.68,
    bloomSmoothing: 0.35,
    bloomRadius: 0.72,
    saturationBoost: 0.24,
    brightnessLift: 0.02,
    contrastBoost: 0.16,
};

export const OUTLINE = {
    thickness: 1,
    edgeThreshold: 0.012,
    fadeStartDistance: 26,
    fadeEndDistance: 70,
    foliageFadeStartDistance: 9,
    foliageFadeEndDistance: 28,
    opacity: 0.68,
};
