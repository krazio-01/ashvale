import { HUD } from "@/constants/ui";
import type { IHudAlertMarker, IHudSlice } from "@/types/ui";
import type { GetState, IStoreState, SetState } from "@/types/store";

export function createHudSlice(set: SetState<IStoreState>, get: GetState<IStoreState>): IHudSlice {
    let damageCursor = 0;
    let damageSerial = 0;

    return {
        isPlayerAlive: true,
        prompt: null,
        frame: {
            meters: {
                health: { current: 0, maximum: 0 },
                stamina: { current: 0, maximum: 0 },
                focus: { current: 0, maximum: 0 },
            },
            target: { visible: false, label: "", health: 0, poise: 0 },
            damageNumbers: Array.from({ length: HUD.damageNumberPool }, () => ({
                active: false,
                worldX: 0,
                worldY: 0,
                worldZ: 0,
                screenX: 0,
                screenY: 0,
                onScreen: false,
                value: 0,
                age: 0,
                emphasis: false,
                spawnId: 0,
            })),
            activeDamageNumbers: 0,
            alertMarkers: Array.from({ length: HUD.alertMarkerPool }, (): IHudAlertMarker => ({
                active: false,
                kind: "suspicious",
                fill: 0,
                screenX: 0,
                screenY: 0,
            })),
            activeAlertMarkers: 0,
        },

        setHudValue(key, value) {
            if (get().hud[key] !== value) set((state) => ({ hud: { ...state.hud, [key]: value } }));
        },

        setMeter(id, current, maximum) {
            const meter = get().hud.frame.meters[id];
            meter.current = current;
            meter.maximum = maximum;
        },

        setTarget(visible, label, health, poise) {
            const target = get().hud.frame.target;
            target.visible = visible;
            target.label = label;
            target.health = health;
            target.poise = poise;
        },

        spawnDamageNumber(x, y, z, value, emphasis) {
            const frame = get().hud.frame;
            const slot = frame.damageNumbers[damageCursor];
            damageCursor = (damageCursor + 1) % frame.damageNumbers.length;

            if (!slot.active) frame.activeDamageNumbers += 1;
            damageSerial += 1;
            slot.active = true;
            slot.onScreen = false;
            slot.worldX = x;
            slot.worldY = y;
            slot.worldZ = z;
            slot.value = value;
            slot.age = 0;
            slot.emphasis = emphasis;
            slot.spawnId = damageSerial;
        },

        ageDamageNumbers(deltaSeconds) {
            const frame = get().hud.frame;
            if (frame.activeDamageNumbers === 0) return;

            for (const number of frame.damageNumbers) {
                if (!number.active) continue;

                number.age += deltaSeconds;
                if (number.age < HUD.damageNumberSeconds) continue;

                number.active = false;
                number.onScreen = false;
                frame.activeDamageNumbers -= 1;
            }
        },

        showAlertMarker(slot, kind, fill, screenX, screenY) {
            const frame = get().hud.frame;
            const marker = frame.alertMarkers[slot];

            marker.active = true;
            marker.kind = kind;
            marker.fill = fill;
            marker.screenX = screenX;
            marker.screenY = screenY;
            frame.activeAlertMarkers = Math.max(frame.activeAlertMarkers, slot + 1);
        },

        hideAlertMarkersFrom(slot) {
            const frame = get().hud.frame;
            for (let index = slot; index < frame.activeAlertMarkers; index += 1) {
                frame.alertMarkers[index].active = false;
            }
            frame.activeAlertMarkers = Math.min(frame.activeAlertMarkers, slot);
        },
    };
}
