import { Vector3 } from "three";
import type { Camera, Vector3Tuple } from "three";
import { PHYSICS } from "@/constants/physics";
import type { ICapsuleSource, IMotorSpec } from "@/types/physics";
import { CombatCharacter } from "@/entities/characters/CombatCharacter";
import {
    finisherKindFor,
    isBehind,
    selectFinisher,
} from "@/systems/combat/finishers/FinisherSelector";
import { FINISHERS } from "@/systems/combat/finishers/finishers";
import {
    finisherCentreDistance,
    FinisherSequence,
    FinisherWindows,
} from "@/systems/combat/finishers/FinisherSequence";
import {
    PLAYER_CROUCH_LOCOMOTION,
    PLAYER_FREE_LOCOMOTION,
    PLAYER_SHEATHED_FREE_LOCOMOTION,
    PLAYER_STRAFE_LOCOMOTION,
} from "@/entities/characters/locomotion";
import {
    PLAYER_STARTING_WEAPON,
    CAMERA,
    PLAYER,
    PLAYER_REACTIONS,
    PLAYER_VITALS,
    STAMINA,
    CAMERA_SHAKE,
    CHARGE_SHAKE,
    KILL_CAMERA,
    DODGE,
    PLAYER_MOTOR_TUNING,
} from "@/constants/player";
import { PLAYER_ASSETS } from "@/constants/characters";
import {
    COMBAT_TIMING,
    BODY_CONTACT,
    COMBAT_MOVEMENT,
    FINISHER_RULES,
    PARRY,
    SLOW_MOTION,
    TARGETING,
} from "@/constants/combat";
import { SIGHT } from "@/constants/enemies";
import {
    PARRY_DEFLECTS,
    PLAYER_MOVE_IDS,
    PLAYER_MOVES,
} from "@/systems/combat/moveSets/playerMoves";
import { cycleTarget, selectTarget } from "@/systems/combat/TargetSelector";
import { FootstepNoise } from "@/entities/characters/player/FootstepNoise";
import type { FootstepGait } from "@/entities/characters/player/FootstepNoise";
import { chooseKillCamShot, PlayerCamera } from "@/entities/characters/player/PlayerCamera";
import { PlayerInput } from "@/entities/characters/player/PlayerInput";
import type { IPlayerCommands } from "@/entities/characters/player/PlayerInput";
import { store } from "@/store/store";
import {
    shortestAngleBetween,
    horizontalDirection,
    horizontalDistance,
    yawTowards,
    yawFromDirection,
    forwardFromYaw,
} from "@/lib/helpers";
import type {
    FinisherKind,
    ICombatant,
    IFinisherDefinition,
    IMoveDefinition,
    IParryResult,
    SwingDirection,
} from "@/types/combat";
import type { IWorldContext } from "@/types/world";
import { ERRORS, HUD_TEXT } from "@/constants/strings";

export class Player extends CombatCharacter implements ICapsuleSource {
    private static readonly PLAYER_MOTOR: IMotorSpec = {
        height: PLAYER.height,
        radius: PLAYER.radius,
        ...PLAYER_MOTOR_TUNING,
        pushesDynamicBodies: true,
    };

    private static clearHudTarget(): void {
        store.getState().hud.setTarget(false, "", 0, 0);
    }

    private static readonly cameraForward = new Vector3();

    private static readonly cameraRight = new Vector3();

    private static readonly moveDirection = new Vector3();

    private static readonly killCamFocus = new Vector3();

    private static readonly approachDirection = new Vector3();

    private static readonly mouseDelta = { x: 0, y: 0 };

    private static readonly opponents: ICombatant[] = [];

    private readonly input = new PlayerInput();
    private readonly followCamera: PlayerCamera;
    private readonly finisherSequence: FinisherSequence;
    private readonly footsteps: FootstepNoise;
    private readonly spawnPoint = new Vector3();
    private readonly spawnYaw: number;
    private readonly unsubscribers: (() => void)[] = [];
    private lockTarget: ICombatant | null = null;
    private finisherCandidate: CombatCharacter | null = null;
    private finisherCandidateKind: FinisherKind | null = null;
    private readonly finisherWindows = new FinisherWindows();
    private lastFinisherId: string | null = null;
    private counterKillTarget: ICombatant | null = null;
    private deflectMoveSerial = 0;
    private dodgeYaw = 0;
    private isCrouching = false;
    private isSprintGranted = false;
    private isWinded = false;
    private previousChargeLevel = 0;

    constructor(
        context: IWorldContext,
        camera: Camera,
        spawnPosition: Vector3Tuple,
        spawnYaw: number
    ) {
        const model = context.assetLibrary.getSkinnedModel(PLAYER_ASSETS.modelPath);
        if (!model) throw new Error(ERRORS.modelNotLoaded("character", PLAYER_ASSETS.modelPath));

        super({
            id: "player",
            team: "player",
            context,
            model,
            motor: Player.PLAYER_MOTOR,
            vitals: PLAYER_VITALS,
            moveSet: PLAYER_MOVES,
            freeLocomotion: PLAYER_FREE_LOCOMOTION,
            strafeLocomotion: PLAYER_STRAFE_LOCOMOTION,
            sheathedLocomotion: PLAYER_SHEATHED_FREE_LOCOMOTION,
            victimRig: "humanoid",
            turnSmoothing: PLAYER.turnSmoothing,
            modelYawOffset: PLAYER_ASSETS.modelYawOffset,
            spawnPosition,
            spawnYaw,
            hitEffect: null,
            reactionLockout: PLAYER_REACTIONS.inputLockSeconds,
            ignoredReactions: PLAYER_REACTIONS.ignored,
            reactionDodgeCancelSeconds: PLAYER_REACTIONS.dodgeCancelSeconds,
        });

        this.spawnPoint.fromArray(spawnPosition);
        this.spawnYaw = spawnYaw;
        this.equipWeapon(PLAYER_STARTING_WEAPON);
        this.proceduralRig.attachCapsule(PHYSICS.capsuleSlots.carriedWeapon, this);
        this.followCamera = new PlayerCamera(
            camera,
            context.physicsWorld,
            this.motor.collider,
            spawnYaw + Math.PI
        );
        this.finisherSequence = new FinisherSequence(context);
        this.footsteps = new FootstepNoise(context.events);
        this.subscribeToCombatEvents();
        this.publishVitals();
        store.getState().hud.setHudValue("isPlayerAlive", true);
    }

    get attackPower(): number {
        return this.weapon?.spec.damage ?? PLAYER.unarmedDamage;
    }

    get stealthVisibility(): number {
        return this.isCrouching ? SIGHT.crouchedVisibility : 1;
    }

    worldCapsule(start: Vector3, end: Vector3): number | null {
        return this.weapon?.mounted === "carry" ? this.weapon.worldCapsule(start, end) : null;
    }

    update(deltaSeconds: number, interpolationAlpha: number): void {
        this.context.combatRegistry.detailCentre.copy(this.position);
        this.applyMouseLook();
        super.update(deltaSeconds, interpolationAlpha);
        this.trackKillCam();
        this.shakeCameraWhileCharging();

        const position = this.sceneObject.position;
        this.followCamera.follow(
            deltaSeconds,
            position.x,
            position.y,
            position.z,
            this.isSprinting
        );
    }

    dispose(): void {
        this.finisherSequence.abort();
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.input.dispose();
        store.getState().hud.setHudValue("prompt", null);
        Player.clearHudTarget();
        super.dispose();
    }

    protected decideActions(deltaSeconds: number): void {
        const commands = this.input.read();
        this.finisherWindows.tick(deltaSeconds);
        if (commands.finisher) this.finisherWindows.press();

        this.computeCameraBasis();
        this.updateLock(commands);
        this.computeMovement(commands, deltaSeconds);
        this.handleCrouchPress(commands.crouchPressed);
        if (commands.jump) this.moveStateMachine.queue("jump");
        this.footsteps.tick(deltaSeconds, this.footstepGait(), this.position);
        this.updateFinisherPrompt();
        this.queueCombatActions(commands);
        this.tryCounterKillAfterDeflect();
        this.publishVitals();
    }

    private handleCrouchPress(pressed: boolean): void {
        if (!pressed) return;

        if (this.isSprinting) {
            if (this.isLowObstacleAhead(PLAYER.slidePoseReach)) return;
            this.dodgeYaw = this.facingYaw;
            this.moveStateMachine.queue("slide");
        } else if (this.moveStateMachine.state === "locomotion")
            this.isCrouching = !this.isCrouching;
    }

    protected onMoveStarted(move: IMoveDefinition): void {
        if (move.tags.includes("dodge")) this.faceImmediately(this.dodgeYaw);
    }

    protected resolveParry(elapsedSeconds: number): IParryResult {
        return PARRY.tiers[elapsedSeconds <= PARRY.perfectSeconds ? "perfect" : "parry"];
    }

    protected onParrySucceeded(
        attacker: ICombatant,
        parry: IParryResult,
        swing: SwingDirection
    ): void {
        const parryFeedback = PARRY.tiers[parry.tier];
        this.context.timeDilation.hitstop(this, parryFeedback.hitstopFrames);
        this.context.timeDilation.hitstop(attacker, parryFeedback.hitstopFrames);
        if (parryFeedback.slowMotion)
            this.context.timeDilation.requestSlowMotion(parryFeedback.slowMotion);
        this.followCamera.addShake(parryFeedback.shakeAmount);
        this.target = attacker;
        this.moveStateMachine.startMove(PARRY_DEFLECTS[parry.tier][swing].id, true);
        this.counterKillTarget = parry.tier === "perfect" ? attacker : null;
        this.deflectMoveSerial = this.moveStateMachine.currentMoveSerial;
    }

    private tryCounterKillAfterDeflect(): void {
        const target = this.counterKillTarget;
        if (!target) return;

        const output = this.moveStateMachine.output;
        if (output.moveSerial < this.deflectMoveSerial) return;
        if (output.moveSerial > this.deflectMoveSerial) {
            this.counterKillTarget = null;
            return;
        }
        const counterAt = output.move?.counterAt;
        if (counterAt === undefined || output.progress < counterAt) return;

        this.counterKillTarget = null;
        if (
            target instanceof CombatCharacter &&
            !target.vitals.isDead &&
            !target.isInFinisher &&
            target.canBeCounterKilled &&
            this.startFinisher(target, "counter")
        )
            return;
        this.moveStateMachine.startMove(PLAYER_MOVE_IDS.counter, true);
    }

    placeAt(position: Vector3, yaw: number): void {
        super.placeAt(position, yaw);
        this.followCamera.resetPivot();
    }

    protected tickFinisher(deltaSeconds: number): void {
        this.input.discardPresses();
        this.publishVitals();
        if (!this.finisherSequence.tick(deltaSeconds)) return;

        if (this.finisherSequence.hasKilled) this.finisherWindows.openChainKillWindow();
    }

    protected onKilled(): void {
        this.finisherWindows.reset();
        this.lockTarget = null;
        this.followCamera.setLockPoint(null);
        this.followCamera.endKillCam();
        store.getState().hud.setHudValue("prompt", null);
        store.getState().hud.setHudValue("isPlayerAlive", false);
    }

    protected onDeadTick(elapsed: number, holdSeconds: number): void {
        this.input.discardPresses();
        if (elapsed < holdSeconds + COMBAT_TIMING.respawnDelaySeconds) return;

        this.vitals.restore();
        this.isCrouching = false;
        this.moveStateMachine.revive();
        this.motor.enableCollision();
        this.placeAt(this.spawnPoint, this.spawnYaw);
        this.animator.returnToLocomotion(COMBAT_TIMING.locomotionReturnFade);
        this.freezeBonePhysics(PHYSICS.restart.holdSeconds);
        this.publishVitals();
        store.getState().hud.setHudValue("isPlayerAlive", true);
    }

    private subscribeToCombatEvents(): void {
        const events = this.context.events;

        this.unsubscribers.push(
            events.on("hitLanded", (event) => {
                if (event.attacker === this) {
                    this.followCamera.addShake(CAMERA_SHAKE.shakeByImpact[event.impact]);
                    if (event.impact !== "light") this.followCamera.punchFov();
                }
                if (event.defender === this)
                    this.followCamera.addShake(CAMERA_SHAKE.shakeByImpact[event.impact] * 1.3);
            }),
            events.on("finisherImpact", (event) => {
                if (event.attacker !== this) return;
                this.followCamera.addShake(CAMERA_SHAKE.shakeByImpact.finisher);
                this.followCamera.punchFov();
                this.context.timeDilation.requestSlowMotion(SLOW_MOTION.finisherImpact);
            }),
            events.on("finisherKill", (event) => {
                if (event.attacker === this)
                    this.followCamera.addShake(CAMERA_SHAKE.shakeByImpact.finisher);
            }),
            events.on("killed", (event) => {
                if (event.killer !== this) return;
                this.finisherWindows.openChainKillWindow();
            })
        );
    }

    private applyMouseLook(): void {
        this.input.consumeMouseDelta(Player.mouseDelta);

        const { mouseSensitivity, invertY } = store.getState().settings.values;
        const sensitivity = CAMERA.mouseSensitivity * mouseSensitivity;
        const pitchDelta = invertY ? -Player.mouseDelta.y : Player.mouseDelta.y;
        this.followCamera.turnBy(Player.mouseDelta.x * sensitivity, pitchDelta * sensitivity);
    }

    private computeCameraBasis(): void {
        forwardFromYaw(this.followCamera.yaw, Player.cameraForward, -1);
        Player.cameraRight.set(-Player.cameraForward.z, 0, Player.cameraForward.x);
    }

    private computeMovement(commands: IPlayerCommands, deltaSeconds: number): void {
        Player.moveDirection
            .set(0, 0, 0)
            .addScaledVector(Player.cameraForward, commands.moveForward)
            .addScaledVector(Player.cameraRight, commands.moveRight);

        this.hasDirectionalInput = Player.moveDirection.lengthSq() > 0;
        if (this.hasDirectionalInput) Player.moveDirection.normalize();

        const stamina = this.vitals.stamina;
        if (stamina <= 0) this.isWinded = true;
        else if (stamina >= STAMINA.sprintResumeFraction * this.vitals.spec.maxStamina)
            this.isWinded = false;
        this.isSprintGranted =
            commands.wantsSprint &&
            this.hasDirectionalInput &&
            !this.isWinded &&
            (this.moveStateMachine.output.allowsLocomotion || this.isJumping) &&
            (this.motor.contact.movedFraction < BODY_CONTACT.stalledFraction ||
                this.vitals.drainStamina(STAMINA.sprintPerSecond * deltaSeconds));
        this.isSprinting =
            this.isSprintGranted &&
            !this.isCrouching &&
            (this.moveStateMachine.state === "locomotion" || this.isJumping);
        this.facesTarget = this.lockTarget !== null && !this.lockTarget.isDead && !this.isSprinting;
        if (this.facesTarget) this.target = this.lockTarget;
        this.isLockedTargetFar =
            this.facesTarget &&
            this.lockTarget !== null &&
            horizontalDistance(this.sceneObject.position, this.lockTarget.sceneObject.position) >
                TARGETING.gapCloseMinDistance;

        this.desiredVelocity.copy(Player.moveDirection).multiplyScalar(this.locomotionSpeed());
        this.locomotionOverride =
            this.isCrouching && !this.facesTarget ? PLAYER_CROUCH_LOCOMOTION : null;
        this.heavyHeld = commands.heavyAttackHeld;
    }

    private locomotionSpeed(): number {
        if (this.isSprintGranted && !this.isCrouching) return PLAYER.sprintSpeed;
        if (this.isSprintGranted) return PLAYER.crouchSprintSpeed;
        if (this.isCrouching) return PLAYER.crouchSpeed;
        return this.facesTarget ? PLAYER.strafeSpeed : PLAYER.walkSpeed;
    }

    private footstepGait(): FootstepGait {
        if (!this.motor.isGrounded || !this.hasDirectionalInput) return "still";
        if (this.isSprintGranted && !this.isCrouching) return "sprint";
        return this.isCrouching && !this.isSprintGranted ? "crouch" : "walk";
    }

    private updateLock(commands: IPlayerCommands): void {
        const current = this.lockTarget;

        if (current?.isDead) this.lockTarget = this.acquireLockTarget();
        else if (
            current &&
            horizontalDistance(this.sceneObject.position, current.sceneObject.position) >
                TARGETING.lockBreakRange
        )
            this.lockTarget = null;

        if (commands.toggleLock)
            this.lockTarget = this.lockTarget ? null : this.acquireLockTarget();

        if (commands.cycleLock !== 0 && this.lockTarget)
            this.lockTarget = cycleTarget(
                this.sceneObject.position,
                Player.cameraForward,
                this.lockTarget,
                this.opponentsWithin(TARGETING.lockRange, Player.opponents),
                commands.cycleLock > 0 ? 1 : -1,
                TARGETING.lockRange
            );

        this.followCamera.setLockPoint(
            this.lockTarget ? this.lockTarget.sceneObject.position : null
        );
    }

    private acquireLockTarget(): ICombatant | null {
        return selectTarget(
            this.sceneObject.position,
            Player.cameraForward,
            this.opponentsWithin(TARGETING.lockRange, Player.opponents),
            TARGETING.lockRange,
            TARGETING.lockMinDot
        );
    }

    private queueCombatActions(commands: IPlayerCommands): void {
        if (this.motor.isGrounded && this.finisherWindows.isRequested && this.tryFinisher()) return;

        if (commands.drawOrSheathe) this.moveStateMachine.queue("draw");

        if (commands.lightAttack) {
            if (
                this.motor.isGrounded &&
                this.finisherWindows.inChainKillWindow &&
                this.tryFinisher()
            )
                return;
            this.pickAttackTarget();
            this.moveStateMachine.queue("light");
        }

        if (commands.heavyAttack) {
            this.pickAttackTarget();
            this.moveStateMachine.queue("heavy");
        }

        if (commands.dodge) {
            this.dodgeYaw = this.facingYaw;
            this.dodgeSide = null;
            if (this.hasDirectionalInput) {
                const referenceYaw = this.facesTarget
                    ? this.facingYaw
                    : yawFromDirection(Player.cameraForward.x, Player.cameraForward.z);
                const inputOffset = shortestAngleBetween(
                    referenceYaw,
                    yawFromDirection(Player.moveDirection.x, Player.moveDirection.z)
                );
                const isSideways =
                    Math.abs(inputOffset) >= DODGE.minSideAngle &&
                    Math.abs(inputOffset) <= DODGE.maxSideAngle;
                if (isSideways) {
                    this.dodgeSide = inputOffset > 0 ? "left" : "right";
                    this.dodgeYaw = referenceYaw;
                }
            }
            this.moveStateMachine.queue("dodge");
        }

        if (commands.parry) this.moveStateMachine.queue("parry");
    }

    private pickAttackTarget(): void {
        if (this.lockTarget && !this.lockTarget.isDead) {
            this.target = this.lockTarget;
            return;
        }

        this.opponentsWithin(TARGETING.autoAimRange, Player.opponents);
        this.target = selectTarget(
            this.sceneObject.position,
            this.intentFacing(),
            Player.opponents,
            TARGETING.autoAimRange,
            TARGETING.autoAimMinFacingDot
        );
    }

    private updateFinisherPrompt(): void {
        this.finisherCandidate = null;
        this.finisherCandidateKind = null;

        const state = this.moveStateMachine.state;
        if (state === "locomotion" || state === "move") this.findFinisherCandidate();

        store
            .getState()
            .hud.setHudValue(
                "prompt",
                this.finisherCandidateKind
                    ? HUD_TEXT.finisherPrompts[this.finisherCandidateKind]
                    : null
            );
    }

    private findFinisherCandidate(): void {
        const inChainKillWindow = this.finisherWindows.inChainKillWindow;
        const reach = inChainKillWindow
            ? FINISHER_RULES.chainKillReach
            : Math.max(FINISHER_RULES.executionReach, FINISHER_RULES.backstabReach);
        const position = this.sceneObject.position;
        this.opponentsWithin(reach + this.bodyRadius, Player.opponents);
        let widestRadius = 0;
        for (const opponent of Player.opponents)
            widestRadius = Math.max(widestRadius, opponent.bodyRadius);

        const candidate =
            this.lockTarget && Player.opponents.includes(this.lockTarget)
                ? this.lockTarget
                : selectTarget(
                      position,
                      this.intentFacing(),
                      Player.opponents,
                      reach + this.bodyRadius + widestRadius,
                      0
                  );

        if (!(candidate instanceof CombatCharacter)) return;

        const victimPosition = candidate.sceneObject.position;
        const behind = isBehind(
            candidate.yaw,
            victimPosition.x,
            victimPosition.z,
            position.x,
            position.z
        );
        const edgeGap =
            horizontalDistance(position, candidate.sceneObject.position) -
            this.bodyRadius -
            candidate.bodyRadius;
        const kind = finisherKindFor(candidate, edgeGap, behind, inChainKillWindow);
        if (!kind) return;

        this.finisherCandidate = candidate;
        this.finisherCandidateKind = kind;
    }

    private tryFinisher(): boolean {
        const victim = this.finisherCandidate;
        const kind = this.finisherCandidateKind;
        if (victim === null || kind === null) return false;
        if (this.stance === "sheathed") {
            if (this.finisherWindows.isRequested) this.finisherWindows.reset();
            if (!this.moveStateMachine.activeMove?.tags.includes("stance"))
                this.moveStateMachine.queue("draw");
            return false;
        }
        return this.startFinisher(victim, kind);
    }

    private startFinisher(victim: CombatCharacter, kind: FinisherKind): boolean {
        const finisher = selectFinisher(FINISHERS, kind, this.lastFinisherId, Math.random);
        if (!finisher || !this.hasClearApproach(victim, finisher)) return false;
        if (!this.finisherSequence.start(this, victim, finisher)) return false;

        this.lastFinisherId = finisher.id;
        this.finisherWindows.reset();
        this.beginKillCam(victim, finisher);
        return true;
    }

    private beginKillCam(victim: CombatCharacter, finisher: IFinisherDefinition): void {
        const own = this.sceneObject.position;
        const theirs = victim.sceneObject.position;
        Player.killCamFocus.addVectors(own, theirs).multiplyScalar(0.5);
        Player.killCamFocus.y += KILL_CAMERA.focusLift;

        const attackerToVictimYaw = yawTowards(own, theirs);
        const finisherBodySpan = finisherCentreDistance(
            finisher.distance,
            this.bodyRadius,
            victim.bodyRadius
        );
        const shot = chooseKillCamShot(
            attackerToVictimYaw,
            this.followCamera.yaw,
            finisherBodySpan,
            (yaw, pitch, distance) =>
                this.followCamera.isShotClear(Player.killCamFocus, yaw, pitch, distance)
        );
        this.followCamera.beginKillCam(shot, Player.killCamFocus);
    }

    private trackKillCam(): void {
        if (!this.finisherSequence.isActive) {
            this.followCamera.endKillCam();
            return;
        }

        this.finisherSequence.finisherMidpoint(Player.killCamFocus);
        Player.killCamFocus.y += KILL_CAMERA.focusLift;
        this.followCamera.setKillCamFocus(Player.killCamFocus);
        if (this.finisherSequence.isRecovering) this.followCamera.endKillCam();
    }

    private shakeCameraWhileCharging(): void {
        const chargeLevel = this.moveStateMachine.output.chargeLevel;
        if (chargeLevel > this.previousChargeLevel)
            this.followCamera.addShake(
                (chargeLevel - this.previousChargeLevel) * CHARGE_SHAKE.shakeScale
            );
        this.previousChargeLevel = chargeLevel;
    }

    private hasClearApproach(victim: CombatCharacter, finisher: IFinisherDefinition): boolean {
        const own = this.position;
        const theirs = victim.position;
        const distance = horizontalDirection(own, theirs, Player.approachDirection);
        const travel =
            distance -
            finisherCentreDistance(finisher.distance, this.bodyRadius, victim.bodyRadius);
        if (travel <= 0 || distance < COMBAT_MOVEMENT.minimumPlanarLength) return true;

        return !this.motor.isObstacleAhead(
            Player.approachDirection.x,
            Player.approachDirection.z,
            travel
        );
    }

    private publishVitals(): void {
        store.getState().hud.setMeter("health", this.vitals.health, this.vitals.spec.maxHealth);
        store.getState().hud.setMeter("stamina", this.vitals.stamina, this.vitals.spec.maxStamina);
        store.getState().hud.setMeter("focus", this.vitals.focus, this.vitals.spec.maxFocus);

        const shown = this.lockTarget ?? this.target;
        if (
            shown instanceof CombatCharacter &&
            !shown.isDead &&
            horizontalDistance(this.sceneObject.position, shown.sceneObject.position) <
                TARGETING.lockBreakRange
        )
            store
                .getState()
                .hud.setTarget(
                    true,
                    shown.displayName,
                    shown.healthFraction,
                    shown.vitals.poiseFraction
                );
        else Player.clearHudTarget();
    }

    private intentFacing(): Vector3 {
        return this.hasDirectionalInput ? Player.moveDirection : Player.cameraForward;
    }

    private opponentsWithin(radius: number, out: ICombatant[]): ICombatant[] {
        return this.context.combatRegistry.collectOpponents(
            this.team,
            this.sceneObject.position,
            radius,
            out
        );
    }
}
