import { Vector3 } from "three";
import type { Camera, Vector3Tuple } from "three";
import type { IMotorSpec } from "@/systems/combat/core/CharacterMotor";
import { CombatCharacter } from "@/systems/combat/core/CombatCharacter";
import {
    finisherKindFor,
    isBehind,
    selectFinisher,
} from "@/systems/combat/finishers/FinisherSelector";
import { FINISHERS } from "@/systems/combat/finishers/finishers";
import { pairCentreDistance } from "@/systems/combat/finishers/PairAlignment";
import { FinisherTrigger } from "@/systems/combat/finishers/FinisherTrigger";
import { PairedAnimationDirector } from "@/systems/combat/finishers/PairedAnimationDirector";
import {
    PLAYER_CROUCH_LOCOMOTION,
    PLAYER_FREE_LOCOMOTION,
    PLAYER_STRAFE_LOCOMOTION,
} from "@/systems/combat/actions/locomotion";
import { PLAYER_STARTING_WEAPON } from "@/constants/weapons";
import { PLAYER_MOVE_IDS, PLAYER_MOVES } from "@/systems/combat/moveSets/playerMoves";
import { cycleTarget, selectTarget } from "@/systems/combat/services/TargetSelector";
import { FootstepNoise } from "@/entities/characters/player/FootstepNoise";
import type { FootstepGait } from "@/entities/characters/player/FootstepNoise";
import { chooseKillCamShot, PlayerCamera } from "@/entities/characters/player/PlayerCamera";
import { PlayerController } from "@/entities/characters/player/PlayerController";
import type { IPlayerCommands } from "@/entities/characters/player/PlayerController";
import { store } from "@/store/store";
import { CAMERA, CHARACTER, PLAYER } from "@/constants/characters";
import {
    CAMERA_SHAKE,
    COMBAT_TIMING,
    FINISHER_RULES,
    KILL_CAMERA,
    PLAYER_VITALS,
    STAMINA,
    TARGETING,
} from "@/constants/combat";
import { SIGHT } from "@/constants/enemyAi";
import { settings } from "@/settings/SettingsStore";
import type {
    FinisherKind,
    ICombatant,
    IFinisherDefinition,
    IMoveDefinition,
} from "@/types/combat";
import type { IWorldContext } from "@/types/world";

export class Player extends CombatCharacter {
    private readonly controller = new PlayerController();
    private readonly followCamera: PlayerCamera;
    private readonly finishers: PairedAnimationDirector;
    private readonly footsteps: FootstepNoise;
    private readonly spawnPoint = new Vector3();
    private readonly spawnYaw: number;
    private readonly unsubscribers: (() => void)[] = [];
    private lockTarget: ICombatant | null = null;
    private promptVictim: CombatCharacter | null = null;
    private promptKind: FinisherKind | null = null;
    private readonly finisherTrigger = new FinisherTrigger();
    private lastFinisherId: string | null = null;
    private dodgeYaw = 0;
    private crouchToggled = false;
    private isCrouching = false;

    constructor(
        context: IWorldContext,
        camera: Camera,
        spawnPosition: Vector3Tuple,
        spawnYaw: number
    ) {
        const model = context.assetLibrary.getSkinnedModel(CHARACTER.modelPath);
        if (!model) throw new Error(`character model not loaded: ${CHARACTER.modelPath}`);

        super({
            id: "player",
            team: "player",
            context,
            model,
            motor: PLAYER_MOTOR,
            vitals: PLAYER_VITALS,
            moveSet: PLAYER_MOVES,
            freeLocomotion: PLAYER_FREE_LOCOMOTION,
            strafeLocomotion: PLAYER_STRAFE_LOCOMOTION,
            victimRig: "humanoid",
            turnSmoothing: PLAYER.turnSmoothing,
            modelYawOffset: CHARACTER.modelYawOffset,
            spawnPosition,
            spawnYaw,
            flashesOnHit: false,
        });

        this.spawnPoint.fromArray(spawnPosition);
        this.spawnYaw = spawnYaw;
        this.equipWeapon(PLAYER_STARTING_WEAPON);
        this.followCamera = new PlayerCamera(
            camera,
            context.physicsWorld,
            this.motor.collider,
            spawnYaw + Math.PI
        );
        this.finishers = new PairedAnimationDirector(context);
        this.footsteps = new FootstepNoise(context.combatEvents);
        this.listenForImpacts();
        this.publishVitals();
        store.getState().hud.setPlayerAlive(true);
    }

    get attackPower(): number {
        return this.weapon?.damage ?? PLAYER.unarmedDamage;
    }

    get stealthVisibility(): number {
        return this.isCrouching ? SIGHT.crouchedVisibility : 1;
    }

    update(deltaSeconds: number, interpolationAlpha: number): void {
        this.applyMouseLook();
        super.update(deltaSeconds, interpolationAlpha);
        this.trackKillCam();

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
        this.finishers.abort();
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.controller.dispose();
        store.getState().hud.setPrompt(null);
        store.getState().hud.setTarget(false, "", 0, 0);
        super.dispose();
    }

    protected think(deltaSeconds: number): void {
        const commands = this.controller.read();
        this.finisherTrigger.tick(deltaSeconds);
        if (commands.finisher) this.finisherTrigger.press();

        this.computeCameraBasis();
        this.updateLock(commands);
        this.computeMovement(commands, deltaSeconds);
        this.routeCrouch(commands.crouchPressed);
        if (commands.jump) this.machine.queue("jump");
        this.footsteps.tick(deltaSeconds, this.footstepGait(), this.position);
        this.refreshPrompt();
        this.issueCombatIntents(commands);
        this.publishVitals();
    }

    private routeCrouch(pressed: boolean): void {
        if (!pressed) return;

        if (this.isSprinting) {
            this.dodgeYaw = this.facingYaw;
            this.machine.queue("slide");
        } else if (this.machine.state === "locomotion") this.crouchToggled = !this.crouchToggled;
    }

    protected onMoveStarted(move: IMoveDefinition): void {
        if (move.tags.includes("dodge")) this.faceImmediately(this.dodgeYaw);
    }

    protected onParrySucceeded(attacker: ICombatant): void {
        this.target = attacker;
        if (
            attacker instanceof CombatCharacter &&
            attacker.canBeCounterKilled &&
            this.startFinisher(attacker, "counter")
        )
            return;
        this.machine.forceMove(PLAYER_MOVE_IDS.counter);
    }

    placeAt(position: Vector3, yaw: number): void {
        super.placeAt(position, yaw);
        this.followCamera.resetPivot();
    }

    protected tickPaired(deltaSeconds: number): void {
        this.controller.discardPending();
        this.publishVitals();
        if (!this.finishers.tick(deltaSeconds)) return;

        this.followCamera.endKillCam();
        if (this.finishers.hasKilled) this.finisherTrigger.openStreak();
    }

    protected onKilled(): void {
        this.finisherTrigger.reset();
        this.lockTarget = null;
        this.followCamera.setLockPoint(null);
        this.followCamera.endKillCam();
        store.getState().hud.setPrompt(null);
        store.getState().hud.setPlayerAlive(false);
    }

    protected onDeadTick(elapsed: number, holdSeconds: number): void {
        this.controller.discardPending();
        if (elapsed < holdSeconds + COMBAT_TIMING.respawnDelaySeconds) return;

        this.vitals.restore();
        this.machine.revive();
        this.motor.enableCollision();
        this.placeAt(this.spawnPoint, this.spawnYaw);
        this.animator.returnToLocomotion(COMBAT_TIMING.locomotionReturnFade);
        this.publishVitals();
        store.getState().hud.setPlayerAlive(true);
    }

    private listenForImpacts(): void {
        const events = this.context.combatEvents;

        this.unsubscribers.push(
            events.on("hitLanded", (event) => {
                if (event.attacker === this) {
                    this.followCamera.addTrauma(CAMERA_SHAKE.trauma[event.impact]);
                    if (event.impact !== "light") this.followCamera.punch();
                }
                if (event.defender === this)
                    this.followCamera.addTrauma(CAMERA_SHAKE.trauma[event.impact] * 1.3);
            }),
            events.on("finisherKill", (event) => {
                if (event.attacker === this)
                    this.followCamera.addTrauma(CAMERA_SHAKE.trauma.finisher);
            }),
            events.on("killed", (event) => {
                if (event.killer !== this) return;
                this.finisherTrigger.openStreak();
            })
        );
    }

    private applyMouseLook(): void {
        this.controller.consumeLook(mouseDelta);

        const sensitivity = CAMERA.mouseSensitivity * settings.mouseSensitivity;
        const pitchDelta = settings.invertY ? -mouseDelta.y : mouseDelta.y;
        this.followCamera.turnBy(mouseDelta.x * sensitivity, pitchDelta * sensitivity);
    }

    private computeCameraBasis(): void {
        const yaw = this.followCamera.yaw;
        cameraForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        cameraRight.set(-cameraForward.z, 0, cameraForward.x);
    }

    private computeMovement(commands: IPlayerCommands, deltaSeconds: number): void {
        moveDirection
            .set(0, 0, 0)
            .addScaledVector(cameraForward, commands.moveForward)
            .addScaledVector(cameraRight, commands.moveRight);

        this.hasDirectionalInput = moveDirection.lengthSq() > 0;
        if (this.hasDirectionalInput) moveDirection.normalize();

        this.isCrouching = this.crouchToggled && !commands.wantsSprint;
        this.isSprinting =
            commands.wantsSprint &&
            this.hasDirectionalInput &&
            this.machine.state === "locomotion" &&
            this.vitals.drainStamina(STAMINA.sprintPerSecond * deltaSeconds);
        this.facesTarget = this.lockTarget !== null && !this.lockTarget.isDead && !this.isSprinting;
        if (this.facesTarget) this.target = this.lockTarget;

        const speed = this.isSprinting
            ? PLAYER.sprintSpeed
            : this.isCrouching
              ? PLAYER.crouchSpeed
              : this.facesTarget
                ? PLAYER.strafeSpeed
                : PLAYER.walkSpeed;

        this.desiredVelocity.copy(moveDirection).multiplyScalar(speed);
        this.locomotionOverride =
            this.isCrouching && !this.facesTarget ? PLAYER_CROUCH_LOCOMOTION : null;
        this.heavyHeld = commands.heavyHeld;
    }

    private footstepGait(): FootstepGait {
        if (!this.motor.isGrounded || !this.hasDirectionalInput) return "still";
        if (this.isSprinting) return "sprint";
        return this.isCrouching ? "crouch" : "walk";
    }

    private updateLock(commands: IPlayerCommands): void {
        const position = this.sceneObject.position;
        const current = this.lockTarget;

        if (
            current &&
            (current.isDead || this.horizontalDistance(current) > TARGETING.lockBreakRange)
        ) {
            this.context.combatRegistry.collectOpponents(
                this.team,
                position,
                TARGETING.lockRange,
                opponents
            );
            this.lockTarget = current.isDead
                ? selectTarget(
                      position,
                      cameraForward,
                      opponents,
                      TARGETING.lockRange,
                      TARGETING.lockMinDot
                  )
                : null;
        }

        if (commands.toggleLock) {
            this.context.combatRegistry.collectOpponents(
                this.team,
                position,
                TARGETING.lockRange,
                opponents
            );
            this.lockTarget = this.lockTarget
                ? null
                : selectTarget(
                      position,
                      cameraForward,
                      opponents,
                      TARGETING.lockRange,
                      TARGETING.lockMinDot
                  );
        }

        if (commands.cycleLock !== 0 && this.lockTarget) {
            this.context.combatRegistry.collectOpponents(
                this.team,
                position,
                TARGETING.lockRange,
                opponents
            );
            this.lockTarget = cycleTarget(
                position,
                cameraForward,
                this.lockTarget,
                opponents,
                commands.cycleLock > 0 ? 1 : -1,
                TARGETING.lockRange
            );
        }

        this.followCamera.setLockPoint(
            this.lockTarget ? this.lockTarget.sceneObject.position : null
        );
    }

    private issueCombatIntents(commands: IPlayerCommands): void {
        if (this.motor.isGrounded && this.finisherTrigger.isRequested && this.tryFinisher()) return;

        if (commands.light) {
            if (this.motor.isGrounded && this.finisherTrigger.inStreak && this.tryFinisher())
                return;
            this.aimAtTarget();
            this.machine.queue("light");
        }

        if (commands.heavy) {
            this.aimAtTarget();
            this.machine.queue("heavy");
        }

        if (commands.dodge) {
            this.dodgeYaw = this.hasDirectionalInput
                ? Math.atan2(moveDirection.x, moveDirection.z)
                : this.sceneObject.rotation.y;
            this.machine.queue("dodge");
        }

        if (commands.parry) this.machine.queue("parry");
    }

    private aimAtTarget(): void {
        if (this.lockTarget && !this.lockTarget.isDead) {
            this.target = this.lockTarget;
            return;
        }

        const facing = this.hasDirectionalInput ? moveDirection : cameraForward;
        this.context.combatRegistry.collectOpponents(
            this.team,
            this.sceneObject.position,
            TARGETING.softRange,
            opponents
        );
        this.target = selectTarget(
            this.sceneObject.position,
            facing,
            opponents,
            TARGETING.softRange,
            TARGETING.softMinDot
        );
    }

    private refreshPrompt(): void {
        this.promptVictim = null;
        this.promptKind = null;

        const state = this.machine.state;
        if (state === "locomotion" || state === "move") this.findFinisherCandidate();

        store.getState().hud.setPrompt(this.promptKind ? PROMPT_LABELS[this.promptKind] : null);
    }

    private findFinisherCandidate(): void {
        const inStreak = this.finisherTrigger.inStreak;
        const reach = inStreak
            ? FINISHER_RULES.streakReach
            : Math.max(FINISHER_RULES.executionReach, FINISHER_RULES.backstabReach);
        const position = this.sceneObject.position;
        const facing = this.hasDirectionalInput ? moveDirection : cameraForward;

        this.context.combatRegistry.collectOpponents(
            this.team,
            position,
            reach + this.bodyRadius,
            opponents
        );
        let widestRadius = 0;
        for (const opponent of opponents)
            widestRadius = Math.max(widestRadius, opponent.hurtboxes[0]?.radius ?? 0);

        const candidate =
            this.lockTarget && opponents.includes(this.lockTarget)
                ? this.lockTarget
                : selectTarget(
                      position,
                      facing,
                      opponents,
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
        const edgeGap = this.horizontalDistance(candidate) - this.bodyRadius - candidate.bodyRadius;
        const kind = finisherKindFor(candidate, edgeGap, behind, inStreak);
        if (!kind) return;

        this.promptVictim = candidate;
        this.promptKind = kind;
    }

    private tryFinisher(): boolean {
        const victim = this.promptVictim;
        const kind = this.promptKind;
        return victim !== null && kind !== null && this.startFinisher(victim, kind);
    }

    private startFinisher(victim: CombatCharacter, kind: FinisherKind): boolean {
        const finisher = selectFinisher(FINISHERS, kind, this.lastFinisherId, Math.random);
        if (!finisher || !this.hasClearApproach(victim, finisher)) return false;
        if (!this.finishers.start(this, victim, finisher)) return false;

        this.lastFinisherId = finisher.id;
        this.finisherTrigger.reset();
        this.beginKillCam(victim, finisher);
        return true;
    }

    private beginKillCam(victim: CombatCharacter, finisher: IFinisherDefinition): void {
        const own = this.sceneObject.position;
        const theirs = victim.sceneObject.position;
        killCamFocus.addVectors(own, theirs).multiplyScalar(0.5);
        killCamFocus.y += KILL_CAMERA.focusLift;

        const pairAxisYaw = Math.atan2(theirs.x - own.x, theirs.z - own.z);
        const pairSpan = pairCentreDistance(finisher.distance, this.bodyRadius, victim.bodyRadius);
        const shot = chooseKillCamShot(
            pairAxisYaw,
            this.followCamera.yaw,
            pairSpan,
            (yaw, pitch, distance) =>
                this.followCamera.isShotClear(killCamFocus, yaw, pitch, distance)
        );
        this.followCamera.beginKillCam(shot, killCamFocus);
    }

    private trackKillCam(): void {
        if (!this.finishers.isActive) {
            this.followCamera.endKillCam();
            return;
        }

        this.finishers.pairMidpoint(killCamFocus);
        killCamFocus.y += KILL_CAMERA.focusLift;
        this.followCamera.setKillCamFocus(killCamFocus);
        if (this.finishers.isRecovering) this.followCamera.endKillCam();
    }

    private hasClearApproach(victim: CombatCharacter, finisher: IFinisherDefinition): boolean {
        const own = this.position;
        const theirs = victim.position;
        const offsetX = theirs.x - own.x;
        const offsetZ = theirs.z - own.z;
        const distance = Math.hypot(offsetX, offsetZ);
        const travel =
            distance - pairCentreDistance(finisher.distance, this.bodyRadius, victim.bodyRadius);
        if (travel <= 0 || distance < 1e-4) return true;

        return !this.motor.isPathBlocked(offsetX / distance, offsetZ / distance, travel);
    }

    private publishVitals(): void {
        store.getState().hud.setVital("health", this.vitals.health, this.vitals.maxHealth);
        store.getState().hud.setVital("stamina", this.vitals.stamina, this.vitals.maxStamina);
        store.getState().hud.setFocus(this.vitals.focus, this.vitals.maxFocus);

        const shown = this.lockTarget ?? this.target;
        if (
            shown instanceof CombatCharacter &&
            !shown.isDead &&
            this.horizontalDistance(shown) < TARGETING.lockBreakRange
        )
            store
                .getState()
                .hud.setTarget(
                    true,
                    shown.displayName,
                    shown.healthFraction,
                    shown.vitals.poiseFraction
                );
        else store.getState().hud.setTarget(false, "", 0, 0);
    }

    private horizontalDistance(other: ICombatant): number {
        const own = this.sceneObject.position;
        const theirs = other.sceneObject.position;
        return Math.hypot(theirs.x - own.x, theirs.z - own.z);
    }
}

const PLAYER_MOTOR: IMotorSpec = {
    height: PLAYER.height,
    radius: PLAYER.radius,
    colliderOffset: PLAYER.colliderOffset,
    maxSlopeClimbAngle: PLAYER.maxSlopeClimbAngle,
    minSlopeSlideAngle: PLAYER.minSlopeSlideAngle,
    autostepMaxHeight: PLAYER.autostepMaxHeight,
    autostepMinWidth: PLAYER.autostepMinWidth,
    snapToGroundDistance: PLAYER.snapToGroundDistance,
    terminalVelocity: PLAYER.terminalVelocity,
    groundAcceleration: PLAYER.groundAcceleration,
    airAcceleration: PLAYER.airAcceleration,
    pushesDynamicBodies: true,
};

const PROMPT_LABELS: Record<FinisherKind, string> = {
    backstab: "Assassinate",
    execution: "Execute",
    counter: "Counter",
    critical: "Critical",
};

const cameraForward = new Vector3();
const cameraRight = new Vector3();
const moveDirection = new Vector3();
const killCamFocus = new Vector3();
const mouseDelta = { x: 0, y: 0 };
const opponents: ICombatant[] = [];
