import { pair, vec3 } from "@/lib/helpers";

export const PLAYER = {
    speed: 7,
    sprintSpeed: 35,
    jumpForce: 16,
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
    far: 700,
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

export const SPAWNING = {
    filesPerEnemy: 8,
    maximumEnemiesPerRegion: 4,
    enemyRingRadiusFactor: 0.25,
    enemySpawnHeight: 1.5,
    playerSpawnHeight: 2,
    bossSpawnHeight: 2.5,
};

export const ENEMY = {
    radius: 0.5,
    height: 1.8,
};

export const BOSS = {
    radius: 1.4,
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
