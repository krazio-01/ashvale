import type { Object3D, Vector3, Vector3Tuple } from "three";
import type { ENEMY_ARCHETYPES } from "@/constants/enemies";
export type Team = "player" | "enemy";
export type ImpactTier = "light" | "heavy" | "finisher";
export type ReactionTier = "none" | "flinch" | "stagger" | "knockback" | "knockdown";
export type MoveTag =
    "light" | "heavy" | "dodge" | "parry" | "shoot" | "movement" | "jump" | "stance";
export type Stance = "sheathed" | "drawn";
export type DodgeSide = "left" | "right";
export type IntentKind =
    "light" | "heavy" | "dodge" | "parry" | "shoot" | "slide" | "jump" | "draw";
type MoveGround = "grounded" | "airborne" | "any";
type MoveMotion = "rootMotion" | "momentum" | "physics";
type HitOutcomeKind =
    "ignored" | "evaded" | "perfectEvaded" | "parried" | "damaged" | "staggered" | "killed";
export type AwarenessState = "unaware" | "suspicious" | "alert";
export type AlertPhase = "unaware" | "suspicious" | "alert" | "searching" | "returning";
export type VictimRig = "humanoid" | "creature";
export type FinisherKind = "counter" | "execution" | "backstab";
export type EnemyArchetype = (typeof ENEMY_ARCHETYPES)[number];
export type ArchetypeId = EnemyArchetype | "boss";
export type ParryTier = "parry" | "perfect";
export type SwingDirection = "high" | "side";
export type ParriedReactions = Readonly<
    Record<ParryTier, Readonly<Record<SwingDirection, string>>>
>;

export interface IParryResult {
    tier: ParryTier;
    staggerSeconds: number;
    knockback: number;
}

export interface IMoveWindow {
    from: number;
    to: number;
}

export type HitShape = { kind: "weapon" } | { kind: "socket"; bone: string; radius: number };

export interface IHitWindow extends IMoveWindow {
    shape: HitShape;
    damageScale: number;
    poiseDamage: number;
    impact: ImpactTier;
    knockback: number;
    parryable: boolean;
    dodgeOnly: boolean;
    swing: SwingDirection;
}

export interface ICancelWindow extends IMoveWindow {
    into: readonly MoveTag[];
}

interface ITrackingWindow extends IMoveWindow {
    turnRate: number;
}

export interface IGapCloseWindow extends IMoveWindow {
    maxDistance: number;
    strikeDistance: number;
}

export interface IMomentum {
    deceleration: number;
    poseReach?: number;
}

export interface ISlowMotionProfile {
    scale: number;
    seconds: number;
    rampInSeconds: number;
    rampOutSeconds: number;
}

export type AttackWarningDanger = "parryable" | "dodgeOnly";
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
    parrySeconds?: number;
    tracking?: ITrackingWindow;
    gapClose?: IGapCloseWindow;
    holdAt?: number;
    counterAt?: number;
    yieldsToMovement?: boolean;
    next?: Partial<Record<IntentKind, string>>;
    followedBy?: string;
    blockedInto?: string;
    momentum?: IMomentum;
    motion: MoveMotion;
    requires?: MoveGround;
    onLand?: string;
    loop?: boolean;
    durationSeconds?: number;
    minimumWindupSeconds?: number;
    launch?: number;
    projectile?: IProjectileLaunch;
    procedural?: { grip?: IMoveWindow };
    mountAt?: { fraction: number; target: WeaponMount };
}

export interface IReactionClips {
    flinch: readonly string[];
    knockback: readonly string[];
    knockdown: readonly string[];
    stagger: string;
    parried: ParriedReactions;
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
    stanceEntry?: Record<Stance, string>;
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
    dodgeOnly: boolean;
    ranged: boolean;
    swing: SwingDirection;
    origin: Vector3;
}

interface IHitOutcomeBase {
    reaction: ReactionTier;
    damageDealt: number;
}

interface IParriedOutcome extends IHitOutcomeBase {
    kind: "parried";
    parry: IParryResult;
}

interface IUnparriedOutcome extends IHitOutcomeBase {
    kind: Exclude<HitOutcomeKind, "parried">;
}

export type IHitOutcome = IParriedOutcome | IUnparriedOutcome;

export interface IAttackThreat {
    moveSerial: number;
    secondsUntilHit: number;
    parryable: boolean;
    dodgeOnly: boolean;
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
    readonly isInFinisher: boolean;
    readonly isStaggered: boolean;
    readonly isReeling: boolean;
    readonly isAttacking: boolean;
    readonly healthFraction: number;
    readonly awareness: AwarenessState;
    readonly victimRig: VictimRig;
    readonly hurtboxes: readonly ICapsule[];
    readonly boundingRadius: number;
    receiveHit(payload: IHitPayload): IHitOutcome;
}

export interface IFinisherDefinition {
    id: string;
    kind: FinisherKind;
    attackerClip: string;
    finisherVictimClip: string | null;
    distance: number;
    bearing: number;
    relativeYaw: number;
    killAt: number;
    impactAt?: readonly number[];
    victimDeath?: string;
    blendInSeconds?: number;
}

export interface IBoss {
    readonly id: string;
    readonly archetype: IEnemyArchetype;
}

export type Handedness = "right" | "left";

export interface IHandRig {
    hand: Object3D;
    indexBase: Object3D;
    middleBase: Object3D;
    ringBase: Object3D;
    pinkyBase: Object3D | null;
    thumbBase: Object3D;
}

export type WeaponMount = "hand" | "carry";

export interface IWeaponCarry {
    bone: string;
    position: Vector3Tuple;
    rotationDegrees: Vector3Tuple;
}

export interface ICarryRig {
    bone: Object3D;
}

export interface IWeaponSpec {
    id: string;
    modelPath: string;
    gripHand: Handedness;
    handleCentreFraction: number;
    gripRoll: number;
    worldLength: number;
    guardFraction: number;
    damage: number;
    carry?: IWeaponCarry;
}

export interface IMeleeWeaponSpec extends IWeaponSpec {
    kind: "melee";
    bladeRadius: number;
    trailColor: string;
}

export type WeaponDefinition = IMeleeWeaponSpec;

export interface IEnemyArchetype {
    label: string;
    modelPath: string;
    height: number;
    radius: number;
    victimRig: VictimRig;
    vitals: IVitalsSpec;
    attackPower: number;
    tactics: ICombatTactics;
    attacks: readonly IEnemyAttack[];
    weapon: WeaponDefinition | null;
    moveSet: IMoveSet;
    counterAttackMove: string;
    patrolSpeed: number;
    combatSpeed: number;
    wanderRadius: number;
    counterKillable: boolean;
    alwaysAware: boolean;
}

export interface IClipMarks {
    marks: Readonly<Record<string, number>>;
    grip: IMoveWindow | null;
}

export interface IProjectileSpec extends Pick<
    IHitWindow,
    "damageScale" | "poiseDamage" | "impact" | "knockback" | "parryable" | "dodgeOnly"
> {
    speed: number;
    radius: number;
    color: string;
}

export interface IVitalsSpec {
    maxHealth: number;
    maxPoise: number;
    maxStamina: number;
    maxFocus: number;
    poiseRegenDelay: number;
    poiseRegenRate: number;
    staminaRegenDelay: number;
    staminaRegenRate: number;
    staggerSeconds: number;
}

export interface IEnemyAttack {
    id: string;
    openingMove: string;
    range: readonly [number, number];
    weight: number;
    cooldownSeconds: number;
    tokenCost: number;
    chain: readonly string[];
    continueChance: number;
}

export interface IDefenseTactics {
    reactionSeconds: number;
    parryChance: number;
    evadeChance: number;
}

export interface IWanderTuning {
    arriveDistance: number;
    pauseSeconds: readonly [number, number];
    maxWalkSeconds: number;
    distanceFraction: readonly [number, number];
}

interface ICombatTactics extends IDefenseTactics {
    preferredRange: number;
    retreatRange: number;
    frenzyBelowHealth: number;
    frenzyCooldownScale: number;
}
