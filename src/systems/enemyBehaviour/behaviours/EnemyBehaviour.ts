import type { Vector3 } from "three";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type { IEnemyArchetype } from "@/constants/enemies";
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
