import type { Vector3 } from "three";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { LOOK_AROUND } from "@/constants/enemies";
import type { IEnemyArchetype } from "@/constants/enemies";
import { scaleBetween } from "@/lib/helpers";
import type { AlertPhase } from "@/types/combat";

export interface IEnemyBody {
    readonly position: Vector3;
    readonly home: Vector3;
    readonly yaw: number;
    readonly archetype: IEnemyArchetype;
    moveTowards(point: Vector3, speed: number, stopDistance: number, pointRadius?: number): number;
    holdStill(): void;
    lookTowards(yaw: number): void;
}

export interface IEnemyCombatBody extends IEnemyBody {
    readonly bodyRadius: number;
    readonly activeMoveId: string | null;
    readonly healthFraction: number;
    faceTarget(): void;
    relax(): void;
    moveAwayFrom(point: Vector3, speed: number): void;
    performMove(moveId: string): boolean;
}

export interface IEnemyBehaviour {
    enter(): void;
    tick(deltaSeconds: number): void;
    exit(): void;
}

export abstract class EnemyBehaviour<
    Body extends IEnemyBody = IEnemyBody,
> implements IEnemyBehaviour {
    protected readonly body: Body;
    protected readonly awareness: AwarenessMeter;
    protected readonly random: () => number;

    constructor(body: Body, awareness: AwarenessMeter, random: () => number) {
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
    private readonly random: () => number;
    private secondsUntilGlance = 0;
    private baseYaw = 0;

    constructor(body: IEnemyBody, random: () => number) {
        this.body = body;
        this.random = random;
    }

    reset(): void {
        this.secondsUntilGlance = 0;
        this.baseYaw = this.body.yaw;
    }

    tick(deltaSeconds: number): void {
        this.secondsUntilGlance -= deltaSeconds;
        if (this.secondsUntilGlance > 0) return;

        this.secondsUntilGlance = scaleBetween(LOOK_AROUND.glanceSeconds, this.random());
        this.body.lookTowards(this.baseYaw + (this.random() * 2 - 1) * LOOK_AROUND.maxTurn);
    }
}

export class BehaviourSelector {
    private readonly behaviours: Readonly<Record<AlertPhase, IEnemyBehaviour>>;
    private active: IEnemyBehaviour | null = null;

    constructor(behaviours: Readonly<Record<AlertPhase, IEnemyBehaviour>>) {
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
