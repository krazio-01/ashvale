import path from "node:path";
import { CLIP } from "@/constants/characters";
import type { ClipName } from "@/constants/characters";
import { PIPELINE_CONFIG } from "../pipeline";

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

export type RootMotion = "extract" | "inPlace";

export interface IRetargetJob {
    output: ClipName;
    source: string;
    rig: SourceRig;
    frames: [number, number];
    rootMotion: RootMotion;
    action?: string;
    calibrationFrame?: number;
    calibrationReason?: string;
    alignToTravel?: boolean;
    speed?: number;
    holdFeet?: boolean;
    grounding?: "auto" | "none";
}

export type CharacterVector = [number, number, number];

export interface IPoseReference {
    clip: string;
    frame: number;
    library?: string;
}

export interface IAuthoredKey {
    time: number;
    pose: IPoseReference;
    ease?: "linear" | "in" | "out" | "inOut";
    adjust?: Partial<Record<string, CharacterVector>>;
    pelvis?: CharacterVector;
    travel?: CharacterVector;
}

export interface IAuthoredClipJob {
    output: ClipName;
    rootMotion: RootMotion;
    keys: IAuthoredKey[];
    plants?: { foot: "left" | "right"; from: number; to: number }[];
    grips?: { from: number; to: number }[];
    grounding?: "auto" | "none";
}

export type ClipJob = IRetargetJob | IAuthoredClipJob;

export const isAuthoredJob = (job: ClipJob): job is IAuthoredClipJob => "keys" in job;

export const CLIP_LIBRARY = {
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

const UAL1 = path.resolve(CLIP_LIBRARY.target);
const UAL2 = path.resolve("assets-src/models/characters/UAL2_Standard.glb");
const WHOLE_TAKE: [number, number] = [0, 0];

const takesIn =
    (folder: string) =>
    (file: string): string =>
        path.join(PIPELINE_CONFIG.combatAssetsRoot, folder, file);

const TAKES = {
    mocapOnlineSword: takesIn("mco_sword/TC_Sword_Free_Pack/FBX_Pack/Animation"),
    mocapOnlineDemo: takesIn("mco_demo/FBX/Animation"),
    kevinRun: takesIn("kevin/Animations/Male/Movement/Run"),
    kevinStrafe: takesIn("kevin/Animations/Male/Movement/Strafe/StrafeRun"),
    kevinCombat: takesIn("kevin/Animations/Male/Combat"),
    mocapCentral: takesIn("mocap_central/MC_Sample_SourceFiles/Animations/UE5_Skel"),
    mocapinFight: takesIn("mocapin_fight/Fight Mocap Animation Data"),
    rokokoCombat: takesIn(
        "rokoko263/Rokoko Studio (Mocap)/RokokoTVContest_MocapAssets/COMBAT/UNREAL ENGINE"
    ),
    rokokoLegacy: takesIn("rokoko263/Rokoko Studio Legacy Mocap (older)"),
    rokokoStudio: takesIn("rokoko263/Rokoko Studio (Mocap)"),
    rokokoCombatPack: takesIn("rokoko_combat/Combat"),
    rokokoWeapons: takesIn("rokoko_weapons"),
    atlas: takesIn("atlas"),
};

type UalSettings = Partial<Pick<IRetargetJob, "frames" | "rootMotion" | "speed">>;

const mocap = (output: ClipName, take: Omit<IRetargetJob, "output">): IRetargetJob => ({
    output,
    ...take,
});

const ual = (
    output: ClipName,
    library: string,
    action: string,
    settings: UalSettings = {}
): IRetargetJob => {
    const { frames = WHOLE_TAKE, rootMotion = "inPlace", ...rest } = settings;
    return { output, source: library, rig: "ual", frames, rootMotion, action, ...rest };
};

const kevinTake = (output: ClipName, source: string): IRetargetJob => ({
    output,
    source,
    rig: "kevin",
    frames: WHOLE_TAKE,
    rootMotion: "inPlace",
});

export const libraryPose = (library: string, clip: string, frame: number): IPoseReference => ({
    library,
    clip,
    frame,
});

export const bakedPose = (clip: ClipName, frame: number): IPoseReference => ({ clip, frame });

const LOCOMOTION_JOBS: IRetargetJob[] = [
    mocap(CLIP.combatIdle, {
        source: TAKES.mocapOnlineSword("KBS_Ready_Idle_001.fbx"),
        rig: "motus",
        frames: WHOLE_TAKE,
        rootMotion: "inPlace",
        holdFeet: true,
    }),
    kevinTake(CLIP.strafeForward, TAKES.kevinRun("HumanM@Run01_Forward.fbx")),
    kevinTake(CLIP.strafeForwardRight, TAKES.kevinStrafe("HumanM@StrafeRun01_ForwardRight.fbx")),
    kevinTake(CLIP.strafeRight, TAKES.kevinStrafe("HumanM@StrafeRun01_Right.fbx")),
    kevinTake(CLIP.strafeBackRight, TAKES.kevinStrafe("HumanM@StrafeRun01_BackwardRight.fbx")),
    kevinTake(CLIP.strafeBack, TAKES.kevinRun("HumanM@Run01_Backward.fbx")),
    kevinTake(CLIP.strafeBackLeft, TAKES.kevinStrafe("HumanM@StrafeRun01_BackwardLeft.fbx")),
    kevinTake(CLIP.strafeLeft, TAKES.kevinStrafe("HumanM@StrafeRun01_Left.fbx")),
    kevinTake(CLIP.strafeForwardLeft, TAKES.kevinStrafe("HumanM@StrafeRun01_ForwardLeft.fbx")),
];

const SWORD_COMBO_TAKE = TAKES.mocapOnlineSword("KBS_Sword_ATK_Combo_01_001.fbx");

const PLAYER_ATTACK_JOBS: IRetargetJob[] = [
    mocap(CLIP.swordLight1, {
        source: SWORD_COMBO_TAKE,
        rig: "motus",
        frames: [9, 36],
        rootMotion: "extract",
        calibrationFrame: 9,
    }),
    mocap(CLIP.swordLight2, {
        source: SWORD_COMBO_TAKE,
        rig: "motus",
        frames: [36, 60],
        rootMotion: "extract",
        calibrationFrame: 1,
        calibrationReason:
            "shares Sword_Light_1's idle calibration so the combo chain lines up; in-range calibration slides this slice ~1m sideways (auditions-sword.md)",
    }),
    mocap(CLIP.swordLight3, {
        source: SWORD_COMBO_TAKE,
        rig: "motus",
        frames: [60, 87],
        rootMotion: "extract",
        calibrationFrame: 1,
        calibrationReason:
            "shares the combo's shared idle calibration for the same reason as Sword_Light_2",
    }),
    mocap(CLIP.swordLight4, {
        source: TAKES.rokokoLegacy("Destiny/Destiny_DrawSwordFight_HUMANIK_769.fbx"),
        rig: "humanikCharacter",
        frames: [1245, 1325],
        rootMotion: "extract",
        calibrationFrame: 1245,
    }),
    mocap(CLIP.swordHeavy, {
        source: TAKES.mocapinFight("05_04_007_attack_02.fbx"),
        rig: "motus",
        frames: [57, 145],
        rootMotion: "extract",
        calibrationFrame: 57,
        calibrationReason:
            "the take's low-guard start, closest neutral pose before the wind-up begins",
    }),
    mocap(CLIP.swordHeavyFinisher, {
        source: TAKES.mocapinFight("05_04_008_attack_03.fbx"),
        rig: "motus",
        frames: [12, 120],
        rootMotion: "extract",
        calibrationFrame: 12,
        calibrationReason:
            "the take's guard-idle hold before the leap windup begins, closest neutral pose",
    }),
    mocap(CLIP.swordCounter, {
        source: TAKES.rokokoCombat("Sword_Generic_ue.fbx"),
        rig: "ue",
        frames: [267, 286],
        rootMotion: "extract",
        calibrationFrame: 267,
    }),
];

const MOVEMENT_JOBS: IRetargetJob[] = [
    mocap(CLIP.jumpAbsorb, {
        source: TAKES.rokokoStudio("Superhero/SuperHeroLanding_Takeoff_mixamo.fbx"),
        rig: "mixamo",
        frames: [421, 431],
        rootMotion: "inPlace",
        calibrationFrame: 366,
        calibrationReason:
            "calibrates on the take's neutral standing frame before the crouch-and-jump; the slice itself has no upright frame",
    }),
    mocap(CLIP.dodgeRoll, {
        source: TAKES.mocapOnlineDemo("Ninja/Ninja1_Combat_Forward_Roll_v1.fbx"),
        rig: "motus",
        frames: [22, 70],
        rootMotion: "extract",
        calibrationFrame: 22,
        alignToTravel: true,
    }),
    mocap(CLIP.dodgeBackstep, {
        source: TAKES.atlas("Stand_Dodge_360_Take001_Offir_mocapatlas.fbx"),
        rig: "atlas",
        frames: [1136, 1214],
        rootMotion: "extract",
        calibrationFrame: 1136,
        speed: 1.3,
    }),
    mocap(CLIP.dodgeLeft, {
        source: TAKES.mocapinFight("05_01_019_dodge_L.fbx"),
        rig: "motus",
        frames: [70, 98],
        rootMotion: "extract",
        calibrationFrame: 70,
    }),
    mocap(CLIP.dodgeRight, {
        source: TAKES.mocapinFight("05_01_018_dodge_R.fbx"),
        rig: "motus",
        frames: [58, 84],
        rootMotion: "extract",
        calibrationFrame: 58,
    }),
    ual(CLIP.parry, UAL2, "Sword_Block", { frames: [0, 18] }),
    ual(CLIP.slideStart, UAL2, "Slide_Start", { rootMotion: "extract" }),
    ual(CLIP.slideHold, UAL2, "Slide_Loop", { frames: [0, 10] }),
    ual(CLIP.slideExit, UAL2, "Slide_Exit", { rootMotion: "extract" }),
];

const KNOCKDOWN_TAKE = TAKES.mocapCentral("Fight/am_Ready_Fight_01_Knockdown_A.FBX");

const HIT_JOBS: IRetargetJob[] = [
    ual(CLIP.reactFlinch, UAL1, "Hit_Chest"),
    ual(CLIP.reactHitHead, UAL1, "Hit_Head"),
    mocap(CLIP.reactCombatDamage, {
        source: TAKES.kevinCombat("HumanM@CombatDamage01.fbx"),
        rig: "kevin",
        frames: WHOLE_TAKE,
        rootMotion: "inPlace",
        speed: 1.35,
    }),
    ual(CLIP.deathCollapse, UAL1, "Death01", { rootMotion: "extract", speed: 1.5 }),
    ual(CLIP.deathKnockback, UAL2, "Hit_Knockback", { rootMotion: "extract" }),
    mocap(CLIP.reactKnockback, {
        source: KNOCKDOWN_TAKE,
        rig: "manny",
        frames: [505, 556],
        rootMotion: "extract",
        calibrationFrame: 500,
        calibrationReason:
            "calibrates on the guard stance just before the hit; the slice starts already reacting",
    }),
    mocap(CLIP.reactKnockdown, {
        source: KNOCKDOWN_TAKE,
        rig: "manny",
        frames: [645, 740],
        rootMotion: "extract",
        calibrationFrame: 590,
        calibrationReason:
            "calibrates on the same guard stance as React_Knockback, from earlier in the same take",
    }),
    mocap(CLIP.reactStagger, {
        source: TAKES.rokokoLegacy("Combat/Fight_GettingKickedinBalls_HUMANIK_WHS_segment.fbx"),
        rig: "humanikCharacter",
        frames: [653, 797],
        rootMotion: "inPlace",
        calibrationFrame: 300,
        calibrationReason:
            "the doubled-over hold has no upright frame; calibrates on the take's earlier neutral stance (auditions-reactions.md)",
    }),
    mocap(CLIP.reactParried, {
        source: TAKES.rokokoLegacy("Combat/Boxing_GettingKnockedOut_HUMANIK_WHS.fbx"),
        rig: "humanikCharacter",
        frames: [455, 540],
        rootMotion: "extract",
        calibrationFrame: 455,
    }),
    mocap(CLIP.deathForward, {
        source: TAKES.kevinCombat("HumanM@Death01.fbx"),
        rig: "kevin",
        frames: [1, 23],
        rootMotion: "extract",
        calibrationFrame: 1,
    }),
];

const FINISHER_JOBS: IRetargetJob[] = [
    mocap(CLIP.finisherKickdownAttacker, {
        source: TAKES.mocapCentral("Fight/af_Ready_Fight_02_Kickdown_B.FBX"),
        rig: "manny",
        frames: [270, 345],
        rootMotion: "extract",
        calibrationFrame: 270,
    }),
    mocap(CLIP.finisherKickdownVictim, {
        source: TAKES.mocapCentral("Fight/am_Ready_Fight_02_Kickdown_A.FBX"),
        rig: "manny",
        frames: [270, 345],
        rootMotion: "extract",
        calibrationFrame: 270,
    }),
    mocap(CLIP.finisherKnockdownAttacker, {
        source: TAKES.mocapCentral("Fight/af_Ready_Fight_01_Knockdown_B.FBX"),
        rig: "manny",
        frames: [620, 700],
        rootMotion: "extract",
        calibrationFrame: 620,
    }),
    mocap(CLIP.finisherKnockdownVictim, {
        source: KNOCKDOWN_TAKE,
        rig: "manny",
        frames: [620, 700],
        rootMotion: "extract",
        calibrationFrame: 620,
    }),
    mocap(CLIP.finisherBackstab, {
        source: TAKES.rokokoWeapons("20210714_s085_stabTwist_Knife_tk01_ERJA-mvn085.fbx"),
        rig: "motus",
        frames: [430, 565],
        rootMotion: "extract",
        calibrationFrame: 430,
    }),
    ual(CLIP.finisherExecution, UAL2, "Sword_Regular_C", {
        frames: [4, 48],
        rootMotion: "extract",
    }),
    ual(CLIP.finisherExecutionSlam, UAL2, "Sword_Heavy_Combo", {
        frames: [55, 104],
        rootMotion: "extract",
    }),
];

const ENEMY_JOBS: IRetargetJob[] = [
    ual(CLIP.enemyPunch, UAL1, "Punch_Cross"),
    mocap(CLIP.enemySwipe, {
        source: TAKES.rokokoCombatPack("KnifeFight_mixamo.fbx"),
        rig: "mixamo",
        frames: [238, 290],
        rootMotion: "extract",
        calibrationFrame: 20,
        calibrationReason:
            "calibrates on the take's neutral ready stance before the slash; the slice itself starts mid-guard",
    }),
    ual(CLIP.enemySlashA, UAL2, "Sword_Regular_A"),
    ual(CLIP.enemySlashARecover, UAL2, "Sword_Regular_A_Rec"),
    ual(CLIP.enemySlashB, UAL2, "Sword_Regular_B"),
    ual(CLIP.enemySlashBRecover, UAL2, "Sword_Regular_B_Rec"),
    ual(CLIP.enemySlashC, UAL2, "Sword_Regular_C"),
    ual(CLIP.enemyCleave, UAL1, "Sword_Attack"),
    kevinTake(CLIP.enemyRisingCut, TAKES.kevinCombat("1H/HumanM@Attack1H01_R.fbx")),
    kevinTake(CLIP.enemyBackhand, TAKES.kevinCombat("1H/HumanM@Attack1H01_L.fbx")),
    ual(CLIP.swordDash, UAL2, "Sword_Dash"),
    kevinTake(CLIP.enemyThrust, TAKES.kevinCombat("Polearm/HumanM@AttackPolearm01.fbx")),
    kevinTake(CLIP.enemyGreatCleave, TAKES.kevinCombat("2H/HumanM@Attack2H01.fbx")),
    ual(CLIP.enemyLowSweep, UAL2, "Sword_Heavy_Combo", { frames: [0, 34] }),
    ual(CLIP.enemyJab, UAL1, "Punch_Jab"),
    ual(CLIP.enemyHook, UAL2, "Melee_Hook"),
    ual(CLIP.enemyHookRecover, UAL2, "Melee_Hook_Rec"),
    ual(CLIP.enemyScratch, UAL2, "Zombie_Scratch"),
    ual(CLIP.enemyHurl, UAL2, "OverhandThrow"),
];

const SWORD_IDLE_TAKE = TAKES.rokokoCombatPack("SwordIdleMedium_mixamo.fbx");

const IDLE_FIDGET_JOBS: IRetargetJob[] = [
    mocap(CLIP.idleFidgetSwordInspect, {
        source: SWORD_IDLE_TAKE,
        rig: "mixamo",
        frames: [770, 990],
        rootMotion: "inPlace",
        calibrationFrame: 770,
        holdFeet: true,
    }),
    mocap(CLIP.idleFidgetSwordRoll, {
        source: SWORD_IDLE_TAKE,
        rig: "mixamo",
        frames: [100, 175],
        rootMotion: "inPlace",
        calibrationFrame: 100,
        holdFeet: true,
    }),
    mocap(CLIP.idleFidgetScratchArm, {
        source: TAKES.mocapCentral("Idle/am_Stand_Idle_06_ScratchArm.FBX"),
        rig: "manny",
        frames: [1, 141],
        rootMotion: "inPlace",
        calibrationFrame: 1,
        holdFeet: true,
    }),
    mocap(CLIP.idleFidgetLookAround, {
        source: TAKES.mocapCentral("Idle/am_Stand_Idle_03_LookAround.FBX"),
        rig: "manny",
        frames: [1, 151],
        rootMotion: "inPlace",
        calibrationFrame: 1,
        holdFeet: true,
    }),
];

const ungrounded = (jobs: IRetargetJob[]): IRetargetJob[] =>
    jobs.map((job) => ({ ...job, grounding: "none" }));

const AUTHORED_CLIP_JOBS: IAuthoredClipJob[] = [];

export const CLIP_JOBS: ClipJob[] = [
    ...LOCOMOTION_JOBS,
    ...PLAYER_ATTACK_JOBS,
    ...MOVEMENT_JOBS,
    ...HIT_JOBS,
    ...FINISHER_JOBS,
    ...ungrounded(ENEMY_JOBS),
    ...IDLE_FIDGET_JOBS,
    ...AUTHORED_CLIP_JOBS,
];
