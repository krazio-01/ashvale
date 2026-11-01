import { Vector3 } from "three";
import type { ICombatEventMap } from "@/events/CombatEvents";
import type { GameEvents } from "@/events/EventEmitter";
import { HEARING } from "@/constants/enemies";
export type FootstepGait = keyof typeof HEARING.footstepRadius;

export class FootstepNoise {
    private readonly events: GameEvents;
    private readonly noise: ICombatEventMap["noise"] = { position: new Vector3(), radius: 0 };
    private secondsUntilStep = 0;

    constructor(events: GameEvents) {
        this.events = events;
    }

    tick(deltaSeconds: number, gait: FootstepGait, position: Vector3): void {
        const radius = HEARING.footstepRadius[gait];
        if (radius <= 0) {
            this.secondsUntilStep = 0;
            return;
        }

        this.secondsUntilStep -= deltaSeconds;
        if (this.secondsUntilStep > 0) return;

        this.secondsUntilStep = HEARING.footstepIntervalSeconds;
        this.noise.position.copy(position);
        this.noise.radius = radius;
        this.events.emit("noise", this.noise);
    }
}
