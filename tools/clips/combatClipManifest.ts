import os from "node:os";
import path from "node:path";
import { CLIP } from "@/constants/characters";
import type { ClipName } from "@/constants/characters";
export const SOURCE_RIGS = [
    "ue",
    "manny",
    "motus",
    "mixamo",
    "kevin",
    "humanikCharacter",
    "ual",
    "atlas",
] as const;
export type SourceRig = (typeof SOURCE_RIGS)[number];
type RootMotionMode = "extract" | "inPlace";

export interface IClipJob {
    output: ClipName;
    source: string;
    rig: SourceRig;
    frames: [number, number];
    rootMotion: RootMotionMode;
    action?: string;
    calibrationFrame?: number;
    calibrationReason?: string;
    alignToTravel?: boolean;
    speed?: number;
}

const COMBAT_ROOT =
    process.env.COMBAT_ASSETS_ROOT ?? path.join(os.homedir(), "Downloads/assets/Combat/extracted");

const clipSource = (relativePath: string): string => path.join(COMBAT_ROOT, relativePath);

export const MANIFEST = {
    blender: process.env.BLENDER_BIN ?? "/snap/bin/blender",
    target: "assets-src/models/characters/UAL1_Standard.glb",
    output: "assets-src/models/characters/CombatClips.glb",
};

export const CLIPS_PROVIDED_BY_CHARACTER_MODEL: readonly string[] = [
    CLIP.idle,
    CLIP.walk,
    CLIP.sprint,
    CLIP.jumpStart,
    CLIP.jumpLoop,
    CLIP.jumpLand,
    CLIP.crouchIdle,
    CLIP.crouchWalk,
];

const UAL_STANDARD = path.resolve("assets-src/models/characters/UAL1_Standard.glb");
const UAL_EXTENDED = path.resolve("assets-src/models/characters/UAL2_Standard.glb");
const FULL_RANGE: [number, number] = [0, 0];

const MOCAP_ONLINE_SWORD = clipSource("mco_sword/TC_Sword_Free_Pack/FBX_Pack/Animation");
const KEVIN_RUN = clipSource("kevin/Animations/Male/Movement/Run");
const KEVIN_STRAFE = clipSource("kevin/Animations/Male/Movement/Strafe/StrafeRun");
const MOCAP_CENTRAL = clipSource("mocap_central/MC_Sample_SourceFiles/Animations/UE5_Skel");
const ROKOKO_COMBAT = clipSource(
    "rokoko263/Rokoko Studio (Mocap)/RokokoTVContest_MocapAssets/COMBAT/UNREAL ENGINE"
);
const ROKOKO_LEGACY = clipSource("rokoko263/Rokoko Studio Legacy Mocap (older)");
const ROKOKO_STUDIO = clipSource("rokoko263/Rokoko Studio (Mocap)");
const MOCAPIN_FIGHT = clipSource("mocapin_fight/Fight Mocap Animation Data");
const ROKOKO_COMBAT_NEW = clipSource("rokoko_combat/Combat");
const MOCAP_CENTRAL_IDLE = path.join(MOCAP_CENTRAL, "Idle");
const KEVIN_COMBAT = clipSource("kevin/Animations/Male/Combat");

type JobOptions = Partial<
    Pick<IClipJob, "action" | "calibrationFrame" | "calibrationReason" | "alignToTravel" | "speed">
>;

function job(
    output: ClipName,
    source: string,
    rig: SourceRig,
    frames: [number, number],
    rootMotion: RootMotionMode,
    options: JobOptions = {}
): IClipJob {
    return { output, source, rig, frames, rootMotion, ...options };
}

function strafe(output: ClipName, file: string): IClipJob {
    return job(output, file, "kevin", FULL_RANGE, "inPlace");
}

function ualAction(output: ClipName, library: string, action: string): IClipJob {
    return job(output, library, "ual", FULL_RANGE, "inPlace", { action });
}

function kevinCombat(output: ClipName, file: string): IClipJob {
    return job(output, path.join(KEVIN_COMBAT, file), "kevin", FULL_RANGE, "inPlace");
}

export const CLIP_JOBS: IClipJob[] = [
    job(
        CLIP.combatIdle,
        path.join(MOCAP_ONLINE_SWORD, "KBS_Ready_Idle_001.fbx"),
        "motus",
        FULL_RANGE,
        "inPlace"
    ),
    strafe(CLIP.strafeForward, path.join(KEVIN_RUN, "HumanM@Run01_Forward.fbx")),
    strafe(CLIP.strafeForwardRight, path.join(KEVIN_STRAFE, "HumanM@StrafeRun01_ForwardRight.fbx")),
    strafe(CLIP.strafeRight, path.join(KEVIN_STRAFE, "HumanM@StrafeRun01_Right.fbx")),
    strafe(CLIP.strafeBackRight, path.join(KEVIN_STRAFE, "HumanM@StrafeRun01_BackwardRight.fbx")),
    strafe(CLIP.strafeBack, path.join(KEVIN_RUN, "HumanM@Run01_Backward.fbx")),
    strafe(CLIP.strafeBackLeft, path.join(KEVIN_STRAFE, "HumanM@StrafeRun01_BackwardLeft.fbx")),
    strafe(CLIP.strafeLeft, path.join(KEVIN_STRAFE, "HumanM@StrafeRun01_Left.fbx")),
    strafe(CLIP.strafeForwardLeft, path.join(KEVIN_STRAFE, "HumanM@StrafeRun01_ForwardLeft.fbx")),
    job(
        CLIP.swordLight1,
        path.join(MOCAP_ONLINE_SWORD, "KBS_Sword_ATK_Combo_01_001.fbx"),
        "motus",
        [9, 36],
        "extract",
        { calibrationFrame: 9 }
    ),
    job(
        CLIP.swordLight2,
        path.join(MOCAP_ONLINE_SWORD, "KBS_Sword_ATK_Combo_01_001.fbx"),
        "motus",
        [36, 60],
        "extract",
        {
            calibrationFrame: 1,
            calibrationReason:
                "shares Sword_Light_1's idle calibration so the combo chain lines up; in-range calibration slides this slice ~1m sideways (auditions-sword.md)",
        }
    ),
    job(
        CLIP.swordLight3,
        path.join(MOCAP_ONLINE_SWORD, "KBS_Sword_ATK_Combo_01_001.fbx"),
        "motus",
        [60, 87],
        "extract",
        {
            calibrationFrame: 1,
            calibrationReason:
                "shares the combo's shared idle calibration for the same reason as Sword_Light_2",
        }
    ),
    job(
        CLIP.swordLight4,
        path.join(ROKOKO_LEGACY, "Destiny/Destiny_DrawSwordFight_HUMANIK_769.fbx"),
        "humanikCharacter",
        [1245, 1325],
        "extract",
        {
            calibrationFrame: 1245,
        }
    ),
    job(
        CLIP.swordHeavy,
        path.join(MOCAPIN_FIGHT, "05_04_007_attack_02.fbx"),
        "motus",
        [57, 145],
        "extract",
        {
            calibrationFrame: 57,
            calibrationReason:
                "the take's low-guard start, closest neutral pose before the wind-up begins",
        }
    ),
    job(
        CLIP.swordHeavyFinisher,
        path.join(MOCAPIN_FIGHT, "05_04_008_attack_03.fbx"),
        "motus",
        [12, 120],
        "extract",
        {
            calibrationFrame: 12,
            calibrationReason:
                "the take's guard-idle hold before the leap windup begins, closest neutral pose",
        }
    ),
    job(
        CLIP.swordCounter,
        path.join(ROKOKO_COMBAT, "Sword_Generic_ue.fbx"),
        "ue",
        [267, 286],
        "extract",
        {
            calibrationFrame: 267,
        }
    ),
    job(
        CLIP.jumpAbsorb,
        path.join(ROKOKO_STUDIO, "Superhero/SuperHeroLanding_Takeoff_mixamo.fbx"),
        "mixamo",
        [421, 431],
        "inPlace",
        {
            calibrationFrame: 366,
            calibrationReason:
                "calibrates on the take's neutral standing frame before the crouch-and-jump; the slice itself has no upright frame",
        }
    ),
    job(
        CLIP.dodgeRoll,
        clipSource("mco_demo/FBX/Animation/Ninja/Ninja1_Combat_Forward_Roll_v1.fbx"),
        "motus",
        [22, 70],
        "extract",
        { calibrationFrame: 22, alignToTravel: true }
    ),
    job(
        CLIP.dodgeBackstep,
        clipSource("atlas/Stand_Dodge_360_Take001_Offir_mocapatlas.fbx"),
        "atlas",
        [1136, 1214],
        "extract",
        { calibrationFrame: 1136, speed: 1.3 }
    ),
    job(
        CLIP.dodgeLeft,
        path.join(MOCAPIN_FIGHT, "05_01_019_dodge_L.fbx"),
        "motus",
        [70, 98],
        "extract",
        { calibrationFrame: 70 }
    ),
    job(
        CLIP.dodgeRight,
        path.join(MOCAPIN_FIGHT, "05_01_018_dodge_R.fbx"),
        "motus",
        [58, 84],
        "extract",
        { calibrationFrame: 58 }
    ),
    job(CLIP.parry, UAL_EXTENDED, "ual", [0, 18], "inPlace", { action: "Sword_Block" }),
    job(CLIP.slideStart, UAL_EXTENDED, "ual", FULL_RANGE, "extract", { action: "Slide_Start" }),
    job(CLIP.slideHold, UAL_EXTENDED, "ual", [0, 10], "inPlace", { action: "Slide_Loop" }),
    job(CLIP.slideExit, UAL_EXTENDED, "ual", FULL_RANGE, "extract", { action: "Slide_Exit" }),
    job(CLIP.reactFlinch, UAL_STANDARD, "ual", FULL_RANGE, "inPlace", { action: "Hit_Chest" }),
    job(CLIP.reactHitHead, UAL_STANDARD, "ual", FULL_RANGE, "inPlace", { action: "Hit_Head" }),
    job(
        CLIP.reactCombatDamage,
        clipSource("kevin/Animations/Male/Combat/HumanM@CombatDamage01.fbx"),
        "kevin",
        FULL_RANGE,
        "inPlace",
        { speed: 1.35 }
    ),
    job(CLIP.deathCollapse, UAL_STANDARD, "ual", FULL_RANGE, "extract", {
        action: "Death01",
        speed: 1.5,
    }),
    job(CLIP.deathKnockback, UAL_EXTENDED, "ual", FULL_RANGE, "extract", {
        action: "Hit_Knockback",
    }),
    job(
        CLIP.reactKnockback,
        path.join(MOCAP_CENTRAL, "Fight/am_Ready_Fight_01_Knockdown_A.FBX"),
        "manny",
        [505, 556],
        "extract",
        {
            calibrationFrame: 500,
            calibrationReason:
                "calibrates on the guard stance just before the hit; the slice starts already reacting",
        }
    ),
    job(
        CLIP.reactKnockdown,
        path.join(MOCAP_CENTRAL, "Fight/am_Ready_Fight_01_Knockdown_A.FBX"),
        "manny",
        [645, 740],
        "extract",
        {
            calibrationFrame: 590,
            calibrationReason:
                "calibrates on the same guard stance as React_Knockback, from earlier in the same take",
        }
    ),
    job(
        CLIP.reactStagger,
        path.join(ROKOKO_LEGACY, "Combat/Fight_GettingKickedinBalls_HUMANIK_WHS_segment.fbx"),
        "humanikCharacter",
        [653, 797],
        "inPlace",
        {
            calibrationFrame: 300,
            calibrationReason:
                "the doubled-over hold has no upright frame; calibrates on the take's earlier neutral stance (auditions-reactions.md)",
        }
    ),
    job(
        CLIP.reactParried,
        path.join(ROKOKO_LEGACY, "Combat/Boxing_GettingKnockedOut_HUMANIK_WHS.fbx"),
        "humanikCharacter",
        [455, 540],
        "extract",
        { calibrationFrame: 455 }
    ),
    job(
        CLIP.deathForward,
        clipSource("kevin/Animations/Male/Combat/HumanM@Death01.fbx"),
        "kevin",
        [1, 23],
        "extract",
        { calibrationFrame: 1 }
    ),
    job(
        CLIP.deathBackward,
        path.join(ROKOKO_LEGACY, "Combat/DyingonBattlefield_HUMANIK_769.fbx"),
        "humanikCharacter",
        [200, 580],
        "extract",
        { calibrationFrame: 200 }
    ),
    job(
        CLIP.finisherKickdownAttacker,
        path.join(MOCAP_CENTRAL, "Fight/af_Ready_Fight_02_Kickdown_B.FBX"),
        "manny",
        [270, 345],
        "extract",
        { calibrationFrame: 270 }
    ),
    job(
        CLIP.finisherKickdownVictim,
        path.join(MOCAP_CENTRAL, "Fight/am_Ready_Fight_02_Kickdown_A.FBX"),
        "manny",
        [270, 345],
        "extract",
        { calibrationFrame: 270 }
    ),
    job(
        CLIP.finisherKnockdownAttacker,
        path.join(MOCAP_CENTRAL, "Fight/af_Ready_Fight_01_Knockdown_B.FBX"),
        "manny",
        [620, 700],
        "extract",
        { calibrationFrame: 620 }
    ),
    job(
        CLIP.finisherKnockdownVictim,
        path.join(MOCAP_CENTRAL, "Fight/am_Ready_Fight_01_Knockdown_A.FBX"),
        "manny",
        [620, 700],
        "extract",
        { calibrationFrame: 620 }
    ),
    job(
        CLIP.finisherExecution,
        path.join(ROKOKO_COMBAT, "Sword_Samurai_ue.fbx"),
        "ue",
        [160, 190],
        "extract",
        { calibrationFrame: 160 }
    ),
    job(
        CLIP.finisherBackstab,
        clipSource("rokoko_weapons/20210714_s085_stabTwist_Knife_tk01_ERJA-mvn085.fbx"),
        "motus",
        [430, 565],
        "extract",
        { calibrationFrame: 430 }
    ),
    job(CLIP.enemyPunch, UAL_STANDARD, "ual", FULL_RANGE, "inPlace", { action: "Punch_Cross" }),
    job(
        CLIP.enemySwipe,
        path.join(ROKOKO_COMBAT_NEW, "KnifeFight_mixamo.fbx"),
        "mixamo",
        [238, 290],
        "extract",
        {
            calibrationFrame: 20,
            calibrationReason:
                "calibrates on the take's neutral ready stance before the slash; the slice itself starts mid-guard",
        }
    ),
    ualAction(CLIP.enemySlashA, UAL_EXTENDED, "Sword_Regular_A"),
    ualAction(CLIP.enemySlashARecover, UAL_EXTENDED, "Sword_Regular_A_Rec"),
    ualAction(CLIP.enemySlashB, UAL_EXTENDED, "Sword_Regular_B"),
    ualAction(CLIP.enemySlashBRecover, UAL_EXTENDED, "Sword_Regular_B_Rec"),
    ualAction(CLIP.enemySlashC, UAL_EXTENDED, "Sword_Regular_C"),
    ualAction(CLIP.enemyCleave, UAL_STANDARD, "Sword_Attack"),
    kevinCombat(CLIP.enemyRisingCut, "1H/HumanM@Attack1H01_R.fbx"),
    kevinCombat(CLIP.enemyBackhand, "1H/HumanM@Attack1H01_L.fbx"),
    ualAction(CLIP.swordDash, UAL_EXTENDED, "Sword_Dash"),
    kevinCombat(CLIP.enemyThrust, "Polearm/HumanM@AttackPolearm01.fbx"),
    kevinCombat(CLIP.enemyGreatCleave, "2H/HumanM@Attack2H01.fbx"),
    job(CLIP.enemyLowSweep, UAL_EXTENDED, "ual", [0, 34], "inPlace", {
        action: "Sword_Heavy_Combo",
    }),
    ualAction(CLIP.enemyJab, UAL_STANDARD, "Punch_Jab"),
    ualAction(CLIP.enemyHook, UAL_EXTENDED, "Melee_Hook"),
    ualAction(CLIP.enemyHookRecover, UAL_EXTENDED, "Melee_Hook_Rec"),
    ualAction(CLIP.enemyScratch, UAL_EXTENDED, "Zombie_Scratch"),
    ualAction(CLIP.enemyHurl, UAL_EXTENDED, "OverhandThrow"),
    job(
        CLIP.idleFidgetSwordInspect,
        path.join(ROKOKO_COMBAT_NEW, "SwordIdleMedium_mixamo.fbx"),
        "mixamo",
        [770, 990],
        "inPlace",
        { calibrationFrame: 770 }
    ),
    job(
        CLIP.idleFidgetSwordRoll,
        path.join(ROKOKO_COMBAT_NEW, "SwordIdleMedium_mixamo.fbx"),
        "mixamo",
        [100, 175],
        "inPlace",
        { calibrationFrame: 100 }
    ),
    job(
        CLIP.idleFidgetScratchArm,
        path.join(MOCAP_CENTRAL_IDLE, "am_Stand_Idle_06_ScratchArm.FBX"),
        "manny",
        [1, 141],
        "inPlace",
        { calibrationFrame: 1 }
    ),
    job(
        CLIP.idleFidgetLookAround,
        path.join(MOCAP_CENTRAL_IDLE, "am_Stand_Idle_03_LookAround.FBX"),
        "manny",
        [1, 151],
        "inPlace",
        { calibrationFrame: 1 }
    ),
];
