import { vec3, pair } from "@/lib/helpers";

export const PLAYER = {
    speed: 5,
    sprintSpeed: 9,
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
    fogNear: 22,
    fogFar: 70,
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
    skyFill: "#6f8fd0",
    bounceFill: "#4a3b2e",
    rimLight: "#7fb8e8",
};

export const SHADING = {
    gradientSteps: 4,
};

export const LIGHT = {
    hemisphereIntensity: 0.7,
    keyIntensity: 2.0,
    keyPosition: vec3(18, 22, 14),
    rimIntensity: 1.4,
    rimPosition: vec3(-16, 10, -18),
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowExtent: 40,
    shadowFar: 80,
};

export const RENDER = {
    pixelRatioRange: pair(1, 1.5),
    toneMappingExposure: 1.35,
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

export const BOSS = {
    radius: 0.9,
    height: 3.2,
};
