import { Vector3 } from "three";
import type { Vector3Tuple } from "three";
import { CombatCharacter } from "@/entities/characters/CombatCharacter";
import { enemyCombatLocomotion, enemyRelaxedLocomotion } from "@/entities/characters/locomotion";
import { BehaviourSelector } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyCombatBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import { EngageBehaviour } from "@/systems/enemyBehaviour/behaviours/CombatBehaviours";
import {
    InvestigateBehaviour,
    SearchBehaviour,
    ReturnHomeBehaviour,
    PatrolBehaviour,
} from "@/systems/enemyBehaviour/behaviours/AmbientBehaviours";
import { EnemySteering } from "@/systems/enemyBehaviour/EnemySteering";
import { EnemyPerception } from "@/systems/enemyBehaviour/perception/EnemyPerception";
import type { IEnemyArchetype, AwarenessState, ICombatant, IHitPayload } from "@/types/combat";
import { IDLE_VARIATION } from "@/constants/characters";
import { ENEMY_MOVEMENT, SIGHT } from "@/constants/enemies";
import { COMBAT_MOVEMENT } from "@/constants/combat";
import { HUD } from "@/constants/ui";
import { alertMarkerFillFor, alertMarkerKindFor } from "@/world/HudTrackers";
import type { IAlertMarkerSource } from "@/world/HudTrackers";
import { horizontalDirection, randomOffset } from "@/lib/helpers";
import type { AlertMarkerKind } from "@/types/ui";
import type { IWorldContext } from "@/types/world";
import type { IMotorSpec } from "@/types/physics";
import { ERRORS } from "@/constants/strings";

interface IEnemyOptions {
    id: string;
    archetype: IEnemyArchetype;
    context: IWorldContext;
    spawnPosition: Vector3Tuple;
    spawnYaw: number;
    player: CombatCharacter | null;
    passive: boolean;
}

export class Enemy extends CombatCharacter implements IEnemyCombatBody, IAlertMarkerSource {
    private static enemyMotor(archetype: IEnemyArchetype): IMotorSpec {
        return {
            height: archetype.height,
            radius: archetype.radius,
            ...ENEMY_MOVEMENT.motor,
            pushesDynamicBodies: false,
        };
    }

    readonly archetype: IEnemyArchetype;

    readonly home: Vector3;
    private readonly player: CombatCharacter | null;
    private readonly steering: EnemySteering;
    private readonly brain: {
        perception: EnemyPerception;
        engageBehaviour: EngageBehaviour;
        behaviourSelector: BehaviourSelector;
    } | null;
    private hasStoppedDeciding = false;

    constructor(options: IEnemyOptions) {
        const model = options.context.assetLibrary.getSkinnedModel(options.archetype.modelPath);
        if (!model) throw new Error(ERRORS.modelNotLoaded("enemy", options.archetype.modelPath));

        super({
            id: options.id,
            team: "enemy",
            context: options.context,
            model,
            motor: Enemy.enemyMotor(options.archetype),
            vitals: options.archetype.vitals,
            moveSet: options.archetype.moveSet,
            freeLocomotion: enemyRelaxedLocomotion(
                options.archetype.height,
                IDLE_VARIATION.relaxedDelaySeconds *
                    (1 + randomOffset(Math.random, IDLE_VARIATION.delayJitter))
            ),
            strafeLocomotion: enemyCombatLocomotion(options.archetype.height),
            victimRig: options.archetype.victimRig,
            turnSmoothing: ENEMY_MOVEMENT.turnSmoothing,
            modelYawOffset: 0,
            spawnPosition: options.spawnPosition,
            spawnYaw: options.spawnYaw,
            hitEffect: "hitFlash",
        });

        this.archetype = options.archetype;
        if (options.archetype.weapon) this.equipWeapon(options.archetype.weapon);
        this.home = new Vector3().fromArray(options.spawnPosition);
        this.player = options.player;
        this.steering = new EnemySteering(this, options.context.combatRegistry);

        if (options.passive || !options.player) {
            this.brain = null;
            return;
        }

        const perception = new EnemyPerception(
            this,
            options.player,
            options.context.physicsWorld,
            this.motor.collider,
            options.context.events
        );
        const awareness = perception.awareness;
        const random = Math.random;
        const engageBehaviour = new EngageBehaviour(
            this,
            awareness,
            options.player,
            random,
            options.context.attackCoordinator,
            options.id
        );

        this.brain = {
            perception,
            engageBehaviour,
            behaviourSelector: new BehaviourSelector({
                unaware: new PatrolBehaviour(this, awareness, random),
                suspicious: new InvestigateBehaviour(this, awareness, random),
                alert: engageBehaviour,
                searching: new SearchBehaviour(this, awareness, random),
                returning: new ReturnHomeBehaviour(this, awareness, random),
            }),
        };
    }

    get attackPower(): number {
        return this.archetype.attackPower;
    }

    get awareness(): AwarenessState {
        if (this.archetype.alwaysAware) return "alert";
        return this.brain?.perception.awareness.state ?? "unaware";
    }

    get displayName(): string {
        return this.archetype.label;
    }

    get canBeCounterKilled(): boolean {
        return this.archetype.counterKillable;
    }

    get eyeHeight(): number {
        return this.archetype.height * SIGHT.eyeHeightFraction;
    }

    get alertMarkerHeight(): number {
        return this.archetype.height * HUD.alertMarkerLift;
    }

    get alertMarkerKind(): AlertMarkerKind | null {
        return this.brain ? alertMarkerKindFor(this.brain.perception.awareness, this.isDead) : null;
    }

    get alertMarkerFill(): number {
        return this.brain ? alertMarkerFillFor(this.brain.perception.awareness) : 0;
    }

    moveTowards(point: Vector3, speed: number, stopDistance: number, pointRadius = 0): number {
        const distance = horizontalDirection(this.position, point, this.desiredVelocity);
        if (distance <= stopDistance || distance < COMBAT_MOVEMENT.minimumPlanarLength) {
            this.holdStill();
            return distance;
        }

        this.steering.steer(this.desiredVelocity, speed, distance - this.bodyRadius - pointRadius);
        return distance;
    }

    moveAwayFrom(point: Vector3, speed: number): void {
        const distance = horizontalDirection(point, this.position, this.desiredVelocity);
        if (distance < COMBAT_MOVEMENT.minimumPlanarLength) {
            this.holdStill();
            return;
        }

        this.steering.steer(this.desiredVelocity, speed, Number.POSITIVE_INFINITY);
    }

    holdStill(): void {
        this.desiredVelocity.set(0, 0, 0);
        this.steering.steer(this.desiredVelocity, this.archetype.patrolSpeed, 0);
    }

    setFacingYaw(yaw: number): void {
        this.facingYaw = yaw;
    }

    startFacingTarget(): void {
        this.facesTarget = true;
        this.target = this.player;
    }

    stopFacingTarget(): void {
        this.facesTarget = false;
    }

    performMove(moveId: string): boolean {
        this.target = this.player;
        return this.moveStateMachine.startMove(moveId);
    }

    isObstacleAhead(directionX: number, directionZ: number, distance: number): boolean {
        return this.motor.isObstacleAhead(directionX, directionZ, distance);
    }

    dispose(): void {
        this.stopDeciding();
        super.dispose();
    }

    protected decideActions(deltaSeconds: number): void {
        this.steering.tick(deltaSeconds);
        const brain = this.brain;
        if (!brain) return;

        brain.perception.tick(deltaSeconds);
        brain.behaviourSelector.tick(brain.perception.awareness.phase, deltaSeconds);
    }

    protected onDamaged(payload: IHitPayload): void {
        this.brain?.perception.notifyDamaged(payload.origin);
        if (payload.impact === "light") this.brain?.engageBehaviour.notifyLightHitLanded();
    }

    protected onParrySucceeded(attacker: ICombatant): void {
        this.target = attacker;
        this.moveStateMachine.startMove(this.archetype.counterAttackMove, true);
    }

    protected onKilled(): void {
        this.stopDeciding();
    }

    private stopDeciding(): void {
        if (this.hasStoppedDeciding) return;
        this.hasStoppedDeciding = true;
        this.brain?.behaviourSelector.stop();
        this.brain?.perception.dispose();
    }
}
