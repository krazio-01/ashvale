import { degrees, metres } from "@/lib/helpers";
import type { ImpactTier, ISlowMotionProfile } from "@/types/combat";

export const COMBAT_TIMING = {
    inputBufferSeconds: 0.3,
    inputQueueCapacity: 3,
    perfectDodgeSeconds: 0.12,
    maxChargeSeconds: 1.2,
    chargeDamageBonus: 0.8,
    streakWindowSeconds: 1.6,
    hitFlashSeconds: 0.12,
    parriedStaggerSeconds: 1.1,
    respawnDelaySeconds: 2.5,
    corpseLingerSeconds: 1.5,
    corpseSinkSeconds: 1.4,
    corpseSinkDepthFraction: 0.6,
    locomotionReturnFade: 0.18,
    reactionFade: 0.05,
    deathFade: 0.1,
};

export const MOVEMENT = {
    warpMaxSpeed: metres(8),
    ledgeSnapDistance: metres(0.4),
};

export const HITSTOP = {
    timeScale: 0.05,
    frameSeconds: 1 / 60,
    frames: {
        light: { attacker: 0, defender: 3 },
        heavy: { attacker: 5, defender: 6 },
        finisher: { attacker: 7, defender: 8 },
    } satisfies Record<ImpactTier, { attacker: number; defender: number }>,
};

export const SLOW_MOTION = {
    perfectDodge: { scale: 0.4, seconds: 0.3, rampInSeconds: 0.03, rampOutSeconds: 0.12 },
} satisfies Record<string, ISlowMotionProfile>;

export const FOCUS = {
    perPerfectDodge: 1,
    perParry: 1,
    damagePerPip: 0.35,
    poisePerPip: 0.6,
};

export const STAMINA = {
    sprintPerSecond: 14,
};

export const TARGETING = {
    softRange: metres(7),
    softMinDot: Math.cos(degrees(75)),
    lockRange: metres(20),
    lockBreakRange: metres(24),
    lockMinDot: Math.cos(degrees(40)),
    angleWeight: 1,
    distanceWeight: 0.6,
    threatBonus: 0.25,
};

export const FINISHER_RULES = {
    backstabReach: metres(1.2),
    backstabConeCos: Math.cos(degrees(35)),
    executionReach: metres(1.2),
    streakReach: metres(3.5),
    basicExecutionHealthFraction: 0.5,
    toughExecutionHealthFraction: 0.25,
    contactGap: metres(0.05),
    syncSeconds: 0.2,
    syncMaxShift: metres(0.35),
    approachSpeed: metres(9),
    approachMaxSeconds: 0.45,
    recoverAt: 0.82,
};

export const KNOCKBACK_DECAY = 10;

export const CAMERA_SHAKE = {
    maxOffset: metres(0.18),
    maxRoll: 0.04,
    decay: 1.8,
    frequency: 24,
    trauma: { light: 0.2, heavy: 0.38, finisher: 0.6 } satisfies Record<ImpactTier, number>,
};

export const LOCK_CAMERA = {
    yawSmoothing: 8,
    pitch: 0.28,
    pitchSmoothing: 5,
};

export const KILL_CAMERA = {
    blendInSeconds: 0.35,
    blendOutSeconds: 0.6,
    baseDistance: metres(2.4),
    focusLift: metres(0.15),
    occlusionPullInSmoothing: 18,
    fallbackPitch: 0.2,
    fallbackDistance: metres(2.2),
    candidates: [
        { yawOffset: Math.PI * 0.75, pitch: 0.2, distanceScale: 0.9, penalty: 0 },
        { yawOffset: -Math.PI * 0.75, pitch: 0.2, distanceScale: 0.9, penalty: 0 },
        { yawOffset: Math.PI / 2, pitch: 0.12, distanceScale: 1.15, penalty: 0.35 },
        { yawOffset: -Math.PI / 2, pitch: 0.12, distanceScale: 1.15, penalty: 0.35 },
    ],
};

export const INPUT_BINDINGS = {
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    jump: ["Space"],
    evade: ["ShiftLeft"],
    crouch: ["KeyC", "ControlLeft"],
    parry: ["KeyQ"],
    shoot: ["KeyF"],
    finisher: ["KeyE"],
};

export const MOUSE_BINDINGS = {
    light: 0,
    lock: 1,
    heavy: 2,
};

export const PLAYER_VITALS = {
    maxHealth: 100,
    maxPoise: 60,
    maxStamina: 100,
    maxFocus: 3,
    poiseRegenDelay: 2,
    poiseRegenRate: 25,
    staminaRegenDelay: 0.6,
    staminaRegenRate: 38,
    staggerSeconds: 1.2,
};
