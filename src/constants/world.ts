import { range } from "@/lib/helpers";
import {
    CorridorClimbStyle,
    type DangerCrossingKind,
    type IStampStyle,
    type OccupancyKind,
    type OccupantKind,
    type StampRole,
} from "@/types/world";
import type { RegionPurpose } from "@/types/realm";
export const VIEW_DISTANCE = 700;

export const SCALE = {
    unitsPerMetre: 2,
    heroHeightMetres: 2.1,
    humanHeightMetres: 1.78,
};

export function metresToUnits(value: number): number {
    return value * SCALE.unitsPerMetre;
}

export const WIND = {
    heading: 0.95,
    gust: { speed: 3.2, wavelengths: range(metresToUnits(4.5), metresToUnits(17)), seed: 41 },
    sway: 0.45,
    flutter: 0.15,
    flutterSpeed: 5.5,
};

export const PROP_SCALE = SCALE.heroHeightMetres / SCALE.humanHeightMetres;

export const BELL_FRAME = { beamHeightMetres: 2.3, bellHeightMetres: 1.2, hangGapMetres: 0.02 };

export const CHAPTER_FLOW = {
    gateRadius: metresToUnits(1.5),
    gateHeight: metresToUnits(6),
    gateSegments: 32,
    gateEdgeRatio: 0.7,
    gateOpacity: 0.35,
    interactionReach: metresToUnits(2.5),
};

export const GATE_RULES = {
    laneMetres: 4,
    depthMetres: 8,
    openSeconds: 1.5,
    switchSocket: "light",
    apronMetres: 10,
    extraWallRises: 2,
    strikesToBreak: 3,
    strikeReachMetres: 1,
};

export const GAP_CROSSING = {
    kinds: ["gorgeLedge", "collapsingBridge"] satisfies DangerCrossingKind[],
    spanOfSprintJump: 1.4,
    flankOfSprintJump: 1.2,
    apronMetres: 6,
    rimProbeUnits: 0.5,
    rimDropOfStepRise: 0.25,
    deepMetres: 14,
    ledgeTurnRadians: 0.12,
    ledgeOverlapOfLength: 0.15,
    ledgeGapOfSprintJump: 0.3,
    plankGapMetres: 0.06,
    plankTiltRadians: 0.05,
    plankTurnRadians: 0.04,
    plankSpinRadians: 2.5,
    lastGapOfSprintJump: 0.3,
    collapseOfSprintSpeed: 0.7,
    collapseLeadMetres: 3,
    fallSeconds: 1.6,
    resetSeconds: 2,
    postInsetMetres: 0.6,
    ropeHeightOfPost: 0.62,
    ropeSagOfSpan: 0.05,
    ropeRadiusMetres: 0.035,
    ropeSegments: 24,
    ropeColour: "#6b5737",
};

const TRAIL_HALF_WIDTH = 1.6;
const TRAIL_WEAR_FALLOFF_WIDTH = 5.5;

export const WORLD = {
    gravity: -22,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
    down: { x: 0, y: -1, z: 0 },
    up: { x: 0, y: 1, z: 0 },
};

export const WORLD_BUILD = {
    sliceMs: 8,
    usesWorldPlan: false,
};

export const MAX_SMALL_INDEX_VERTEX_COUNT = 65535;

export const COLLISION_LAYERS = {
    world: 0x0001,
    character: 0x0002,
    wallRun: 0x0004,
    all: 0xffff,
};

export const COLLISION_GROUPS = {
    world: (COLLISION_LAYERS.world << 16) | COLLISION_LAYERS.all,
    wallRunnable:
        ((COLLISION_LAYERS.world | COLLISION_LAYERS.wallRun) << 16) | COLLISION_LAYERS.all,
    character: (COLLISION_LAYERS.character << 16) | COLLISION_LAYERS.world,
    obstacleProbe: (COLLISION_LAYERS.all << 16) | COLLISION_LAYERS.all,
    sightLine: (COLLISION_LAYERS.all << 16) | COLLISION_LAYERS.world,
};

const SEAL_CROWN_METRES = 0.9;

const SEAL_ROUGHNESS_METRES = 2;

const PLAIN_STAMP_STYLE: IStampStyle = {
    profile: "ramp",
    isLethal: false,
    opensTraversal: false,
    onlyRaises: false,
    isMassif: false,
    isCliff: false,
    isShapeless: false,
    roughnessMetres: 0,
    crownMetres: 0,
};

export const STAMP_STYLE: Record<StampRole, IStampStyle> = {
    wallRunGap: {
        ...PLAIN_STAMP_STYLE,
        profile: "wall",
        isLethal: true,
        opensTraversal: true,
        isCliff: true,
    },
    linkGrade: PLAIN_STAMP_STYLE,
    wallRunFace: { ...PLAIN_STAMP_STYLE, profile: "wall", isCliff: true },
    corridorBank: {
        ...PLAIN_STAMP_STYLE,
        profile: "wall",
        opensTraversal: true,
        onlyRaises: true,
    },
    sealRing: {
        ...PLAIN_STAMP_STYLE,
        profile: "wall",
        onlyRaises: true,
        isMassif: true,
        crownMetres: SEAL_CROWN_METRES,
    },
    sealTier: {
        ...PLAIN_STAMP_STYLE,
        profile: "wall",
        onlyRaises: true,
        isMassif: true,
        roughnessMetres: SEAL_ROUGHNESS_METRES,
        crownMetres: SEAL_CROWN_METRES,
    },
    gateOpening: { ...PLAIN_STAMP_STYLE, opensTraversal: true, isShapeless: true },
    crossingGap: { ...PLAIN_STAMP_STYLE, profile: "wall", isLethal: true, opensTraversal: true },
    crossingFlank: { ...PLAIN_STAMP_STYLE, profile: "wall", isLethal: true },
};

export const SEALED_ROOM_STYLES: Partial<Record<RegionPurpose, CorridorClimbStyle>> = {
    secretPath: CorridorClimbStyle.Hidden,
    puzzle: CorridorClimbStyle.Gated,
};

export const TERRAIN = {
    edgeStripFade: metresToUnits(6),
    waterCliffClearance: 5,
    targetCellSize: 4,
    occupancyCellSize: 6,
    minimumResolution: 64,
    maximumResolution: 256,
    pathLevel: 0,
    levelHeight: 9,
    bankWidth: 12,
    linkDrop: 0.4,
    linkStepRatio: 0.5,
    linkStepFaceWidth: 2,
    reliefWidthSteps: 4,
    stampRefinement: { maximumFactor: 8, marginCells: 1, clearanceCells: 2, faceQuads: 4 },
    stampNoise: { roughnessWavelengthMetres: 20, crownWavelengthMetres: 7 },
    sealTiers: [{ widthMetres: 7 }, { widthMetres: 8 }],
    arenaCoreRatio: 0.6,
    passageShare: 0.4,
    passageSlopeShare: 0.45,
    corridorBankWidthRatio: 3,
    passagePathMetres: 3,
    grandPassagePathMetres: 7,
    macroSlopeGrainWavelengths: 4,
    borderProfileSampleCount: 256,
    peakColorSharpness: 0.7,
    propGroupCellSize: 140,
    lipDrop: metresToUnits(0.75),
    underside: {
        depthShare: 0.45,
        ringCount: 12,
        taperCurve: 1.8,
        roughness: metresToUnits(5),
        noiseScale: 0.045,
        noiseSeed: 7919,
        loopSmoothing: 3,
        shade: [0.75, 0.35],
    },
};

export const MODEL_MODULE_SEPARATOR = "#";

export const KIT_MODULE_ROLES = [
    "cliff",
    "fire",
    "floor",
    "foliage",
    "ledge",
    "light",
    "lore",
    "prop",
    "seat",
    "stair",
    "wall",
] as const;

export const OCCUPANCY_BLOCKERS: Record<OccupantKind, readonly OccupancyKind[]> = {
    scene: ["solidFootprint", "keepOut"],
    camp: ["solidFootprint", "keepOut", "enemyFree"],
    campSpot: ["enemyFree"],
    prop: ["solidFootprint", "keepOut"],
    enemy: ["solidFootprint", "keepOut", "enemyFree"],
    groundCover: ["solidFootprint"],
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
    driedEarth: { hueShift: -0.01, saturationScale: 0.95, lightnessShift: 0.02 },
    dust: { hueShift: -0.015, saturationScale: 0.85, lightnessShift: 0.03 },
    mud: { hueShift: 0.005, saturationScale: 1.15, lightnessShift: -0.12 },
    gritFromRock: { hueShift: 0, saturationScale: 0.45, lightnessShift: 0.03 },
};

export const GROUND_SURFACES = {
    grass: { source: "forrest_ground_01", tileMetres: 2, detail: 1 },
    soil: { source: "brown_mud_dry", tileMetres: 1.3, detail: 0.9 },
    litter: { source: "forest_leaves_04", tileMetres: 1.5, detail: 0.9 },
};

export const GROUND_SURFACE = {
    folder: "/textures/ground",
    bumpDepth: metresToUnits(0.04),
    secondScale: 0.37,
    blendBand: range(0.45, 0.55),
    maxAnisotropy: 2,
    rockFace: { tileMetres: 6, detail: 1.3 },
};

export const FOREST_FLOOR = {
    mossTileSpan: 23,
    mossBand: range(0.45, 0.62),
};

export const GROUND_MATERIAL = {
    loamBaseWeight: 0.7,
    sharpness: 7,
    trailDustGain: 1.4,
    trailMudGain: 0.9,
    maskNoise: { size: 256, octaves: 3, gain: 0.55, mipmapped: false },
    maskTileCounts: [3, 4, 5, 7],
    broadTileSpan: 170,
    fineTileSpan: 43,
    broadMaskWeight: 0.65,
    fineMaskOffset: [0.37, 0.71],
    detailTileSpan: 14,
    detailTileCounts: [6, 16, 3, 34],
    detailStrengths: [0.18, 0.1, 0.32, 0.36],
};

export const BORDER_BARRIER = {
    height: 30,
    sink: 6,
};

export const WATER_COURSE = {
    cliffClearance: 8,
    cliffBankGap: 3,
    minimumRegionsInCourse: 1,
    minimumPointCount: 6,
    rimOffsetRatio: 0.88,
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
    borderArc: 1.7,
    contourStep: 2,
    fallSourceRatio: 0.7,
    borderSeedOffset: 89,
};

export const SPRING = {
    maximumCount: 3,
    minimumRegionHalfSpan: 16,
    seedOffset: 300,
    seedStride: 47,
    angleNoiseScale: 0.05,
    centreOffsetRatio: 0.42,
    radiusBase: 5,
    radiusRange: 2.5,
    shapeNoiseScale: 0.08,
    restingDrop: 1,
    anchorReaches: [-1.15, -0.6, 0, 0.6, 1.15],
    halfWidthRatios: [0, 0.85, 1, 0.85, 0],
    rimHalfWidth: 0.8,
    bedRatios: [0.5, 0.8, 1, 0.8, 0.5],
    minimumPointCount: 3,
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
    wetRiverbedMudShare: 0.25,
    propBankMargin: 1.4,
    cutoffBelowBed: 2,
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
    foamWhiteShare: 0.92,
    foamCoverShare: 0.92,
    fresnelAlpha: 0.35,
    foamAlphaGain: 0.35,
    bankSkipDepth: -0.5,
    outsideDepth: -1,
    headRows: 3,
    headCurvatureShare: 0.65,
};

export const WADING_RIPPLES = {
    immersionDepth: 0.35,
    channelGrace: 2,
    ringWavelength: 1.1,
    ringSpeed: 3.4,
    ringFalloff: 2.8,
    ringAmplitude: 0.18,
    contactFoamStrength: 0.8,
    fullMotionSpeed: 2,
    motionResponse: 10,
    immersionStart: -0.1,
};

export const TERRAIN_DETAIL = {
    grainNoiseHeight: 0.55,
    grainNoiseScale: 0.42,
    rockSlopeStart: 0.32,
    rockSlopeEnd: 0.6,
    surfaceRoughness: 0.95,
    pitLight: {
        texelsPerPit: 2,
        floorTransmission: 0.03,
        transmissionCurve: 2.4,
        blendDepth: metresToUnits(0.5),
        sunPenumbra: metresToUnits(1.2),
    },
};

export const GROUND_DEPTH_SHADE = {
    depthShadeStep: 0.05,
    minimumDepthShade: 0.72,
};

export const RENDER = {
    maximumPixelRatio: 1.5,
    maximumFrameDeltaSeconds: 0.1,
};

export const LIGHT = {
    sunLightDistance: 60,
    sunToFill: 4.2,
    backLightDistance: 40,
    rimElevation: 0.45,
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowNormalBias: metresToUnits(0.05),
    shadowRadius: 2,
    shadowFar: 200,
    shadowEdgeFadeShare: 0.75,
    cavity: { strength: 4, maxShare: 0.5 },
};

export const ATMOSPHERE = {
    skyRadius: 650,
    middleAltitude: 0.32,
    skyDitherStrength: 0.6,
    seasonalSunElevationRange: range(0.15, 1.3),
    silhouettes: {
        middleShare: 0.5,
        shadeOfSky: 0.8,
        footHazeShare: 0.45,
        ranges: [
            { peakAltitude: 0.085, haze: 0.62, phase: 0.37, frequencies: [3, 7, 17, 41] },
            { peakAltitude: 0.05, haze: 0.38, phase: 1.91, frequencies: [5, 11, 23, 53] },
        ],
        octaveWeights: [0.5, 0.27, 0.15, 0.08],
    },
    clouds: {
        coverRange: range(0, 0.85),
        noise: { size: 256, tileCounts: [4, 8, 16], octaves: 5, gain: 0.5, mipmapped: true },
        noiseSeed: 11,
        octaves: [
            { weight: 0.58, scale: 1, offset: 0 },
            { weight: 0.28, scale: 2.7, offset: 0.31 },
            { weight: 0.14, scale: 7.3, offset: 0.77 },
        ],
        projectionScale: 0.32,
        horizonLift: 0.14,
        horizonFade: 0.16,
        driftSpeed: 0.004,
        sunProbe: 0.025,
        litBase: 0.55,
        litContrast: 5,
        sunGlowFocus: 5,
        sunGlowStrength: 0.45,
        opacity: 0.96,
    },
};

export const STYLE = {
    metalness: 0,
    stylize: 0.15,
    wrap: 0.12,
    stylizeContrastShare: 0.55,
    stylizeContrastEdge: 0.85,
    specularStylizeDamping: 0.85,
    toneMappingExposure: 1.2,
    fogSunFocus: 6,
    fogRiseLimit: 60,
    fogCameraDip: 0.35,
    fogFalloffFloor: 0.00001,
    fogFarFadeShare: 0.75,
    translucency: 0.85,
    backLightFocus: 4,
    cloth: {
        materialPattern: /awning|banner|flag/i,
        swayAttribute: "_sway",
        ripple: metresToUnits(0.06),
        swing: metresToUnits(0.08),
        waveNumbers: [2.4, 1.3, 1.9],
    },
    bark: {
        materialPattern: /bark|trunk/i,
        luminanceTarget: 0.13,
        gainRange: range(1, 2.6),
    },
    character: {
        fill: 0.79,
        rim: 2.2,
        rimFocus: 2.5,
    },
    canopyVariety: {
        strengthRange: range(0.35, 1.3),
        hueSpread: 0.9,
    },
    canopy: {
        evergreenMaterialPattern: /pine|fir|spruce|conifer/i,
        fallingLeafRoughness: 0.8,
        sphereBlend: 0.65,
        crownLift: 0.15,
        crownShade: range(0.7, 1.12),
        crownShadeBand: range(-0.6, 0.8),
        leafAlphaCutoff: 0.2,
        leafLuminanceTarget: 0.15,
        leafGainRange: range(0.8, 2.2),
        sway: {
            crownHeight: metresToUnits(8),
            swing: metresToUnits(0.16),
            flutter: metresToUnits(0.025),
            heightCap: 1.6,
            swingRange: range(0.05, 0.95),
        },
        translucency: 1,
    },
    grade: {
        whiteBalance: { red: 1.03, green: 1.0105, blue: 0.976 },
        vignette: 0.07,
        punch: {
            amount: 0.35,
            contrast: 0.1,
            saturation: 0.18,
            displayGamma: 2.2,
            lumaWeights: [0.2126, 0.7152, 0.0722],
        },
    },
    bloom: { intensity: 0.2, threshold: 0.95, smoothing: 0.35, radius: 0.5 },
    rock: {
        patchWavelength: 3,
        patchStrength: 0.6,
        mossFacing: range(0.35, 0.8),
        dustFacing: range(-0.2, 0.4),
        snowFacing: range(0.55, 0.85),
    },
};

export const SHARED_MATERIALS = ["rock"] as const;

export const SURFACE_KIND_NAMES = ["rock"] as const;

export const CANOPY_ROLES = ["foliage", "evergreen"] as const;
