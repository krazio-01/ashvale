import type { Vector3Tuple } from "three";

export const PLAYER = {
    speed: 5,
    sprintSpeed: 9,
    jumpForce: 6,
    height: 1.7,
    radius: 0.4,
    eyeHeight: 0.7,
};

export const CAMERA: {
    fov: number;
    near: number;
    far: number;
} = {
    fov: 55,
    near: 0.1,
    far: 200,
};

export const WORLD = {
    gravity: -22,
    fogNear: 22,
    fogFar: 70,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

export const PALETTE = {
    void: "#1a1526",
    haze: "#4a3f63",
    stoneDark: "#5a4f52",
    stone: "#8a7a6d",
    ember: "#ff7a3c",
    keyLight: "#ffe8cc",
    skyFill: "#6f8fd0",
    bounceFill: "#4a3b2e",
    rimLight: "#7fb8e8",
};

export const SHADING = {
    gradientSteps: 4,
};

export const LIGHT: {
    hemisphereIntensity: number;
    keyIntensity: number;
    keyPosition: Vector3Tuple;
    rimIntensity: number;
    rimPosition: Vector3Tuple;
    shadowMapSize: number;
    shadowBias: number;
    shadowExtent: number;
    shadowFar: number;
} = {
    hemisphereIntensity: 0.7,
    keyIntensity: 2.0,
    keyPosition: [18, 22, 14],
    rimIntensity: 1.4,
    rimPosition: [-16, 10, -18],
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowExtent: 40,
    shadowFar: 80,
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
