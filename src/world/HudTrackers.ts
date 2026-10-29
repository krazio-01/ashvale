import { Group, Vector3 } from "three";
import type { Camera, Object3D } from "three";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { store } from "@/store/store";
import { HUD } from "@/constants/ui";
import type { AlertMarkerKind } from "@/types/ui";
import type { IWorldEntity } from "@/types/world";
import type { CombatEvents } from "@/events/CombatEvents";
import { metres } from "@/lib/helpers";

export interface IAlertMarkerSource {
    readonly sceneObject: Object3D;
    readonly alertMarkerHeight: number;
    readonly alertMarkerKind: AlertMarkerKind | null;
    readonly alertMarkerFill: number;
}

export function alertMarkerKindFor(meter: AwarenessMeter, isDead: boolean): AlertMarkerKind | null {
    if (isDead) return null;
    if (meter.phase === "alert")
        return meter.secondsInPhase < HUD.alertFlashSeconds ? "alert" : null;
    return meter.state === "suspicious" ? "suspicious" : null;
}

export function alertMarkerFillFor(meter: AwarenessMeter): number {
    return meter.phase === "searching" ? 1 : meter.level;
}

const alertMarkerProjectorScratchProjection = new Vector3();
const scratchCameraPosition = new Vector3();

export class AlertMarkerProjector implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly sources = new Set<IAlertMarkerSource>();

    constructor(camera: Camera) {
        this.camera = camera;
    }

    track(source: IAlertMarkerSource): void {
        this.sources.add(source);
    }

    update(): void {
        const hud = store.getState().hud;
        this.camera.updateMatrixWorld();
        this.camera.getWorldPosition(scratchCameraPosition);

        let slot = 0;
        for (const source of this.sources) {
            if (slot >= HUD.alertMarkerPool) break;

            const kind = source.alertMarkerKind;
            if (!kind) continue;

            const position = source.sceneObject.position;
            if (position.distanceTo(scratchCameraPosition) > HUD.alertMarkerRange) continue;

            alertMarkerProjectorScratchProjection
                .set(position.x, position.y + source.alertMarkerHeight, position.z)
                .project(this.camera);
            const isOnScreen =
                alertMarkerProjectorScratchProjection.z < 1 &&
                Math.abs(alertMarkerProjectorScratchProjection.x) <= 1.05 &&
                Math.abs(alertMarkerProjectorScratchProjection.y) <= 1.05;
            if (!isOnScreen) continue;

            hud.showAlertMarker(
                slot,
                kind,
                source.alertMarkerFill,
                (alertMarkerProjectorScratchProjection.x + 1) / 2,
                (1 - alertMarkerProjectorScratchProjection.y) / 2
            );
            slot += 1;
        }

        hud.hideAlertMarkersFrom(slot);
    }

    dispose(): void {
        this.sources.clear();
        store.getState().hud.hideAlertMarkersFrom(0);
    }
}

const SPAWN_HEIGHT = metres(0.4);
const RISE_PER_SECOND = metres(HUD.damageNumberRise * 10);
const damageNumberProjectorScratchProjection = new Vector3();

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

            damageNumberProjectorScratchProjection
                .set(number.worldX, number.worldY + number.age * RISE_PER_SECOND, number.worldZ)
                .project(this.camera);
            number.onScreen =
                damageNumberProjectorScratchProjection.z < 1 &&
                Math.abs(damageNumberProjectorScratchProjection.x) <= 1.1 &&
                Math.abs(damageNumberProjectorScratchProjection.y) <= 1.1;
            number.screenX = (damageNumberProjectorScratchProjection.x + 1) / 2;
            number.screenY = (1 - damageNumberProjectorScratchProjection.y) / 2;
        }
    }

    dispose(): void {
        this.unsubscribe();
    }
}
