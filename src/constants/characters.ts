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
    startPosition: vec3(0, 8, 18),
    targetFollowDistance: PLAYER_HEIGHT * 3,
    minimumFollowDistance: PLAYER_HEIGHT,
    collisionPadding: 0.4,
    pullOutSmoothing: 5,
    pivotHeight: PLAYER_HEIGHT * 0.82,
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
