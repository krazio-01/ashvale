import path from "node:path";
import { CLIP } from "@/constants/characters";
import type { ClipName } from "@/constants/characters";
import { GRIP } from "@/constants/combat";
import { PLAYER, PLAYER_STARTING_WEAPON } from "@/constants/player";
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
    plants?: { foot: "left" | "right"; from: number; to: number; pose?: IPoseReference }[];
    grips?: { from: number; to: number; pose?: IPoseReference }[];
    fingers?: IPoseReference;
    grounding?: "auto" | "none";
}

export type Feel = "snap" | "hold" | "movingHold" | "overshoot" | "anticipate" | "ease";

export interface IHandIntent {
    position: CharacterVector;
    blade: CharacterVector;
    edge?: CharacterVector;
}

export interface ICarriedHand {
    pull: number;
    edge?: CharacterVector;
}

export interface IStance {
    base: IPoseReference;
    pelvis?: CharacterVector;
    pelvisTurn?: CharacterVector;
    chest?: CharacterVector;
    head?: CharacterVector;
    shoulder?: CharacterVector;
    feet?: { left?: CharacterVector; right?: CharacterVector };
    hand?: IHandIntent | ICarriedHand;
    elbow?: CharacterVector;
    feetFrom?: IPoseReference;
    offHandElbow?: CharacterVector;
    offHand?: CharacterVector | "grip" | IPoseReference;
    gripHold?: number;
}

export interface IBeat<Stance extends string = string> {
    pose: Stance;
    seconds: number;
    feel: Feel;
    arc?: number;
    travel?: CharacterVector;
    contact?: true;
    mark?: string;
}

export interface IBeatClipJob<Stance extends string = string> {
    output: ClipName;
    rootMotion: RootMotion;
    stances: Readonly<Record<Stance, IStance>>;
    start: Stance;
    beats: IBeat<Stance>[];
    reversed?: true;
    fingers?: IPoseReference;
    grounding?: "auto" | "none";
    startMatches?: IPoseReference;
    endMatches?: IPoseReference;
}

export interface IPoseSourceJob extends Omit<IRetargetJob, "output"> {
    output: string;
    poseSource: true;
}

export type ClipJob = IRetargetJob | IAuthoredClipJob | IBeatClipJob | IPoseSourceJob;

export const isAuthoredJob = (job: ClipJob): job is IAuthoredClipJob => "keys" in job;

export const isBeatJob = (job: ClipJob): job is IBeatClipJob => "beats" in job;

const stancePoseReferences = (stance: IStance): IPoseReference[] => [
    ...(stance.feetFrom ? [stance.feetFrom] : []),
    ...(typeof stance.offHand === "object" && "clip" in stance.offHand ? [stance.offHand] : []),
];

export const authoredPoses = (job: IAuthoredClipJob | IBeatClipJob): IPoseReference[] => [
    ...("keys" in job
        ? job.keys.map((key) => key.pose)
        : [job.start, ...job.beats.map((beat) => beat.pose)].map((name) => job.stances[name].base)),
    ...(job.fingers ? [job.fingers] : []),
    ...("stances" in job ? Object.values<IStance>(job.stances).flatMap(stancePoseReferences) : []),
    ...("startMatches" in job && job.startMatches ? [job.startMatches] : []),
    ...("endMatches" in job && job.endMatches ? [job.endMatches] : []),
    ...("keys" in job ? [...(job.plants ?? []), ...(job.grips ?? [])] : []).flatMap((contact) =>
        contact.pose ? [contact.pose] : []
    ),
];

export const CLIP_LIBRARY = {
    target: "assets-src/models/characters/UAL1_Standard.glb",
    output: "assets-src/models/characters/CombatClips.glb",
};

export const CLIP_TUNING = {
    headRadiusHips: 0.12,
    headClearanceMetres: 0.1,
    gripGapMetres: 0.05,
};

export const GAME_FIT = {
    tuning: CLIP_TUNING,
    grip: GRIP,
    bladeToCharacterHeight: PLAYER_STARTING_WEAPON.worldLength / PLAYER.height,
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
export const OUTPUT_FPS = 30;
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

export const sourcePose = (job: IPoseSourceJob, frame: number): IPoseReference => ({
    clip: job.output,
    frame,
});

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

const TWO_HANDED_GRIP_POSE_JOB: IPoseSourceJob = {
    output: "Pose_TwoHandedGrip",
    poseSource: true,
    source: TAKES.kevinCombat("2H/HumanM@CombatIdle2H01.fbx"),
    rig: "kevin",
    frames: WHOLE_TAKE,
    rootMotion: "inPlace",
};

const POSE_SOURCE_JOBS: IPoseSourceJob[] = [TWO_HANDED_GRIP_POSE_JOB];

const IDLE_POSE = libraryPose(UAL1, "Idle_Loop", 0);
const COUNTER_KILL_START_POSE = bakedPose(CLIP.finisherKickdownAttacker, 1);
const TWO_HANDED_GRIP = sourcePose(TWO_HANDED_GRIP_POSE_JOB, 1);

const IDLE_BODY = {
    base: IDLE_POSE,
    feetFrom: IDLE_POSE,
    offHand: IDLE_POSE,
    offHandElbow: [-0.5, -0.5, -1],
} satisfies Partial<IStance>;
const GUARD_ELBOW: CharacterVector = [0.9, -0.7, -0.2];
const BLADE_RAISED_SHOULDER: CharacterVector = [5, -15, 0];

const PLAYER_POSES = {
    idle: { base: IDLE_POSE },
    lowGuard: {
        base: IDLE_POSE,
        pelvis: [0, 0.05, -0.1],
        chest: [0, 0, 0],
        head: [4, 0, 0],
        hand: { position: [0.12, 0.32, 1.12], blade: [0.25, 0.5, 0.82] },
        elbow: GUARD_ELBOW,
        offHand: "grip",
    },
    deflectHigh: {
        base: IDLE_POSE,
        pelvis: [0, 0, -0.18],
        pelvisTurn: [0, 0, -8],
        chest: [-4, 0, -8],
        head: [2, 0, 4],
        hand: { position: [0.1, 0.3, 1.14], blade: [0.35, 0.5, 0.8] },
        elbow: [1.0, 0, -0.1],
        offHand: "grip",
    },
    deflectHighOut: {
        base: IDLE_POSE,
        pelvis: [0, 0.01, -0.18],
        pelvisTurn: [0, 0, -14],
        chest: [-6, 0, -16],
        head: [-2, 0, 8],
        hand: { position: [0.16, 0.26, 1.12], blade: [0.5, 0.6, 0.62] },
        elbow: [1.0, 0, -0.2],
        offHand: "grip",
    },
    deflectSide: {
        base: IDLE_POSE,
        pelvis: [0, -0.03, -0.22],
        pelvisTurn: [0, 0, 15],
        chest: [4, 0, 12],
        head: [-4, 0, -10],
        hand: { position: [-0.06, 0.32, 1.14], blade: [-0.15, 0.4, 0.9] },
        elbow: [0.9, -0.1, -0.3],
        offHand: "grip",
    },
    deflectSideOut: {
        base: IDLE_POSE,
        pelvis: [0, 0.02, -0.18],
        pelvisTurn: [0, 0, 12],
        chest: [-6, 0, 16],
        head: [-2, 0, 4],
        hand: { position: [-0.1, 0.3, 1.14], blade: [-0.4, 0.6, 0.69] },
        elbow: [0.9, -0.1, -0.3],
        offHand: "grip",
    },
    lowered: {
        base: IDLE_POSE,
        pelvis: [0, 0.01, -0.07],
        chest: [-4, 0, 0],
        hand: { position: [0.14, 0.36, 1.05], blade: [0.15, 0.85, 0.2] },
        elbow: GUARD_ELBOW,
        offHand: "grip",
        gripHold: 0.45,
    },
    landCrouch: {
        base: IDLE_POSE,
        pelvis: [0, 0.03, -0.17],
        chest: [-8, 0, 0],
        head: [6, 0, 0],
    },
    counterStart: { base: COUNTER_KILL_START_POSE },
    idleFeet: IDLE_BODY,
    raisedHand: {
        ...IDLE_BODY,
        shoulder: [2, -6, 0],
        hand: { position: [0.63, -0.24, 1.42], blade: [-0.78, 0.4, -0.48], edge: [0.69, 0.45, 0.56] },
        elbow: [-0.86, -0.51, 0.08],
    },
    carriedHilt: {
        ...IDLE_BODY,
        shoulder: [1, -16, -7],
        head: [-5, -5, 2],
        hand: { pull: 0, edge: [-0.88, -0.09, 0.46] },
        elbow: [-0.32, -0.95, 0.02],
    },
    pulledHilt: {
        ...IDLE_BODY,
        shoulder: [1, -20, -6],
        head: [-2, -6, -2],
        hand: { pull: 0.08, edge: [-0.62, 0.72, 0.32] },
        elbow: [-0.33, -0.94, -0.09],
    },
    liftedBlade: {
        ...IDLE_BODY,
        shoulder: BLADE_RAISED_SHOULDER,
        hand: { position: [0.41, -0.26, 1.97], blade: [0.12, 0.18, -0.98], edge: [0.74, 0.54, -0.4] },
        elbow: [-0.52, -0.83, -0.21],
    },
    bladeOut: {
        ...IDLE_BODY,
        shoulder: BLADE_RAISED_SHOULDER,
        hand: { position: [0.44, -0.05, 1.92], blade: [0.89, 0.44, 0.08], edge: [-0.1, 0.54, 0.84] },
        elbow: [-0.21, -0.54, 0.82],
    },
    bladeRising: {
        ...IDLE_BODY,
        shoulder: BLADE_RAISED_SHOULDER,
        hand: { position: [0.44, -0.09, 1.99], blade: [0.77, 0.13, 0.62], edge: [-0.72, -0.48, 0.49] },
        elbow: [-0.31, -0.9, 0.32],
    },
    bladeUp: {
        ...IDLE_BODY,
        shoulder: BLADE_RAISED_SHOULDER,
        hand: { position: [0.37, -0.15, 2.05], blade: [0.22, 0.45, 0.87], edge: [0.11, -0.85, -0.51] },
        elbow: [-0.52, -0.82, -0.24],
    },
    bladeForward: {
        ...IDLE_BODY,
        hand: { position: [0.56, 0.12, 1.75], blade: [-0.48, 0.87, 0.08], edge: [0.83, -0.52, -0.21] },
        elbow: [-0.12, -0.98, -0.15],
    },
} satisfies Record<string, IStance>;

const PLAYER_STANCES = {
    ...PLAYER_POSES,
    guardReach: { ...PLAYER_POSES.lowGuard, gripHold: 0.8 },
    shedHighRelease: {
        ...PLAYER_POSES.deflectHighOut,
        hand: { position: [0.16, 0.26, 1.12], blade: [0.7, 0.5, 0.3] },
        gripHold: 0.5,
    },
    perfectSideReleaseRight: { ...PLAYER_POSES.deflectHighOut, gripHold: 0.5 },
} satisfies Record<string, IStance>;

type PlayerStance = keyof typeof PLAYER_STANCES;

const KICKDOWN_VICTIM_START_POSE = bakedPose(CLIP.finisherKickdownVictim, 1);

const ENEMY_STANCES = {
    idle: { base: IDLE_POSE },
    recoilHigh: {
        base: IDLE_POSE,
        pelvis: [0, -0.14, -0.06],
        pelvisTurn: [0, 0, -10],
        chest: [30, 0, -12],
        head: [26, 0, 6],
        feet: { right: [0.2, -0.55, 0] },
        hand: { position: [0.3, 0.05, 1.75], blade: [0.1, -0.4, 0.9] },
        elbow: [0.9, 0.3, 0.3],
    },
    recoilSide: {
        base: IDLE_POSE,
        pelvis: [0.04, -0.06, -0.05],
        pelvisTurn: [0, 0, -28],
        chest: [8, 0, -26],
        head: [6, 0, 14],
        feet: { right: [0.26, -0.5, 0] },
        hand: { position: [0.58, 0.02, 1.22], blade: [0.6, 0.2, 0.77] },
        elbow: [0.9, 0.2, -0.38],
    },
    stumbleHigh: {
        base: IDLE_POSE,
        pelvis: [0, -0.2, -0.12],
        pelvisTurn: [0, 0, -6],
        chest: [26, 0, -6],
        head: [20, 0, 0],
        feet: { left: [-0.2, -0.25, 0], right: [0.2, -0.7, 0] },
        hand: { position: [0.5, -0.2, 1.48], blade: [0.3, -0.5, 0.8] },
        elbow: [0.9, 0.2, 0.2],
    },
    stumbleSide: {
        base: IDLE_POSE,
        pelvis: [0.06, -0.18, -0.12],
        pelvisTurn: [0, 0, -32],
        chest: [14, 0, -24],
        head: [8, 0, 12],
        feet: { left: [-0.25, -0.1, 0], right: [0.25, -0.6, 0] },
        hand: { position: [0.62, -0.06, 1.3], blade: [0.7, 0, 0.7] },
        elbow: [0.9, 0.1, -0.4],
    },
    offBalance: {
        base: IDLE_POSE,
        pelvis: [0.02, -0.22, -0.16],
        pelvisTurn: [0, 0, -4],
        chest: [10, 0, -4],
        head: [4, 0, 0],
        feet: { left: [-0.22, -0.3, 0], right: [0.2, -0.62, 0] },
    },
    strikeHigh: {
        base: IDLE_POSE,
        pelvis: [0, 0.06, -0.06],
        chest: [-14, 0, 6],
        head: [-6, 0, 0],
        hand: { position: [0.22, 0.45, 1.45], blade: [0.05, 0.55, 0.83] },
        elbow: [0.9, 0.2, -0.38],
    },
    strikeSide: {
        base: IDLE_POSE,
        pelvis: [0, 0.05, -0.05],
        pelvisTurn: [0, 0, 20],
        chest: [-10, 0, 18],
        hand: { position: [-0.1, 0.5, 1.15], blade: [-0.85, 0.4, 0.3] },
        elbow: [0.9, 0.1, -0.42],
    },
    recoverHigh: {
        base: IDLE_POSE,
        pelvis: [0, -0.06, -0.05],
        chest: [6, 0, -4],
        head: [6, 0, 0],
        feet: { right: [0.2, -0.45, 0] },
        hand: { position: [0.32, 0.25, 1.15], blade: [0.2, 0.6, -0.77] },
        elbow: [0.9, 0.1, -0.42],
    },
    victimStart: { base: KICKDOWN_VICTIM_START_POSE },
} satisfies Record<string, IStance>;

const beatClips =
    <Stance extends string>(stances: Readonly<Record<Stance, IStance>>, fingers?: IPoseReference) =>
    (
        output: ClipName,
        start: Stance,
        beats: IBeat<Stance>[],
        endMatches: IPoseReference,
        startMatches?: IPoseReference
    ): IBeatClipJob<Stance> => ({
        output,
        rootMotion: "inPlace",
        stances,
        start,
        beats,
        ...(fingers && { fingers }),
        endMatches,
        ...(startMatches && { startMatches }),
    });

const playerBeats = beatClips(PLAYER_STANCES, TWO_HANDED_GRIP);
const enemyBeats = beatClips(ENEMY_STANCES);

type ParrySide = "High" | "Side";

const PERFECT_PARRY_RELEASE = {
    High: "shedHighRelease",
    Side: "perfectSideReleaseRight",
} as const satisfies Record<ParrySide, PlayerStance>;

const returnToIdle = (loweredSeconds: number, idleSeconds: number): IBeat<PlayerStance>[] => [
    { pose: "lowered", seconds: loweredSeconds, feel: "ease", mark: "lowering" },
    { pose: "idle", seconds: idleSeconds, feel: "ease", mark: "idle" },
    { pose: "idle", seconds: 0.04, feel: "hold" },
];

const parryDeflect = (side: ParrySide): IBeatClipJob =>
    playerBeats(
        CLIP[`parryDeflect${side}`],
        `deflect${side}`,
        [
            { pose: `deflect${side}`, seconds: 0.1, feel: "movingHold", contact: true },
            { pose: `deflect${side}Out`, seconds: 0.13, feel: "overshoot", mark: "out" },
            { pose: "lowGuard", seconds: 0.07, feel: "ease" },
            ...returnToIdle(0.1, 0.11),
        ],
        IDLE_POSE
    );

const parryPerfect = (side: ParrySide): IBeatClipJob =>
    playerBeats(
        CLIP[`parryPerfect${side}`],
        `deflect${side}`,
        [
            { pose: `deflect${side}`, seconds: 0.05, feel: "movingHold", contact: true },
            { pose: PERFECT_PARRY_RELEASE[side], seconds: 0.08, feel: "snap" },
            { pose: "counterStart", seconds: 0.24, feel: "ease" },
            { pose: "counterStart", seconds: 0.08, feel: "hold", mark: "counter" },
        ],
        COUNTER_KILL_START_POSE
    );

const reactGuardBroken = (side: ParrySide): IBeatClipJob =>
    enemyBeats(
        CLIP[`reactGuardBroken${side}`],
        `strike${side}`,
        [
            { pose: `recoil${side}`, seconds: 0.13, feel: "ease", contact: true },
            { pose: `stumble${side}`, seconds: 0.3, feel: "overshoot" },
            { pose: "offBalance", seconds: 0.45, feel: "movingHold" },
            { pose: "victimStart", seconds: 0.4, feel: "ease" },
            { pose: "victimStart", seconds: 0.12, feel: "hold" },
        ],
        KICKDOWN_VICTIM_START_POSE
    );

const DRAW = {
    start: "idleFeet",
    beats: [
        { pose: "raisedHand", seconds: 0.2, feel: "ease" },
        { pose: "carriedHilt", seconds: 0.15, feel: "ease" },
        { pose: "carriedHilt", seconds: 0.05, feel: "movingHold" },
        { pose: "pulledHilt", seconds: 0.12, feel: "ease", mark: "mount" },
        { pose: "liftedBlade", seconds: 0.15, feel: "ease" },
        { pose: "bladeOut", seconds: 0.08, feel: "ease" },
        { pose: "bladeRising", seconds: 0.09, feel: "ease" },
        { pose: "bladeUp", seconds: 0.12, feel: "ease" },
        { pose: "bladeForward", seconds: 0.2, feel: "ease" },
        { pose: "idleFeet", seconds: 0.23, feel: "ease" },
    ],
} satisfies { start: PlayerStance; beats: IBeat<PlayerStance>[] };

const BEAT_CLIP_JOBS: IBeatClipJob[] = [
    playerBeats(CLIP.swordDraw, DRAW.start, DRAW.beats, IDLE_POSE, IDLE_POSE),
    {
        ...playerBeats(CLIP.swordSheathe, DRAW.start, DRAW.beats, IDLE_POSE, IDLE_POSE),
        reversed: true,
    },
    playerBeats(
        CLIP.parryGuard,
        "idle",
        [
            { pose: "guardReach", seconds: 0.1, feel: "snap", arc: 0.15 },
            { pose: "lowGuard", seconds: 0.06, feel: "ease" },
            { pose: "lowGuard", seconds: 0.16, feel: "movingHold" },
            ...returnToIdle(0.12, 0.14),
        ],
        IDLE_POSE,
        IDLE_POSE
    ),
    playerBeats(
        CLIP.parryReguard,
        "lowGuard",
        [{ pose: "lowGuard", seconds: 0.3, feel: "movingHold" }, ...returnToIdle(0.12, 0.14)],
        IDLE_POSE
    ),
    playerBeats(
        CLIP.jumpAbsorb,
        "idle",
        [
            { pose: "landCrouch", seconds: 0.09, feel: "ease" },
            { pose: "idle", seconds: 0.3, feel: "ease" },
            { pose: "idle", seconds: 0.04, feel: "hold" },
        ],
        IDLE_POSE,
        IDLE_POSE
    ),
    parryDeflect("High"),
    enemyBeats(
        CLIP.reactParriedHigh,
        "strikeHigh",
        [
            { pose: "recoilHigh", seconds: 0.17, feel: "ease", contact: true },
            { pose: "recoilHigh", seconds: 0.12, feel: "movingHold" },
            { pose: "recoverHigh", seconds: 0.13, feel: "ease" },
            { pose: "idle", seconds: 0.12, feel: "ease" },
            { pose: "idle", seconds: 0.06, feel: "hold" },
        ],
        IDLE_POSE
    ),
    parryDeflect("Side"),
    parryPerfect("High"),
    parryPerfect("Side"),
    enemyBeats(
        CLIP.reactParriedSide,
        "strikeSide",
        [
            { pose: "recoilSide", seconds: 0.17, feel: "ease", contact: true },
            { pose: "recoilSide", seconds: 0.12, feel: "movingHold" },
            { pose: "idle", seconds: 0.25, feel: "ease" },
            { pose: "idle", seconds: 0.06, feel: "hold" },
        ],
        IDLE_POSE
    ),
    reactGuardBroken("High"),
    reactGuardBroken("Side"),
];

export const CLIP_JOBS: ClipJob[] = [
    ...LOCOMOTION_JOBS,
    ...PLAYER_ATTACK_JOBS,
    ...MOVEMENT_JOBS,
    ...HIT_JOBS,
    ...FINISHER_JOBS,
    ...ungrounded(ENEMY_JOBS),
    ...IDLE_FIDGET_JOBS,
    ...POSE_SOURCE_JOBS,
    ...BEAT_CLIP_JOBS,
];
