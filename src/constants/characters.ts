import { metres, pair, vec3 } from "@/lib/helpers";
import { WORLD } from "@/constants/world";

const PLAYER_HEIGHT = metres(2.1);

export const PLAYER = {
    height: PLAYER_HEIGHT,
    radius: PLAYER_HEIGHT * 0.24,
    walkSpeed: PLAYER_HEIGHT * 1.25,
    sprintSpeed: PLAYER_HEIGHT * 5,
    jumpForce: 11,
    maxHealth: 100,
    unarmedDamage: 5,
    turnSmoothing: 15,
    groundAcceleration: 34,
    airAcceleration: 14,
    movingSpeedThreshold: PLAYER_HEIGHT * 0.12,
    airborneGraceSeconds: 0.12,
    spawnPosition: vec3(0, 2, 6),
    colliderOffset: 0.02,
    maxSlopeClimbAngle: (45 * Math.PI) / 180,
    minSlopeSlideAngle: (38 * Math.PI) / 180,
    autostepMaxHeight: PLAYER_HEIGHT * 0.26,
    autostepMinWidth: PLAYER_HEIGHT * 0.12,
    snapToGroundDistance: PLAYER_HEIGHT * 0.3,
    terminalVelocity: -45,
};

export const CAMERA = {
    fov: 55,
    near: 0.1,
    far: 700,
    startPosition: vec3(0, 5, 10),
    targetFollowDistance: PLAYER_HEIGHT * 2.3,
    sprintFollowDistance: PLAYER_HEIGHT * 2.4,
    minimumFollowDistance: PLAYER_HEIGHT * 0.6,
    collisionPadding: metres(0.125),
    pullOutSmoothing: 4,
    pivotHeight: PLAYER_HEIGHT * 0.7,
    shoulderOffset: metres(0.35),
    pivotSmoothing: 12,
    sprintFovBoost: 2,
    speedBlendSmoothing: 6,
    mouseSensitivity: 0.0023,
    pitchRange: pair(-0.45, 1.25),
    startPitch: 0.21,
};

export const SPAWNING = {
    filesPerEnemy: 8,
    maximumEnemiesPerRegion: 4,
    spawnClearanceBuffer: metres(0.15),
    playerSpawnHeight: 2,
};

export const ENEMY = {
    sentinelHeight: metres(2.2),
    sentinelRadius: metres(0.71),
    golemHeight: metres(2.8),
    golemRadius: metres(0.91),
    gremlinHeight: metres(2.1),
    gremlinRadius: metres(0.58),
    wraithHeight: metres(2.4),
    wraithRadius: metres(0.64),
};

export const ENEMY_PLACEMENT = {
    campProbability: 0.7,
    smallestCamp: 2,
    largestCamp: 3,
    campRadius: metres(3.2),
    minimumMemberSpacing: metres(2.2),
    minimumCampSpacing: metres(8),
    regionEdgeMargin: metres(4),
    maximumSteepness: 0.6,
    playerSpawnClearance: metres(12),
    spawnClearanceRegionFraction: 0.5,
    propClearanceRadius: ENEMY.golemRadius + metres(0.3),
    samplingAttempts: 12,
    facingJitter: (25 * Math.PI) / 180,
    dominantArchetypeShare: 0.6,
};

export const BOSS = {
    height: metres(3),
    radius: metres(0.85),
};

export const WEAPON = {
    swordModelPath: "/models/weapons/Sword.glb",
    swordDamage: 14,
    gripPosition: vec3(0, 0, 0),
    gripRotation: vec3(0, 0, 0),
    gripScale: 0.2,
};

export const NON_PLAYER = {
    colliderOffset: 0.02,
    maxSlopeClimbAngle: (50 * Math.PI) / 180,
    minSlopeSlideAngle: (40 * Math.PI) / 180,
    autostepMaxHeight: metres(0.3),
    autostepMinWidth: metres(0.2),
    snapToGroundDistance: metres(0.25),
    terminalVelocity: -45,
};

export const PALETTE = {
    haze: "#4a3f63",
    stoneDark: "#5a4f52",
    stone: "#8a7a6d",
    stoneLight: "#c2ad91",
    moss: "#6f7d55",
    ember: "#ff7a3c",
    playerBody: "#c1503c",
    gold: "#d4af37",
};

export enum CharacterMotion {
    Idle = "idle",
    Walk = "walk",
    Run = "run",
    JumpStart = "jumpStart",
    JumpLoop = "jumpLoop",
    JumpLand = "jumpLand",
}

export const CHARACTER = {
    modelPath: "/models/characters/UAL1_Standard.glb",
    clipLibraryPaths: ["/models/characters/UAL2_Standard.glb"],
    modelYawOffset: 0,
    playbackRateRange: pair(0.5, 2.5),
};

export const CREATURE = {
    impModelPath: "/models/characters/Imp.gltf",
    puglinModelPath: "/models/characters/Puglin.gltf",
};

const JUMP_RISE_SECONDS = PLAYER.jumpForce / Math.abs(WORLD.gravity);

export const MOTION_CLIPS: Record<CharacterMotion, IMotionClip> = {
    [CharacterMotion.Idle]: {
        clipName: "Idle_Loop",
        loops: true,
        fadeSeconds: 0.18,
        playback: { mode: "fixed" },
    },
    [CharacterMotion.Walk]: {
        clipName: "Walk_Loop",
        loops: true,
        fadeSeconds: 0.14,
        playback: { mode: "matchStride", strideSpeed: PLAYER_HEIGHT * 0.85 },
    },
    [CharacterMotion.Run]: {
        clipName: "Sprint_Loop",
        loops: true,
        fadeSeconds: 0.14,
        playback: { mode: "matchStride", strideSpeed: PLAYER_HEIGHT * 4 },
    },
    [CharacterMotion.JumpStart]: {
        clipName: "Jump_Start",
        loops: false,
        fadeSeconds: 0.03,
        playback: { mode: "fitDuration", seconds: JUMP_RISE_SECONDS },
    },
    [CharacterMotion.JumpLoop]: {
        clipName: "Jump_Loop",
        loops: true,
        fadeSeconds: 0.1,
        playback: { mode: "fixed" },
    },
    [CharacterMotion.JumpLand]: {
        clipName: "Jump_Land",
        loops: false,
        fadeSeconds: 0.06,
        playback: { mode: "fixed" },
    },
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

export type MotionPlayback =
    | { mode: "fixed" }
    | { mode: "matchStride"; strideSpeed: number }
    | { mode: "fitDuration"; seconds: number };

export interface IMotionClip {
    clipName: string;
    loops: boolean;
    fadeSeconds: number;
    playback: MotionPlayback;
}
