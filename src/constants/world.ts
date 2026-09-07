import { quad } from "@/lib/helpers";

export const SCALE = {
    unitsPerMetre: 2,
};

const TRAIL_HALF_WIDTH = 1.6;
const TRAIL_WEAR_FALLOFF_WIDTH = 3.2;

export const WORLD = {
    gravity: -22,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

export const TERRAIN = {
    targetCellSize: 4,
    minimumResolution: 64,
    maximumResolution: 256,
    pathLevel: 0,
    bankWidth: 12,
    corridorDrop: 0.4,
    corridorStepRatio: 0.5,
    corridorStepFaceWidth: 2,
    climbStyleWeights: [0.6, 0.17, 0.13, 0.1],
    cliffHoldDistance: 26,
    cliffReleaseDistance: 70,
    macroSlopeGrainWavelengths: 4,
    carveColorSharpness: 0.75,
    peakColorSharpness: 0.7,
    bucketSize: 220,
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
    wearFalloffExponent: 2.5,
    edgeWobbleAmplitude: 1.4,
    edgeWobbleScale: 0.055,
    distanceLimit: (TRAIL_HALF_WIDTH + TRAIL_WEAR_FALLOFF_WIDTH) * 2,
};

export const SOIL_RAMP = {
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

export const GROUND_PATCH = {
    noiseScale: 0.34,
    breakupStrength: 1.15,
};

export const WORLD_EDGE = {
    groundApron: 24,
    lipWidth: 20,
    dropDepth: 70,
    dropCurve: 2.6,
    barrierLipRatio: 0.3,
    barrierHeight: 30,
    barrierSink: 6,
};

/* water is a landform, not a decal: one course is routed past the arenas, the ground is blended
   down onto its bed, and the surface is the flat plane that bed sits under — so water can only
   ever exist inside its own channel, and its depth is capped by the bed rather than by the land */
export const WATER_COURSE = {
    minimumRegionsInCourse: 2,
    minimumPointCount: 12,
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
    fordHalfWidthRatio: 0.55,
    fordBedRatio: 0.45,
    waterlineDropBelowGround: 2.6,
    endTaperLength: 26,
    rimSafetyMargin: 4,
    shoreProbeMargin: 3,
};

export const WATER_CHANNEL = {
    bedDepth: 1.6,
    flatBedRatio: 0.5,
    bankWidth: 13,
    shoreReach: 5,
    dryDepth: -8,
    shoreWetBand: 1.4,
    shoreGrassBand: 1,
    shoreWetShade: 0.78,
    propBankMargin: 1.4,
};

/* the sheet spans the whole channel and finds its own shoreline per pixel, where the rendered
   ground crosses the water plane. nothing here describes an outline — the outline is wherever the
   depth reaches zero, which is why it can be exact instead of polygonal */
export const WATER_SURFACE = {
    lateralStep: 1.4,
    wetQuadMargin: 0.06,

    depthFadeRange: 1.15,
    shallowAlpha: 0.06,
    deepAlpha: 0.5,
    flowSpeed: 1.2,

    rippleWavelengths: quad(6.5, 3.1, 1.4, 0.8),
    rippleAmplitudes: quad(0.045, 0.05, 0.04, 0.032),
    rippleDrifts: quad(1, 0.6, 1.5, 0.9),

    /* physically based reflectance (Schlick's approximation): water reflects almost nothing
       looking straight down and almost everything at a grazing angle, which is the one cue that
       reads as "wet" rather than "painted" — reflectivityAtNormal is F0, the fraction reflected
       when looking straight down */
    reflectivityAtNormal: 0.02,
    grazingCurve: 5,

    specularSharpness: 420,
    specularStrength: 0.75,
    glitterThreshold: 0.6,
    glitterGrain: 90,

    causticWavelength: 0.5,
    causticStrength: 0.16,
    causticDepthReach: 0.85,

    foamDepth: 0.16,
    foamSoftness: 0.11,
    foamBreakupScale: 1.4,
    foamBreakupStrength: 0.5,
    foamColorMix: 0.75,
    foamAlpha: 0.55,

    seasonTintStrength: 0.35,
};

export const WATER_WADER = {
    immersionDepth: 0.5,
    channelGrace: 2,
    ringWavelength: 1.1,
    ringSpeed: 3.2,
    ringFalloff: 3.6,
    ringAmplitude: 0.15,
    collarRadius: 1.5,
    collarSoftness: 0.7,
    collarStrength: 0.85,
    speedReference: 6,
    speedSmoothing: 6,
};

export const TERRAIN_DETAIL = {
    textureSize: 384,
    worldRepeat: 7,
    grainTileCount: 10,
    grainStrength: 0.15,
    blotchTileCount: 3,
    mudMultiplier: [0.55, 0.48, 0.4],
    dustMultiplier: [1, 0.94, 0.78],
    grainNoiseHeight: 0.55,
    grainNoiseScale: 0.42,
    rockSlopeStart: 0.32,
    rockSlopeEnd: 0.85,
};

export const GROUND = {
    depthShadeStep: 0.05,
    minimumDepthShade: 0.72,
};
