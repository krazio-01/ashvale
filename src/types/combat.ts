import type { Object3D, Vector3 } from "three";

export type Team = "player" | "enemy";
export type ImpactTier = "light" | "heavy" | "finisher";
export type ReactionTier = "none" | "flinch" | "stagger" | "knockback" | "knockdown";
export type MoveTag = "light" | "heavy" | "dodge" | "parry" | "shoot" | "movement" | "jump";
export type IntentKind = "light" | "heavy" | "dodge" | "parry" | "shoot" | "slide" | "jump";
export type MoveGround = "grounded" | "airborne" | "any";
export type MoveMotion = "rootMotion" | "momentum" | "physics";
export type HitOutcomeKind =
    "ignored" | "evaded" | "perfectEvaded" | "parried" | "damaged" | "staggered" | "killed";
export type AwarenessState = "unaware" | "suspicious" | "alert";
export type AlertPhase = "unaware" | "suspicious" | "alert" | "searching" | "returning";
export type VictimRig = "humanoid" | "creature";
export type FinisherKind = "counter" | "execution" | "backstab" | "critical";
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
}

export interface ICancelWindow extends IMoveWindow {
    into: readonly MoveTag[];
}

export interface ITrackingWindow extends IMoveWindow {
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
    telegraphAt?: number;
    next?: Partial<Record<"light" | "heavy", string>>;
    followedBy?: string;
    momentum?: IMomentum;
    motion: MoveMotion;
    requires?: MoveGround;
    onLand?: string;
    loop?: boolean;
    durationSeconds?: number;
    launch?: number;
}

export interface IReactionClips {
    flinch: string;
    knockback: string;
    knockdown: string;
    stagger: string;
    parried: string;
    finisherDeath: string;
    deaths: readonly string[];
}

export interface IMoveSet {
    moves: Readonly<Record<string, IMoveDefinition>>;
    entry: Partial<Record<IntentKind, string>>;
    sprintEntry: Partial<Record<IntentKind, string>>;
    stationaryEntry: Partial<Record<IntentKind, string>>;
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
    origin: Vector3;
}

export interface IHitOutcome {
    kind: HitOutcomeKind;
    reaction: ReactionTier;
    damageDealt: number;
}

export interface ICombatant {
    readonly id: string;
    readonly team: Team;
    readonly sceneObject: Object3D;
    readonly position?: Vector3;
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
