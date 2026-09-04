import type { ChapterSeason, ChapterTheme } from "@/types/realm";

export enum PropLayer {
    Canopy = "canopy",
    Rock = "rock",
    Understory = "understory",
    Groundcover = "groundcover",
    Debris = "debris",
}

export const PROP_TRANSFORM_STRIDE = 5;

export interface IThemeProp {
    modelPath: string;
    layer: PropLayer;
    footprintRadius: number;
    scaleRange: [number, number];
}

export interface IPropGroup {
    modelPath: string;
    layer: PropLayer;
    hasCollider: boolean;
    footprintRadius: number;
    instanceCount: number;
    transforms: Float32Array;
}

export interface ISkyGradient {
    zenith: string;
    middle: string;
    horizon: string;
    abyss: string;
    glow: string;
    sun: string;
    sunElevation: number;
    sunAzimuth: number;
    sunSize: number;
    glowFalloff: number;
    hazeStrength: number;
}

export interface IThemeLighting {
    keyColor: string;
    keyIntensity: number;
    rimColor: string;
    rimIntensity: number;
    skyFill: string;
    groundFill: string;
    hemisphereIntensity: number;
}

export interface ISoilTint {
    color: string;
    strength: number;
    lightnessShift: number;
}

export interface ITerrainProfile {
    wildColor: string;
    rockColor: string;
    peakColor: string;
    soilColor: string;
    wildElevation: number;
    wildRelief: number;
    mountainHeight: number;
    featureSize: number;
    ruggedness: number;
    slopeShade: number;
}

export interface IThemeEnvironment {
    sky: ISkyGradient;
    lighting: IThemeLighting;
    fogDensity: number;
    outlineColor: string;
    terrain: ITerrainProfile;
}

export interface ISeasonColorShift {
    hueShift: number;
    saturationScale: number;
    lightnessShift: number;
}

export interface ISeasonTint {
    color: string;
    strength: number;
}

export interface ISeasonProfile {
    season: ChapterSeason;
    ground: ISeasonColorShift;
    groundTint: ISoilTint;
    skyTint: ISeasonTint;
    lightTint: ISeasonTint;
    keyIntensityScale: number;
    hemisphereIntensityScale: number;
    fogDensityScale: number;
    sunElevationDelta: number;
}

export interface IThemeManifest {
    theme: ChapterTheme;
    props: IThemeProp[];
    scatterPropsPerFile: number;
    environment: IThemeEnvironment;
}
