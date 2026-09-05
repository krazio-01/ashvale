import { pair } from "@/lib/helpers";
import { CAMERA } from "./characters";

const PROP_VIEW_RATIO_OF_CAMERA_FAR = 0.5;

export const GRASS = {
    levelRadii: [15, 45, 150],
    tuftSpacing: 0.38,
    bladesPerTuft: 5,
    bladeHeightRange: pair(0.32, 0.62),
    bladeWidth: 0.1,
    bladeTaperExponent: 0.6,
    bladeCurvature: 0.6,
    leanRange: pair(0.35, 0.95),
    steepGroundBand: pair(0.58, 0.9),
    worldEdgeFadeWidth: 14,
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

export const VEGETATION = {
    treeDensity: 0.00021,
    fillerDensity: 0.00018,
    groundCoverDensity: 0.00067,
    treeSpeciesPerBand: 5,
    fillerSpeciesPerBand: 4,
    groundCoverSpeciesPerBand: 6,
    outerDensityFactor: 0.55,
    maximumPerBand: 1500,
    treeSlopeLimit: 0.7,
    fillerSlopeLimit: 1.1,
    grassSlopeLimit: 0.8,
    treeScaleBoost: pair(1.1, 1.7),
    edgePadding: 2,
    trailWearRejectThreshold: 0.75,
    groundBite: 0.02,
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
    occupancyCellSize: 6,
    collidingPropBudget: 900,
    groundBite: 0.02,
    placementAttempts: 8,
    trailWearRejectThreshold: 0.75,
    typicalFileCount: 20,
    richnessRange: pair(0.5, 2),

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
        huddleRatio: 0.55,
        huddleRadius: 2.6,
        centreBias: 0.6,
        spacingGap: 0.15,
        slopeLimit: 1.1,
        scaleBoost: pair(0.9, 1.25),
    },

    groundcover: {
        density: 0.01,
        openDensity: 0.0035,
        meadowPatchWavelength: 55,
        openPatchThreshold: 0.42,
        centreBias: 0.5,
        spacingGap: 0.05,
        slopeLimit: 0.9,
        scaleBoost: pair(0.9, 1.2),
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
};

export const CORRIDOR_PROPS = {
    anchorsPerUnitLength: 0.022,
    minimumAnchorsPerCorridor: 1,
    maximumAnchorsPerCorridor: 8,
    spineJitter: 0.35,
    lateralMarginRatio: 0.7,
    lateralSpread: 16,
    clusterRadius: 5,
    propsPerAnchor: pair(2, 5),
    speciesPerRealm: 6,
    regionKeepOut: 6,
    slopeLimit: 0.9,
    carveRejectThreshold: 0.25,
    scaleBoost: pair(1, 1.4),
    placementAttempts: 8,
};

export const GROUND_FIELD = {
    steepGroundBand: pair(0.58, 0.9),
    worldEdgeFadeWidth: 14,
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
    driftWavelength: 26,
    driftThreshold: 0.28,
    speciesWavelength: 61,
    speciesOffset: 137,
    swayStrength: 0.16,
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
