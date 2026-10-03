import { metres, pair } from "@/lib/helpers";

export const STRIDE = {
    walk: 1.25,
    strafe: 1.45,
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

export const CHARACTER = {
    modelPath: "/models/characters/UAL1_Standard.glb",
    clipLibraryPaths: ["/models/characters/CombatClips.glb"],
    modelYawOffset: 0,
    playbackRateRange: pair(0.5, 2.5),
};

export const IDLE_VARIATION = {
    relaxedDelaySeconds: 7,
    delayJitter: 0.4,
};

export function jitteredIdleDelay(baseSeconds: number, random: () => number): number {
    return (
        baseSeconds * (1 - IDLE_VARIATION.delayJitter + random() * 2 * IDLE_VARIATION.delayJitter)
    );
}

export const CREATURE = {
    impModelPath: "/models/characters/Imp.gltf",
    puglinModelPath: "/models/characters/Puglin.gltf",
};

export const HAND_BONES = {
    right: {
        hand: "hand_r",
        indexBase: "index_01_r",
        middleBase: "middle_01_r",
        ringBase: "ring_01_r",
        pinkyBase: "pinky_01_r",
        thumbBase: "thumb_01_r",
    },
    left: {
        hand: "hand_l",
        indexBase: "index_01_l",
        middleBase: "middle_01_l",
        ringBase: "ring_01_l",
        pinkyBase: "pinky_01_l",
        thumbBase: "thumb_01_l",
    },
};

export const SKELETON_BONES = {
    pelvis: "pelvis",
    chest: "spine_03",
    neck: "neck_01",
    head: "Head",
    clavicles: { left: "clavicle_l", right: "clavicle_r" },
    arms: {
        left: ["upperarm_l", "lowerarm_l", "hand_l"],
        right: ["upperarm_r", "lowerarm_r", "hand_r"],
    },
    legs: {
        left: ["thigh_l", "calf_l", "foot_l"],
        right: ["thigh_r", "calf_r", "foot_r"],
    },
} as const;

export const CLIP = {
    idle: "Idle_Loop",
    walk: "Walk_Loop",
    sprint: "Sprint_Loop",
    jumpStart: "Jump_Start",
    jumpLoop: "Jump_Loop",
    jumpLand: "Jump_Land",
    jumpAbsorb: "Jump_Absorb",
    crouchIdle: "Crouch_Idle_Loop",
    crouchWalk: "Crouch_Fwd_Loop",
    combatIdle: "Combat_Idle",
    strafeForward: "Strafe_F",
    strafeForwardRight: "Strafe_FR",
    strafeRight: "Strafe_R",
    strafeBackRight: "Strafe_BR",
    strafeBack: "Strafe_B",
    strafeBackLeft: "Strafe_BL",
    strafeLeft: "Strafe_L",
    strafeForwardLeft: "Strafe_FL",
    swordLight1: "Sword_Light_1",
    swordLight2: "Sword_Light_2",
    swordLight3: "Sword_Light_3",
    swordLight4: "Sword_Light_4",
    swordHeavy: "Sword_Heavy",
    swordHeavyFinisher: "Sword_Heavy_Finisher",
    swordCounter: "Sword_Counter",
    dodgeRoll: "Dodge_Roll",
    dodgeBackstep: "Dodge_Backstep",
    dodgeLeft: "Dodge_Left",
    dodgeRight: "Dodge_Right",
    slideStart: "Slide_Start",
    slideHold: "Slide_Hold",
    slideExit: "Slide_Exit",
    parry: "Parry",
    parryGuard: "Parry_Guard",
    parryReguard: "Parry_Reguard",
    parryDeflectHigh: "Parry_Deflect_High",
    parryDeflectSide: "Parry_Deflect_Side",
    parryPerfectHigh: "Parry_Perfect_High",
    parryPerfectSide: "Parry_Perfect_Side",
    reactFlinch: "React_Flinch",
    reactHitHead: "React_Hit_Head",
    reactCombatDamage: "React_Combat_Damage",
    reactKnockback: "React_Knockback",
    reactKnockdown: "React_Knockdown",
    reactStagger: "React_Stagger",
    reactParried: "React_Parried",
    reactParriedHigh: "React_Parried_High",
    reactParriedSide: "React_Parried_Side",
    reactGuardBrokenHigh: "React_GuardBroken_High",
    reactGuardBrokenSide: "React_GuardBroken_Side",
    deathForward: "Death_Forward",
    deathCollapse: "Death_Collapse",
    deathKnockback: "Death_Knockback",
    finisherExecution: "Fin_Execution_A",
    finisherExecutionSlam: "Fin_Execution_B",
    finisherKickdownAttacker: "Fin_Kickdown_A",
    finisherKickdownVictim: "Fin_Kickdown_B",
    finisherKnockdownAttacker: "Fin_Knockdown_A",
    finisherKnockdownVictim: "Fin_Knockdown_B",
    finisherBackstab: "Fin_Backstab_A",
    enemyPunch: "Enemy_Punch",
    enemySwipe: "Enemy_Swipe",
    enemySlashA: "Enemy_Slash_A",
    enemySlashARecover: "Enemy_Slash_A_Recover",
    enemySlashB: "Enemy_Slash_B",
    enemySlashBRecover: "Enemy_Slash_B_Recover",
    enemySlashC: "Enemy_Slash_C",
    enemyCleave: "Enemy_Cleave",
    enemyRisingCut: "Enemy_Rising_Cut",
    enemyBackhand: "Enemy_Backhand",
    swordDash: "Enemy_Lunge",
    enemyThrust: "Enemy_Thrust",
    enemyGreatCleave: "Enemy_Great_Cleave",
    enemyLowSweep: "Enemy_Low_Sweep",
    enemyJab: "Enemy_Jab",
    enemyHook: "Enemy_Hook",
    enemyHookRecover: "Enemy_Hook_Recover",
    enemyScratch: "Enemy_Scratch",
    enemyHurl: "Enemy_Hurl",
    idleFidgetSwordInspect: "Idle_Fidget_SwordInspect",
    idleFidgetSwordRoll: "Idle_Fidget_SwordRoll",
    idleFidgetScratchArm: "Idle_Fidget_ScratchArm",
    idleFidgetLookAround: "Idle_Fidget_LookAround",
} as const;

export type ClipName = (typeof CLIP)[keyof typeof CLIP];

export type ImpactProfileName =
    "parry" | "parryPerfect" | "recoil" | "guardBroken" | "hitLight" | "hitHeavy";

interface IImpactLink {
    bone: string;
    gain: number;
}

interface IImpactProfile {
    strength: number;
    stiffness: number;
    damping: number;
    chain: readonly IImpactLink[];
}

const SWORD_ARM_INWARD: readonly IImpactLink[] = [
    { bone: "hand_r", gain: 0.3 },
    { bone: "lowerarm_r", gain: 0.3 },
    { bone: "upperarm_r", gain: 0.25 },
    { bone: "clavicle_r", gain: 0.2 },
    { bone: "spine_03", gain: 0.4 },
    { bone: "spine_02", gain: 0.35 },
    { bone: "spine_01", gain: 0.25 },
    { bone: "pelvis", gain: 0.15 },
    { bone: "Head", gain: -0.15 },
];

const WEAPON_ARM_THROWN: readonly IImpactLink[] = [
    { bone: "hand_r", gain: 0.6 },
    { bone: "lowerarm_r", gain: 0.5 },
    { bone: "upperarm_r", gain: 0.55 },
    { bone: "clavicle_r", gain: 0.3 },
    { bone: "spine_03", gain: 0.45 },
    { bone: "spine_02", gain: 0.3 },
    { bone: "spine_01", gain: 0.2 },
    { bone: "pelvis", gain: 0.1 },
    { bone: "Head", gain: 0.25 },
];

const TORSO_STRUCK: readonly IImpactLink[] = [
    { bone: "spine_03", gain: 0.4 },
    { bone: "clavicle_l", gain: 0.15 },
    { bone: "clavicle_r", gain: 0.15 },
    { bone: "spine_02", gain: 0.3 },
    { bone: "spine_01", gain: 0.2 },
    { bone: "pelvis", gain: 0.1 },
    { bone: "Head", gain: 0.3 },
];

export const PROCEDURAL = {
    lod: { fullMetres: metres(15), impactMetres: metres(40) },
    ik: { reachLimit: 0.999 },
    springs: { maxRadians: 0.6, maxStepSeconds: 1 / 30, maxSubsteps: 4, linkDelaySeconds: 1 / 60 },
    impacts: {
        parry: {
            strength: 6,
            stiffness: 260,
            damping: 16,
            chain: SWORD_ARM_INWARD,
        },
        parryPerfect: {
            strength: 5,
            stiffness: 420,
            damping: 24,
            chain: SWORD_ARM_INWARD,
        },
        recoil: {
            strength: 13,
            stiffness: 180,
            damping: 14,
            chain: WEAPON_ARM_THROWN,
        },
        guardBroken: {
            strength: 16,
            stiffness: 140,
            damping: 11,
            chain: WEAPON_ARM_THROWN,
        },
        hitLight: {
            strength: 5,
            stiffness: 300,
            damping: 20,
            chain: TORSO_STRUCK,
        },
        hitHeavy: {
            strength: 9,
            stiffness: 220,
            damping: 16,
            chain: TORSO_STRUCK,
        },
    } satisfies Record<ImpactProfileName, IImpactProfile>,
    ambient: {
        leanGain: 0.02,
        leanMaxRadians: 0.1,
        leanResponse: 6,
        leanShares: [
            ["spine_01", 0.4],
            ["spine_02", 0.35],
            ["spine_03", 0.25],
        ] as const,
        breathHz: 0.3,
        breathRadians: 0.012,
        clavicleBreathShare: 0.5,
        lookMaxYaw: 0.87,
        lookMaxPitch: 0.35,
        lookResponse: 8,
        neckShare: 0.4,
        headShare: 0.6,
    },
    feet: {
        liftHeight: metres(0.06),
        maxDrift: metres(0.12),
        blendSeconds: 0.08,
        correctionSeconds: 0.08,
        probeAbove: metres(0.6),
        floorRise: metres(0.25),
        maxPelvisDrop: metres(0.25),
        maxRaise: metres(0.35),
    },
    bladeContact: {
        seconds: 0.12,
        maxCorrection: metres(0.06),
        attackerMaxCorrection: metres(0.2),
    },
    grip: { rampSeconds: 0.08 },
};
