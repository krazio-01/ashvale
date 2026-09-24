import { Group, Mesh, MeshBasicMaterial, SkinnedMesh, Vector3 } from "three";
import type { Material, Object3D, Skeleton, Vector3Tuple } from "three";
import { clone as cloneSkinnedModel } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ActionMachine } from "@/systems/combat/actions/ActionMachine";
import type { IMachineInput, IMachineOutput } from "@/systems/combat/actions/ActionMachine";
import { CharacterMotor } from "@/systems/combat/core/CharacterMotor";
import type { IMotorSpec } from "@/systems/combat/core/CharacterMotor";
import { AttackExecutor } from "@/systems/combat/hit/AttackExecutor";
import type { IAttackOwner } from "@/systems/combat/hit/AttackExecutor";
import type {
    IPairedParticipant,
    PairedRole,
} from "@/systems/combat/finishers/PairedAnimationDirector";
import { reactionFor, resolveDefense } from "@/systems/combat/hit/HitResolver";
import type { IDefenderSnapshot } from "@/systems/combat/hit/HitResolver";
import { hasCrossed, isWithin } from "@/systems/combat/actions/MoveTimeline";
import { Vitals } from "@/systems/combat/core/Vitals";
import type { IVitalsSpec } from "@/systems/combat/core/Vitals";
import { CharacterAnimator } from "@/entities/characters/CharacterAnimator";
import type {
    IFreeLocomotion,
    IOneShotOptions,
    IStrafeLocomotion,
    LocomotionDefinition,
} from "@/entities/characters/CharacterAnimator";
import { createWeapon } from "@/entities/weapons/createWeapon";
import type { Weapon } from "@/entities/weapons/Weapon";
import { HAND_BONES } from "@/constants/characters";
import { COMBAT_TIMING, FOCUS, MOVEMENT, SLOW_MOTION } from "@/constants/combat";
import { angleDelta } from "@/lib/helpers";
import type {
    AwarenessState,
    HitShape,
    ICapsule,
    ICombatant,
    IHitOutcome,
    IHitPayload,
    IMoveDefinition,
    IMoveSet,
    ReactionTier,
    Team,
    VictimRig,
    IStrikeSegment,
} from "@/types/combat";
import type { IHandRig, WeaponDefinition } from "@/types/weapons";
import type { ISkinnedModel, IWorldContext, IWorldEntity } from "@/types/world";

export interface ICombatCharacterConfig {
    id: string;
    team: Team;
    context: IWorldContext;
    model: ISkinnedModel;
    motor: IMotorSpec;
    vitals: IVitalsSpec;
    moveSet: IMoveSet;
    freeLocomotion: IFreeLocomotion;
    strafeLocomotion: IStrafeLocomotion | null;
    victimRig: VictimRig;
    turnSmoothing: number;
    modelYawOffset: number;
    spawnPosition: Vector3Tuple;
    spawnYaw: number;
    flashesOnHit: boolean;
}

const flashMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const STILL = new Vector3();
const MOVING_SPEED = 0.15;
const scratchRootMotion = new Vector3();
const scratchDesired = new Vector3();

const REACTION_PLAYBACK: IOneShotOptions = {
    fadeSeconds: COMBAT_TIMING.reactionFade,
    loop: false,
    driven: false,
    rate: 1,
};
const STAGGER_PLAYBACK: IOneShotOptions = { fadeSeconds: 0.08, loop: true, driven: false, rate: 1 };
const DEATH_PLAYBACK: IOneShotOptions = {
    fadeSeconds: COMBAT_TIMING.deathFade,
    loop: false,
    driven: false,
    rate: 1,
};
const PAIRED_PLAYBACK: IOneShotOptions = { fadeSeconds: 0.1, loop: false, driven: true, rate: 1 };
const PAIRED_LOOP_PLAYBACK: IOneShotOptions = {
    fadeSeconds: 0.12,
    loop: true,
    driven: false,
    rate: 1,
};
const PAIRED_RETURN_FADE = 0.25;

function yawTowards(from: Vector3, to: Vector3): number {
    return Math.atan2(to.x - from.x, to.z - from.z);
}

function collectSkeletons(root: Object3D): Skeleton[] {
    const skeletons: Skeleton[] = [];
    root.traverse((object) => {
        if (object instanceof SkinnedMesh) skeletons.push(object.skeleton);
    });
    return skeletons;
}

function collectMeshes(root: Object3D): Mesh[] {
    const meshes: Mesh[] = [];
    root.traverse((object) => {
        if (object instanceof Mesh) meshes.push(object);
    });
    return meshes;
}

export abstract class CombatCharacter implements IWorldEntity, IAttackOwner, IPairedParticipant {
    readonly id: string;
    readonly team: Team;
    readonly victimRig: VictimRig;
    readonly sceneObject = new Group();
    readonly vitals: Vitals;
    readonly machine: ActionMachine;
    readonly hurtboxes: readonly ICapsule[];
    readonly broadRadius: number;

    protected readonly context: IWorldContext;
    protected readonly motor: CharacterMotor;
    protected readonly animator: CharacterAnimator;
    protected readonly modelInstance: Object3D;
    protected readonly moveSet: IMoveSet;
    protected readonly desiredVelocity = new Vector3();
    protected readonly executor: AttackExecutor;
    protected weapon: Weapon | null = null;
    protected target: ICombatant | null = null;
    protected facingYaw: number;
    protected facesTarget = false;
    protected isSprinting = false;
    protected heavyHeld = false;
    protected hasDirectionalInput = false;
    protected locomotionOverride: LocomotionDefinition | null = null;

    private readonly hurtbox: ICapsule;
    private readonly bodyHeight: number;
    private readonly turnSmoothing: number;
    private readonly freeLocomotion: IFreeLocomotion;
    private readonly strafeLocomotion: IStrafeLocomotion | null;
    private readonly flashesOnHit: boolean;
    private readonly skeletons: Skeleton[];
    private readonly meshes: Mesh[];
    private readonly bonesByName = new Map<string, Object3D>();
    private readonly machineInput: IMachineInput;
    private readonly defender: IDefenderSnapshot = {
        isDead: false,
        isUntouchable: false,
        isInvulnerable: false,
        isDodging: false,
        invulnerableSeconds: 0,
        isParrying: false,
        isArmored: false,
        isStaggered: false,
    };
    private readonly flashOriginals: (Material | Material[])[] = [];
    private isFlashing = false;
    private momentumSpeed = 0;
    private previousFacingYaw: number;
    private readonly moveVelocity = new Vector3();
    private flashRemaining = 0;
    private pendingStaggerClip: string | null = null;
    private deathElapsed = 0;
    private deathHoldSeconds = 0;
    private pairedClip: string | null = null;
    private pairedTime = 0;
    private readonly pairedDisplacement = new Vector3();
    private isDisposed = false;

    protected constructor(config: ICombatCharacterConfig) {
        this.id = config.id;
        this.team = config.team;
        this.victimRig = config.victimRig;
        this.context = config.context;
        this.moveSet = config.moveSet;
        this.bodyHeight = config.motor.height;
        this.turnSmoothing = config.turnSmoothing;
        this.freeLocomotion = config.freeLocomotion;
        this.strafeLocomotion = config.strafeLocomotion;
        this.flashesOnHit = config.flashesOnHit;
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

        this.skeletons = collectSkeletons(this.modelInstance);
        this.meshes = collectMeshes(this.modelInstance);
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
        this.vitals = new Vitals(config.vitals);
        this.machine = new ActionMachine(config.moveSet, (clip) => this.animator.durationOf(clip));
        this.machineInput = {
            deltaSeconds: 0,
            realDeltaSeconds: 0,
            heavyHeld: false,
            isSprinting: false,
            hasDirectionalInput: false,
            isGrounded: true,
            spendStamina: (cost) => this.vitals.trySpendStamina(cost),
        };
        this.executor = new AttackExecutor(this, config.context);

        this.hurtbox = { start: new Vector3(), end: new Vector3(), radius: config.motor.radius };
        this.hurtboxes = [this.hurtbox];
        this.broadRadius = config.motor.height / 2 + config.motor.radius;
        this.updateHurtbox(this.sceneObject.position);

        config.context.combatRegistry.register(this);
    }

    abstract get attackPower(): number;

    get isDead(): boolean {
        return this.vitals.isDead;
    }

    get isStaggered(): boolean {
        return this.machine.state === "staggered";
    }

    get isAttacking(): boolean {
        const move = this.machine.activeMove;
        return move !== null && move.hits.length > 0;
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

    get isPaired(): boolean {
        return this.machine.state === "paired";
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

    get stealthVisibility(): number {
        return 1;
    }

    receiveHit(payload: IHitPayload): IHitOutcome {
        const output = this.machine.output;
        const inMove = this.machine.state === "move";
        const defender = this.defender;

        defender.isDead = this.vitals.isDead;
        defender.isUntouchable = this.machine.state === "paired";
        defender.isInvulnerable = inMove && output.isInvulnerable;
        defender.isDodging = inMove && output.move !== null && output.move.tags.includes("dodge");
        defender.invulnerableSeconds = output.invulnerableSeconds;
        defender.isParrying = inMove && output.isParrying;
        defender.isArmored = inMove && output.isArmored;
        defender.isStaggered = this.vitals.isStaggered;

        const defense = resolveDefense(
            defender,
            payload.parryable,
            COMBAT_TIMING.perfectDodgeSeconds
        );

        if (defense === "ignored" || defense === "evaded")
            return { kind: defense, reaction: "none", damageDealt: 0 };

        if (defense === "perfectEvaded") {
            this.onPerfectEvade(payload.attacker);
            return { kind: defense, reaction: "none", damageDealt: 0 };
        }

        if (defense === "parried") {
            this.vitals.gainFocus(FOCUS.perParry);
            this.context.combatEvents.emit("parried", {
                attacker: payload.attacker,
                defender: this,
            });
            this.onParrySucceeded(payload.attacker);
            return { kind: "parried", reaction: "none", damageDealt: 0 };
        }

        const result = this.vitals.applyDamage(payload.damage, payload.poiseDamage);
        const dealt = result.dealt;
        this.applyKnockback(payload);
        this.flash();

        if (result.killed) {
            this.die(payload.attacker, true);
            return { kind: "killed", reaction: "none", damageDealt: dealt };
        }

        if (result.poiseBroken) {
            this.machine.stagger(this.vitals.staggerSecondsRemaining);
            this.context.combatEvents.emit("staggered", { combatant: this });
            this.onDamaged(payload, "stagger");
            return { kind: "staggered", reaction: "stagger", damageDealt: dealt };
        }

        const reaction = reactionFor(payload.impact, defender);
        if (reaction !== "none")
            this.machine.react(reaction, this.animator.durationOf(this.reactionClip(reaction)));
        this.onDamaged(payload, reaction);
        return { kind: "damaged", reaction, damageDealt: dealt };
    }

    sampleHitShape(shape: HitShape, segment: IStrikeSegment): boolean {
        if (shape.kind === "weapon") return this.weapon?.sampleStrike(segment) ?? false;

        const bone = this.boneNamed(shape.bone);
        if (!bone) return false;

        bone.getWorldPosition(segment.start);
        segment.end.copy(segment.start);
        segment.radius = shape.radius;
        return true;
    }

    protected equipWeapon(definition: WeaponDefinition): void {
        const template = this.context.assetLibrary.getTemplate(definition.modelPath);
        if (!template) throw new Error(`weapon model not loaded: ${definition.modelPath}`);

        const boneNames = HAND_BONES[definition.gripHand];
        const requireBone = (name: string): Object3D => {
            const bone = this.boneNamed(name);
            if (!bone) throw new Error(`no ${name} bone on ${this.id}`);
            return bone;
        };
        const handRig: IHandRig = {
            hand: requireBone(boneNames.hand),
            indexBase: requireBone(boneNames.indexBase),
            middleBase: requireBone(boneNames.middleBase),
            ringBase: requireBone(boneNames.ringBase),
            pinkyBase: requireBone(boneNames.pinkyBase),
            thumbBase: requireBone(boneNames.thumbBase),
        };

        this.weapon?.dispose();
        this.weapon = createWeapon(definition, template, handRig, this.context.sceneRoot);
    }

    onHitConfirmed(_defender: ICombatant, _outcome: IHitOutcome, move: IMoveDefinition): void {
        this.vitals.gainFocus(move.focusGain);
    }

    onAttackParried(_defender: ICombatant): void {
        this.pendingStaggerClip = this.moveSet.reactions.parried;
        this.vitals.stagger(COMBAT_TIMING.parriedStaggerSeconds);
        this.machine.stagger(COMBAT_TIMING.parriedStaggerSeconds);
    }

    beginPaired(role: PairedRole): void {
        this.machine.enterPaired();
        this.motor.stop();
        if (role === "victim") this.motor.disableCollision();
        this.pairedClip = null;
        this.pairedTime = 0;
        this.pairedDisplacement.set(0, 0, 0);
    }

    playPairedLoop(clip: string, yaw: number): void {
        this.faceImmediately(yaw);
        this.pairedClip = null;
        this.pairedTime = 0;
        this.animator.playOneShot(clip, PAIRED_LOOP_PLAYBACK);
    }

    playPaired(clip: string, yaw: number): void {
        this.faceImmediately(yaw);
        this.pairedClip = clip;
        this.pairedTime = 0;
        this.animator.playOneShot(clip, PAIRED_PLAYBACK);
    }

    drivePaired(clipSeconds: number): void {
        const clip = this.pairedClip;
        if (!clip) return;

        const time = Math.min(clipSeconds, this.animator.durationOf(clip));
        this.animator.driveOneShot(time);
        this.animator.sampleRootMotion(
            clip,
            this.pairedTime,
            time,
            this.facingYaw,
            scratchRootMotion
        );
        scratchRootMotion.y = 0;
        this.pairedTime = time;
        this.pairedDisplacement.add(scratchRootMotion);
    }

    movePaired(delta: Vector3): void {
        this.pairedDisplacement.x += delta.x;
        this.pairedDisplacement.z += delta.z;
    }

    setPairedYaw(yaw: number): void {
        this.faceImmediately(yaw);
    }

    placeAt(position: Vector3, yaw: number): void {
        this.motor.teleport(position);
        this.sceneObject.position.copy(position);
        this.faceImmediately(yaw);
    }

    endPaired(): void {
        this.pairedClip = null;
        if (this.machine.state !== "paired") return;

        this.machine.exitPaired();
        this.motor.enableCollision();
        this.animator.returnToLocomotion(PAIRED_RETURN_FADE);
    }

    finishOff(killer: ICombatant): void {
        if (this.isDead) return;
        this.die(killer, this.pairedClip === null, this.moveSet.reactions.finisherDeath);
    }

    clipDuration(clip: string): number {
        return this.animator.durationOf(clip);
    }

    fixedUpdate(fixedTimestep: number): void {
        this.previousFacingYaw = this.facingYaw;
        const deltaSeconds = fixedTimestep * this.context.timeDilation.localScale(this);

        if (this.machine.state === "paired") {
            this.tickPaired(deltaSeconds);
            this.commitPairedMotion(deltaSeconds);
            return;
        }

        if (this.vitals.isDead) {
            this.commitPairedMotion(deltaSeconds);
            this.deathElapsed += deltaSeconds;
            this.onDeadTick(this.deathElapsed, this.deathHoldSeconds);
            return;
        }

        this.vitals.tick(deltaSeconds);
        this.desiredVelocity.set(0, 0, 0);
        this.think(deltaSeconds);

        const input = this.machineInput;
        input.deltaSeconds = deltaSeconds;
        input.realDeltaSeconds =
            fixedTimestep / Math.max(this.context.timeDilation.globalScale, 1e-3);
        input.isGrounded = this.motor.isGrounded;
        input.heavyHeld = this.heavyHeld;
        input.isSprinting = this.isSprinting;
        input.hasDirectionalInput = this.hasDirectionalInput;

        if (
            !this.motor.isGrounded &&
            this.motor.groundGap(MOVEMENT.ledgeSnapDistance) === Number.POSITIVE_INFINITY
        )
            this.machine.fall();

        this.applyMachineOutput(this.machine.tick(input), deltaSeconds);
    }

    private commitPairedMotion(deltaSeconds: number): void {
        const displacement = this.pairedDisplacement;
        if (this.motor.isCollidable) this.motor.step(deltaSeconds, STILL, displacement);
        else if (displacement.lengthSq() > 0) this.motor.translate(displacement);
        else this.motor.hold();
        displacement.set(0, 0, 0);
    }

    postStep(): void {
        this.motor.postStep();
    }

    update(deltaSeconds: number, interpolationAlpha: number): void {
        const scale = this.context.timeDilation.localScale(this);
        const position = this.motor.interpolate(interpolationAlpha);
        this.sceneObject.position.copy(position);

        if (!this.isDead && this.machine.state !== "paired") {
            if (this.machine.state === "move" && !this.machine.output.allowsLocomotion) {
                this.sceneObject.rotation.y =
                    this.previousFacingYaw +
                    angleDelta(this.previousFacingYaw, this.facingYaw) * interpolationAlpha;
            } else {
                const turn = 1 - Math.exp(-this.turnSmoothing * deltaSeconds * scale);
                this.sceneObject.rotation.y +=
                    angleDelta(this.sceneObject.rotation.y, this.facingYaw) * turn;
            }
            this.feedLocomotion();
        }

        this.animator.update(deltaSeconds * scale, interpolationAlpha);
        this.updateHurtbox(position);
        this.updateFlash(deltaSeconds);
        this.weapon?.update(
            deltaSeconds,
            this.executor.isWeaponStriking && this.machine.state === "move"
        );
    }

    dispose(): void {
        this.isDisposed = true;
        this.context.combatRegistry.unregister(this);
        this.context.timeDilation.release(this);
        this.weapon?.dispose();
        this.restoreFlash();
        this.animator.dispose();
        for (const skeleton of this.skeletons) skeleton.dispose();
        this.motor.dispose();
    }

    protected abstract think(deltaSeconds: number): void;

    protected onMoveStarted(_move: IMoveDefinition): void {}

    protected onDamaged(_payload: IHitPayload, _reaction: ReactionTier): void {}

    protected onParrySucceeded(_attacker: ICombatant): void {}

    protected onKilled(_killer: ICombatant | null): void {}

    protected onDeadTick(_elapsed: number, _holdSeconds: number): void {}

    protected tickPaired(_deltaSeconds: number): void {}

    protected onPerfectEvade(attacker: ICombatant): void {
        this.vitals.gainFocus(FOCUS.perPerfectDodge);
        this.context.combatEvents.emit("perfectDodge", { dodger: this, attacker });
        if (this.team === "player")
            this.context.timeDilation.requestSlowMotion(SLOW_MOTION.perfectDodge);
    }

    protected faceImmediately(yaw: number): void {
        this.facingYaw = yaw;
        this.previousFacingYaw = yaw;
        this.sceneObject.rotation.y = yaw;
    }

    protected die(killer: ICombatant | null, playDeathClip: boolean, deathClip?: string): void {
        if (this.machine.state === "dead") return;

        this.vitals.kill();
        this.machine.die();
        this.motor.stop();
        this.motor.disableCollision();
        this.deathElapsed = 0;

        if (playDeathClip) {
            const deaths = this.moveSet.reactions.deaths;
            const clip =
                deathClip ?? deaths[Math.floor(Math.random() * deaths.length)] ?? deaths[0] ?? "";
            this.animator.playOneShot(clip, DEATH_PLAYBACK);
            this.deathHoldSeconds = this.animator.durationOf(clip);
        } else {
            this.deathHoldSeconds = this.pairedClip
                ? Math.max(0, this.animator.durationOf(this.pairedClip) - this.pairedTime)
                : 0;
        }

        this.context.combatEvents.emit("killed", { combatant: this, killer });
        this.onKilled(killer);
    }

    private applyMachineOutput(output: IMachineOutput, deltaSeconds: number): void {
        if (output.moveStarted && output.move) this.beginMove(output.move);
        if (output.reactionStarted)
            this.animator.playOneShot(this.reactionClip(output.reactionStarted), REACTION_PLAYBACK);

        if (output.staggerStarted) {
            this.animator.playOneShot(
                this.pendingStaggerClip ?? this.moveSet.reactions.stagger,
                STAGGER_PLAYBACK
            );
            this.pendingStaggerClip = null;
        }

        if (output.returnedToLocomotion)
            this.animator.returnToLocomotion(COMBAT_TIMING.locomotionReturnFade);

        let displacement: Vector3 | null = null;
        const move = output.move;
        if (!move) this.momentumSpeed = 0;

        if (move) {
            const clipSeconds = this.animator.durationOf(move.clip);
            if (!move.loop) this.animator.driveOneShot(output.time * clipSeconds);

            if (hasCrossed(move.telegraphAt, output.previousTime, output.time))
                this.context.combatEvents.emit("telegraph", { combatant: this, moveId: move.id });

            this.executor.process(move, output);
            if (this.machine.state === "paired" || this.isDead) return;

            this.applyTracking(move, output.time, deltaSeconds);
            displacement = this.moveDisplacement(move, output, clipSeconds, deltaSeconds);
        }

        const velocity = this.moveDesiredVelocity(move, output);
        this.updateFacing(velocity, output);
        this.motor.setAutostep(this.machine.state === "locomotion");
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
        output: IMachineOutput,
        clipSeconds: number,
        deltaSeconds: number
    ): Vector3 | null {
        if (move.motion === "physics") return null;

        const displacement = scratchRootMotion.set(0, 0, 0);
        if (move.motion === "rootMotion") {
            this.animator.sampleRootMotion(
                move.clip,
                output.previousTime * clipSeconds,
                output.time * clipSeconds,
                this.facingYaw,
                displacement
            );
            displacement.y = 0;
            displacement.multiplyScalar(move.rootMotionScale);
        } else if (this.momentumSpeed > 0) {
            const glide = this.momentumSpeed * deltaSeconds;
            displacement.set(Math.sin(this.facingYaw) * glide, 0, Math.cos(this.facingYaw) * glide);
            this.momentumSpeed = Math.max(
                0,
                this.momentumSpeed - (move.momentum?.deceleration ?? 0) * deltaSeconds
            );
        }

        this.executor.applyWarp(move, output.previousTime, output.time, displacement, deltaSeconds);
        return displacement;
    }

    private moveDesiredVelocity(move: IMoveDefinition | null, output: IMachineOutput): Vector3 {
        if (output.allowsLocomotion) return this.desiredVelocity;
        if (!move || move.motion !== "physics") return STILL;

        const velocity = this.motor.velocity;
        const inputSpeed = Math.hypot(this.desiredVelocity.x, this.desiredVelocity.z);
        if (!this.hasDirectionalInput || inputSpeed < 1e-4) {
            if (this.motor.isGrounded && move.launch === undefined) return STILL;
            return scratchDesired.set(velocity.x, 0, velocity.z);
        }

        const speed = Math.max(Math.hypot(velocity.x, velocity.z), inputSpeed);
        return scratchDesired.copy(this.desiredVelocity).multiplyScalar(speed / inputSpeed);
    }

    private beginMove(move: IMoveDefinition): void {
        const handover = this.moveVelocity.lengthSq() > 0 ? this.moveVelocity : this.motor.velocity;
        const handoverX = handover.x;
        const handoverZ = handover.z;

        if (move.motion === "physics") this.motor.velocity.set(handoverX, 0, handoverZ);
        else this.motor.velocity.set(0, 0, 0);
        this.momentumSpeed = move.motion === "momentum" ? Math.hypot(handoverX, handoverZ) : 0;
        if (move.launch !== undefined) this.motor.jump(move.launch);

        this.previousFacingYaw = this.sceneObject.rotation.y;
        this.onMoveStarted(move);
        this.executor.begin(move, this.target, move.spendsFocus ? this.vitals.spendFocus() : 0);
        this.animator.playOneShot(move.clip, {
            fadeSeconds: move.fadeSeconds,
            loop: move.loop ?? false,
            driven: !move.loop,
            rate: 1,
        });
    }

    private applyTracking(move: IMoveDefinition, time: number, deltaSeconds: number): void {
        const target = this.target;
        if (!target || target.isDead || !move.tracking || !isWithin(move.tracking, time)) return;

        const desired = yawTowards(this.sceneObject.position, target.sceneObject.position);
        const step = Math.min(1, move.tracking.turnRate * deltaSeconds);
        this.facingYaw += angleDelta(this.facingYaw, desired) * step;
    }

    private updateFacing(velocity: Vector3, output: IMachineOutput): void {
        if (!output.allowsLocomotion) return;

        if (this.facesTarget && this.target && !this.target.isDead) {
            this.facingYaw = yawTowards(
                this.sceneObject.position,
                this.target.sceneObject.position
            );
            return;
        }

        if (Math.hypot(velocity.x, velocity.z) > MOVING_SPEED)
            this.facingYaw = Math.atan2(velocity.x, velocity.z);
    }

    private feedLocomotion(): void {
        const velocity = this.motor.velocity;
        const yaw = this.sceneObject.rotation.y;
        const cosine = Math.cos(yaw);
        const sine = Math.sin(yaw);
        const forward = velocity.x * sine + velocity.z * cosine;
        const right = -velocity.x * cosine + velocity.z * sine;
        const strafe = this.facesTarget && !this.isSprinting ? this.strafeLocomotion : null;

        this.animator.setLocomotion(this.locomotionOverride ?? strafe ?? this.freeLocomotion);
        this.animator.setLocomotionInput(right, forward, Math.hypot(velocity.x, velocity.z));
    }

    private reactionClip(tier: ReactionTier): string {
        const reactions = this.moveSet.reactions;
        if (tier === "knockback") return reactions.knockback;
        if (tier === "knockdown") return reactions.knockdown;
        if (tier === "stagger") return reactions.stagger;
        return reactions.flinch;
    }

    private applyKnockback(payload: IHitPayload): void {
        const dx = this.sceneObject.position.x - payload.origin.x;
        const dz = this.sceneObject.position.z - payload.origin.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-4) return;

        this.motor.addKnockback(dx / length, dz / length, payload.knockback);
    }

    private updateHurtbox(position: Vector3): void {
        const halfSpan = Math.max(this.bodyHeight / 2 - this.hurtbox.radius, 0);
        this.hurtbox.start.set(position.x, position.y - halfSpan, position.z);
        this.hurtbox.end.set(position.x, position.y + halfSpan, position.z);
    }

    private boneNamed(name: string): Object3D | null {
        const cached = this.bonesByName.get(name);
        if (cached) return cached;

        const bone = this.modelInstance.getObjectByName(name) ?? null;
        if (bone) this.bonesByName.set(name, bone);
        return bone;
    }

    private flash(): void {
        if (!this.flashesOnHit) return;

        this.flashRemaining = COMBAT_TIMING.hitFlashSeconds;
        if (this.isFlashing) return;

        const originals = this.flashOriginals;
        for (let index = 0; index < this.meshes.length; index += 1) {
            const mesh = this.meshes[index];
            if (!mesh) continue;
            originals[index] = mesh.material;
            mesh.material = flashMaterial;
        }
        this.isFlashing = true;
    }

    private updateFlash(deltaSeconds: number): void {
        if (this.flashRemaining <= 0) return;

        this.flashRemaining = Math.max(0, this.flashRemaining - deltaSeconds);
        if (this.flashRemaining === 0) this.restoreFlash();
    }

    private restoreFlash(): void {
        if (!this.isFlashing) return;

        const originals = this.flashOriginals;
        for (let index = 0; index < this.meshes.length; index += 1) {
            const mesh = this.meshes[index];
            const original = originals[index];
            if (mesh && original) mesh.material = original;
        }
        this.isFlashing = false;
    }
}
