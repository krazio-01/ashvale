import { Vector3 } from "three";
import type { CombatEvents, ICombatEventMap } from "@/systems/combat/services/CombatEvents";
import { NOISE } from "@/constants/enemies";
export type FootstepGait = keyof typeof NOISE.footstepRadius;

export class FootstepNoise {
    private readonly events: CombatEvents;
    private readonly noise: ICombatEventMap["noise"] = { position: new Vector3(), radius: 0 };
    private secondsUntilStep = 0;

    constructor(events: CombatEvents) {
        this.events = events;
    }

    tick(deltaSeconds: number, gait: FootstepGait, position: Vector3): void {
        const radius = NOISE.footstepRadius[gait];
        if (radius <= 0) {
            this.secondsUntilStep = 0;
            return;
        }

        this.secondsUntilStep -= deltaSeconds;
        if (this.secondsUntilStep > 0) return;

        this.secondsUntilStep = NOISE.footstepIntervalSeconds;
        this.noise.position.copy(position);
        this.noise.radius = radius;
        this.events.emit("noise", this.noise);
    }
}
