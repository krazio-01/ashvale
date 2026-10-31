import { Group, Mesh, SkinnedMesh, Vector3 } from "three";
import type { Object3D, Skeleton, Vector3Tuple } from "three";
import { clone as cloneSkinnedModel } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MoveStateMachine } from "@/systems/combat/actions/MoveStateMachine";
import type { IMoveStateInput, IMoveStateOutput } from "@/systems/combat/actions/MoveStateMachine";
import { CharacterMotor } from "@/systems/combat/CharacterMotor";
import { AttackExecutor } from "@/systems/combat/hit/AttackExecutor";
import type { IAttackOwner } from "@/systems/combat/hit/AttackExecutor";
import type {
    IFinisherParticipant,
    FinisherRole,
} from "@/systems/combat/finishers/FinisherSequence";
import { reactionFor, resolveDefense } from "@/systems/combat/hit/HitResolver";
import type { IDefenderSnapshot } from "@/systems/combat/hit/HitResolver";
import {
    hasCrossed,
    isWithin,
    isStrikeMove,
    attackWarningDanger,
    attackWarningTime,
} from "@/systems/combat/actions/MoveTimeline";
import type { ICombatEventMap } from "@/events/CombatEvents";
import { Vitals } from "@/systems/combat/Vitals";
import type {
    IVitalsSpec,
    AwarenessState,
    HitShape,
    IAttackThreat,
    ICapsule,
    ICombatant,
    IHitOutcome,
    IHitPayload,
    IMoveDefinition,
    IParryResult,
    IProjectileLaunch,
    IMoveSet,
    ReactionTier,
    SwingDirection,
    Team,
    VictimRig,
    DodgeSide,
    Stance,
    Handedness,
    ICarryRig,
    IHandRig,
    WeaponDefinition,
} from "@/types/combat";
import { CharacterAnimator } from "@/entities/characters/CharacterAnimator";
import { ProceduralRig } from "@/entities/characters/ProceduralRig";
import type {
    IFreeLocomotion,
    IOneShotOptions,
    IStrafeLocomotion,
    LocomotionDefinition,
} from "@/entities/characters/CharacterAnimator";
import { createWeapon } from "@/entities/weapons/Weapon";
import { EffectSet } from "@/systems/effects/Effects";
import type { MaterialEffectId } from "@/systems/effects/Effects";
import type { Weapon } from "@/entities/weapons/Weapon";
import { HAND_BONES, PROCEDURAL_ANIMATION } from "@/constants/characters";
import { PHYSICS } from "@/constants/physics";
import {
    COMBAT_TIMING,
    BODY_CONTACT,
    FOCUS,
    COMBAT_MOVEMENT,
    PARRY,
    SLOW_MOTION,
} from "@/constants/combat";
import {
    shortestAngleBetween,
    clamp,
    pickRandom,
    yawTowards,
    smoothingFactor,
    yawFromDirection,
    forwardFromYaw,
    horizontalLength,
    horizontalDirection,
} from "@/lib/helpers";
import type { IBladeSource, IProceduralFrame, ProceduralDetail } from "@/types/characters";
import type { ISkinnedModel, IWorldContext, IWorldEntity } from "@/types/world";
import type { IMotorSpec, PhysicsDetail } from "@/types/physics";
import { ERRORS } from "@/constants/strings";

interface ICombatCharacterConfig {
    id: string;
    team: Team;
    context: IWorldContext;
    model: ISkinnedModel;
    motor: IMotorSpec;
    vitals: IVitalsSpec;
    moveSet: IMoveSet;
    freeLocomotion: IFreeLocomotion;
    strafeLocomotion: IStrafeLocomotion;
    sheathedLocomotion?: IFreeLocomotion;
    victimRig: VictimRig;
    turnSmoothing: number;
    modelYawOffset: number;
    spawnPosition: Vector3Tuple;
    spawnYaw: number;
    hitEffect: MaterialEffectId | null;
    reactionLockout?: Partial<Record<ReactionTier, number>>;
    ignoredReactions?: readonly ReactionTier[];
    reactionDodgeCancelSeconds?: number;
}

export abstract class CombatCharacter
    implements IWorldEntity, IAttackOwner, IFinisherParticipant, IBladeSource
{
    private static readonly STAGGER_PLAYBACK: IOneShotOptions = {
        fadeSeconds: 0.08,
        loop: true,
        timeSetByCaller: false,
    };

    private static readonly ZERO_VELOCITY = new Vector3();

    private static readonly MIN_MOVING_SPEED = 0.15;

    private static readonly WEAPON_LOOK_POINT_BLADE_FRACTION = 0.6;

    private static readonly ANIMATION_DETAILS: readonly [
        ProceduralDetail,
        ProceduralDetail,
        ProceduralDetail,
    ] = ["full", "impact", "none"];

    private static readonly PHYSICS_DETAILS: readonly [
        PhysicsDetail,
        PhysicsDetail,
        PhysicsDetail,
    ] = ["full", "reduced", "frozen"];

    private static readonly scratchRootMotion = new Vector3();

    private static readonly scratchDesired = new Vector3();

    private static readonly scratchLaunchOrigin = new Vector3();

    private static readonly scratchLaunchAim = new Vector3();

    private static readonly scratchPush = new Vector3();

    private static readonly scratchForward = new Vector3();

    private static readonly REACTION_PLAYBACK: IOneShotOptions = {
        fadeSeconds: COMBAT_TIMING.reactionFade,
        loop: false,
        timeSetByCaller: false,
    };

    private static readonly PARRIED_PLAYBACK: IOneShotOptions = {
        ...CombatCharacter.STAGGER_PLAYBACK,
        fadeSeconds: 0.03,
    };

    private static readonly DEATH_PLAYBACK: IOneShotOptions = {
        fadeSeconds: COMBAT_TIMING.deathFade,
        loop: false,
        timeSetByCaller: false,
    };

    private static readonly FINISHER_PLAYBACK: IOneShotOptions = {
        fadeSeconds: 0.1,
        loop: false,
        timeSetByCaller: true,
    };

    private static readonly FINISHER_LOOP_PLAYBACK: IOneShotOptions = {
        fadeSeconds: 0.12,
        loop: true,
        timeSetByCaller: false,
    };

    private static readonly FINISHER_RETURN_FADE = 0.25;

    private static detailForDistance<Detail extends string>(
        distance: number,
        fullMetres: number,
        reducedMetres: number,
        labels: readonly [Detail, Detail, Detail]
    ): Detail {
        if (distance <= fullMetres) return labels[0];
        return distance <= reducedMetres ? labels[1] : labels[2];
    }

    readonly id: string;
    readonly team: Team;
    readonly victimRig: VictimRig;
    readonly sceneObject = new Group();
    readonly vitals: Vitals;
    readonly moveStateMachine: MoveStateMachine;
    readonly hurtboxes: readonly ICapsule[];
    readonly boundingRadius: number;

    protected readonly context: IWorldContext;
    protected readonly motor: CharacterMotor;
    protected readonly animator: CharacterAnimator;
    private readonly gazeHilt = new Vector3();
    private readonly gazeTip = new Vector3();
    protected readonly proceduralRig: ProceduralRig;
    private wasInFinisher = false;
    private physicsFreezeSeconds = 0;
    private readonly proceduralFrame: IProceduralFrame = {
        deltaSeconds: 0,
        detail: "full",
        physicsDetail: "full",
        weaponHand: "right",
        twoHandGripWeight: 0,
        grounded: false,
        plantFeet: false,
        lookTarget: null,
    };
    protected readonly modelInstance: Object3D;
    protected readonly moveSet: IMoveSet;
    protected readonly desiredVelocity = new Vector3();
    protected readonly attackExecutor: AttackExecutor;
    protected weapon: Weapon | null = null;
    protected target: ICombatant | null = null;
    protected facingYaw: number;
    protected facesTarget = false;
    protected isSprinting = false;
    protected isLockedTargetFar = false;
    protected heavyHeld = false;
    protected hasDirectionalInput = false;
    protected dodgeSide: DodgeSide | null = null;
    protected locomotionOverride: LocomotionDefinition | null = null;

    private readonly hurtbox: ICapsule;
    private readonly parryCapsule: ICapsule;
    private readonly bodyHeight: number;
    private readonly turnSmoothing: number;
    private readonly freeLocomotion: IFreeLocomotion;
    private readonly strafeLocomotion: IStrafeLocomotion;
    private readonly sheathedLocomotion: IFreeLocomotion | null;
    private readonly hitEffect: MaterialEffectId | null;
    private readonly effects: EffectSet;
    private readonly reactionLockout: Partial<Record<ReactionTier, number>>;
    private readonly ignoredReactions: readonly ReactionTier[];
    private readonly reactionDodgeCancelSeconds: number;
    private readonly reactionClipsByTier: Record<ReactionTier, readonly string[]>;
    private readonly skeletons: Skeleton[] = [];
    private readonly bonesByName = new Map<string, Object3D | null>();
    private readonly moveStateInput: IMoveStateInput;
    private readonly defenderSnapshot: IDefenderSnapshot = {
        isDead: false,
        isUntouchable: false,
        isInvulnerable: false,
        isDodging: false,
        invulnerableSeconds: 0,
        isParrying: false,
        isArmored: false,
        isStaggered: false,
    };
    private readonly reusableAttackThreat: IAttackThreat = {
        moveSerial: 0,
        secondsUntilHit: 0,
        parryable: false,
        dodgeOnly: false,
        impact: "light",
    };
    private readonly attackWarningEvent: ICombatEventMap["attackWarning"] = {
        combatant: this,
        moveId: "",
        danger: "parryable",
        shape: { kind: "weapon" },
    };
    private readonly projectileSocketShape: { kind: "socket"; bone: string; radius: number } = {
        kind: "socket",
        bone: "",
        radius: 0,
    };
    private momentumSpeed = 0;
    private isRootMotionBlocked = false;
    private previousFacingYaw: number;
    private readonly moveVelocity = new Vector3();
    private pendingStaggerClip: string | null = null;
    private pendingStaggerIsParried = false;
    private pendingReactionClip = "";
    private deathClip: string | null = null;
    private deathClipTime = 0;
    private deathElapsed = 0;
    private deathHoldSeconds = 0;
    private finisherClip: string | null = null;
    private finisherClipTime = 0;
    private readonly rootMotionAccumulator = new Vector3();
    private readonly movePlayback: IOneShotOptions = {
        fadeSeconds: 0,
        loop: false,
        timeSetByCaller: true,
    };
    private isDisposed = false;

    protected constructor(config: ICombatCharacterConfig) {
        this.id = config.id;
        this.team = config.team;
        this.victimRig = config.victimRig;
        this.context = config.context;
        this.moveSet = config.moveSet;
        const reactions = config.moveSet.reactions;
        this.reactionClipsByTier = {
            none: reactions.flinch,
            flinch: reactions.flinch,
            knockback: reactions.knockback,
            knockdown: reactions.knockdown,
            stagger: [reactions.stagger],
        };
        this.bodyHeight = config.motor.height;
        this.turnSmoothing = config.turnSmoothing;
        this.freeLocomotion = config.freeLocomotion;
        this.strafeLocomotion = config.strafeLocomotion;
        this.sheathedLocomotion = config.sheathedLocomotion ?? null;
        this.hitEffect = config.hitEffect;
        this.reactionLockout = config.reactionLockout ?? {};
        this.ignoredReactions = config.ignoredReactions ?? [];
        this.reactionDodgeCancelSeconds =
            config.reactionDodgeCancelSeconds ?? Number.POSITIVE_INFINITY;
        this.facingYaw = config.spawnYaw;
        this.previousFacingYaw = config.spawnYaw;

        const [x, y, z] = config.spawnPosition;
        this.sceneObject.position.set(x, y, z);
        this.sceneObject.rotation.y = config.spawnYaw;

        this.modelInstance = cloneSkinnedModel(config.model.scene);
        this.modelInstance.scale.setScalar(config.motor.height / config.model.height);
        this.modelInstance.position.y = -config.motor.height / 2;
        this.modelInstance.rotation.y = config.modelYawOffset;
        this.sceneObject.add(this.modelInstance);

        const meshes: Mesh[] = [];
        this.modelInstance.traverse((object) => {
            if (!(object instanceof Mesh)) return;
            meshes.push(object);
            if (!(object instanceof SkinnedMesh)) return;
            const own = object.skeleton;
            const shared = this.skeletons.find(
                (skeleton) =>
                    skeleton.bones.length === own.bones.length &&
                    skeleton.bones.every((bone, index) => bone === own.bones[index]) &&
                    skeleton.boneInverses.every((inverse, index) =>
                        inverse.equals(own.boneInverses[index])
                    )
            );
            if (shared) object.skeleton = shared;
            else this.skeletons.push(own);
        });
        this.effects = new EffectSet(config.hitEffect ? [config.hitEffect] : [], { meshes });
        this.animator = new CharacterAnimator(
            this.modelInstance,
            config.model.animations,
            config.model.rootMotion
        );
        this.animator.setLocomotion(config.freeLocomotion);

        this.motor = new CharacterMotor(
            config.context.physicsWorld,
            config.motor,
            config.spawnPosition
        );
        this.proceduralRig = new ProceduralRig(this.modelInstance, this.sceneObject, this.motor);
        this.vitals = new Vitals(config.vitals);
        this.moveStateMachine = new MoveStateMachine(config.moveSet, (clip) =>
            this.animator.durationOf(clip)
        );
        this.moveStateInput = {
            deltaSeconds: 0,
            realDeltaSeconds: 0,
            heavyHeld: false,
            isSprinting: false,
            isLockedTargetFar: false,
            hasDirectionalInput: false,
            dodgeSide: null,
            isGrounded: true,
            stance: "drawn",
            spendStamina: (cost) => this.vitals.trySpendStamina(cost),
        };
        this.attackExecutor = new AttackExecutor(this, config.context);

        this.hurtbox = { start: new Vector3(), end: new Vector3(), radius: config.motor.radius };
        this.parryCapsule = { start: new Vector3(), end: new Vector3(), radius: 0 };
        this.hurtboxes = [this.hurtbox, this.parryCapsule];
        this.boundingRadius = config.motor.height / 2 + config.motor.radius;
        this.updateHurtbox(this.sceneObject.position);

        config.context.combatRegistry.register(this);
    }

    abstract get attackPower(): number;

    get isDead(): boolean {
        return this.vitals.isDead;
    }

    get isStaggered(): boolean {
        return this.moveStateMachine.state === "staggered";
    }

    get isReeling(): boolean {
        return (
            this.moveStateMachine.state === "reaction" ||
            this.moveStateMachine.state === "staggered"
        );
    }

    get isAttacking(): boolean {
        const move = this.moveStateMachine.activeMove;
        return move !== null && isStrikeMove(move);
    }

    get healthFraction(): number {
        return this.vitals.healthFraction;
    }

    get awareness(): AwarenessState {
        return "alert";
    }

    get yaw(): number {
        return this.sceneObject.rotation.y;
    }

    get bodyRadius(): number {
        return this.hurtbox.radius;
    }

    get position(): Vector3 {
        return this.motor.position;
    }

    get isInFinisher(): boolean {
        return this.moveStateMachine.state === "finisher";
    }

    get activeMoveId(): string | null {
        return this.moveStateMachine.activeMove?.id ?? null;
    }

    protected get isJumping(): boolean {
        return this.moveStateMachine.output.move?.tags.includes("jump") === true;
    }

    private get canTurnFreely(): boolean {
        return this.moveStateMachine.output.allowsLocomotion || this.isJumping;
    }

    get currentTarget(): ICombatant | null {
        return this.target;
    }

    protected get liveTarget(): ICombatant | null {
        const target = this.target;
        return target && !target.isDead ? target : null;
    }

    get attackThreat(): IAttackThreat | null {
        return this.moveStateMachine.attackThreat(this.reusableAttackThreat);
    }

    get disposed(): boolean {
        return this.isDisposed;
    }

    get displayName(): string {
        return this.id;
    }

    get canBeCounterKilled(): boolean {
        return false;
    }

    get stance(): Stance {
        return this.weapon && this.weapon.mounted !== "hand" ? "sheathed" : "drawn";
    }

    get stealthVisibility(): number {
        return 1;
    }

    receiveHit(payload: IHitPayload): IHitOutcome {
        const defense = resolveDefense(
            this.snapshotDefender(),
            payload.parryable,
            payload.dodgeOnly,
            COMBAT_TIMING.perfectDodgeSeconds
        );

        if (defense === "ignored" || defense === "evaded")
            return { kind: defense, reaction: "none", damageDealt: 0 };

        if (defense === "perfectEvaded") {
            this.onPerfectEvade();
            return { kind: defense, reaction: "none", damageDealt: 0 };
        }

        if (defense === "parried") return this.handleParry(payload);
        return this.applyHitReaction(payload);
    }

    protected handleParry(payload: IHitPayload): IHitOutcome {
        const parry = this.resolveParry(this.moveStateMachine.output.elapsedSeconds);
        this.vitals.gainFocus(FOCUS.perParry);
        this.context.events.emit("parried", {
            attacker: payload.attacker,
            defender: this,
        });
        this.proceduralRig.applyImpact(
            this.pushDirectionAwayFrom(payload.attacker.sceneObject.position),
            parry.tier === "perfect" ? "parryPerfect" : "parry"
        );
        if (!payload.ranged && payload.attacker instanceof CombatCharacter)
            this.beginMutualBladeContact(payload.attacker);
        if (!payload.ranged) this.onParrySucceeded(payload.attacker, parry, payload.swing);
        return { kind: "parried", reaction: "none", damageDealt: 0, parry };
    }

    protected applyHitReaction(payload: IHitPayload): IHitOutcome {
        const result = this.vitals.applyDamage(
            payload.damage,
            payload.poiseDamage,
            this.isStaggered
        );
        const dealt = result.dealt;
        this.knockBackFrom(payload.origin, payload.knockback);
        this.proceduralRig.applyImpact(
            this.pushDirectionAwayFrom(payload.origin),
            payload.impact === "light" ? "hitLight" : "hitHeavy"
        );
        if (this.hitEffect) this.effects.get(this.hitEffect).play();

        if (result.killed) {
            this.die(payload.attacker, true);
            return { kind: "killed", reaction: "none", damageDealt: dealt };
        }

        if (result.poiseBroken) {
            this.moveStateMachine.stagger(this.vitals.spec.staggerSeconds);
            this.onDamaged(payload, "stagger");
            return { kind: "staggered", reaction: "stagger", damageDealt: dealt };
        }

        const rawReaction = reactionFor(payload.impact, this.defenderSnapshot);
        const reaction = this.ignoredReactions.includes(rawReaction) ? "none" : rawReaction;
        if (reaction !== "none") {
            this.pendingReactionClip = this.pickReactionClip(reaction);
            const clipSeconds = this.animator.durationOf(this.pendingReactionClip);
            this.moveStateMachine.react(
                reaction,
                Math.min(clipSeconds, this.reactionLockout[reaction] ?? clipSeconds),
                this.reactionDodgeCancelSeconds
            );
        }
        this.onDamaged(payload, reaction);
        return { kind: "damaged", reaction, damageDealt: dealt };
    }

    private snapshotDefender(): IDefenderSnapshot {
        const output = this.moveStateMachine.output;
        const inMove = this.moveStateMachine.state === "move";
        const defender = this.defenderSnapshot;
        defender.isDead = this.vitals.isDead;
        defender.isUntouchable = this.isInFinisher;
        defender.isInvulnerable = inMove && output.isInvulnerable;
        defender.isDodging = inMove && output.move !== null && output.move.tags.includes("dodge");
        defender.invulnerableSeconds = output.invulnerableSeconds;
        defender.isParrying = inMove && output.isParrying;
        defender.isArmored = inMove && output.isArmored;
        defender.isStaggered = this.isStaggered;
        return defender;
    }

    private beginMutualBladeContact(attacker: CombatCharacter): void {
        this.proceduralRig.beginBladeContact(
            this,
            attacker,
            this.weaponHand(),
            PROCEDURAL_ANIMATION.bladeContact.maxCorrection
        );
        attacker.proceduralRig.beginBladeContact(
            attacker,
            this,
            attacker.weaponHand(),
            PROCEDURAL_ANIMATION.bladeContact.attackerMaxCorrection
        );
    }

    sampleHitShape(shape: HitShape, segment: ICapsule): boolean {
        if (shape.kind === "weapon") return this.weapon?.getStrikeCapsule(segment) ?? false;

        const bone = this.boneNamed(shape.bone);
        if (!bone) return false;

        bone.getWorldPosition(segment.start);
        segment.end.copy(segment.start);
        segment.radius = shape.radius;
        return true;
    }

    protected equipWeapon(definition: WeaponDefinition): void {
        const template = this.context.assetLibrary.getTemplate(definition.modelPath);
        if (!template) throw new Error(ERRORS.modelNotLoaded("weapon", definition.modelPath));

        const boneNames = HAND_BONES[definition.gripHand];
        const requireBone = (name: string): Object3D => {
            const bone = this.boneNamed(name);
            if (!bone) throw new Error(ERRORS.missingBone(name, this.id));
            return bone;
        };
        const handRig: IHandRig = {
            hand: requireBone(boneNames.hand),
            indexBase: requireBone(boneNames.indexBase),
            middleBase: requireBone(boneNames.middleBase),
            ringBase: requireBone(boneNames.ringBase),
            pinkyBase: this.boneNamed(boneNames.pinkyBase),
            thumbBase: requireBone(boneNames.thumbBase),
        };

        const carryRig: ICarryRig | undefined = definition.carry
            ? { bone: requireBone(definition.carry.bone) }
            : undefined;

        this.weapon?.dispose();
        this.weapon = createWeapon(definition, template, handRig, this.context.sceneRoot, carryRig);
    }

    onHitConfirmed(_defender: ICombatant, _outcome: IHitOutcome, move: IMoveDefinition): void {
        this.vitals.gainFocus(move.focusGain);
    }

    onAttackParried(defender: ICombatant, parry: IParryResult, swing: SwingDirection): void {
        this.proceduralRig.applyImpact(
            this.pushDirectionAwayFrom(defender.sceneObject.position),
            parry.tier === "perfect" ? "guardBroken" : "recoil"
        );
        this.pendingStaggerClip = this.moveSet.reactions.parried[parry.tier][swing];
        this.pendingStaggerIsParried = true;
        this.vitals.breakPoise();
        this.moveStateMachine.stagger(parry.staggerSeconds);
        if (parry.knockback === 0 || this.isInFinisher) return;

        this.knockBackFrom(defender.sceneObject.position, parry.knockback);
    }

    beginFinisher(role: FinisherRole): void {
        this.moveStateMachine.enterFinisher();
        this.motor.stop();
        if (role === "victim") this.motor.disableCollision();
        this.setFinisherClip(null);
        this.rootMotionAccumulator.set(0, 0, 0);
    }

    playFinisherLoop(clip: string, yaw: number): void {
        this.faceImmediately(yaw);
        this.setFinisherClip(null);
        this.animator.playOneShot(clip, CombatCharacter.FINISHER_LOOP_PLAYBACK);
    }

    playFinisherClip(
        clip: string,
        yaw: number,
        blendInSeconds = CombatCharacter.FINISHER_PLAYBACK.fadeSeconds
    ): void {
        this.faceImmediately(yaw);
        this.setFinisherClip(clip);
        this.animator.playOneShot(clip, {
            ...CombatCharacter.FINISHER_PLAYBACK,
            fadeSeconds: blendInSeconds,
        });
    }

    setFinisherClipTime(clipSeconds: number): void {
        const clip = this.finisherClip;
        if (!clip) return;

        const time = this.accumulateRootMotion(clip, this.finisherClipTime, clipSeconds);
        this.animator.setOneShotTime(time);
        this.finisherClipTime = time;
    }

    moveInFinisher(delta: Vector3): void {
        this.rootMotionAccumulator.x += delta.x;
        this.rootMotionAccumulator.z += delta.z;
    }

    setFinisherYaw(yaw: number): void {
        this.faceImmediately(yaw);
    }

    placeAt(position: Vector3, yaw: number): void {
        this.motor.teleport(position);
        this.sceneObject.position.copy(position);
        this.faceImmediately(yaw);
    }

    endFinisher(): void {
        this.finisherClip = null;
        if (!this.isInFinisher) return;

        this.moveStateMachine.exitFinisher();
        this.motor.enableCollision();
        this.animator.returnToLocomotion(CombatCharacter.FINISHER_RETURN_FADE);
    }

    finishOff(killer: ICombatant, deathClip?: string): void {
        if (this.isDead) return;
        this.die(
            killer,
            this.finisherClip === null,
            deathClip ?? this.moveSet.reactions.finisherDeath
        );
    }

    clipDuration(clip: string): number {
        return this.animator.durationOf(clip);
    }

    fixedUpdate(fixedTimestep: number): void {
        this.previousFacingYaw = this.facingYaw;
        const deltaSeconds = fixedTimestep * this.context.timeDilation.hitstopTimeScale(this);

        if (this.isInFinisher) {
            this.tickFinisher(deltaSeconds);
            this.commitAccumulatedMotion(deltaSeconds, false);
            return;
        }

        if (this.vitals.isDead) {
            this.advanceDeathRootMotion(deltaSeconds);
            this.commitAccumulatedMotion(deltaSeconds, true);
            this.deathElapsed += deltaSeconds;
            this.onDeadTick(this.deathElapsed, this.deathHoldSeconds);
            return;
        }

        this.vitals.tick(deltaSeconds, this.isStaggered);
        this.desiredVelocity.set(0, 0, 0);
        this.decideActions(deltaSeconds);

        const input = this.moveStateInput;
        input.deltaSeconds = deltaSeconds;
        input.realDeltaSeconds =
            fixedTimestep / Math.max(this.context.timeDilation.slowMotionTimeScale, 1e-3);
        input.isGrounded = this.motor.isGrounded;
        input.stance = this.stance;
        input.heavyHeld = this.heavyHeld;
        input.isSprinting = this.isSprinting;
        input.isLockedTargetFar = this.isLockedTargetFar;
        input.hasDirectionalInput = this.hasDirectionalInput;
        input.dodgeSide = this.dodgeSide;

        if (
            !this.motor.isGrounded &&
            this.motor.distanceToGround(COMBAT_MOVEMENT.ledgeSnapDistance) ===
                Number.POSITIVE_INFINITY
        )
            this.moveStateMachine.fall();

        const wasStaggered = this.isStaggered;
        const output = this.moveStateMachine.tick(input);
        if (wasStaggered && !this.isStaggered) this.vitals.refillPoise();
        this.applyMoveStateOutput(output, deltaSeconds);
    }

    private advanceDeathRootMotion(deltaSeconds: number): void {
        const clip = this.deathClip;
        if (!clip) return;

        this.deathClipTime = this.accumulateRootMotion(
            clip,
            this.deathClipTime,
            this.deathClipTime + deltaSeconds
        );
    }

    private accumulateRootMotion(clip: string, fromSeconds: number, toSeconds: number): number {
        const clampedToSeconds = Math.min(toSeconds, this.animator.durationOf(clip));
        this.animator.sampleRootMotion(
            clip,
            fromSeconds,
            clampedToSeconds,
            this.facingYaw,
            CombatCharacter.scratchRootMotion
        );
        CombatCharacter.scratchRootMotion.y = 0;
        this.rootMotionAccumulator.add(CombatCharacter.scratchRootMotion);
        return clampedToSeconds;
    }

    private setFinisherClip(clip: string | null): void {
        this.finisherClip = clip;
        this.finisherClipTime = 0;
    }

    private commitAccumulatedMotion(deltaSeconds: number, followsGround: boolean): void {
        const displacement = this.rootMotionAccumulator;
        if (this.motor.isCollidable)
            this.motor.step(deltaSeconds, CombatCharacter.ZERO_VELOCITY, displacement);
        else if (displacement.lengthSq() === 0) this.motor.holdPosition();
        else if (followsGround) this.motor.translateOnGround(displacement);
        else this.motor.translate(displacement);
        displacement.set(0, 0, 0);
    }

    afterPhysicsStep(): void {
        this.motor.syncPositionFromPhysics();
    }

    update(deltaSeconds: number, interpolationAlpha: number): void {
        const scale = this.context.timeDilation.hitstopTimeScale(this);
        const position = this.motor.interpolate(interpolationAlpha);
        this.sceneObject.position.copy(position);
        const isInFinisher = this.isInFinisher;
        const resolvedSpeed = horizontalLength(this.motor.contact.resolvedVelocity);

        if (!this.isDead && !isInFinisher) {
            if (this.moveStateMachine.state === "move" && !this.canTurnFreely) {
                this.sceneObject.rotation.y =
                    this.previousFacingYaw +
                    shortestAngleBetween(this.previousFacingYaw, this.facingYaw) *
                        interpolationAlpha;
            } else {
                const turn = smoothingFactor(this.turnSmoothing * deltaSeconds, scale);
                this.sceneObject.rotation.y +=
                    shortestAngleBetween(this.sceneObject.rotation.y, this.facingYaw) * turn;
            }
            this.updateLocomotionAnimation(resolvedSpeed);
        }

        this.proceduralRig.restoreAnimatedPose();
        this.animator.update(deltaSeconds * scale, interpolationAlpha);
        const frame = this.proceduralFrame;
        frame.deltaSeconds = deltaSeconds * scale;
        const detailDistance = this.sceneObject.position.distanceTo(
            this.context.combatRegistry.detailCentre
        );
        frame.detail =
            this.isDead || isInFinisher
                ? "none"
                : CombatCharacter.detailForDistance(
                      detailDistance,
                      PROCEDURAL_ANIMATION.lod.fullMetres,
                      PROCEDURAL_ANIMATION.lod.impactMetres,
                      CombatCharacter.ANIMATION_DETAILS
                  );
        frame.physicsDetail = CombatCharacter.detailForDistance(
            detailDistance,
            PHYSICS.lod.fullMetres,
            PHYSICS.lod.reducedMetres,
            CombatCharacter.PHYSICS_DETAILS
        );
        if (this.physicsFreezeSeconds > 0) {
            this.physicsFreezeSeconds -= deltaSeconds;
            frame.physicsDetail = "frozen";
        }
        if (isInFinisher && !this.wasInFinisher) this.proceduralRig.resetPhysics();
        this.wasInFinisher = isInFinisher;
        frame.weaponHand = this.weaponHand();
        frame.twoHandGripWeight = this.twoHandGripWeight();
        frame.grounded = this.motor.isGrounded;
        frame.plantFeet = !(resolvedSpeed > CombatCharacter.MIN_MOVING_SPEED);
        frame.lookTarget = this.liveTarget?.position ?? this.weaponGazePoint();
        this.proceduralRig.update(frame);
        this.updateHurtbox(position);
        this.effects.update(deltaSeconds);
        this.weapon?.update(
            deltaSeconds,
            this.attackExecutor.isWeaponStriking && this.moveStateMachine.state === "move"
        );
    }

    dispose(): void {
        this.isDisposed = true;
        this.context.combatRegistry.unregister(this);
        this.context.timeDilation.clearHitstop(this);
        this.weapon?.dispose();
        this.effects.dispose();
        this.animator.dispose();
        for (const skeleton of this.skeletons) skeleton.dispose();
        this.proceduralRig.dispose();
        this.motor.dispose();
    }

    protected abstract decideActions(deltaSeconds: number): void;

    protected onMoveStarted(_move: IMoveDefinition): void {}

    private weaponGazePoint(): Vector3 | null {
        if (!this.animator.isLookingAtWeapon || !this.getBladeSegment(this.gazeHilt, this.gazeTip))
            return null;
        return this.gazeHilt.lerp(this.gazeTip, CombatCharacter.WEAPON_LOOK_POINT_BLADE_FRACTION);
    }

    getBladeSegment(hilt: Vector3, tip: Vector3): boolean {
        return this.weapon?.getBladeSegment(hilt, tip) ?? false;
    }

    protected weaponHand(): Handedness {
        return this.weapon?.spec.gripHand ?? "right";
    }

    protected pushDirectionAwayFrom(source: Vector3): Vector3 {
        const position = this.sceneObject.position;
        CombatCharacter.scratchPush.set(position.x - source.x, 0, position.z - source.z);
        if (CombatCharacter.scratchPush.lengthSq() < 1e-8)
            forwardFromYaw(this.facingYaw, CombatCharacter.scratchPush);
        return CombatCharacter.scratchPush.normalize();
    }

    private twoHandGripWeight(): number {
        if (this.moveStateMachine.state !== "move") return 0;
        const output = this.moveStateMachine.output;
        const grip = output.move?.procedural?.grip;
        if (!grip) return 0;
        const secondsOutsideGripWindow = Math.max(
            grip.from * output.moveSeconds - output.elapsedSeconds,
            output.elapsedSeconds - grip.to * output.moveSeconds,
            0
        );
        return clamp(1 - secondsOutsideGripWindow / PROCEDURAL_ANIMATION.grip.rampSeconds, 0, 1);
    }

    protected onDamaged(_payload: IHitPayload, _reaction: ReactionTier): void {}

    protected resolveParry(_elapsedSeconds: number): IParryResult {
        return PARRY.enemyParryResult;
    }

    protected onParrySucceeded(
        _attacker: ICombatant,
        _parry: IParryResult,
        _swing: SwingDirection
    ): void {}

    protected onKilled(_killer: ICombatant | null): void {}

    protected onDeadTick(_elapsed: number, _holdSeconds: number): void {}

    protected freezeBonePhysics(seconds: number): void {
        this.physicsFreezeSeconds = seconds;
    }

    protected tickFinisher(_deltaSeconds: number): void {}

    protected onPerfectEvade(): void {
        this.vitals.gainFocus(FOCUS.perPerfectDodge);
        if (this.team === "player")
            this.context.timeDilation.requestSlowMotion(SLOW_MOTION.perfectDodge);
    }

    protected faceImmediately(yaw: number): void {
        this.facingYaw = yaw;
        this.previousFacingYaw = yaw;
        this.sceneObject.rotation.y = yaw;
    }

    protected die(killer: ICombatant | null, playDeathClip: boolean, deathClip?: string): void {
        if (this.moveStateMachine.state === "dead") return;

        this.vitals.kill();
        this.moveStateMachine.die();
        this.motor.stop();
        this.motor.disableCollision();
        this.deathElapsed = 0;

        if (playDeathClip) {
            const clip = deathClip ?? pickRandom(this.moveSet.reactions.deaths);
            this.animator.playOneShot(clip, CombatCharacter.DEATH_PLAYBACK);
            this.deathHoldSeconds = this.animator.durationOf(clip);
            this.deathClip = clip;
            this.deathClipTime = 0;
        } else {
            this.deathClip = null;
            this.deathHoldSeconds = this.finisherClip
                ? Math.max(0, this.animator.durationOf(this.finisherClip) - this.finisherClipTime)
                : 0;
        }

        this.context.events.emit("killed", { combatant: this, killer });
        this.onKilled(killer);
    }

    private applyMoveStateOutput(output: IMoveStateOutput, deltaSeconds: number): void {
        if (output.moveStarted && output.move) this.beginMove(output.move);
        if (output.reactionStarted) {
            this.animator.playOneShot(this.pendingReactionClip, CombatCharacter.REACTION_PLAYBACK);
        }

        if (output.staggerStarted) {
            this.animator.playOneShot(
                this.pendingStaggerClip ?? this.moveSet.reactions.stagger,
                this.pendingStaggerIsParried
                    ? CombatCharacter.PARRIED_PLAYBACK
                    : CombatCharacter.STAGGER_PLAYBACK
            );
            this.pendingStaggerClip = null;
            this.pendingStaggerIsParried = false;
        }

        if (output.returnedToLocomotion)
            this.animator.returnToLocomotion(COMBAT_TIMING.locomotionReturnFade);

        if (output.mountTarget) this.weapon?.mount(output.mountTarget);

        let displacement: Vector3 | null = null;
        const move = output.move;
        if (!move) this.transferMomentumToMotor();
        else {
            const clipSeconds = this.animator.durationOf(move.clip);
            if (!move.loop) this.animator.setOneShotTime(output.progress * clipSeconds);

            const attackWarningAt = attackWarningTime(move, output.moveSecondsDuringWindup);
            if (
                attackWarningAt !== null &&
                ((output.moveStarted && attackWarningAt === 0) ||
                    hasCrossed(attackWarningAt, output.previousProgress, output.progress))
            )
                this.emitAttackWarning(move);

            this.attackExecutor.checkHitWindows(move, output);
            if (this.isInFinisher || this.isDead) return;

            if (this.moveStateMachine.activeMove === move) {
                const projectile = move.projectile;
                if (
                    projectile &&
                    hasCrossed(projectile.at, output.previousProgress, output.progress)
                )
                    this.launchProjectile(projectile);

                this.turnTowardsTargetDuringMove(move, output.progress, deltaSeconds);
                displacement = this.moveDisplacement(move, output, clipSeconds, deltaSeconds);
            }
        }

        const velocity = this.velocityForCurrentMove(move, output);
        this.updateFacing(velocity);
        this.motor.setAutostep(this.moveStateMachine.state === "locomotion");
        this.motor.step(
            deltaSeconds,
            velocity,
            displacement,
            move !== null && move.motion !== "physics"
        );

        if (displacement && deltaSeconds > 0)
            this.moveVelocity.set(displacement.x / deltaSeconds, 0, displacement.z / deltaSeconds);
        else this.moveVelocity.set(0, 0, 0);
    }

    private moveDisplacement(
        move: IMoveDefinition,
        output: IMoveStateOutput,
        clipSeconds: number,
        deltaSeconds: number
    ): Vector3 | null {
        if (move.motion === "physics") return null;

        const displacement = CombatCharacter.scratchRootMotion.set(0, 0, 0);
        const contact = this.motor.contact;
        const isBlockedHeadOn = output.previousProgress > 0 && contact.isHeadOn;
        if (move.motion === "rootMotion") {
            if (
                !this.isRootMotionBlocked &&
                move.tags.includes("dodge") &&
                isBlockedHeadOn &&
                contact.movedFraction < BODY_CONTACT.stalledFraction
            ) {
                this.isRootMotionBlocked = true;
                this.moveStateMachine.forceCancelsOpen();
            }
            if (!this.isRootMotionBlocked) {
                this.animator.sampleRootMotion(
                    move.clip,
                    output.previousProgress * clipSeconds,
                    output.progress * clipSeconds,
                    this.facingYaw,
                    displacement
                );
                displacement.y = 0;
                displacement.multiplyScalar(move.rootMotionScale);
            }
        } else if (this.momentumSpeed > 0 && output.allowsLocomotion && this.hasDirectionalInput) {
            this.transferMomentumToMotor();
        } else if (this.momentumSpeed > 0) {
            const reach = move.momentum?.poseReach;
            if (isBlockedHeadOn || (reach !== undefined && this.isLowObstacleAhead(reach))) {
                this.momentumSpeed = 0;
                if (move.blockedInto) this.moveStateMachine.startMove(move.blockedInto, true);
            } else {
                const glideDistance = this.momentumSpeed * deltaSeconds;
                forwardFromYaw(this.facingYaw, displacement, glideDistance);
                this.momentumSpeed = Math.max(
                    0,
                    this.momentumSpeed - (move.momentum?.deceleration ?? 0) * deltaSeconds
                );
            }
        }

        this.attackExecutor.applyGapClose(
            move,
            output.previousProgress,
            output.progress,
            displacement,
            deltaSeconds
        );
        return displacement;
    }

    protected isLowObstacleAhead(reach: number): boolean {
        forwardFromYaw(this.facingYaw, CombatCharacter.scratchForward);
        return this.motor.isWallAhead(
            CombatCharacter.scratchForward.x,
            CombatCharacter.scratchForward.z,
            reach + BODY_CONTACT.lowProbeMargin,
            BODY_CONTACT.lowProbeHeightFraction
        );
    }

    private transferMomentumToMotor(): void {
        if (this.momentumSpeed <= 0) return;
        forwardFromYaw(this.facingYaw, this.motor.velocity, this.momentumSpeed);
        this.momentumSpeed = 0;
    }

    private velocityForCurrentMove(
        move: IMoveDefinition | null,
        output: IMoveStateOutput
    ): Vector3 {
        if (output.allowsLocomotion) return this.desiredVelocity;
        if (!move || move.motion !== "physics") return CombatCharacter.ZERO_VELOCITY;

        const velocity = this.motor.velocity;
        const inputSpeed = horizontalLength(this.desiredVelocity);
        if (!this.hasDirectionalInput || inputSpeed < COMBAT_MOVEMENT.minimumPlanarLength) {
            if (this.motor.isGrounded && move.launch === undefined)
                return CombatCharacter.ZERO_VELOCITY;
            return CombatCharacter.scratchDesired.set(velocity.x, 0, velocity.z);
        }

        const speed = Math.max(horizontalLength(velocity), inputSpeed);
        return CombatCharacter.scratchDesired
            .copy(this.desiredVelocity)
            .multiplyScalar(speed / inputSpeed);
    }

    private beginMove(move: IMoveDefinition): void {
        const carriedVelocity =
            this.moveVelocity.lengthSq() > 0 ? this.moveVelocity : this.motor.velocity;
        const carriedVelocityX = carriedVelocity.x;
        const carriedVelocityZ = carriedVelocity.z;

        if (move.motion === "physics")
            this.motor.velocity.set(carriedVelocityX, 0, carriedVelocityZ);
        else this.motor.velocity.set(0, 0, 0);
        this.momentumSpeed =
            move.motion === "momentum" ? Math.hypot(carriedVelocityX, carriedVelocityZ) : 0;
        this.isRootMotionBlocked = false;
        if (move.launch !== undefined) this.motor.jump(move.launch);

        this.previousFacingYaw = this.sceneObject.rotation.y;
        this.onMoveStarted(move);
        this.attackExecutor.begin(
            move,
            this.target,
            move.spendsFocus ? this.vitals.spendFocus() : 0
        );
        const playback = this.movePlayback;
        playback.fadeSeconds = move.fadeSeconds;
        playback.loop = move.loop ?? false;
        playback.timeSetByCaller = !move.loop;
        this.animator.playOneShot(move.clip, playback);
    }

    private turnTowardsTargetDuringMove(
        move: IMoveDefinition,
        time: number,
        deltaSeconds: number
    ): void {
        const target = this.liveTarget;
        if (!target || !move.tracking || !isWithin(move.tracking, time)) return;

        const desired = yawTowards(this.sceneObject.position, target.position);
        const step = Math.min(1, move.tracking.turnRate * deltaSeconds);
        this.facingYaw += shortestAngleBetween(this.facingYaw, desired) * step;
    }

    private updateFacing(velocity: Vector3): void {
        if (!this.canTurnFreely) return;

        const target = this.liveTarget;
        if (this.facesTarget && target) {
            this.facingYaw = yawTowards(this.sceneObject.position, target.position);
            return;
        }

        if (horizontalLength(velocity) > CombatCharacter.MIN_MOVING_SPEED)
            this.facingYaw = yawFromDirection(velocity.x, velocity.z);
    }

    private updateLocomotionAnimation(resolvedSpeed: number): void {
        const velocity = this.motor.velocity;
        const intendedSpeed = horizontalLength(velocity);
        const speed = Math.min(intendedSpeed, resolvedSpeed);
        const scale = intendedSpeed > 0 ? speed / intendedSpeed : 0;
        const yaw = this.sceneObject.rotation.y;
        const cosine = Math.cos(yaw);
        const sine = Math.sin(yaw);
        const forward = (velocity.x * sine + velocity.z * cosine) * scale;
        const right = (-velocity.x * cosine + velocity.z * sine) * scale;
        const sheathedLocomotionChoice =
            this.stance === "sheathed" ? this.sheathedLocomotion : null;
        const strafe =
            this.facesTarget && !this.isSprinting && !sheathedLocomotionChoice
                ? this.strafeLocomotion
                : null;

        this.animator.setLocomotion(
            this.locomotionOverride ?? strafe ?? sheathedLocomotionChoice ?? this.freeLocomotion
        );
        this.animator.setLocomotionInput(right, forward, speed);
    }

    private launchProjectile(launch: IProjectileLaunch): void {
        const socket = this.boneNamed(launch.socket);
        if (socket) socket.getWorldPosition(CombatCharacter.scratchLaunchOrigin);
        else CombatCharacter.scratchLaunchOrigin.copy(this.position);

        const hurtbox = this.liveTarget?.hurtboxes[0];
        if (hurtbox)
            CombatCharacter.scratchLaunchAim
                .addVectors(hurtbox.start, hurtbox.end)
                .multiplyScalar(0.5);
        else
            forwardFromYaw(this.facingYaw, CombatCharacter.scratchLaunchAim).add(
                CombatCharacter.scratchLaunchOrigin
            );

        this.context.projectiles.launch(
            this,
            launch.kind,
            CombatCharacter.scratchLaunchOrigin,
            CombatCharacter.scratchLaunchAim
        );
    }

    private emitAttackWarning(move: IMoveDefinition): void {
        const event = this.attackWarningEvent;
        event.moveId = move.id;
        event.danger = attackWarningDanger(move);
        const firstHit = move.hits[0];
        if (firstHit) event.shape = firstHit.shape;
        else if (move.projectile) {
            this.projectileSocketShape.bone = move.projectile.socket;
            event.shape = this.projectileSocketShape;
        }
        this.context.events.emit("attackWarning", event);
    }

    private pickReactionClip(tier: ReactionTier): string {
        const clips = this.reactionClipsByTier[tier];
        return clips.length > 0 ? pickRandom(clips) : this.moveSet.reactions.stagger;
    }

    private knockBackFrom(source: Vector3, strength: number): void {
        const length = horizontalDirection(
            source,
            this.sceneObject.position,
            CombatCharacter.scratchPush
        );
        if (length < COMBAT_MOVEMENT.minimumPlanarLength) return;

        this.motor.addKnockback(
            CombatCharacter.scratchPush.x,
            CombatCharacter.scratchPush.z,
            strength
        );
    }

    private updateHurtbox(position: Vector3): void {
        const halfSpan = Math.max(this.bodyHeight / 2 - this.hurtbox.radius, 0);
        this.hurtbox.start.set(position.x, position.y - halfSpan, position.z);
        this.hurtbox.end.set(position.x, position.y + halfSpan, position.z);

        const guarding =
            this.moveStateMachine.state === "move" &&
            this.moveStateMachine.output.isParrying &&
            this.getBladeSegment(this.parryCapsule.start, this.parryCapsule.end);
        if (guarding) this.parryCapsule.radius = PARRY.guardRadius;
        else {
            this.parryCapsule.start.copy(position);
            this.parryCapsule.end.copy(position);
            this.parryCapsule.radius = 0;
        }
    }

    private boneNamed(name: string): Object3D | null {
        const cached = this.bonesByName.get(name);
        if (cached !== undefined) return cached;

        const bone = this.modelInstance.getObjectByName(name) ?? null;
        this.bonesByName.set(name, bone);
        return bone;
    }
}
