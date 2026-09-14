import { pair } from "@/lib/helpers";
import { CAMERA } from "./characters";
import { TRAIL, WORLD_EDGE } from "./world";

const PROP_VIEW_RATIO_OF_CAMERA_FAR = 0.5;

const WORLD_EDGE_FADE_WIDTH = 14;

export const GRASS = {
    levelRadii: [15, 45, 150],
    tuftSpacing: 0.38,
    tuftSpreadRatio: 0.35,
    bladesPerTuft: 5,
    bladeHeightRange: pair(0.32, 0.62),
    bladeWidth: 0.1,
    bladeTaperExponent: 0.6,
    bladeCurvature: 0.6,
    leanRange: pair(0.35, 0.95),
    steepGroundBand: pair(0.58, 0.9),
    worldEdgeFadeWidth: WORLD_EDGE_FADE_WIDTH,
    growth: {
        crushedHeightRatio: 0.4,
        crushedExtraLean: 0.7,
    },
    wind: {
        heading: 0.95,
        bendSpread: 1.1,
        waveLength: 14,
        waveSpeed: 1.1,
        sway: 0.45,
        flutter: 0.15,
        flutterSpeed: 5.5,
    },
    tone: {
        tuftToneWeight: 0.45,
        tintRange: pair(0.82, 1.1),
        lushHueShift: 0.03,
        dryHueShift: -0.05,
        tipLightnessGain: 0.18,
        rootDarken: 0.45,
    },
    light: {
        sunWrap: 0.42,
        sunGain: 0.55,
        ambientGain: 0.85,
        baseOcclusion: 0.42,
        tipSheen: 0.06,
    },
};

export const LEDGE = {
    stepRiseOfJumpApex: 0.7,
    maxAlongCorridorRatio: 0.3,
    safeRiseOfJumpApex: 0.95,
    rocksPerStep: 3,
    rockWidthOfCorridorHalfWidth: 0.22,
    rockWidthJitter: 0.45,
    lateralSpreadOfCorridorHalfWidth: 0.75,
    alongSpreadOfRockWidth: 1.6,
    riseJitter: 0.18,
    buriedDepth: 1.5,
};

export const PROP_FIELD = {
    activationRadius: CAMERA.far * PROP_VIEW_RATIO_OF_CAMERA_FAR,
    activationJitter: 0.1,
    deactivationMargin: 15,
    occupancyCellSize: 6,
    collidingPropBudget: 900,
    groundBite: 0.02,
    placementAttempts: 8,
    typicalFileCount: 20,
    richnessRange: pair(0.5, 2),

    softEdges: {
        trailClearance: 2.25,
        trailFadeWidth: TRAIL.halfWidth + TRAIL.wearFalloffWidth - 2.25,
        slopeFadeRatio: 0.7,
        apronFadeWidth: WORLD_EDGE_FADE_WIDTH,
    },

    keepOut: {
        combatArenaRatio: 0.35,
        enemySpawnClearance: 3,
        laneClearanceRatio: 1.05,
        chapterSpawnClearance: 7,
    },

    clump: {
        candidateSpacing: 46,
        maskWavelength: 110,
        maskOctaves: 3,
        maskGain: 0.5,
        forestThreshold: 0.46,
        outcropThreshold: 0.6,
        radiusRange: pair(12, 24),
        canopySpeciesPerClump: 2,
        understorySpeciesPerClump: 3,
        groundcoverSpeciesPerClump: 4,
    },

    distantTreeline: {
        candidateSpacing: 14,
        maskWavelength: 70,
        innerReach: WORLD_EDGE.groundApron + WORLD_EDGE.lipWidth * WORLD_EDGE.barrierLipRatio,
        extraReach: 8,
        innerDensity: 0.08,
        outerDensity: 0.4,
        slopeLimit: 2.5,
        scaleBoost: pair(1.1, 1.6),
    },

    biomeRegion: {
        wavelength: 200,
        octaves: 2,
        gain: 0.5,
        equalizeBand: pair(0.1, 0.9),
        transitionWidth: 0.4,
    },

    canopy: {
        density: 0.0035,
        centreBias: 0.8,
        spacingGap: 1.4,
        slopeLimit: 0.7,
        scaleBoost: pair(1.1, 1.7),
    },

    rock: {
        density: 0.005,
        centreBias: 0.6,
        spacingGap: 0.7,
        slopeLimit: 1.1,
        scaleBoost: pair(0.9, 1.6),
    },

    understory: {
        density: 0.008,
        huddleRatio: 0.7,
        huddleRadius: 2.6,
        huddleCentreBias: 1.4,
        centreBias: 0.6,
        spacingGap: 0.15,
        slopeLimit: 1.1,
        scaleBoost: pair(0.9, 1.25),
    },

    groundcover: {
        density: 0.01,
        centreBias: 0.5,
        spacingGap: 0.05,
        slopeLimit: 0.9,
        scaleBoost: pair(0.9, 1.2),
    },

    groundcoverPatch: {
        spacing: 42,
        maskWavelength: 86,
        maskThreshold: 0.5,
        radiusRange: pair(2.4, 5.0),
        countRange: pair(16, 38),
        coreBias: 0.8,
        rimWavelength: 6,
        rimStrength: 0.5,
        speciesPerPatch: 1,
    },

    debris: {
        density: 0.0014,
        trailShoulderRatio: 0.45,
        shoulderOffsetRatio: pair(0.25, 0.7),
        centreBias: 0.5,
        spacingGap: 0,
        slopeLimit: 1.2,
        scaleBoost: pair(0.9, 1.15),
    },

    embedding: {
        minimumCount: 2,
        maximumCount: 6,
        countPerFootprintMetre: 2.6,
        innerRadiusRatio: 0.65,
        outerRadiusRatio: 1.45,
        placementAttempts: 4,
        rules: {
            density: 0,
            slopeLimit: 1.1,
            scaleBoost: pair(0.7, 1.05),
            centreBias: 0.7,
            spacingGap: 0.02,
        },
    },
};

export const GROUND_COVER = {
    steepGroundBand: pair(0.58, 0.9),
    worldEdgeFadeWidth: WORLD_EDGE_FADE_WIDTH,
    coverTrailBand: pair(TRAIL.halfWidth, TRAIL.halfWidth + TRAIL.wearFalloffWidth),
};

export const BLOOM = {
    levelRadii: [20, 52],
    cellSpacing: 1.15,
    petalsPerBloom: 5,
    stemHeightRange: pair(0.17, 0.29),
    petalLength: 0.11,
    petalWidth: 0.07,
    petalRise: 0.55,
    scaleRange: pair(0.75, 1.2),
    coverage: 0.9,
    swayStrength: 0.16,

    patch: {
        spacing: 9,
        radiusRange: pair(2.4, 5.2),
        chance: 0.42,
        coreRatio: 0.32,
        edgeWavelength: 4.5,
        edgeStrength: 0.45,
    },
    tone: {
        tipLightnessGain: 0.16,
        throatDarken: 0.62,
        stemHueShift: -0.02,
        stemLightnessShift: -0.06,
        speciesHueSpread: 0.27,
    },
    light: {
        sunWrap: 0.5,
        sunGain: 0.6,
        ambientGain: 0.9,
    },
};

export const WATER_EDGE = {
    minimumSpringRadius: 4,
    frameSpan: 2,
    stoneSink: 0.3,
    stoneScaleJitter: 0.15,
    springPlantCount: 10,
    springPlantCrossSpread: 1.8,
    springPlantBackRange: pair(0.2, 1.1),
    plantScaleRange: pair(0.85, 1.3),
    outflowStoneOffset: 2,
    outflowStoneScaleRange: pair(1.3, 1.8),
    mudholeStoneCount: 6,
    mudholeStoneAngleJitter: 0.4,
    mudholeStoneOffsetRange: pair(0.3, 1.7),
    mudholeStoneScaleRange: pair(0.8, 1.3),
    mudholeStoneSink: 0.2,
    mudholePlantCount: 14,
    mudholePlantOffsetRange: pair(0.2, 2),
    mudholeTreePoolRadius: 4,
    mudholeTreeOffsetRange: pair(3, 5),
    mudholeTreeScaleRange: pair(0.9, 1.2),
};
