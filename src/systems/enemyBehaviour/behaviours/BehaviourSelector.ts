import type { IEnemyBehaviour } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { AlertPhase } from "@/types/combat";

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
