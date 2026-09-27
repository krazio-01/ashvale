import { Vector3 } from "three";
import type { CombatEvents, ICombatEventMap } from "@/systems/combat/services/CombatEvents";

export class HearingSensor {
    readonly heardPosition = new Vector3();
    private readonly listenerPosition: Vector3;
    private readonly unsubscribe: () => void;
    private loudest = 0;

    constructor(events: CombatEvents, listenerPosition: Vector3) {
        this.listenerPosition = listenerPosition;
        this.unsubscribe = events.on("noise", (noise) => this.hear(noise));
    }

    consumeLoudness(): number {
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
