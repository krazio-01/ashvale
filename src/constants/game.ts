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
    groundedVelocityThreshold: 0.05,
    spawnPosition: vec3(0, 2, 6),
};

export const CAMERA = {
    fov: 55,
    near: 0.1,
    far: 200,
    startPosition: vec3(0, 8, 18),
    followDistance: 7,
    followHeight: 3.2,
    lookAtHeight: 1.2,
    followSmoothing: 6,
};

export const WORLD = {
    gravity: -22,
    fogNear: 35,
    fogFar: 100,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

export const GROUND = {
    size: 90,
    thickness: 0.5,
};

export const PROP = {
    pillarRadius: 0.9,
    pillarHeight: 6,
    pillarTaper: 0.75,
    pillarSides: 7,
    boulderRadius: 1.2,
    slabWidth: 3.4,
    slabHeight: 0.9,
    slabDepth: 1.6,
};

export const PALETTE = {
    void: "#1a1526",
    haze: "#4a3f63",
    groundNear: "#4a4238",
    stoneDark: "#5a4f52",
    stone: "#8a7a6d",
    stoneLight: "#c2ad91",
    moss: "#6f7d55",
    ember: "#ff7a3c",
    playerBody: "#c1503c",
    keyLight: "#ffe8cc",
    skyFill: "#8a95b8",
    bounceFill: "#4a3b2e",
    rimLight: "#9cb8d8",
};

export const REGION = {
    floorThickness: 0.4,
    floorColorsByDepth: [PALETTE.stoneLight, PALETTE.stone, PALETTE.stoneDark, PALETTE.groundNear],
};

export const CORRIDOR = {
    floorThickness: 0.3,
    color: PALETTE.stone,
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
    gradientSteps: 4,
};

export const LIGHT = {
    hemisphereIntensity: 0.35,
    keyIntensity: 1.7,
    keyPosition: vec3(18, 22, 14),
    rimIntensity: 0.8,
    rimPosition: vec3(-16, 10, -18),
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowExtent: 60,
    shadowFar: 120,
};

export const RENDER = {
    pixelRatioRange: pair(1, 2),
    multisampling: 8,
    toneMappingExposure: 1.1,
};

export const OUTLINE = {
    color: "#211a17",
    normalThreshold: 0.15,
    depthThreshold: 0.0015,
    debugView: false,
};

export enum PropShape {
    Pillar = "pillar",
    Boulder = "boulder",
    Slab = "slab",
}

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
