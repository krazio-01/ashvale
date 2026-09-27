import type { IEnemyBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import { LOOK_AROUND } from "@/constants/enemies";
import { scaleBetween } from "@/lib/helpers";

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
