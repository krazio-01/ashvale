import { CLIP, SKELETON_BONES } from "@/constants/characters";
import { degreesToRadians, metresToUnits } from "@/lib/helpers";
import type {
    ImpactTier,
    IParryResult,
    ISlowMotionProfile,
    ParryTier,
    ProjectileKind,
    WeaponDefinition,
    IClipMarks,
    IProjectileSpec,
} from "@/types/combat";
import type { EffectSpec } from "@/types/world";

export const COMBAT_TIMING = {
    inputBufferSeconds: 0.3,
    inputQueueCapacity: 3,
    perfectDodgeSeconds: 0.12,
    maxChargeSeconds: 1.2,
    chargeDamageBonus: 0.8,
    chainKillWindowSeconds: 1.6,
    respawnDelaySeconds: 2.5,
    locomotionReturnFade: 0.18,
    reactionFade: 0.05,
    deathFade: 0.1,
};

export const COMBAT_MOVEMENT = {
    gapCloseMaxSpeed: metresToUnits(8),
    ledgeSnapDistance: metresToUnits(0.4),
    minimumPlanarLength: 1e-4,
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
    finisherImpact: { scale: 0.25, seconds: 0.4, rampInSeconds: 0.02, rampOutSeconds: 0.35 },
    perfectParry: { scale: 0.3, seconds: 0.25, rampInSeconds: 0.02, rampOutSeconds: 0.15 },
} satisfies Record<string, ISlowMotionProfile>;

export const FOCUS = {
    perPerfectDodge: 1,
    perParry: 1,
    damagePerFocusPoint: 0.35,
    poisePerFocusPoint: 0.6,
};

export const TARGETING = {
    autoAimRange: metresToUnits(7),
    autoAimMinFacingDot: Math.cos(degreesToRadians(75)),
    lockRange: metresToUnits(20),
    lockBreakRange: metresToUnits(24),
    lockMinDot: Math.cos(degreesToRadians(40)),
    angleWeight: 1,
    distanceWeight: 0.6,
    threatBonus: 0.25,
    gapCloseMinDistance: metresToUnits(5.5),
    gapCloseMaxDistance: metresToUnits(9),
};

export const FINISHER_RULES = {
    backstabReach: metresToUnits(1.2),
    backstabConeCos: Math.cos(degreesToRadians(35)),
    executionReach: metresToUnits(1.2),
    chainKillReach: metresToUnits(3.5),
    basicExecutionHealthFraction: 0.5,
    toughExecutionHealthFraction: 0.25,
    contactGap: metresToUnits(0.05),
    syncSeconds: 0.2,
    syncMaxShift: metresToUnits(0.35),
    approachSpeed: metresToUnits(9),
    approachMaxSeconds: 0.45,
    recoverAtFraction: 0.82,
};

export const KNOCKBACK_DECAY = 10;

export const ATTACK_WARNING = { minimumWindupSeconds: 0.38, flashLeadSeconds: 0.3 };

const DEFLECT_MARKS: IClipMarks = {
    marks: { idle: 0.706, lowering: 0.529, out: 0.176 },
    grip: { from: 0, to: 0.647 },
};

const PERFECT_MARKS: IClipMarks = {
    marks: { counter: 0.733 },
    grip: { from: 0, to: 0.2 },
};

export const CLIP_MARKS: Readonly<Record<string, IClipMarks>> = {
    [CLIP.parryGuard]: {
        marks: { idle: 0.65, lowering: 0.5 },
        grip: { from: 0.05, to: 0.6 },
    },
    [CLIP.parryReguard]: {
        marks: { idle: 0.684, lowering: 0.474 },
        grip: { from: 0, to: 0.579 },
    },
    [CLIP.parryDeflectHigh]: DEFLECT_MARKS,
    [CLIP.parryDeflectSide]: DEFLECT_MARKS,
    [CLIP.parryPerfectHigh]: PERFECT_MARKS,
    [CLIP.parryPerfectSide]: PERFECT_MARKS,
    [CLIP.swordDraw]: { marks: { mount: 0.286 }, grip: null },
    [CLIP.swordSheathe]: { marks: { mount: 0.714 }, grip: null },
};

export const PARRY = {
    windowSeconds: 0.3,
    perfectSeconds: 0.12,
    guardFadeSeconds: 0.03,
    reguardFadeSeconds: 0.08,
    guardRadius: metresToUnits(0.1),
    enemyParryResult: { tier: "parry", staggerSeconds: 1.1, knockback: 0 } satisfies IParryResult,
    tiers: {
        parry: {
            tier: "parry",
            staggerSeconds: 0.6,
            knockback: 2,
            hitstopFrames: 4,
            shakeAmount: 0.25,
            slowMotion: null,
        },
        perfect: {
            tier: "perfect",
            staggerSeconds: 1.4,
            knockback: 3,
            hitstopFrames: 6,
            shakeAmount: 0.4,
            slowMotion: SLOW_MOTION.perfectParry,
        },
    } satisfies Record<ParryTier, IParryTierEffects>,
};

export const BODY_CONTACT = {
    headOnDot: -0.7,
    stalledFraction: 0.3,
    lowProbeMargin: metresToUnits(0.15),
    lowProbeHeightFraction: 0.38,
};

export const PROJECTILES: Record<ProjectileKind, IProjectileSpec> = {
    bolt: {
        speed: metresToUnits(14),
        radius: metresToUnits(0.18),
        damageScale: 1,
        poiseDamage: 12,
        impact: "light",
        knockback: 3,
        parryable: true,
        dodgeOnly: false,
        color: "#b9a8ff",
    },
    blast: {
        speed: metresToUnits(10),
        radius: metresToUnits(0.4),
        damageScale: 2,
        poiseDamage: 40,
        impact: "heavy",
        knockback: 8,
        parryable: false,
        dodgeOnly: true,
        color: "#ff5a3c",
    },
};

export const PROJECTILE_POOL = { size: 12, lifetimeSeconds: 3 };

export const WEAPONS = {
    sword: {
        kind: "melee",
        id: "sword",
        modelPath: "/models/weapons/Sword.gltf",
        gripHand: "right",
        handleCentreFraction: 0.145,
        gripRoll: 0,
        worldLength: metresToUnits(1.05),
        guardFraction: 0.18,
        bladeRadius: metresToUnits(0.09),
        damage: 14,
        trailColor: "#ffe2b0",
        carry: {
            bone: SKELETON_BONES.chest,
            position: [metresToUnits(-0.276), metresToUnits(0.456), metresToUnits(-0.176)],
            rotationDegrees: [92.6, -64, -93.3],
        },
    },
    longsword: {
        kind: "melee",
        id: "longsword",
        modelPath: "/models/weapons/Longsword.gltf",
        gripHand: "right",
        handleCentreFraction: 0.14,
        gripRoll: 0,
        worldLength: metresToUnits(1.05),
        guardFraction: 0.28,
        bladeRadius: metresToUnits(0.09),
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
        worldLength: metresToUnits(0.45),
        guardFraction: 0.35,
        bladeRadius: metresToUnits(0.06),
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
        worldLength: metresToUnits(1.6),
        guardFraction: 0.25,
        bladeRadius: metresToUnits(0.12),
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
        worldLength: metresToUnits(0.95),
        guardFraction: 0.7,
        bladeRadius: metresToUnits(0.14),
        damage: 20,
        trailColor: "#ffb070",
    },
} satisfies Record<string, WeaponDefinition>;

export const BLADE_THICKNESS_SLICES = 16;

export const HAND_GRIP = {
    knuckleReach: 0.9,
    palmDepth: 1.1,
};

export const EFFECTS = {
    hitFlash: { kind: "materialFlash", color: 0xffffff, seconds: 0.12 },
    hitSparks: {
        kind: "particleBurst",
        trigger: "hitLanded",
        capacity: 256,
        lifetimeSeconds: 0.42,
        burstSize: { light: 10, heavy: 18, finisher: 28 },
        speedMetres: { light: 5, heavy: 7, finisher: 7 },
        spreadFraction: 0.5,
        liftFraction: 0.8,
        gravityMetres: 9,
        sizeMetres: 0.12,
        colorCycle: ["#ff6a3a", "#ffd9a0", "#ffd9a0"],
        renderOrder: 11,
    },
    attackWarningFlares: {
        kind: "attackWarningFlare",
        trigger: "attackWarning",
        ignoreTeam: "player",
        poolSize: 8,
        seconds: 0.45,
        colors: { parryable: "#f2f0ff", dodgeOnly: "#ff3b24" },
        sizes: { parryable: metresToUnits(0.6), dodgeOnly: metresToUnits(1.1) },
        textureSize: 32,
        renderOrder: 12,
    },
    slashTrail: {
        kind: "ribbonTrail",
        maxSamples: 24,
        subdivisions: 6,
        sampleLifetime: 0.22,
        releaseFadeRate: 9,
        innerEdgeFraction: 0.45,
        renderOrder: 10,
    },
} satisfies Record<string, EffectSpec>;

interface IParryTierEffects extends IParryResult {
    hitstopFrames: number;
    shakeAmount: number;
    slowMotion: ISlowMotionProfile | null;
}

export type EffectId = keyof typeof EFFECTS;
