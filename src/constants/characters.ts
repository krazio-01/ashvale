import { metres } from "@/lib/helpers";
import type { ProceduralDetail } from "@/types/procedural";
import type { Handedness } from "@/types/weapons";

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
    modelPath: "/models/characters/Player.gltf",
    clipLibraryPaths: [
        "/models/characters/UAL1_Standard.glb",
        "/models/characters/CombatClips.glb",
    ],
    modelYawOffset: 0,
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

const SIDE_SUFFIXES = { left: "l", right: "r" } as const;
const SIDE_LIST = Object.values(SIDE_SUFFIXES);
const FINGERS = ["index", "middle", "ring", "pinky", "thumb"] as const;
const TORSO_CHAIN_UP = ["spine_03", "spine_02", "spine_01", "pelvis"] as const;

const suffixed = (baseNames: readonly string[], side: string): string[] =>
    baseNames.map((baseName) => `${baseName}_${side}`);
const namesPerSide = (baseNames: readonly string[]): string[] =>
    baseNames.flatMap((baseName) => SIDE_LIST.map((side) => `${baseName}_${side}`));
const forEachSide = <Item>(build: (side: string) => readonly Item[]): Item[] =>
    SIDE_LIST.flatMap(build);
const chainLinks = (names: readonly string[]): [string, string][] =>
    names.slice(1).map((name, index) => [names[index], name]);
const limbSegments = (
    baseNames: readonly string[],
    radii: readonly number[],
    side: string
): [string, number][] => suffixed(baseNames, side).map((name, index) => [name, radii[index]]);

function handBones(side: string) {
    return {
        hand: `hand_${side}`,
        indexBase: `index_01_${side}`,
        middleBase: `middle_01_${side}`,
        ringBase: `ring_01_${side}`,
        pinkyBase: `pinky_01_${side}`,
        thumbBase: `thumb_01_${side}`,
    };
}

export const HAND_BONES = { right: handBones("r"), left: handBones("l") };

export type SkeletonSide = "left" | "right";
export type ColliderGroup = "torso" | "upperArm" | "lowerArm" | "thigh" | "calf";
export type MirrorRegion = "torso" | "neck" | "head";

export interface ISkeletonDescriptor {
    sides: Record<SkeletonSide, string>;
    sideSigns: Record<SkeletonSide, number>;
    bones: {
        pelvis: string;
        chest: string;
        neck: string;
        head: string;
        headTop: string;
        root: string;
        spine: readonly string[];
        clavicles: Record<SkeletonSide, string>;
        arms: Record<SkeletonSide, readonly string[]>;
        legs: Record<SkeletonSide, readonly string[]>;
        feet: Record<SkeletonSide, readonly string[]>;
        handTips: Record<SkeletonSide, string>;
    };
    chains: Record<string, string>;
    limbs: Record<
        string,
        {
            segments: readonly (readonly [string, number])[];
            bones: readonly string[];
            distal: readonly string[];
            zone?: string;
        }
    >;
    regions: Record<string, readonly string[]>;
    rig: {
        coreBones: readonly string[];
        dampedBones: readonly string[];
        torsoAnchors: readonly string[];
    };
    spineCurve: readonly (readonly [string, MirrorRegion])[];
    placedJoints: readonly string[];
    segmentTails: Record<string, string>;
    hiddenBoneParts: readonly string[];
    propAnchors: readonly string[];
    colliderSegments: readonly (readonly [string, string, string, ColliderGroup])[];
    fingerBones: readonly string[];
    leafMarker: string;
    previewClips: Record<"standard" | "extreme", readonly (readonly [string, number])[]>;
    measuredJoints: readonly string[];
}

export const SKELETONS = {
    ual: {
        sides: SIDE_SUFFIXES,
        sideSigns: { left: 1, right: -1 },
        bones: {
            pelvis: "pelvis",
            chest: "spine_03",
            neck: "neck_01",
            head: "Head",
            headTop: "head_top",
            root: "root",
            spine: ["spine_01", "spine_02", "spine_03"],
            clavicles: { left: "clavicle_l", right: "clavicle_r" },
            arms: {
                left: ["upperarm_l", "lowerarm_l", "hand_l"],
                right: ["upperarm_r", "lowerarm_r", "hand_r"],
            },
            legs: {
                left: ["thigh_l", "calf_l", "foot_l"],
                right: ["thigh_r", "calf_r", "foot_r"],
            },
            feet: { left: ["foot_l", "ball_l"], right: ["foot_r", "ball_r"] },
            handTips: { left: "middle_01_l", right: "middle_01_r" },
        },
        chains: Object.fromEntries([
            ...forEachSide((side) => chainLinks(suffixed(["thigh", "calf", "foot", "ball"], side))),
            ...chainLinks(["spine_01", "spine_02", "spine_03", "neck_01", "Head"]),
            ...forEachSide((side) =>
                chainLinks(
                    suffixed(["clavicle", "upperarm", "lowerarm", "hand", "middle_01"], side)
                )
            ),
        ]),
        limbs: Object.fromEntries([
            ...forEachSide((side) => [
                [
                    `leg_${side}`,
                    {
                        segments: limbSegments(["thigh", "calf", "foot"], [0.15, 0.12, 0.1], side),
                        bones: ["pelvis", ...suffixed(["thigh", "calf", "foot", "ball"], side)],
                        distal: suffixed(["calf", "foot", "ball"], side),
                    },
                ],
            ]),
            ...forEachSide((side) => [
                [
                    `arm_${side}`,
                    {
                        segments: limbSegments(["upperarm", "lowerarm"], [0.1, 0.09], side),
                        bones: [
                            "spine_03",
                            ...suffixed(["clavicle", "upperarm", "lowerarm", "hand"], side),
                        ],
                        distal: suffixed(["lowerarm", "hand"], side),
                        zone: `hand_${side}`,
                    },
                ],
            ]),
        ]),
        regions: {
            head: ["Head", "neck_01"],
            ...Object.fromEntries(namesPerSide(["hand"]).map((hand) => [hand, [hand]])),
            torso: ["pelvis", "spine_01", "spine_02", "spine_03", ...namesPerSide(["clavicle"])],
            arms: namesPerSide(["upperarm", "lowerarm"]),
            legs: namesPerSide(["thigh", "calf"]),
            feet: namesPerSide(["foot", "ball"]),
        },
        rig: {
            coreBones: [
                "pelvis",
                "spine_01",
                "spine_02",
                "spine_03",
                "neck_01",
                "Head",
                ...namesPerSide([
                    "clavicle",
                    "upperarm",
                    "lowerarm",
                    "hand",
                    "thigh",
                    "calf",
                    "foot",
                    "ball",
                ]),
            ],
            dampedBones: namesPerSide(["calf", "foot", "ball", "upperarm", "lowerarm", "hand"]),
            torsoAnchors: TORSO_CHAIN_UP,
        },
        spineCurve: [
            ["pelvis", "torso"],
            ["spine_01", "torso"],
            ["spine_02", "torso"],
            ["spine_03", "torso"],
            ["neck_01", "neck"],
            ["Head", "head"],
        ],
        placedJoints: ["pelvis", "thigh_l", "thigh_r", "spine_01"],
        segmentTails: { pelvis: "spine_01", Head: "head_top" },
        fingerBones: FINGERS,
        leafMarker: "_leaf",
        previewClips: {
            standard: [
                ["Combat_Idle", 0.5],
                ["Walk_Loop", 0.3],
                ["Sprint_Loop", 0.4],
                ["Sword_Light_1", 0.45],
                ["Sword_Heavy", 0.5],
                ["React_Hit_Head", 0.3],
            ],
            extreme: [
                ["Dodge_Roll", 0.4],
                ["Death_Forward", 0.8],
                ["Crouch_Fwd_Loop", 0.5],
                ["Jump_Start", 0.6],
                ["Sword_Heavy_Finisher", 0.5],
                ["Slide_Hold", 0.5],
            ],
        },
        hiddenBoneParts: [...FINGERS, "leaf", "phys_"],
        propAnchors: TORSO_CHAIN_UP,
        colliderSegments: [
            ["spine_01", "pelvis", "spine_03", "torso"],
            ...forEachSide((side): [string, string, string, ColliderGroup][] => [
                [`upperarm_${side}`, `upperarm_${side}`, `lowerarm_${side}`, "upperArm"],
                [`lowerarm_${side}`, `lowerarm_${side}`, `hand_${side}`, "lowerArm"],
            ]),
            ...forEachSide((side): [string, string, string, ColliderGroup][] => [
                [`thigh_${side}`, `thigh_${side}`, `calf_${side}`, "thigh"],
                [`calf_${side}`, `calf_${side}`, `foot_${side}`, "calf"],
            ]),
        ],
        measuredJoints: [
            "pelvis",
            "spine_01",
            "spine_02",
            "spine_03",
            "neck_01",
            "Head",
            "head_top",
            ...forEachSide((side) => suffixed(["upperarm", "lowerarm", "hand", "middle_01"], side)),
            ...forEachSide((side) => suffixed(["thigh", "calf", "foot", "ball"], side)),
        ],
    },
} as const satisfies Record<string, ISkeletonDescriptor>;

export type SkeletonName = keyof typeof SKELETONS;
export const SKELETON_BONES = SKELETONS.ual.bones;

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
    swordDraw: "Sword_Draw",
    swordSheathe: "Sword_Sheathe",
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

export const PROCEDURAL_DETAIL_RANK: Record<ProceduralDetail, number> = {
    none: 0,
    impact: 1,
    full: 2,
};

export const OTHER_HAND: Record<Handedness, Handedness> = { left: "right", right: "left" };

export const PROCEDURAL_EPSILON = {
    turnRadians: 1e-5,
    reach: 1e-4,
    lookDistance: 1e-4,
    bend: 1e-6,
    degenerateLengthSquared: 1e-8,
    springRestSquared: 1e-8,
};
