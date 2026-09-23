import { metres } from "@/lib/helpers";
import type { ImpactTier } from "@/types/combat";

const degrees = (value: number): number => (value * Math.PI) / 180;

export const COMBAT_TIMING = {
    inputBufferSeconds: 0.3,
    perfectDodgeSeconds: 0.12,
    evadeTapSeconds: 0.2,
    maxChargeSeconds: 1.2,
    chargeDamageBonus: 0.8,
    streakWindowSeconds: 0.9,
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

export const HITSTOP_SECONDS: Record<ImpactTier, number> = {
    light: 0.06,
    heavy: 0.11,
    finisher: 0.14,
};

export const ATTACKER_HITSTOP_SECONDS: Record<ImpactTier, number> = {
    light: 0.015,
    heavy: 0.11,
    finisher: 0.14,
};

export const SLOW_MOTION = {
    perfectDodge: { scale: 0.3, seconds: 0.55 },
    finisherKill: { scale: 0.45, seconds: 0.35 },
    lastKill: { scale: 0.25, seconds: 0.8 },
};

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
    backstabRange: metres(2.2),
    backstabConeCos: Math.cos(degrees(35)),
    executionRange: metres(2.5),
    executionHealthFraction: 0.2,
    streakHealthFraction: 0.5,
    streakRange: metres(4),
    alignSeconds: 0.12,
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
    shotSmoothing: 6,
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
