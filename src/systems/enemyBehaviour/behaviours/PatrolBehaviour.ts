import { Vector3 } from "three";
import { EnemyBehaviour } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import { LookAround } from "@/systems/enemyBehaviour/behaviours/LookAround";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { PATROL, RETURN_HOME } from "@/constants/enemies";
import { FULL_TURN, lerp, scaleBetween } from "@/lib/helpers";

export class PatrolBehaviour extends EnemyBehaviour {
    private readonly waypoint = new Vector3();
    private readonly lookAround: LookAround;
    private isStrolling = false;
    private stageRemaining = 0;

    constructor(body: IEnemyBody, awareness: AwarenessMeter, random: () => number) {
        super(body, awareness, random);
        this.lookAround = new LookAround(body, random);
    }

    enter(): void {
        this.rest();
    }

    tick(deltaSeconds: number): void {
        this.stageRemaining -= deltaSeconds;

        if (this.isStrolling) {
            const remaining = this.body.moveTowards(
                this.waypoint,
                this.body.archetype.patrolSpeed,
                PATROL.arriveDistance
            );
            if (remaining <= PATROL.arriveDistance || this.stageRemaining <= 0) this.rest();
            return;
        }

        this.body.holdStill();
        this.lookAround.tick(deltaSeconds);
        if (this.stageRemaining <= 0) this.beginStroll();
    }

    private rest(): void {
        this.isStrolling = false;
        this.stageRemaining = scaleBetween(PATROL.restSeconds, this.random());
        this.lookAround.reset();
    }

    private beginStroll(): void {
        const wanderRadius = this.body.archetype.wanderRadius;
        if (wanderRadius <= 0) {
            this.rest();
            return;
        }

        const angle = this.random() * FULL_TURN;
        const distance = lerp(PATROL.minimumStrollFraction, 1, this.random()) * wanderRadius;
        const home = this.body.home;
        this.waypoint.set(
            home.x + Math.sin(angle) * distance,
            home.y,
            home.z + Math.cos(angle) * distance
        );
        this.isStrolling = true;
        this.stageRemaining = PATROL.maxStrollSeconds;
    }
}

export class DisengageBehaviour extends EnemyBehaviour {
    private elapsed = 0;

    enter(): void {
        this.elapsed = 0;
    }

    tick(deltaSeconds: number): void {
        this.elapsed += deltaSeconds;
        const remaining = this.body.moveTowards(
            this.body.home,
            this.body.archetype.patrolSpeed,
            RETURN_HOME.arriveDistance
        );

        if (remaining <= RETURN_HOME.arriveDistance || this.elapsed >= RETURN_HOME.giveUpSeconds)
            this.awareness.settle();
    }
}
