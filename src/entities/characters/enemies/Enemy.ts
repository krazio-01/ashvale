import { Vector3 } from "three";
import type { Vector3Tuple } from "three";
import type { IMotorSpec } from "@/systems/combat/core/CharacterMotor";
import { CombatCharacter } from "@/entities/characters/CombatCharacter";
import { enemyCombatLocomotion, enemyRelaxedLocomotion } from "@/entities/characters/locomotion";
import { BehaviourSelector } from "@/systems/enemyBehaviour/behaviours/BehaviourSelector";
import type { IEnemyCombatBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import { EngageBehaviour } from "@/systems/enemyBehaviour/behaviours/EngageBehaviour";
import {
    InvestigateBehaviour,
    SearchBehaviour,
} from "@/systems/enemyBehaviour/behaviours/InvestigateBehaviour";
import {
    DisengageBehaviour,
    PatrolBehaviour,
} from "@/systems/enemyBehaviour/behaviours/PatrolBehaviour";
import { Movement } from "@/systems/enemyBehaviour/movement/Movement";
import { EnemyPerception } from "@/systems/enemyBehaviour/perception/EnemyPerception";
import { HearingSensor } from "@/systems/enemyBehaviour/perception/HearingSensor";
import { SightSensor } from "@/systems/enemyBehaviour/perception/SightSensor";
import type { IEnemyArchetype } from "@/constants/enemies";
import { IDLE_VARIATION, jitteredIdleDelay } from "@/constants/characters";
import { NON_PLAYER, SIGHT } from "@/constants/enemies";
import { HUD } from "@/constants/presentation";
import {
    alertMarkerFillFor,
    alertMarkerKindFor,
} from "@/world/effects/combat/AlertMarkerProjector";
import type { IAlertMarkerSource } from "@/world/effects/combat/AlertMarkerProjector";
import { horizontalDirection } from "@/lib/helpers";
import type { AwarenessState, ICombatant, IHitPayload } from "@/types/combat";
import type { AlertMarkerKind } from "@/types/hud";
import type { IWorldContext } from "@/types/world";

export class Enemy extends CombatCharacter implements IEnemyCombatBody, IAlertMarkerSource {
    readonly archetype: IEnemyArchetype;

    private readonly homePosition: Vector3;
    private readonly player: CombatCharacter | null;
    private readonly steering: Movement;
    private readonly perception: EnemyPerception | null;
    private readonly engage: EngageBehaviour | null;
    private readonly behaviours: BehaviourSelector | null;
    private hasStoppedThinking = false;

    constructor(options: IEnemyOptions) {
        const model = options.context.assetLibrary.getSkinnedModel(options.archetype.modelPath);
        if (!model) throw new Error(`enemy model not loaded: ${options.archetype.modelPath}`);

        super({
            id: options.id,
            team: "enemy",
            context: options.context,
            model,
            motor: enemyMotor(options.archetype),
            vitals: options.archetype.vitals,
            moveSet: options.archetype.moveSet,
            freeLocomotion: enemyRelaxedLocomotion(
                options.archetype.height,
                jitteredIdleDelay(IDLE_VARIATION.relaxedDelaySeconds, Math.random)
            ),
            strafeLocomotion: enemyCombatLocomotion(options.archetype.height),
            victimRig: options.archetype.victimRig,
            turnSmoothing: NON_PLAYER.turnSmoothing,
            modelYawOffset: 0,
            spawnPosition: options.spawnPosition,
            spawnYaw: options.spawnYaw,
            flashesOnHit: true,
        });

        this.archetype = options.archetype;
        if (options.archetype.weapon) this.equipWeapon(options.archetype.weapon);
        this.homePosition = new Vector3().fromArray(options.spawnPosition);
        this.player = options.player;
        this.steering = new Movement(this, options.context.combatRegistry);

        const player = options.player;
        if (options.passive || !player) {
            this.perception = null;
            this.engage = null;
            this.behaviours = null;
            return;
        }

        const perception = new EnemyPerception(
            this,
            player,
            new SightSensor(options.context.physicsWorld, this.motor.collider),
            new HearingSensor(options.context.combatEvents, this.position),
            options.context.combatEvents
        );
        const meter = perception.meter;
        const random = Math.random;
        const engage = new EngageBehaviour(
            this,
            meter,
            player,
            random,
            options.context.attackCoordinator,
            options.id
        );

        this.perception = perception;
        this.engage = engage;
        this.behaviours = new BehaviourSelector({
            unaware: new PatrolBehaviour(this, meter, random),
            suspicious: new InvestigateBehaviour(this, meter, random),
            alert: engage,
            searching: new SearchBehaviour(this, meter, random),
            returning: new DisengageBehaviour(this, meter, random),
        });
    }

    get attackPower(): number {
        return this.archetype.attackPower;
    }

    get awareness(): AwarenessState {
        if (this.archetype.alwaysAware) return "alert";
        return this.perception?.meter.state ?? "unaware";
    }

    get displayName(): string {
        return this.archetype.label;
    }

    get canBeCounterKilled(): boolean {
        return this.archetype.counterKillable;
    }

    get eyeLift(): number {
        return this.archetype.height * SIGHT.eyeHeightFraction;
    }

    get home(): Vector3 {
        return this.homePosition;
    }

    get alertMarkerHeight(): number {
        return this.archetype.height * HUD.alertMarkerLift;
    }

    get alertMarkerKind(): AlertMarkerKind | null {
        return this.perception ? alertMarkerKindFor(this.perception.meter, this.isDead) : null;
    }

    get alertMarkerFill(): number {
        return this.perception ? alertMarkerFillFor(this.perception.meter) : 0;
    }

    get activeMoveId(): string | null {
        return this.machine.activeMove?.id ?? null;
    }

    moveTowards(point: Vector3, speed: number, stopDistance: number, pointRadius = 0): number {
        const distance = horizontalDirection(this.position, point, this.desiredVelocity);
        if (distance <= stopDistance || distance < 1e-4) {
            this.holdStill();
            return distance;
        }

        this.steering.steer(this.desiredVelocity, speed, distance - this.bodyRadius - pointRadius);
        return distance;
    }

    moveAwayFrom(point: Vector3, speed: number): void {
        const distance = horizontalDirection(point, this.position, this.desiredVelocity);
        if (distance < 1e-4) {
            this.holdStill();
            return;
        }

        this.steering.steer(this.desiredVelocity, speed, Number.POSITIVE_INFINITY);
    }

    holdStill(): void {
        this.desiredVelocity.set(0, 0, 0);
        this.steering.steer(this.desiredVelocity, this.archetype.patrolSpeed, 0);
    }

    lookTowards(yaw: number): void {
        this.facingYaw = yaw;
    }

    faceTarget(): void {
        this.facesTarget = true;
        this.target = this.player;
    }

    relax(): void {
        this.facesTarget = false;
    }

    performMove(moveId: string): boolean {
        this.target = this.player;
        return this.machine.startMove(moveId);
    }

    isPathBlocked(directionX: number, directionZ: number, distance: number): boolean {
        return this.motor.isPathBlocked(directionX, directionZ, distance);
    }

    dispose(): void {
        this.stopThinking();
        super.dispose();
    }

    protected think(deltaSeconds: number): void {
        this.steering.tick(deltaSeconds);
        const perception = this.perception;
        const behaviours = this.behaviours;
        if (!perception || !behaviours) return;

        perception.tick(deltaSeconds);
        behaviours.tick(perception.meter.phase, deltaSeconds);
    }

    protected onDamaged(payload: IHitPayload): void {
        this.perception?.notifyDamaged(payload.origin);
        if (payload.impact === "light") this.engage?.notifyLightHitLanded();
    }

    protected onParrySucceeded(attacker: ICombatant): void {
        this.target = attacker;
        this.machine.forceMove(this.archetype.riposteMove);
    }

    protected onKilled(): void {
        this.stopThinking();
    }

    private stopThinking(): void {
        if (this.hasStoppedThinking) return;
        this.hasStoppedThinking = true;
        this.behaviours?.stop();
        this.perception?.dispose();
    }
}

interface IEnemyOptions {
    id: string;
    archetype: IEnemyArchetype;
    context: IWorldContext;
    spawnPosition: Vector3Tuple;
    spawnYaw: number;
    player: CombatCharacter | null;
    passive: boolean;
}

function enemyMotor(archetype: IEnemyArchetype): IMotorSpec {
    return {
        height: archetype.height,
        radius: archetype.radius,
        colliderOffset: NON_PLAYER.colliderOffset,
        maxSlopeClimbAngle: NON_PLAYER.maxSlopeClimbAngle,
        minSlopeSlideAngle: NON_PLAYER.minSlopeSlideAngle,
        autostepMaxHeight: NON_PLAYER.autostepMaxHeight,
        autostepMinWidth: NON_PLAYER.autostepMinWidth,
        snapToGroundDistance: NON_PLAYER.snapToGroundDistance,
        terminalVelocity: NON_PLAYER.terminalVelocity,
        groundAcceleration: NON_PLAYER.acceleration,
        airAcceleration: NON_PLAYER.acceleration * NON_PLAYER.airAccelerationFraction,
        pushesDynamicBodies: false,
    };
}
