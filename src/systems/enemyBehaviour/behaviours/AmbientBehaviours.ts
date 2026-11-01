import { Vector3 } from "three";
import { EnemyBehaviour, LookAround } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { PATROL, RETURN_HOME, INVESTIGATE, SEARCH } from "@/constants/enemies";
import { FULL_TURN, valueInRange, pointAtYaw, horizontalDistance, yawTowards } from "@/lib/helpers";
import type { RandomSource } from "@/lib/helpers";
import type { IWanderTuning } from "@/types/combat";

type InvestigationStage = "hesitating" | "approaching" | "looking";

abstract class WanderBehaviour extends EnemyBehaviour {
    private readonly tuning: IWanderTuning;
    private readonly waypoint = new Vector3();
    private readonly lookAround: LookAround;
    private isWalking = false;
    private stageRemaining = 0;

    constructor(
        body: IEnemyBody,
        awareness: AwarenessMeter,
        random: RandomSource,
        tuning: IWanderTuning
    ) {
        super(body, awareness, random);
        this.tuning = tuning;
        this.lookAround = new LookAround(body, random);
    }

    tick(deltaSeconds: number): void {
        this.stageRemaining -= deltaSeconds;

        if (this.isWalking) {
            const remaining = this.body.moveTowards(
                this.waypoint,
                this.body.archetype.patrolSpeed,
                this.tuning.arriveDistance
            );
            if (remaining <= this.tuning.arriveDistance || this.stageRemaining <= 0)
                this.pauseAtWaypoint();
            return;
        }

        this.body.holdStill();
        this.lookAround.tick(deltaSeconds);
        if (this.stageRemaining <= 0) this.walkToNewWaypoint();
    }

    protected abstract wanderCentre(): Vector3;

    protected abstract wanderRadius(): number;

    protected pauseAtWaypoint(): void {
        this.isWalking = false;
        this.stageRemaining = valueInRange(this.tuning.pauseSeconds, this.random());
        this.lookAround.reset();
    }

    protected walkToNewWaypoint(): void {
        const radius = this.wanderRadius();
        if (radius <= 0) {
            this.pauseAtWaypoint();
            return;
        }

        const angle = this.random() * FULL_TURN;
        const distance = valueInRange(this.tuning.distanceFraction, this.random()) * radius;
        pointAtYaw(this.wanderCentre(), angle, distance, this.waypoint);
        this.isWalking = true;
        this.stageRemaining = this.tuning.maxWalkSeconds;
    }
}

export class PatrolBehaviour extends WanderBehaviour {
    constructor(body: IEnemyBody, awareness: AwarenessMeter, random: RandomSource) {
        super(body, awareness, random, PATROL);
    }

    enter(): void {
        this.pauseAtWaypoint();
    }

    protected wanderCentre(): Vector3 {
        return this.body.home;
    }

    protected wanderRadius(): number {
        return this.body.archetype.wanderRadius;
    }
}

export class SearchBehaviour extends WanderBehaviour {
    constructor(body: IEnemyBody, awareness: AwarenessMeter, random: RandomSource) {
        super(body, awareness, random, SEARCH);
    }

    enter(): void {
        this.walkToNewWaypoint();
    }

    protected wanderCentre(): Vector3 {
        return this.awareness.lastKnownPosition;
    }

    protected wanderRadius(): number {
        return SEARCH.radius;
    }
}

export class InvestigateBehaviour extends EnemyBehaviour {
    private readonly lookAround: LookAround;
    private stage: InvestigationStage = "hesitating";
    private hesitationRemaining = 0;

    constructor(body: IEnemyBody, awareness: AwarenessMeter, random: RandomSource) {
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
            this.body.setFacingYaw(yawTowards(this.body.position, lead));
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

export class ReturnHomeBehaviour extends EnemyBehaviour {
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
            this.awareness.finishReturningHome();
    }
}
