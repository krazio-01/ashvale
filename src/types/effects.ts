import type { Mesh, Object3D, Vector3Tuple } from "three";
import type { EffectId } from "@/constants/combat";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { AttackWarningDanger, ImpactTier, Team } from "@/types/combat";

export type EffectTrigger = "hitLanded" | "attackWarning" | "propStruck";

export interface IMaterialFlashSpec {
    kind: "materialFlash";
    color: number;
    seconds: number;
}

export interface IParticleBurstSpec {
    kind: "particleBurst";
    trigger?: EffectTrigger;
    capacity: number;
    lifetimeSeconds: number;
    burstSize: Readonly<Record<ImpactTier, number>>;
    speedMetres: Readonly<Record<ImpactTier, number>>;
    spreadFraction: number;
    liftFraction: number;
    gravityScale: number;
    sizeMetres: number;
    colorCycle: readonly string[];
    renderOrder: number;
}

export interface IAttackWarningFlareSpec {
    kind: "attackWarningFlare";
    trigger?: EffectTrigger;
    ignoreTeam: Team | null;
    poolSize: number;
    seconds: number;
    colors: Readonly<Record<AttackWarningDanger, string>>;
    sizes: Readonly<Record<AttackWarningDanger, number>>;
    textureSize: number;
    renderOrder: number;
}

export interface IRibbonTrailSpec {
    kind: "ribbonTrail";
    maxSamples: number;
    subdivisions: number;
    sampleLifetime: number;
    releaseFadeRate: number;
    innerEdgeFraction: number;
    renderOrder: number;
    look: IRibbonTrailLook;
}

interface IRibbonTrailLook {
    streakLanes: number;
    streakSpeedRange: [number, number];
    streakFrequency: number;
    streakDepth: number;
    coreBand: [rise: number, peak: number];
    glowFocus: number;
    glowGain: number;
    coreGain: number;
    whitening: { core: number; glow: number };
}

type ContinuousShape = "glow" | "leaf" | "mist" | "shaft" | "bird";

export type ContinuousAnchor = "camera" | "socket";

type ContinuousFacing = "camera" | "up";

export interface IContinuousSpec {
    kind: "continuous";
    anchor: ContinuousAnchor;
    countPerAnchor: number;
    extentMetres: Vector3Tuple;
    liftMetres: number;
    lifetimeSeconds: number;
    velocityMetres: Vector3Tuple;
    swayMetres: number;
    sizeMetres: [number, number];
    growth: number;
    stretch: number;
    colors: readonly string[];
    opacity: number;
    additive: boolean;
    shape: ContinuousShape;
    facing: ContinuousFacing;
    flicker: number;
    renderOrder: number;
}

export interface ICanopyFallSpec {
    kind: "canopyFall";
    leavesPerCrown: number;
    reachMetres: number;
    fallSpeedMetres: [number, number];
    driftMetres: number;
    flutterMetres: number;
    flutterSpeeds: [number, number];
    tumbleSpeed: number;
    landingSeconds: number;
    groundLiftMetres: number;
    restSeconds: number;
    shrinkSeconds: number;
    reachFadeShare: number;
    sizeMetres: [number, number];
    colors: readonly string[];
}

export interface ICanopyCrown {
    base: Vector3Tuple;
    bottom: number;
    top: number;
    radius: number;
}

export type EffectSpec =
    | IMaterialFlashSpec
    | IParticleBurstSpec
    | IAttackWarningFlareSpec
    | IRibbonTrailSpec
    | IContinuousSpec
    | ICanopyFallSpec;

export interface IEffectTarget {
    readonly materialLibrary: MaterialLibrary;
    readonly meshes?: readonly Mesh[];
    readonly sceneRoot?: Object3D;
    readonly color?: string;
}

export type EffectScales = Partial<Record<EffectId, number>>;
