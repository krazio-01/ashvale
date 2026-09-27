import { EnemyBehaviour } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import { LookAround } from "@/systems/enemyBehaviour/behaviours/LookAround";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { INVESTIGATE, SEARCH } from "@/constants/enemies";
import { FULL_TURN, horizontalDistance, scaleBetween, yawTowards } from "@/lib/helpers";
import { Vector3 } from "three";

type InvestigationStage = "hesitating" | "approaching" | "looking";

export class InvestigateBehaviour extends EnemyBehaviour {
    private readonly lookAround: LookAround;
    private stage: InvestigationStage = "hesitating";
    private hesitationRemaining = 0;

    constructor(body: IEnemyBody, awareness: AwarenessMeter, random: () => number) {
        super(body, awareness, random);
        this.lookAround = new LookAround(body, random);
    }

    enter(): void {
        this.stage = "hesitating";
        this.hesitationRemaining = INVESTIGATE.hesitateSeconds;
    }

    tick(deltaSeconds: number): void {
        const lead = this.awareness.lastKnownPosition;

        if (this.stage === "hesitating") {
            this.body.holdStill();
            this.body.lookTowards(yawTowards(this.body.position, lead));
            this.hesitationRemaining -= deltaSeconds;
            if (this.hesitationRemaining <= 0) this.stage = "approaching";
            return;
        }

        if (this.stage === "approaching") {
            const remaining = this.body.moveTowards(
                lead,
                this.body.archetype.patrolSpeed,
                INVESTIGATE.arriveDistance
            );
            if (remaining > INVESTIGATE.arriveDistance) return;

            this.stage = "looking";
            this.lookAround.reset();
            return;
        }

        if (horizontalDistance(this.body.position, lead) > INVESTIGATE.arriveDistance * 2) {
            this.stage = "approaching";
            return;
        }

        this.body.holdStill();
        this.lookAround.tick(deltaSeconds);
    }
}

export class SearchBehaviour extends EnemyBehaviour {
    private readonly waypoint = new Vector3();
    private readonly lookAround: LookAround;
    private isWalking = false;
    private stageRemaining = 0;

    constructor(body: IEnemyBody, awareness: AwarenessMeter, random: () => number) {
        super(body, awareness, random);
        this.lookAround = new LookAround(body, random);
    }

    enter(): void {
        this.beginLeg();
    }

    tick(deltaSeconds: number): void {
        this.stageRemaining -= deltaSeconds;

        if (this.isWalking) {
            const remaining = this.body.moveTowards(
                this.waypoint,
                this.body.archetype.patrolSpeed,
                SEARCH.arriveDistance
            );
            if (remaining <= SEARCH.arriveDistance || this.stageRemaining <= 0) this.pause();
            return;
        }

        this.body.holdStill();
        this.lookAround.tick(deltaSeconds);
        if (this.stageRemaining <= 0) this.beginLeg();
    }

    private pause(): void {
        this.isWalking = false;
        this.stageRemaining = scaleBetween(SEARCH.pauseSeconds, this.random());
        this.lookAround.reset();
    }

    private beginLeg(): void {
        const centre = this.awareness.lastKnownPosition;
        const angle = this.random() * FULL_TURN;
        const distance = this.random() * SEARCH.radius;
        this.waypoint.set(
            centre.x + Math.sin(angle) * distance,
            centre.y,
            centre.z + Math.cos(angle) * distance
        );
        this.isWalking = true;
        this.stageRemaining = SEARCH.maxLegSeconds;
    }
}
