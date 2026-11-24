import type { IEraSignals } from "@/types/realm";
import type { LifeEffectId } from "@/constants/effects";
import type { GameEventMap } from "@/events/EventEmitter";
import type { EffectScales } from "@/types/effects";
import type { IConcept, IThemeScenes } from "@/types/scenes";
import type { PropColliderShape } from "@/types/world";
import type { CanopyRole, PropLayer } from "@/types/world";

export interface IThemeProp {
    modelPath: string;
    layer: PropLayer;
    footprintRadius: number;
    scaleRange: [number, number];
    groundOffset?: number;
    rotationSteps?: number;
    collides?: boolean;
    colliderShape?: PropColliderShape;
    slopeLimit?: number;
}

export interface ISkyGradient {
    zenith: string;
    middle: string;
    horizon: string;
    belowHorizonColor: string;
    glow: string;
    sun: string;
    sunElevation: number;
    sunAzimuth: number;
    sunSize: number;
    glowFalloff: number;
    hazeStrength: number;
    cloudCover: number;
    cloudSoftness: number;
    cloudLit: string;
    cloudShade: string;
}

interface IRimLight {
    color: string;
    intensity: number;
}

export interface IThemeLighting {
    sunLightColor: string;
    sunLightIntensity: number;
    rim: IRimLight | null;
    sunToFill: number;
}

export interface IFill {
    skyColor: string;
    groundColor: string;
    intensity: number;
}

export interface ITerrainProfile {
    grassColor: string;
    rockColor: string;
    peakColor: string;
    soilColor: string;
    grasslandHeight: number;
    mountainHeight: number;
    slopeShade: number;
}

export interface IThemeAtmosphere {
    density: number;
    heightFalloff: number;
    base: number;
    sunColor: string;
    sunStrength: number;
}

export type SeasonTarget = "canopy" | "ground" | "air";

export interface IRockSurface {
    mossColor: string;
    mossAmount: number;
    dustColor: string;
    dustAmount: number;
    snowColor: string;
    snowAmount: number;
}

export interface IThemeEnvironment {
    sky: ISkyGradient;
    lighting: IThemeLighting;
    atmosphere: IThemeAtmosphere;
    terrain: ITerrainProfile;
    water: IWaterProfile;
    rockSurface: IRockSurface;
    seasonTargets: readonly SeasonTarget[];
    canopyTints: CanopyTints;
    lifeScale: EffectScales;
    seasonOverrides?: Partial<Record<SeasonId, Partial<ISeasonProfile>>>;
}

export interface IColorShift {
    hueShift: number;
    saturationScale: number;
    lightnessShift: number;
}

export interface ISeasonTint {
    color: string;
    strength: number;
}

export type CanopyTints = Record<CanopyRole, ISeasonTint>;

export type SeasonId = "spring" | "summer" | "autumn" | "winter";

export interface ISeasonProfile {
    canopyTints: CanopyTints;
    snowCover: number;
    groundColorShift: IColorShift;
    soilTint: ISoilTint;
    skyTint: ISeasonTint;
    lightTint: ISeasonTint;
    keyIntensityScale: number;
    fillScale: number;
    fogDensityScale: number;
    cloudCoverScale: number;
    lifeScale: EffectScales;
    sunElevationDelta: number;
    bloom: { coverageScale: number; colorShift: IColorShift };
}

export interface IEnvironmentOverrides extends Partial<
    Omit<IThemeEnvironment, "sky" | "lighting">
> {
    sky?: Partial<ISkyGradient>;
    lighting?: Partial<IThemeLighting>;
}

type ChapterPin = "first" | "last";

export interface IEraFit {
    pin: ChapterPin | null;
    weights: Partial<Record<keyof IEraSignals, number>>;
}

export interface IThemeLandform {
    floorBlendRadius: number;
    floorReliefHeight: number;
    floorReliefScale: number;
    openGroundReliefHeight: number;
    openGroundReliefScale: number;
    openGroundRampRatio: number;
    minimumOpennessRatio: number;
    wallRunGap: IWallRunGapShape | null;
}

interface IWallRunGapShape {
    depthLevels: number;
    jumpReachRatio: number;
    laneOfCorridorWidth: number;
    approachOfGapLength: number;
    flankOfCorridorWidth: number;
}

export type WaterCourseName = "routeRiver" | "borderRiver" | "spring";

export interface IThemeBorder {
    flatReach: number;
    barrierReach: number;
    steepestSlopeAngle: number;
    profileHeight: number;
    profileCurve: number;
    crestWidth: number;
    ridgeNoiseHeight: number;
    ridgeNoiseScale: number;
    treelineDepth: number;
    treelineDensity: [number, number];
    waterCourses: readonly WaterCourseName[];
    riverReach: number;
    waterDepth: number;
    dropHeight: number;
    dropSlopeAngle: number;
}

export interface IThemeZones {
    forestWavelength: number;
    forestShare: number;
    forestSoftness: number;
    clearingRatio: number;
    clearingFadeWidth: number;
    trailForestGap: number;
    slopeForestFade: [number, number];
    bankReach: number;
}

export type ZoneField = "forest" | "clearing" | "wetness" | "familyBand";

export type GroveCue = "familyBand" | "wetness" | "bossProximity";

export interface IPreference<Cue extends string> {
    cue: Cue;
    target: number;
    weight: number;
}

export interface IGroveFamily {
    species: readonly IThemeProp[];
    preferences: readonly IPreference<GroveCue>[];
}

export interface IThemeTrees {
    families: readonly IGroveFamily[];
    groveThreshold: number;
    familyVariety: number;
    bossReach: number;
    understory: readonly IThemeProp[];
}

interface IThemeRocks {
    boulders: readonly IThemeProp[];
    debris: readonly IThemeProp[];
    rockySlope: [number, number];
}

export type CoverCue = Exclude<ZoneField, "familyBand">;

export type CoverAffinity = Partial<
    Record<CoverCue, readonly [from: number, to: number, floor?: number]>
>;

export interface IGroundCoverSpecies {
    props: readonly IThemeProp[];
    affinity: CoverAffinity;
    patchSpacing: number;
    patchChance: number;
}

export interface IThemeGroundCover {
    grass: CoverAffinity;
    flowers: {
        affinity: CoverAffinity;
        palette: readonly [string, string, string];
        coverage: number;
    };
    forestFloor: { litterColor: string; mossColor: string; strength: number } | null;
    windStrength: number;
    species: readonly IGroundCoverSpecies[];
    hostClutter: readonly IThemeProp[];
}

export interface IThemeSound {
    ambience: string | null;
    cues: Partial<Record<keyof GameEventMap, string>>;
}

export interface IThemeConfig {
    zones: IThemeZones;
    trees: IThemeTrees;
    rocks: IThemeRocks;
    groundCover: IThemeGroundCover;
    environment: IThemeEnvironment;
    eraFit: IEraFit;
    landform: IThemeLandform;
    border: IThemeBorder;
    scenes: IThemeScenes;
    concepts: readonly IConcept[];
    life: readonly LifeEffectId[];
    sound: IThemeSound;
    extraPreloadModelPaths?: string[];
}

interface ISoilTint extends ISeasonTint {
    lightnessShift: number;
}

interface IWaterProfile {
    shallowColor: string;
    deepColor: string;
}
