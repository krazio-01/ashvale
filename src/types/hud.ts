type HudVitalId = "health" | "stamina";

export interface IHudVital {
    current: number;
    maximum: number;
}

interface IHudTarget {
    visible: boolean;
    label: string;
    health: number;
    poise: number;
}

export interface IHudDamageNumber {
    active: boolean;
    worldX: number;
    worldY: number;
    worldZ: number;
    screenX: number;
    screenY: number;
    onScreen: boolean;
    value: number;
    age: number;
    emphasis: boolean;
    serial: number;
}

export type AlertMarkerKind = "suspicious" | "alert";

export interface IHudAlertMarker {
    active: boolean;
    kind: AlertMarkerKind;
    fill: number;
    screenX: number;
    screenY: number;
}

interface IHudFrameBuffer {
    vitals: Record<HudVitalId, IHudVital>;
    focus: IHudVital;
    target: IHudTarget;
    damageNumbers: IHudDamageNumber[];
    activeDamageNumbers: number;
    alertMarkers: IHudAlertMarker[];
    activeAlertMarkers: number;
}

export interface IHudSlice {
    isPlayerAlive: boolean;
    prompt: string | null;
    readonly frame: IHudFrameBuffer;
    setPlayerAlive: (isPlayerAlive: boolean) => void;
    setPrompt: (prompt: string | null) => void;
    setVital: (id: HudVitalId, current: number, maximum: number) => void;
    setFocus: (current: number, maximum: number) => void;
    setTarget: (visible: boolean, label: string, health: number, poise: number) => void;
    spawnDamageNumber: (x: number, y: number, z: number, value: number, emphasis: boolean) => void;
    ageDamageNumbers: (deltaSeconds: number) => void;
    showAlertMarker: (
        slot: number,
        kind: AlertMarkerKind,
        fill: number,
        screenX: number,
        screenY: number
    ) => void;
    hideAlertMarkersFrom: (slot: number) => void;
}

export interface IHudVitalDescriptor {
    id: HudVitalId;
    label: string;
    lowFraction: number;
}
