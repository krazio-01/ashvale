import type { Vector2Tuple, Vector3Tuple } from "three";
import { PROP_SCALE, SCALE, TRAIL, VIEW_DISTANCE, metresToUnits } from "@/constants/world";
import {
    CAMERA,
    PLAYER,
    PLAYER_MOTOR_TUNING,
    PLAYER_MOVEMENT,
    SPRINT_JUMP_REACH,
} from "@/constants/player";
import { degreesToRadians, range } from "@/lib/helpers";
import {
    PropLayer,
    type ISurfaceKindRule,
    type PropColliderShape,
    type SurfaceKind,
} from "@/types/world";
import type { ISinglePieceSpec, SceneMarkerKind, SceneModel } from "@/types/scenes";

const builtMetres = (units: number) => units / SCALE.unitsPerMetre / PROP_SCALE;

export const PROP_TRANSFORM_STRIDE = 5;

const PERCH_DECK_HEIGHT = builtMetres(
    (PLAYER_MOVEMENT.landing.plungeFrom + PLAYER_MOVEMENT.landing.hardFrom) / 2
);
const PERCH_STEP_RISE = builtMetres(PLAYER_MOTOR_TUNING.autostepMaxHeight * 0.6);
const PERCH_STEPS = Math.ceil(PERCH_DECK_HEIGHT / PERCH_STEP_RISE);
const PERCH_DECK_SIDE = 3.2;
const PERCH_TREAD = 0.45;
const PERCH_STAIR_WIDTH_METRES = 1.5;

export const PERCH_STAND = {
    deckHeightMetres: PERCH_DECK_HEIGHT,
    deckSideMetres: PERCH_DECK_SIDE,
    steps: PERCH_STEPS,
    deckThicknessMetres: 0.2,
    stairWidthMetres: PERCH_STAIR_WIDTH_METRES / PROP_SCALE,
    stairHalfWidth: metresToUnits(PERCH_STAIR_WIDTH_METRES) / 2,
    runMetres: PERCH_STEPS * PERCH_TREAD,
    treadMetres: PERCH_TREAD,
    railHeightMetres: 0.5,
    roofClearanceMetres: builtMetres(PLAYER.height * 2),
    postRadiusMetres: 0.16,
};

export const ENEMY_MARKERS: readonly SceneMarkerKind[] = ["enemySpot", "guardPost"];

export const ROCK_EMBED = {
    buryDepth: metresToUnits(0.3),
    sinkShare: 0.25,
    maxRiseShare: 0.35,
    maxSinkShare: 0.5,
    skirtWidth: metresToUnits(1.5),
    skirtSlope: 2.5,
    paintWidth: metresToUnits(0.75),
    undersideSubdivisions: 4,
    blockedRiseLimit: metresToUnits(1),
};

const CAMERA_WALKWAY_SHARE = 0.5;

export const SURFACE_FIELD = {
    paintWidth: metresToUnits(1.5),
    trailClearance: CAMERA.targetFollowDistance * CAMERA_WALKWAY_SHARE - TRAIL.halfWidth,
    edgeWavelength: metresToUnits(3),
    edgeShare: 0.3,
    coreSpread: 1.8,
    bankSteepness: 0.55,
    bankDepthPerSteepness: metresToUnits(4),
    bankTileSize: metresToUnits(32),
    crestHalfWidth: metresToUnits(3),
    refusedRetries: 2,
    refusedShrink: 0.6,
    skirtWidth: 0,
    footFade: metresToUnits(0.6),
};

export const BOULDER_FACE = {
    segmentHalfLength: metresToUnits(14),
    courseHeight: range(metresToUnits(7), metresToUnits(11)),
    bulge: metresToUnits(1),
    sink: 0.12,
    heightFit: range(0.8, 1),
    widthShare: range(0.85, 1.4),
    depthShare: range(0.8, 1.25),
    spacingShare: 0.62,
    yawJitter: degreesToRadians(8),
    tones: [
        [0.8, 0.78, 0.76],
        [1.1, 0.98, 0.84],
        [0.86, 0.8, 0.72],
        [0.82, 0.94, 0.74],
    ] satisfies Vector3Tuple[],
    heightShade: range(0.72, 1.1),
    shadeJitter: 0.1,
};

export const SURFACE_KINDS: Record<SurfaceKind, ISurfaceKindRule> = {
    rock: {
        material: "rock",
        models: [
            "/models/scans/BoulderJagged.gltf",
            "/models/scans/BoulderSlab.gltf",
            "/models/scans/OutcropLayered.gltf",
            "/models/scans/OutcropStepped.gltf",
        ],
        coverage: 0.95,
        edgeSizeShare: 0.45,
        footings: {
            walkable: {
                acrossMetres: range(1.4, 3.2),
                heightLimit: PLAYER_MOVEMENT.mantle.ground.maximum,
            },
            barrier: { acrossMetres: range(3, 7), heightLimit: null },
            crest: { acrossMetres: range(6, 12), heightLimit: null },
        },
    },
};

export const SCENE_LAYOUT = {
    wear: {
        edgeWavelength: metresToUnits(2.5),
        edgeShare: 0.45,
        sizeJitter: range(0.6, 1.25),
    },
    dressSocket: "goods",
    fordReach: metresToUnits(15),
    trailFitShares: [0.5, 0.35, 0.65, 0.2, 0.8],
    faceTopInset: 0.4,
    courseCrownShare: 0.15,
    courseWidthOverlap: 1.06,
    courseDepthStep: metresToUnits(0.05),
    siteMargin: metresToUnits(2.5),
    sceneGap: metresToUnits(1.5),
    sceneSpacing: metresToUnits(10),
    approachHalfWidth: metresToUnits(1.2),
    trailClearance: TRAIL.halfWidth + metresToUnits(1.5),
    waterClearance: metresToUnits(3),
    backdropDepth: metresToUnits(5),
    backdropSpread: degreesToRadians(35),
    angleAttempts: 8,
    radiusAttempts: 6,
    angleJitter: 0.3,
    ringRadiusRatio: 0.7,
    ringAreaPerItem: metresToUnits(15) * metresToUnits(15),
    ringMaximumItems: 8,
    fightCoreJumpReaches: 1.5,
    adaptSteps: 24,
    adaptMeetsMinimum: 10000,
    adaptPreference: 0.01,
    directionTolerance: 1e-6,
    adaptBlockedPenalty: 0.02,
    landmarkStretch: 3,
    landmarkShrink: 0.35,
    openAreaStep: metresToUnits(2),
    bandGap: metresToUnits(3.5),
    maximumSettledRegions: 4,
    structureBaseSink: 0.05,
    cliffSteepness: Math.tan(degreesToRadians(60)),
    slopeSteepness: range(Math.tan(degreesToRadians(45)), Math.tan(degreesToRadians(60))),
    terrainSiteSpacing: metresToUnits(18),
    terrainSiteLimit: 24,
    edgeBlockerSpacing: metresToUnits(9),
    edgeGuardSpacing: metresToUnits(5),
    edgeMergeSectors: 8,
    baseGroundSamples: 16,
    baseGroundRings: 2,
    maxStretchRatio: 2.5,
};

export const FIGHT_CORE_RADIUS = SPRINT_JUMP_REACH * SCENE_LAYOUT.fightCoreJumpReaches;

export const PLACE_LAYOUT = {
    endMarginMetres: 1,
    cornerClearMetres: 5,
    stallInsetMetres: 3.8,
    goodsInsetMetres: 1,
    frontGoodsMetres: 0.6,
    overheadInsetMetres: 0.6,
    floorTileScale: 0.5,
    frontageGapMetres: range(0.2, 1),
    stallGapMetres: range(0.5, 1.4),
    goodsGapMetres: range(0.6, 2.2),
    frontGoodsGapMetres: range(2.5, 5),
    overheadGapMetres: range(3.5, 5.5),
};

export const FLIGHT_LAYOUT = {
    treadBuryShare: 1.5,
    treadYawJitter: degreesToRadians(7),
    treadRiseJitter: 0.35,
    treadShiftShare: 0.12,
    slabWidthShare: range(0.6, 1.5),
    edgingChance: 0.6,
    edgingInset: metresToUnits(0.3),
    edgingScale: range(0.7, 1.15),
    sideSpacingShare: 0.55,
    sideSink: metresToUnits(0.4),
    sideYawJitter: degreesToRadians(8),
    guardGap: metresToUnits(0.8),
    guardSetback: metresToUnits(1.2),
    crownSetback: metresToUnits(1.5),
};

export const MODEL_LEAN = {
    minShare: 0.15,
};

const PROP_ACTIVATION_VIEW_RATIO = 0.3;

const WORLD_EDGE_FADE_WIDTH = 14;

export const PROP_LAYER_RULES: Record<
    PropLayer,
    {
        castsShadow: boolean;
        collidesByDefault: boolean;
        softEdged: boolean;
        isSolidMass: boolean;
        colliderShape: PropColliderShape;
    }
> = {
    [PropLayer.Canopy]: {
        castsShadow: true,
        collidesByDefault: true,
        softEdged: false,
        isSolidMass: false,
        colliderShape: "cylinder",
    },
    [PropLayer.Rock]: {
        castsShadow: true,
        collidesByDefault: true,
        softEdged: false,
        isSolidMass: true,
        colliderShape: "hull",
    },
    [PropLayer.Understory]: {
        castsShadow: true,
        collidesByDefault: false,
        softEdged: true,
        isSolidMass: false,
        colliderShape: "cylinder",
    },
    [PropLayer.Groundcover]: {
        castsShadow: false,
        collidesByDefault: false,
        softEdged: true,
        isSolidMass: false,
        colliderShape: "cylinder",
    },
    [PropLayer.Debris]: {
        castsShadow: false,
        collidesByDefault: false,
        softEdged: false,
        isSolidMass: true,
        colliderShape: "cylinder",
    },
    [PropLayer.Structure]: {
        castsShadow: true,
        collidesByDefault: false,
        softEdged: false,
        isSolidMass: false,
        colliderShape: "cylinder",
    },
};

export const COLLIDER_SHAPE = {
    columns: 24,
    voidShareMin: 0.1,
    enterableHeight: PLAYER.height * 0.6,
    enterableWidth: PLAYER.radius * 2,
    boxFillMin: 0.85,
    triangleBudget: 4000,
    decimationShrink: 0.8,
};

export const STANDABLE = {
    probeRise: PLAYER.height,
    groundReach: PLAYER.height * 0.5,
    minimumNormalY: Math.cos(PLAYER_MOTOR_TUNING.maxSlopeClimbAngle),
    capsuleLift: PLAYER.radius * 0.1,
    ringStep: PLAYER.radius * 2,
    maximumRadius: PLAYER.height * 10,
    searchRise: PLAYER.height * 2,
};

export function layerCollides(layer: PropLayer, explicit: boolean | null | undefined): boolean {
    return explicit ?? PROP_LAYER_RULES[layer].collidesByDefault;
}

export function singleSpec(
    model: SceneModel,
    at: Vector2Tuple,
    options: Partial<Omit<ISinglePieceSpec, "piece" | "model" | "at">> = {}
): ISinglePieceSpec {
    return {
        piece: "single",
        model,
        mirrored: false,
        at,
        yaw: 0,
        scale: 1,
        sink: 0,
        collides: false,
        stretchToSite: null,
        socketMarker: null,
        detached: false,
        colliderShape: null,
        wallRunnable: null,
        perch: null,
        frontMarkers: null,
        dress: [],
        layer: PropLayer.Rock,
        ...options,
    };
}

const GRASS_FULL_REACH = metresToUnits(15);

export const GRASS = {
    thinning: {
        reach: metresToUnits(100),
        fullReach: GRASS_FULL_REACH,
        falloff: 3,
        floorShare: 0.01,
        fadeStart: metresToUnits(65),
        rankFadeWidth: 0.3,
        bandShareRatio: 2,
        detail: { near: 3, far: 1, reach: GRASS_FULL_REACH },
    },
    shape: {
        maxWidthGain: 1.4,
        patchSpan: metresToUnits(1),
        bladesPerSquareMetre: 220,
        bladeHeightRange: range(metresToUnits(0.18), metresToUnits(0.75)),
        heightSkew: 1.7,
        tallShare: 0.07,
        tallStretch: 1.35,
        stalks: { share: 0.02, stretch: 1.8 },
        roundness: 0.6,
        bladeWidth: metresToUnits(0.028),
        bladeSink: metresToUnits(0.04),
        bladeTaper: 0.85,
        widthJitter: range(0.6, 1.5),
        lean: 0.45,
        leanBase: 0.3,
        bendRiseLoss: 0.3,
        tallBoost: 1.4,
        viewFacing: 0.6,
    },
    tufts: {
        cellSize: metresToUnits(0.45),
        reach: 0.7,
        heightRange: range(0.8, 1.6),
        lean: 0.35,
        toneShift: 0.18,
    },
    coverage: {
        patchContrast: 0.85,
        patchFullBand: range(0.5, 0.9),
        bedThinning: 0.2,
        heightRange: range(0.1, 1),
        clumpKeep: range(0.7, 1),
        clumpHeight: range(0.6, 1.45),
        clumpWavelength: metresToUnits(11),
        dryPatchWavelength: metresToUnits(32),
        dryPatchBand: range(0.5, 0.82),
    },
    wind: {
        swayGain: 2,
        restShare: 0.45,
        gustBand: range(0.55, 0.9),
    },
    tone: {
        base: { hueShift: 0.013, saturationScale: 0.86, lightnessShift: -0.122 },
        tip: { hueShift: -0.009, saturationScale: 1.31, lightnessShift: 0.174 },
        dry: { hueShift: -0.088, saturationScale: 0.82, lightnessShift: 0.266 },
        variety: { hueShift: 0.035, saturationScale: 1.05, lightnessShift: 0.05 },
        dryAmount: 0.22,
        dryPatchGain: 1.5,
        tipJitter: range(0.86, 1.14),
        gustBright: 0.24,
    },
    edge: {
        shortGrass: { hueShift: -0.02, saturationScale: 0.8, lightnessShift: -0.04 },
    },
    floor: {
        heightShare: 0.04,
        clumpTone: range(0.88, 1.1),
        variety: 0.5,
        coreBand: range(0.5, 1),
        coverBand: range(0.2, 0.7),
    },
    light: {
        normalUpBlend: 0.55,
        sideTilt: 0.25,
    },
};

export const LEDGE_STEPS = {
    buriedDepth: 1.5,
};

export const PROP_SCATTER = {
    activationRadius: VIEW_DISTANCE * PROP_ACTIVATION_VIEW_RATIO,
    activationJitter: 0.1,
    deactivationMargin: 15,
    sinkIntoGround: 0.02,
    crownSpawnShare: 0.7,
    placementAttempts: 8,
    densityScaleRange: range(0.5, 2),

    smallProps: {
        layer: PropLayer.Rock,
        maxRadius: metresToUnits(SURFACE_KINDS.rock.footings.walkable.acrossMetres[1]) / 2,
        viewDistance: metresToUnits(50),
    },

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

    grove: {
        candidateSpacing: 34,
        radiusRange: range(14, 30),
        familyWavelength: 200,
        understorySpeciesPerGrove: 3,
        boulderDensity: 0.0005,
    },

    rockCluster: {
        candidateSpacing: 40,
        radiusRange: range(6, 12),
        chance: 0.6,
    },

    distantTreeline: {
        candidateSpacing: 14,
        maskWavelength: 70,
        slopeLimit: 2.5,
        scaleBoost: range(1.1, 1.6),
    },

    canopy: {
        density: 0.0071,
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
        centreBias: 0.5,
        spacingGap: 0.05,
        slopeLimit: 0.9,
        scaleBoost: range(0.9, 1.2),
    },

    groundcoverPatch: {
        maskWavelength: 86,
        maskOctaves: 3,
        maskGain: 0.5,
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
    trail: {
        windowMetres: 48,
        idleUnits: 1e6,
        tickSeconds: 1 / 30,
        maxTicksPerFrame: 2,
        ageStepsPerTick: 8,
        ageStepRange: 255,
        holdShare: 0.12,
        naturalFrequency: 4.6,
        pressBend: 1.1,
        edgeFadeShare: 0.1,
        minRadiusTexels: 1.5,
        sourcePool: 192,
        sourcesPerCharacter: 3,
        maxStamped: 48,
        neutralTexel: [128, 128, 0, 255],
        cueSources: 8,
        fullSpeedMetres: 6,
        lightLifeShare: 0.6,
        foot: { radiusMetres: 0.22, lightStrength: 0.45, radialShare: 0.3 },
        brush: { strength: 0.6, radialShare: 0.7 },
        flowerLeanRadians: 1.1,
    },
    steepGroundBand: range(0.58, 0.9),
    worldEdgeFadeWidth: WORLD_EDGE_FADE_WIDTH,
    coverFullBand: range(0.08, 0.7),
    coverTrailBand: range(TRAIL.halfWidth, TRAIL.halfWidth + TRAIL.wearFalloffWidth),
    coverTextureSubdivisions: 2,
    sectorCount: 8,
    sectorCellMargin: 2,
    cellOverlap: Math.SQRT2,
    coverWarpWavelengths: range(metresToUnits(1.5), metresToUnits(5)),
    coverWarpReach: metresToUnits(2),
    trailEdgeJitter: metresToUnits(1.5),
    footprintJitter: metresToUnits(1.2),
    hashSalts: {
        bladeCell: 1,
        bloomPlace: 3,
        bloomShape: 11,
        patchOccupancy: 19,
        trailNoise: 3,
        footprintNoise: 7,
    },
    seedSpan: 256,
    mapTexelSize: metresToUnits(0.5),
    mapMaxSide: 2048,
    plantRoughness: 0.82,
};

const FLOWER_REACH = metresToUnits(40);

export const FLOWER_PATCHES = {
    thinning: {
        reach: FLOWER_REACH,
        fullReach: FLOWER_REACH,
        falloff: 1,
        floorShare: 1,
        fadeStart: metresToUnits(26),
        rankFadeWidth: 0.3,
        bandShareRatio: 2,
        detail: { near: 5, far: 3, reach: metresToUnits(15) },
    },
    cellSpacing: metresToUnits(0.35),
    stemHeightRange: range(metresToUnits(0.3), metresToUnits(0.42)),
    petalLength: metresToUnits(0.15),
    petalWidth: metresToUnits(0.1),
    petalRise: 0.55,
    stemWidthShare: 0.18,
    throatWidthShare: 0.35,
    scaleRange: range(0.75, 1.2),
    swayStrength: 0.16,

    patch: {
        spacing: metresToUnits(8),
        radiusRange: range(metresToUnits(3), metresToUnits(7)),
        chance: 0.6,
        coreRatio: 0.75,
        edgeWavelength: metresToUnits(2.5),
        edgeStrength: 0.45,
        coverBand: range(0.4, 0.6),
    },
    tone: {
        tipLightnessGain: 0.16,
        throatDarken: 0.62,
        stemHueShift: -0.02,
        stemLightnessShift: -0.06,
    },
};
