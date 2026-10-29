import { EnemyBehaviour, LookAround } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { INVESTIGATE, SEARCH, PATROL, RETURN_HOME } from "@/constants/enemies";
import { FULL_TURN, horizontalDistance, scaleBetween, yawTowards, lerp } from "@/lib/helpers";
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
