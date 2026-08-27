import { pair } from "@/lib/helpers";

export const WORLD = {
    gravity: -22,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

export const TERRAIN = {
    targetCellSize: 3,
    minimumResolution: 96,
    maximumResolution: 400,
    playMargin: 30,
    transition: 90,
    spread: 160,
    pathLevel: 0,
    bankWidth: 12,
    corridorDrop: 0.4,
    wildReliefScale: 0.035,
    peakShaping: 1.5,
    colorNoiseStrength: 0.08,
    carveColorSharpness: 0.75,
    bucketSize: 70,
};

export const LANDFORM = {
    floorReliefHeight: 0.5,
    floorReliefScale: 0.028,
    minimumOpennessRatio: 0.5,
    wildRampRatio: 0.7,
    mountainRampStartRatio: 0.5,
    mountainRampEndRatio: 1.6,
    terraceBandCount: 6,
    terraceOnsetRatio: 0.5,
    terraceRiserWidth: 0.13,
    terraceStrength: 0.85,
    vistaGapScale: 1.6,
    vistaGapDepth: 0.55,
    vistaGapRange: pair(0.34, 0.6),
    rampartStartRatio: 0.72,
    rampartHeightRatio: 1,
};

export const TERRAIN_DETAIL = {
    textureSize: 256,
    worldRepeat: 11,
    grainStrength: 0.3,
    grainNoiseHeight: 0.55,
    grainNoiseScale: 0.42,
    rockSlopeStart: 0.32,
    rockSlopeEnd: 0.85,
    broadVariationScale: 0.012,
    broadVariationStrength: 0.16,
    patchVariationScale: 0.08,
};

export const GROUND = {
    clearedHueShift: -0.05,
    clearedSaturationScale: 0.55,
    clearedLightnessGain: 0.18,
    depthLightnessStep: 0.035,
    minimumFloorLightness: 0.22,
    routeSaturationScale: 0.8,
    routeLightnessGain: 0.09,
};
