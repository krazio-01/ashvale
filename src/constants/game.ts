import { vec3, pair } from "@/lib/helpers";

export const PLAYER = {
    speed: 5,
    sprintSpeed: 10,
    jumpForce: 6,
    height: 1.7,
    radius: 0.4,
    maxHealth: 100,
    unarmedDamage: 5,
    turnSmoothing: 12,
    spawnPosition: vec3(0, 2, 6),
    colliderOffset: 0.02,
    maxSlopeClimbAngle: (45 * Math.PI) / 180,
    minSlopeSlideAngle: (38 * Math.PI) / 180,
    autostepMaxHeight: 0.45,
    autostepMinWidth: 0.2,
    snapToGroundDistance: 0.5,
    terminalVelocity: -45,
};

export const CAMERA = {
    fov: 55,
    near: 0.1,
    far: 320,
    startPosition: vec3(0, 8, 18),
    targetFollowDistance: 7,
    minimumFollowDistance: 1.7,
    collisionPadding: 0.4,
    pullOutSmoothing: 5,
    pivotHeight: 1.4,
    pivotSmoothing: 10,
    mouseSensitivity: 0.0023,
    pitchRange: pair(-0.5, 1.15),
    startPitch: 0.35,
};

export const WORLD = {
    gravity: -22,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

export const PALETTE = {
    haze: "#4a3f63",
    stoneDark: "#5a4f52",
    stone: "#8a7a6d",
    stoneLight: "#c2ad91",
    moss: "#6f7d55",
    ember: "#ff7a3c",
    playerBody: "#c1503c",
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

export const ATMOSPHERE = {
    skyRadius: 200,
    middleAltitude: 0.32,
    skyDitherStrength: 0.6,
    hazeBaseHeight: 0,
    hazeHeightFadeRate: 0.022,
    hazeHeightInfluence: 0.75,
    sunGlowStrength: 0.5,
    sunGlowFalloff: 4,
};

export const AMBIENT_OCCLUSION = {
    radius: 1.4,
    distanceFalloff: 1,
    intensity: 2.4,
    samples: 8,
    denoiseSamples: 4,
    denoiseRadius: 12,
    halfResolution: true,
};

export const TERRAIN = {
    targetCellSize: 2.5,
    minimumResolution: 96,
    maximumResolution: 208,
    playMargin: 20,
    transition: 50,
    spread: 110,
    pathLevel: 0,
    bankWidth: 8,
    corridorDrop: 0.4,
    wildReliefScale: 0.035,
    peakShaping: 1.5,
    colorNoiseStrength: 0.08,
    flatColorSharpness: 0.75,
    bucketSize: 70,
};

export const SURROUND = {
    innerTreeCount: 80,
    innerFillerCount: 70,
    innerGrassCount: 260,
    outerTreeCount: 40,
    outerFillerCount: 60,
    outerGrassCount: 140,
    treeSlopeLimit: 0.7,
    fillerSlopeLimit: 1.1,
    grassSlopeLimit: 0.8,
    treeScaleBoost: pair(1.1, 1.7),
    edgePadding: 2,
    flatRejectWeight: 0.1,
};

export const SPAWNING = {
    filesPerEnemy: 8,
    maximumEnemiesPerRegion: 4,
    enemyRingRadiusFactor: 0.25,
    enemySpawnHeight: 1.5,
    playerSpawnHeight: 2,
    bossSpawnHeight: 2.5,
};

export const BOSS = {
    radius: 1.4,
};

export const SHADING = {
    gradientSteps: 6,
};

export const LIGHT = {
    keyDistance: 60,
    rimDistance: 40,
    rimElevation: 0.45,
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowExtent: 60,
    shadowFar: 160,
};

export const RENDER = {
    pixelRatioRange: pair(1, 1.5),
    multisampling: 0,
    foliageMaskScale: 0.5,
};

export const POST_PROCESSING = {
    exposure: 1.15,
    bloomIntensity: 0.55,
    bloomThreshold: 0.68,
    bloomSmoothing: 0.35,
    bloomRadius: 0.72,
    saturationBoost: 0.24,
    brightnessLift: 0.02,
    contrastBoost: 0.12,
};

export const OUTLINE = {
    thickness: 1,
    edgeThreshold: 0.012,
    fadeStartDistance: 26,
    fadeEndDistance: 70,
    opacity: 0.68,
    debugView: false,
};

export enum EnemyAction {
    Idle = "idle",
    Chase = "chase",
    Attack = "attack",
    Retreat = "retreat",
}

export enum EnemyArchetype {
    Sentinel = "sentinel",
    Wraith = "wraith",
    Golem = "golem",
    Gremlin = "gremlin",
}

export const ENEMY = {
    radius: 0.5,
    height: 1.8,
};

export const PROP_PLACEMENT = {
    landmarksPerRegion: 2,
    landmarkSpeciesPerRegion: 1,
    structureSpeciesPerRegion: 2,
    minimumStructuresPerRegion: 3,
    maximumStructuresPerRegion: 10,
    filesPerStructure: 12,
    maximumScatterPerRegion: 120,
    filesPerCluster: 25,
    minimumClustersPerRegion: 2,
    maximumClustersPerRegion: 5,
    clusterRadiusRatio: 0.22,
    scatterAnchoredToStructureRatio: 0.4,
    structureAnchorRadius: 3,
    centerClearanceRatio: 0.35,
    separationGap: 1,
    placementAttempts: 10,
};

export const GRASS = {
    tileSize: 16,
    tilesPerFrame: 2,
    tierHysteresis: 3,
    heightSampleSpacing: 1,
    detailTiers: [
        { radius: 20, bladesPerSquareMetre: 14, segments: 5, scale: 1 },
        { radius: 36, bladesPerSquareMetre: 7, segments: 3, scale: 1.25 },
        { radius: 56, bladesPerSquareMetre: 3, segments: 2, scale: 1.6 },
    ],
    bladeHeightRange: pair(0.4, 1),
    bladeWidth: 0.1,
    bladeTaperExponent: 0.55,
    leanRange: pair(0.06, 0.3),
    curlRange: pair(0.12, 0.42),
    tintRange: pair(0.82, 1.16),
    fadeStart: 42,
    fadeEnd: 54,
    tipLightnessGain: 0.26,
    tipHueShift: 0.04,
    rootDarken: 0.74,
    sunWrap: 0.45,
    windStrength: 0.13,
    windFrequency: 1.5,
    windScale: 0.11,
    windGustScale: 0.02,
    routeRejectWeight: 0.3,
};

export const TERRAIN_DETAIL = {
    textureSize: 256,
    worldRepeat: 11,
    grainStrength: 0.3,
    microReliefHeight: 0.55,
    microReliefScale: 0.42,
    rockSlopeStart: 0.32,
    rockSlopeEnd: 0.85,
    broadVariationScale: 0.012,
    broadVariationStrength: 0.16,
};
