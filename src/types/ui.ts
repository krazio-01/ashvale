export type GraphicsQuality = "low" | "medium" | "high" | "ultra" | "custom";

type FrameRateLimit = 30 | 60 | 120;

type ResolutionScale = 0.75 | 1.0 | 1.25 | 1.5;

export type ShadowQuality = "off" | "low" | "medium" | "high";

type AntiAliasingQuality = "off" | "smaa";

export type OutlineQuality = "off" | "low" | "high";

export interface IGameSettings {
    frameRateLimit: FrameRateLimit;
    showFps: boolean;
    resolutionScale: ResolutionScale;

    qualityPreset: GraphicsQuality;
    shadows: ShadowQuality;
    bloom: boolean;
    antiAliasing: AntiAliasingQuality;
    outlines: OutlineQuality;
    atmosphere: boolean;

    mouseSensitivity: number;
    invertY: boolean;
    fov: number;
}

export type SettingSection = "Display" | "Graphics" | "Controls";

interface IChoiceOption<T> {
    label: string;
    value: T;
}

interface IBaseControlDescriptor<K extends keyof IGameSettings> {
    key: K;
    section: SettingSection;
    label: string;
    description: string;
    requiresNextRealm?: boolean;
}

export interface ISliderControlDescriptor<
    K extends keyof IGameSettings,
> extends IBaseControlDescriptor<K> {
    type: "slider";
    min: number;
    max: number;
    step: number;
    formatValue?: (value: number) => string;
}

export interface IToggleControlDescriptor<
    K extends keyof IGameSettings,
> extends IBaseControlDescriptor<K> {
    type: "toggle";
    onLabel?: string;
    offLabel?: string;
}

export interface IChoiceControlDescriptor<
    K extends keyof IGameSettings,
> extends IBaseControlDescriptor<K> {
    type: "choice";
    options: IChoiceOption<IGameSettings[K]>[];
}

export type ISettingControlDescriptor<K extends keyof IGameSettings = keyof IGameSettings> =
    ISliderControlDescriptor<K> | IToggleControlDescriptor<K> | IChoiceControlDescriptor<K>;

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
