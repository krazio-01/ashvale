import { degrees, metres } from "@/lib/helpers";
import type { ImpactTier, ISlowMotionProfile, ProjectileKind } from "@/types/combat";
import type { WeaponDefinition } from "@/types/weapons";

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

export const TARGETING = {
    softRange: metres(7),
    softMinDot: Math.cos(degrees(75)),
    lockRange: metres(20),
    lockBreakRange: metres(24),
    lockMinDot: Math.cos(degrees(40)),
    angleWeight: 1,
    distanceWeight: 0.6,
    threatBonus: 0.25,
    gapCloseMinDistance: metres(5.5),
    gapCloseMaxDistance: metres(9),
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

export const TELEGRAPH = { leadSeconds: 0.38 };

export interface IProjectileSpec {
    speed: number;
    radius: number;
    damageScale: number;
    poiseDamage: number;
    impact: ImpactTier;
    knockback: number;
    parryable: boolean;
    perilous: boolean;
    color: string;
}

export const PROJECTILES: Record<ProjectileKind, IProjectileSpec> = {
    bolt: {
        speed: metres(14),
        radius: metres(0.18),
        damageScale: 1,
        poiseDamage: 12,
        impact: "light",
        knockback: 3,
        parryable: true,
        perilous: false,
        color: "#b9a8ff",
    },
    blast: {
        speed: metres(10),
        radius: metres(0.4),
        damageScale: 2,
        poiseDamage: 40,
        impact: "heavy",
        knockback: 8,
        parryable: false,
        perilous: true,
        color: "#ff5a3c",
    },
};

export const PROJECTILE_POOL = { size: 12, lifetimeSeconds: 3 };

export const WEAPONS = {
    longsword: {
        kind: "melee",
        id: "longsword",
        modelPath: "/models/weapons/Longsword.gltf",
        gripHand: "right",
        handleCentreFraction: 0.14,
        gripRoll: 0,
        worldLength: metres(1.05),
        guardFraction: 0.28,
        bladeRadius: metres(0.09),
        damage: 14,
        trailColor: "#ffe2b0",
    },
    dagger: {
        kind: "melee",
        id: "dagger",
        modelPath: "/models/weapons/Dagger.gltf",
        gripHand: "right",
        handleCentreFraction: 0.17,
        gripRoll: 0,
        worldLength: metres(0.45),
        guardFraction: 0.35,
        bladeRadius: metres(0.06),
        damage: 6,
        trailColor: "#ffd0c0",
    },
    greatsword: {
        kind: "melee",
        id: "greatsword",
        modelPath: "/models/weapons/Greatsword.gltf",
        gripHand: "right",
        handleCentreFraction: 0.12,
        gripRoll: 0,
        worldLength: metres(1.6),
        guardFraction: 0.25,
        bladeRadius: metres(0.12),
        damage: 22,
        trailColor: "#ffc080",
    },
    axe: {
        kind: "melee",
        id: "axe",
        modelPath: "/models/weapons/Axe.gltf",
        gripHand: "right",
        handleCentreFraction: 0.2,
        gripRoll: 0,
        worldLength: metres(0.95),
        guardFraction: 0.7,
        bladeRadius: metres(0.14),
        damage: 20,
        trailColor: "#ffb070",
    },
} satisfies Record<string, WeaponDefinition>;

export const GRIP = {
    knuckleReach: 0.9,
    palmDepth: 1.1,
};

export const TELEGRAPH_FLARES = {
    poolSize: 8,
    seconds: 0.45,
    parryableColor: "#f2f0ff",
    perilousColor: "#ff3b24",
    parryableSize: metres(0.6),
    perilousSize: metres(1.1),
};

export const HIT_SPARKS = {
    capacity: 256,
    lifetimeSeconds: 0.42,
    burstSize: { light: 10, heavy: 18, finisher: 28 } satisfies Record<ImpactTier, number>,
    sparkColor: "#ffd9a0",
    emberColor: "#ff6a3a",
};
