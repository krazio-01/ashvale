import { Group, Vector3 } from "three";
import type { Camera, Object3D } from "three";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { store } from "@/store/store";
import { HUD } from "@/constants/ui";
import type { AlertMarkerKind } from "@/types/ui";
import type { IWorldEntity } from "@/types/world";
import type { GameEvents } from "@/events/EventEmitter";
import { metresToUnits } from "@/lib/helpers";

const DAMAGE_NUMBER_SPAWN_HEIGHT = metresToUnits(0.4);
const DAMAGE_NUMBER_RISE_PER_SECOND = metresToUnits(HUD.damageNumberRise * 10);
const scratchProjection = new Vector3();
const scratchCameraPosition = new Vector3();

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
    return meter.phase === "searching" ? 1 : meter.awarenessLevel;
}

abstract class HudTracker implements IWorldEntity {
    readonly sceneObject = new Group();
    protected screenX = 0;
    protected screenY = 0;

    constructor(protected readonly camera: Camera) {}

    abstract update(deltaSeconds: number): void;
    abstract dispose(): void;

    protected projectToScreen(x: number, y: number, z: number, margin: number): boolean {
        scratchProjection.set(x, y, z).project(this.camera);
        this.screenX = (scratchProjection.x + 1) / 2;
        this.screenY = (1 - scratchProjection.y) / 2;
        return (
            scratchProjection.z < 1 &&
            Math.abs(scratchProjection.x) <= margin &&
            Math.abs(scratchProjection.y) <= margin
        );
    }
}

export class AlertMarkerTracker extends HudTracker {
    private readonly sources = new Set<IAlertMarkerSource>();

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

            const isOnScreen = this.projectToScreen(
                position.x,
                position.y + source.alertMarkerHeight,
                position.z,
                HUD.alertMarkerScreenMargin
            );
            if (!isOnScreen) continue;

            hud.showAlertMarker(slot, kind, source.alertMarkerFill, this.screenX, this.screenY);
            slot += 1;
        }

        hud.hideAlertMarkersFrom(slot);
    }

    dispose(): void {
        this.sources.clear();
        store.getState().hud.hideAlertMarkersFrom(0);
    }
}

export class DamageNumberTracker extends HudTracker {
    private readonly unsubscribe: () => void;

    constructor(events: GameEvents, camera: Camera) {
        super(camera);
        this.unsubscribe = events.on("hitLanded", (event) => {
            if (event.attacker.team !== "player" && event.defender.team !== "player") return;

            const point = event.point;
            store
                .getState()
                .hud.spawnDamageNumber(
                    point.x,
                    point.y + DAMAGE_NUMBER_SPAWN_HEIGHT,
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

            number.onScreen = this.projectToScreen(
                number.worldX,
                number.worldY + number.age * DAMAGE_NUMBER_RISE_PER_SECOND,
                number.worldZ,
                HUD.damageNumberScreenMargin
            );
            number.screenX = this.screenX;
            number.screenY = this.screenY;
        }
    }

    dispose(): void {
        this.unsubscribe();
        store.getState().hud.ageDamageNumbers(Number.POSITIVE_INFINITY);
    }
}
