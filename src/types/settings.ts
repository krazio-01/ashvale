export type GraphicsQuality = "low" | "medium" | "high" | "ultra" | "custom";
export type FrameRateLimit = 30 | 60 | 120;
export type ResolutionScale = 0.75 | 1.0 | 1.25 | 1.5;
export type ShadowQuality = "off" | "low" | "medium" | "high";
export type AntiAliasingQuality = "off" | "smaa";
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
}

export type SettingSection = "Display" | "Graphics" | "Controls";

export interface IChoiceOption<T> {
    label: string;
    value: T;
}

export interface IBaseControlDescriptor<K extends keyof IGameSettings> {
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
