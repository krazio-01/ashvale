import type { ChapterSeason, ChapterTheme } from "@/types/realm";

export enum PropRole {
    Landmark = "landmark",
    Structure = "structure",
    Scatter = "scatter",
}

export interface IThemeProp {
    modelPath: string;
    role: PropRole;
    footprintRadius: number;
    scaleRange: [number, number];
    hasCollider: boolean;
}

export interface IPropPlacement {
    position: [number, number, number];
    rotationY: number;
    scale: number;
}

export interface IPropGroup {
    modelPath: string;
    role: PropRole;
    hasCollider: boolean;
    footprintRadius: number;
    placements: IPropPlacement[];
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

export interface ITerrainProfile {
    wildColor: string;
    rockColor: string;
    peakColor: string;
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
