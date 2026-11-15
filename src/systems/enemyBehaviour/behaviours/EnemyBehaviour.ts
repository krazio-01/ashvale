import type { Vector3 } from "three";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type { IEnemyArchetype, AlertPhase } from "@/types/combat";
import { valueInRange, randomOffset } from "@/lib/helpers";
import type { RandomSource } from "@/lib/helpers";

export interface IEnemyBody {
    readonly position: Vector3;
    readonly home: Vector3;
    readonly yaw: number;
    readonly archetype: IEnemyArchetype;
    moveTowards(point: Vector3, speed: number, stopDistance: number, pointRadius?: number): number;
    holdStill(): void;
    setFacingYaw(yaw: number): void;
}

export interface IEnemyCombatBody extends IEnemyBody {
    readonly bodyRadius: number;
    readonly activeMoveId: string | null;
    readonly healthFraction: number;
    startFacingTarget(): void;
    stopFacingTarget(): void;
    moveAwayFrom(point: Vector3, speed: number): void;
    performMove(moveId: string): boolean;
}

export abstract class EnemyBehaviour<Body extends IEnemyBody = IEnemyBody> {
    protected readonly body: Body;
    protected readonly awareness: AwarenessMeter;
    protected readonly random: RandomSource;

    constructor(body: Body, awareness: AwarenessMeter, random: RandomSource) {
        this.body = body;
        this.awareness = awareness;
        this.random = random;
    }

    enter(): void {}

    abstract tick(deltaSeconds: number): void;

    exit(): void {}
}

export class LookAround {
    private readonly body: IEnemyBody;
    private readonly random: RandomSource;
    private secondsUntilTurn = 0;
    private isGlancing = false;
    private baseYaw = 0;

    constructor(body: IEnemyBody, random: RandomSource) {
        this.body = body;
        this.random = random;
    }

    reset(): void {
        this.isGlancing = false;
        this.secondsUntilTurn = valueInRange(this.body.archetype.look.restSeconds, this.random());
        this.baseYaw = this.body.yaw;
    }

    tick(deltaSeconds: number): void {
        this.secondsUntilTurn -= deltaSeconds;
        if (this.secondsUntilTurn > 0) return;

        const { restSeconds, glanceSeconds, maxTurn } = this.body.archetype.look;
        this.isGlancing = !this.isGlancing;
        this.secondsUntilTurn = valueInRange(
            this.isGlancing ? glanceSeconds : restSeconds,
            this.random()
        );
        this.body.setFacingYaw(
            this.isGlancing ? this.baseYaw + randomOffset(this.random, maxTurn) : this.baseYaw
        );
    }
}

export class BehaviourSelector {
    private readonly behaviours: Readonly<Record<AlertPhase, EnemyBehaviour>>;
    private active: EnemyBehaviour | null = null;

    constructor(behaviours: Readonly<Record<AlertPhase, EnemyBehaviour>>) {
        this.behaviours = behaviours;
    }

    tick(phase: AlertPhase, deltaSeconds: number): void {
        const next = this.behaviours[phase];
        if (next !== this.active) {
            this.active?.exit();
            this.active = next;
            next.enter();
        }

        next.tick(deltaSeconds);
    }

    stop(): void {
        this.active?.exit();
        this.active = null;
    }
}
