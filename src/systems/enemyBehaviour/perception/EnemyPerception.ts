import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Object3D } from "three";
import type { ICombatEventMap } from "@/events/CombatEvents";
import type { GameEvents } from "@/events/EventEmitter";
import { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type { IAwarenessStimulus } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { isSegmentBlocked } from "@/systems/physics/RapierWorld";
import { AWARENESS, SIGHT } from "@/constants/enemies";
import { COMBAT_MOVEMENT } from "@/constants/combat";
import {
    shortestAngleBetween,
    clamp,
    horizontalDistance,
    lerp,
    smoothstep,
    yawTowards,
} from "@/lib/helpers";
import type { ICombatant } from "@/types/combat";

interface IPerceivedTarget {
    readonly isDead: boolean;
    readonly sceneObject: Object3D;
    readonly stealthVisibility: number;
}

interface IPerceivingBody extends ICombatant {
    readonly position: Vector3;
    readonly yaw: number;
    readonly eyeHeight: number;
}

class SightSensor {
    private static coneStrength(
        eye: Vector3,
        facingYaw: number,
        target: Vector3,
        distance: number
    ): number {
        if (distance < COMBAT_MOVEMENT.minimumPlanarLength) return 1;
        if (distance > SIGHT.farRange) return 0;

        const bearing = Math.abs(shortestAngleBetween(facingYaw, yawTowards(eye, target)));

        if (distance <= SIGHT.nearRange && bearing <= SIGHT.nearHalfAngle)
            return lerp(
                1,
                SIGHT.nearEdgeStrength,
                smoothstep(SIGHT.nearRange * 0.4, SIGHT.nearRange, distance)
            );

        if (bearing <= SIGHT.farHalfAngle)
            return (
                SIGHT.farStrength *
                (1 - (distance - SIGHT.nearRange) / (SIGHT.farRange - SIGHT.nearRange))
            );

        return 0;
    }

    private static proximitySenseStrength(distance: number, visibility: number): number {
        if (distance > SIGHT.proximitySenseRange) return 0;

        const standingShare = clamp(
            (visibility - SIGHT.crouchedVisibility) / (1 - SIGHT.crouchedVisibility),
            0,
            1
        );
        return SIGHT.proximitySenseStrength * standingShare;
    }

    private readonly physicsWorld: PhysicsWorld;
    private readonly ownCollider: Collider;
    private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    private secondsUntilCheck = 0;
    private wasInCone = false;
    private isLineClear = false;

    constructor(physicsWorld: PhysicsWorld, ownCollider: Collider) {
        this.physicsWorld = physicsWorld;
        this.ownCollider = ownCollider;
    }

    measureSightStrength(
        eye: Vector3,
        facingYaw: number,
        target: Vector3,
        visibility: number,
        deltaSeconds: number
    ): number {
        const distance = horizontalDistance(eye, target);
        const proximitySense = SightSensor.proximitySenseStrength(distance, visibility);
        const cone = SightSensor.coneStrength(eye, facingYaw, target, distance);
        if (cone <= 0) {
            this.wasInCone = false;
            return proximitySense;
        }

        this.secondsUntilCheck -= deltaSeconds;
        if (!this.wasInCone || this.secondsUntilCheck <= 0) {
            this.isLineClear = this.hasClearLine(eye, target);
            this.secondsUntilCheck = SIGHT.lineOfSightInterval;
        }
        this.wasInCone = true;

        return Math.max(proximitySense, this.isLineClear ? cone * visibility : 0);
    }

    private hasClearLine(eye: Vector3, target: Vector3): boolean {
        return !isSegmentBlocked(this.physicsWorld, this.ray, eye, target, this.ownCollider);
    }
}

class HearingSensor {
    readonly heardPosition = new Vector3();
    private readonly listenerPosition: Vector3;
    private readonly unsubscribe: () => void;
    private loudest = 0;

    constructor(events: GameEvents, listenerPosition: Vector3) {
        this.listenerPosition = listenerPosition;
        this.unsubscribe = events.on("noise", (noise) => this.hear(noise));
    }

    takeHeardLoudness(): number {
        const loudness = this.loudest;
        this.loudest = 0;
        return loudness;
    }

    dispose(): void {
        this.unsubscribe();
    }

    private hear(noise: ICombatEventMap["noise"]): void {
        if (noise.radius <= 0) return;

        const loudness = 1 - this.listenerPosition.distanceTo(noise.position) / noise.radius;
        if (loudness <= this.loudest) return;

        this.loudest = loudness;
        this.heardPosition.copy(noise.position);
    }
}

export class EnemyPerception {
    private static readonly scratchEye = new Vector3();

    private static readonly scratchTargetPoint = new Vector3();

    readonly awareness = new AwarenessMeter();

    private readonly body: IPerceivingBody;
    private readonly target: IPerceivedTarget;
    private readonly sight: SightSensor;
    private readonly hearing: HearingSensor;
    private readonly events: GameEvents;
    private readonly stimulus: IAwarenessStimulus = {
        sightStrength: 0,
        sightPosition: new Vector3(),
        heardLoudness: 0,
        heardPosition: new Vector3(),
    };
    private readonly alarm: ICombatEventMap["alarmRaised"];
    private readonly unsubscribe: () => void;

    constructor(
        body: IPerceivingBody,
        target: IPerceivedTarget,
        physicsWorld: PhysicsWorld,
        ownCollider: Collider,
        events: GameEvents
    ) {
        this.body = body;
        this.target = target;
        this.sight = new SightSensor(physicsWorld, ownCollider);
        this.hearing = new HearingSensor(events, body.position);
        this.events = events;
        this.alarm = { raiser: body, position: new Vector3() };
        this.unsubscribe = events.on("alarmRaised", (event) => this.hearAlarm(event));
    }

    tick(deltaSeconds: number): void {
        if (this.target.isDead) {
            this.awareness.forceReturnHome();
            return;
        }

        const targetPosition = this.target.sceneObject.position;
        const eye = EnemyPerception.scratchEye.copy(this.body.position);
        eye.y += this.body.eyeHeight;
        const targetPoint = EnemyPerception.scratchTargetPoint.copy(targetPosition);
        targetPoint.y += SIGHT.targetLift;

        const stimulus = this.stimulus;
        stimulus.sightStrength = this.sight.measureSightStrength(
            eye,
            this.body.yaw,
            targetPoint,
            this.target.stealthVisibility,
            deltaSeconds
        );
        stimulus.sightPosition.copy(targetPosition);
        stimulus.heardLoudness = this.hearing.takeHeardLoudness();
        stimulus.heardPosition.copy(this.hearing.heardPosition);
        this.awareness.tick(deltaSeconds, stimulus);

        if (!this.awareness.consumeAlarm()) return;

        this.alarm.position.copy(this.awareness.lastKnownPosition);
        this.events.emit("alarmRaised", this.alarm);
    }

    notifyDamaged(attackerPosition: Vector3): void {
        this.awareness.raiseAlarm(attackerPosition, true);
    }

    dispose(): void {
        this.unsubscribe();
        this.hearing.dispose();
    }

    private hearAlarm(event: ICombatEventMap["alarmRaised"]): void {
        if (event.raiser === this.body || this.target.isDead) return;

        const raiserDistance = this.body.position.distanceTo(event.raiser.sceneObject.position);
        if (raiserDistance > AWARENESS.alarmRadius) return;

        this.awareness.raiseAlarm(event.position, false);
    }
}
