import { Group, Vector3 } from "three";
import type { CombatEvents, ICombatEventMap } from "@/systems/combat/services/CombatEvents";
import { NOISE } from "@/constants/enemies";
import type { ICombatant } from "@/types/combat";
import type { IWorldEntity } from "@/types/world";

export class CombatNoise implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly events: CombatEvents;
    private readonly silentVictims = new WeakSet<ICombatant>();
    private readonly noise: ICombatEventMap["noise"] = { position: new Vector3(), radius: 0 };
    private readonly unsubscribers: (() => void)[];

    constructor(events: CombatEvents) {
        this.events = events;
        this.unsubscribers = [
            events.on("hitLanded", (event) => this.emit(event.point, NOISE.combatRadius)),
            events.on("parried", (event) =>
                this.emit(event.defender.sceneObject.position, NOISE.combatRadius)
            ),
            events.on("finisherStarted", (event) => {
                if (event.finisher.kind === "backstab") this.silentVictims.add(event.victim);
            }),
            events.on("killed", (event) => {
                if (this.silentVictims.has(event.combatant)) return;
                this.emit(event.combatant.sceneObject.position, NOISE.deathCryRadius);
            }),
        ];
    }

    update(): void {}

    dispose(): void {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
    }

    private emit(position: Vector3, radius: number): void {
        this.noise.position.copy(position);
        this.noise.radius = radius;
        this.events.emit("noise", this.noise);
    }
}
