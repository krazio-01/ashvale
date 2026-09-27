import { Group, Vector3 } from "three";
import type { Camera } from "three";
import type { CombatEvents } from "@/systems/combat/services/CombatEvents";
import { store } from "@/store/store";
import { HUD } from "@/constants/presentation";
import { metres } from "@/lib/helpers";
import type { IWorldEntity } from "@/types/world";

const SPAWN_HEIGHT = metres(0.4);
const RISE_PER_SECOND = metres(HUD.damageNumberRise * 10);
const scratchProjection = new Vector3();

export class DamageNumberProjector implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly unsubscribe: () => void;

    constructor(events: CombatEvents, camera: Camera) {
        this.camera = camera;
        this.unsubscribe = events.on("hitLanded", (event) => {
            if (event.attacker.team !== "player" && event.defender.team !== "player") return;

            const point = event.point;
            store
                .getState()
                .hud.spawnDamageNumber(
                    point.x,
                    point.y + SPAWN_HEIGHT,
                    point.z,
                    Math.round(event.outcome.damageDealt),
                    event.impact !== "light" || event.outcome.kind !== "damaged"
                );
        });
    }

    update(deltaSeconds: number): void {
        store.getState().hud.ageDamageNumbers(deltaSeconds);

        const frame = store.getState().hud.frame;
        if (frame.activeDamageNumbers === 0) return;

        this.camera.updateMatrixWorld();
        const numbers = frame.damageNumbers;
        for (let index = 0; index < numbers.length; index += 1) {
            const number = numbers[index];
            if (!number?.active) continue;

            scratchProjection
                .set(number.worldX, number.worldY + number.age * RISE_PER_SECOND, number.worldZ)
                .project(this.camera);
            number.onScreen =
                scratchProjection.z < 1 &&
                Math.abs(scratchProjection.x) <= 1.1 &&
                Math.abs(scratchProjection.y) <= 1.1;
            number.screenX = (scratchProjection.x + 1) / 2;
            number.screenY = (1 - scratchProjection.y) / 2;
        }
    }

    dispose(): void {
        this.unsubscribe();
    }
}
