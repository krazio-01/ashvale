import { Vector3 } from "three";
import type { Object3D } from "three";
import type { CombatEvents, ICombatEventMap } from "@/systems/combat/services/CombatEvents";
import { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type { IAwarenessStimulus } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type { HearingSensor } from "@/systems/enemyBehaviour/perception/HearingSensor";
import type { ISightSensor } from "@/systems/enemyBehaviour/perception/SightSensor";
import { AWARENESS, SIGHT } from "@/constants/enemies";
import type { ICombatant } from "@/types/combat";

interface IPerceivedTarget {
    readonly isDead: boolean;
    readonly sceneObject: Object3D;
    readonly stealthVisibility: number;
}

interface IPerceivingBody extends ICombatant {
    readonly position: Vector3;
    readonly yaw: number;
    readonly eyeLift: number;
}

const scratchEye = new Vector3();
const scratchTargetPoint = new Vector3();

export class EnemyPerception {
    readonly meter = new AwarenessMeter();

    private readonly body: IPerceivingBody;
    private readonly target: IPerceivedTarget;
    private readonly sight: ISightSensor;
    private readonly hearing: HearingSensor;
    private readonly events: CombatEvents;
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
        sight: ISightSensor,
        hearing: HearingSensor,
        events: CombatEvents
    ) {
        this.body = body;
        this.target = target;
        this.sight = sight;
        this.hearing = hearing;
        this.events = events;
        this.alarm = { raiser: body, position: new Vector3() };
        this.unsubscribe = events.on("alarmRaised", (event) => this.hearAlarm(event));
    }

    tick(deltaSeconds: number): void {
        if (this.target.isDead) {
            this.meter.standDown();
            return;
        }

        const targetPosition = this.target.sceneObject.position;
        const eye = scratchEye.copy(this.body.position);
        eye.y += this.body.eyeLift;
        const targetPoint = scratchTargetPoint.copy(targetPosition);
        targetPoint.y += SIGHT.targetLift;

        const stimulus = this.stimulus;
        stimulus.sightStrength = this.sight.sense(
            eye,
            this.body.yaw,
            targetPoint,
            this.target.stealthVisibility,
            deltaSeconds
        );
        stimulus.sightPosition.copy(targetPosition);
        stimulus.heardLoudness = this.hearing.consumeLoudness();
        stimulus.heardPosition.copy(this.hearing.heardPosition);
        this.meter.tick(deltaSeconds, stimulus);

        if (!this.meter.consumeAlarm()) return;

        this.alarm.position.copy(this.meter.lastKnownPosition);
        this.events.emit("alarmRaised", this.alarm);
    }

    notifyDamaged(attackerPosition: Vector3): void {
        this.meter.alarm(attackerPosition, true);
    }

    dispose(): void {
        this.unsubscribe();
        this.hearing.dispose();
    }

    private hearAlarm(event: ICombatEventMap["alarmRaised"]): void {
        if (event.raiser === this.body || this.target.isDead) return;

        const raiserDistance = this.body.position.distanceTo(event.raiser.sceneObject.position);
        if (raiserDistance > AWARENESS.alarmRadius) return;

        this.meter.alarm(event.position, false);
    }
}
