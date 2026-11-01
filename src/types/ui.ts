type HudVitalId = "health" | "stamina";
type HudMeterId = HudVitalId | "focus";
type HudValueKey = "isPlayerAlive" | "prompt";

export interface IHudMeter {
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
    spawnId: number;
}

export type AlertMarkerKind = "suspicious" | "alert";

export interface IHudAlertMarker {
    active: boolean;
    kind: AlertMarkerKind;
    fill: number;
    screenX: number;
    screenY: number;
}

interface IHudLiveState {
    meters: Record<HudMeterId, IHudMeter>;
    target: IHudTarget;
    damageNumbers: IHudDamageNumber[];
    activeDamageNumbers: number;
    alertMarkers: IHudAlertMarker[];
    activeAlertMarkers: number;
}

export interface IHudSlice {
    isPlayerAlive: boolean;
    prompt: string | null;
    readonly frame: IHudLiveState;
    setHudValue: <Key extends HudValueKey>(key: Key, value: IHudSlice[Key]) => void;
    setMeter: (id: HudMeterId, current: number, maximum: number) => void;
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

export type PresetQuality = Exclude<GraphicsQuality, "custom">;

export type GraphicsPresetValues = Pick<
    IGameSettings,
    "shadows" | "bloom" | "antiAliasing" | "outlines" | "atmosphere"
>;

export interface ISettingsSlice {
    values: IGameSettings;
    update: (partial: Partial<IGameSettings>) => void;
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
}

export interface ISliderControlDescriptor<
    K extends keyof IGameSettings,
> extends IBaseControlDescriptor<K> {
    type: "slider";
    min: number;
    max: number;
    step: number;
    formatValue: (value: number) => string;
}

export interface IToggleControlDescriptor<
    K extends keyof IGameSettings,
> extends IBaseControlDescriptor<K> {
    type: "toggle";
    onLabel: string;
    offLabel: string;
}

export interface IChoiceControlDescriptor<
    K extends keyof IGameSettings,
> extends IBaseControlDescriptor<K> {
    type: "choice";
    options: IChoiceOption<IGameSettings[K]>[];
}

export type ISettingControlDescriptor<K extends keyof IGameSettings = keyof IGameSettings> =
    ISliderControlDescriptor<K> | IToggleControlDescriptor<K> | IChoiceControlDescriptor<K>;

export type SettingControlsMap = {
    [K in keyof IGameSettings]: ISettingControlDescriptor<K> extends infer Descriptor
        ? Descriptor extends unknown
            ? Omit<Descriptor, "key">
            : never
        : never;
};

interface IControlEntry {
    keys: readonly string[];
    action: string;
    description: string;
}

export interface IControlGroup {
    title: string;
    entries: readonly IControlEntry[];
}
