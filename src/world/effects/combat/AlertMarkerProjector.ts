import { Group, Vector3 } from "three";
import type { Camera, Object3D } from "three";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { store } from "@/store/store";
import { HUD } from "@/constants/presentation";
import type { AlertMarkerKind } from "@/types/hud";
import type { IWorldEntity } from "@/types/world";

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

const scratchProjection = new Vector3();
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

            scratchProjection
                .set(position.x, position.y + source.alertMarkerHeight, position.z)
                .project(this.camera);
            const isOnScreen =
                scratchProjection.z < 1 &&
                Math.abs(scratchProjection.x) <= 1.05 &&
                Math.abs(scratchProjection.y) <= 1.05;
            if (!isOnScreen) continue;

            hud.showAlertMarker(
                slot,
                kind,
                source.alertMarkerFill,
                (scratchProjection.x + 1) / 2,
                (1 - scratchProjection.y) / 2
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
