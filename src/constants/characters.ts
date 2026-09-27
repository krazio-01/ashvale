import { pair } from "@/lib/helpers";

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
    reactFlinch: "React_Flinch",
    reactHitHead: "React_Hit_Head",
    reactCombatDamage: "React_Combat_Damage",
    reactKnockback: "React_Knockback",
    reactKnockdown: "React_Knockdown",
    reactStagger: "React_Stagger",
    reactParried: "React_Parried",
    deathForward: "Death_Forward",
    deathBackward: "Death_Backward",
    deathCollapse: "Death_Collapse",
    deathKnockback: "Death_Knockback",
    finisherExecution: "Fin_Execution_A",
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
