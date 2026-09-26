import type { Object3D, Vector3 } from "three";
import type { IEnemyArchetype } from "@/constants/enemies";
export type Team = "player" | "enemy";
export type ImpactTier = "light" | "heavy" | "finisher";
export type ReactionTier = "none" | "flinch" | "stagger" | "knockback" | "knockdown";
export type MoveTag = "light" | "heavy" | "dodge" | "parry" | "shoot" | "movement" | "jump";
export type DodgeSide = "left" | "right";
export type IntentKind = "light" | "heavy" | "dodge" | "parry" | "shoot" | "slide" | "jump";
type MoveGround = "grounded" | "airborne" | "any";
type MoveMotion = "rootMotion" | "momentum" | "physics";
type HitOutcomeKind =
    "ignored" | "evaded" | "perfectEvaded" | "parried" | "damaged" | "staggered" | "killed";
export type AwarenessState = "unaware" | "suspicious" | "alert";
export type AlertPhase = "unaware" | "suspicious" | "alert" | "searching" | "returning";
export type VictimRig = "humanoid" | "creature";
export type FinisherKind = "counter" | "execution" | "backstab";
export type EnemyArchetype = "sentinel" | "wraith" | "golem" | "gremlin";

export interface IMoveWindow {
    from: number;
    to: number;
}

export type HitShape = { kind: "weapon" } | { kind: "socket"; bone: string; radius: number };

export interface IStrikeSegment {
    start: Vector3;
    end: Vector3;
    radius: number;
}

export interface IHitWindow extends IMoveWindow {
    shape: HitShape;
    damageScale: number;
    poiseDamage: number;
    impact: ImpactTier;
    knockback: number;
    parryable: boolean;
    perilous: boolean;
}

export interface ICancelWindow extends IMoveWindow {
    into: readonly MoveTag[];
}

interface ITrackingWindow extends IMoveWindow {
    turnRate: number;
}

export interface IWarpWindow extends IMoveWindow {
    maxDistance: number;
    strikeDistance: number;
}

export interface IMomentum {
    deceleration: number;
}

export interface ISlowMotionProfile {
    scale: number;
    seconds: number;
    rampInSeconds: number;
    rampOutSeconds: number;
}

export type TelegraphDanger = "parryable" | "perilous";
export type ProjectileKind = "bolt" | "blast";

export interface IProjectileLaunch {
    at: number;
    kind: ProjectileKind;
    socket: string;
}

export interface IMoveDefinition {
    id: string;
    clip: string;
    tags: readonly MoveTag[];
    playbackRate: number;
    fadeSeconds: number;
    staminaCost: number;
    focusGain: number;
    spendsFocus: boolean;
    rootMotionScale: number;
    hits: readonly IHitWindow[];
    cancels: readonly ICancelWindow[];
    invulnerable?: IMoveWindow;
    armor?: IMoveWindow;
    parryWindow?: IMoveWindow;
    tracking?: ITrackingWindow;
    warp?: IWarpWindow;
    holdAt?: number;
    next?: Partial<Record<"light" | "heavy", string>>;
    followedBy?: string;
    momentum?: IMomentum;
    motion: MoveMotion;
    requires?: MoveGround;
    onLand?: string;
    loop?: boolean;
    durationSeconds?: number;
    minimumWarningSeconds?: number;
    launch?: number;
    projectile?: IProjectileLaunch;
}

export interface IReactionClips {
    flinch: readonly string[];
    knockback: readonly string[];
    knockdown: readonly string[];
    stagger: string;
    parried: string;
    finisherDeath: string;
    deaths: readonly string[];
}

export interface IMoveSet {
    moves: Readonly<Record<string, IMoveDefinition>>;
    entry: Partial<Record<IntentKind, string>>;
    sprintEntry: Partial<Record<IntentKind, string>>;
    lockedFarEntry?: Partial<Record<IntentKind, string>>;
    sideDodgeEntry?: Record<DodgeSide, string>;
    airEntry: Partial<Record<IntentKind, string>>;
    air?: { airborne: string; land: string };
    reactions: IReactionClips;
}

export interface ICapsule {
    readonly start: Vector3;
    readonly end: Vector3;
    radius: number;
}

export interface IHitPayload {
    attacker: ICombatant;
    moveId: string;
    damage: number;
    poiseDamage: number;
    impact: ImpactTier;
    knockback: number;
    parryable: boolean;
    perilous: boolean;
    ranged: boolean;
    origin: Vector3;
}

export interface IHitOutcome {
    kind: HitOutcomeKind;
    reaction: ReactionTier;
    damageDealt: number;
}

export interface IAttackThreat {
    moveSerial: number;
    secondsUntilHit: number;
    parryable: boolean;
    perilous: boolean;
    impact: ImpactTier;
}

export interface IAttackThreatSource {
    readonly attackThreat: IAttackThreat | null;
    readonly currentTarget: ICombatant | null;
}

export interface ICombatant {
    readonly id: string;
    readonly team: Team;
    readonly sceneObject: Object3D;
    readonly position: Vector3;
    readonly bodyRadius: number;
    readonly isDead: boolean;
    readonly isPaired: boolean;
    readonly isStaggered: boolean;
    readonly isAttacking: boolean;
    readonly healthFraction: number;
    readonly awareness: AwarenessState;
    readonly victimRig: VictimRig;
    readonly hurtboxes: readonly ICapsule[];
    readonly broadRadius: number;
    receiveHit(payload: IHitPayload): IHitOutcome;
}

export interface IFinisherDefinition {
    id: string;
    kind: FinisherKind;
    attackerClip: string;
    pairedVictimClip: string | null;
    distance: number;
    bearing: number;
    relativeYaw: number;
    killAt: number;
}

export interface IBoss {
    readonly id: string;
    readonly archetype: IEnemyArchetype;
}
