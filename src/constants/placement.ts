import { TRAIL, VIEW_DISTANCE, WORLD_EDGE } from "@/constants/world";
import { range } from "@/lib/helpers";
import { PropLayer } from "@/types/world";

export const PROP_TRANSFORM_STRIDE = 5;

export const DEFAULT_FAMILY = "default";

const PROP_ACTIVATION_VIEW_RATIO = 0.5;

const WORLD_EDGE_FADE_WIDTH = 14;

export const PROP_LAYER_RULES: Record<
    PropLayer,
    { castsShadow: boolean; collidesByDefault: boolean; softEdged: boolean }
> = {
    [PropLayer.Canopy]: { castsShadow: true, collidesByDefault: true, softEdged: false },
    [PropLayer.Rock]: { castsShadow: true, collidesByDefault: true, softEdged: false },
    [PropLayer.Understory]: { castsShadow: true, collidesByDefault: false, softEdged: true },
    [PropLayer.Groundcover]: { castsShadow: false, collidesByDefault: false, softEdged: true },
    [PropLayer.Debris]: { castsShadow: false, collidesByDefault: false, softEdged: false },
};

export const GRASS = {
    detailLevelRadii: [15, 45, 150],
    tuftSpacing: 0.38,
    tuftSpreadRatio: 0.35,
    bladesPerTuft: 5,
    bladeHeightRange: range(0.32, 0.62),
    bladeWidth: 0.1,
    bladeTaperExponent: 0.6,
    bladeCurvature: 0.6,
    leanRange: range(0.35, 0.95),
    growth: {
        crushedHeightRatio: 0.4,
        crushedExtraLean: 0.7,
    },
    tone: {
        tuftToneWeight: 0.45,
        tintRange: range(0.82, 1.1),
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

export const LEDGE_STEPS = {
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

export const PROP_SCATTER = {
    activationRadius: VIEW_DISTANCE * PROP_ACTIVATION_VIEW_RATIO,
    activationJitter: 0.1,
    deactivationMargin: 15,
    occupancyCellSize: 6,
    collidingPropBudget: 900,
    sinkIntoGround: 0.02,
    placementAttempts: 8,
    typicalFileCount: 20,
    densityScaleRange: range(0.5, 2),

    softEdges: {
        trailClearance: 8.0,
        trailFadeWidth: 3.5,
        slopeFadeRatio: 0.7,
        apronFadeWidth: WORLD_EDGE_FADE_WIDTH,
    },

    keepOut: {
        combatArenaRatio: 0.35,
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
        radiusRange: range(12, 24),
        canopySpeciesPerClump: 2,
        understorySpeciesPerClump: 3,
        groundcoverSpeciesPerClump: 4,
    },

    distantTreeline: {
        candidateSpacing: 14,
        maskWavelength: 70,
        innerReach: WORLD_EDGE.flatBorderWidth + WORLD_EDGE.lipWidth * WORLD_EDGE.barrierLipRatio,
        extraReach: 8,
        innerDensity: 0.08,
        outerDensity: 0.4,
        slopeLimit: 2.5,
        scaleBoost: range(1.1, 1.6),
    },

    biomeRegion: {
        wavelength: 200,
        octaves: 2,
        gain: 0.5,
        equalizeBand: range(0.1, 0.9),
        transitionWidth: 0.4,
    },

    canopy: {
        density: 0.0035,
        centreBias: 0.8,
        spacingGap: 1.4,
        slopeLimit: 0.7,
        scaleBoost: range(1.1, 1.7),
    },

    rock: {
        density: 0.005,
        centreBias: 0.6,
        spacingGap: 0.7,
        slopeLimit: 1.1,
        scaleBoost: range(0.9, 1.6),
    },

    understory: {
        density: 0.008,
        clusterChance: 0.7,
        clusterRadius: 2.6,
        clusterCentreBias: 1.4,
        centreBias: 0.6,
        spacingGap: 0.15,
        slopeLimit: 1.1,
        scaleBoost: range(0.9, 1.25),
    },

    groundcover: {
        density: 0.01,
        centreBias: 0.5,
        spacingGap: 0.05,
        slopeLimit: 0.9,
        scaleBoost: range(0.9, 1.2),
    },

    groundcoverPatch: {
        spacing: 42,
        maskWavelength: 86,
        maskThreshold: 0.5,
        radiusRange: range(2.4, 5.0),
        countRange: range(16, 38),
        coreBias: 0.8,
        rimWavelength: 6,
        rimStrength: 0.5,
        speciesPerPatch: 1,
    },

    debris: {
        density: 0.0014,
        trailShoulderRatio: 0.45,
        shoulderOffsetRatio: 0.25,
        centreBias: 0.5,
        spacingGap: 0,
        slopeLimit: 1.2,
        scaleBoost: range(0.9, 1.15),
    },

    clutterAroundProps: {
        minimumCount: 2,
        maximumCount: 6,
        countPerFootprintMetre: 2.6,
        innerRadiusRatio: 0.65,
        outerRadiusRatio: 1.45,
        placementAttempts: 4,
        rules: {
            density: 0,
            slopeLimit: 1.1,
            scaleBoost: range(0.7, 1.05),
            centreBias: 0.7,
            spacingGap: 0.02,
        },
    },
};

export const GROUND_COVER = {
    steepGroundBand: range(0.58, 0.9),
    worldEdgeFadeWidth: WORLD_EDGE_FADE_WIDTH,
    coverTrailBand: range(TRAIL.halfWidth, TRAIL.halfWidth + TRAIL.wearFalloffWidth),
};

export const FLOWER_PATCHES = {
    detailLevelRadii: [20, 52],
    cellSpacing: 1.15,
    petalsPerBloom: 5,
    stemHeightRange: range(0.17, 0.29),
    petalLength: 0.11,
    petalWidth: 0.07,
    petalRise: 0.55,
    scaleRange: range(0.75, 1.2),
    coverage: 0.9,
    swayStrength: 0.16,

    patch: {
        spacing: 9,
        radiusRange: range(2.4, 5.2),
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
    springPlantBackRange: range(0.2, 1.1),
    plantScaleRange: range(0.85, 1.3),
    outflowStoneOffset: 2,
    outflowStoneScaleRange: range(1.3, 1.8),
    mudholeStoneCount: 6,
    mudholeStoneAngleJitter: 0.4,
    mudholeStoneOffsetRange: range(0.3, 1.7),
    mudholeStoneScaleRange: range(0.8, 1.3),
    mudholeStoneSink: 0.2,
    mudholePlantCount: 14,
    mudholePlantOffsetRange: range(0.2, 2),
    mudholeTreePoolRadius: 4,
    mudholeTreeOffsetRange: range(3, 5),
    mudholeTreeScaleRange: range(0.9, 1.2),
};
