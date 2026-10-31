import type {
    AnimationClip,
    BufferGeometry,
    CanvasTexture,
    DataTexture,
    Group,
    KeyframeTrack,
    Material,
    Mesh,
    Object3D,
    Vector3,
    Vector3Tuple,
} from "three";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import type { AssetLibrary } from "@/world/assets/AssetLibrary";
import type { WorldEnvironment } from "@/world/World";
import type { AttackCoordinator } from "@/systems/combat/AttackCoordinator";
import type { ProjectileSystem } from "@/systems/combat/ProjectileSystem";
import type { GameEvents } from "@/events/EventEmitter";
import type { CombatRegistry } from "@/systems/combat/CombatRegistry";
import type { TimeDilation } from "@/systems/combat/TimeDilation";
import type { AttackWarningDanger, ImpactTier, Team } from "@/types/combat";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import type { IGroundMaterials } from "@/world/terrain/TerrainMaterials";

export interface IWorldEntity {
    readonly sceneObject: Object3D;
    fixedUpdate?(fixedTimestep: number): void;
    afterPhysicsStep?(): void;
    update(deltaSeconds: number, interpolationAlpha: number): void;
    dispose(): void;
}

export type EffectTrigger = "hitLanded" | "attackWarning";

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
    gravityMetres: number;
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
}

export type EffectSpec =
    IMaterialFlashSpec | IParticleBurstSpec | IAttackWarningFlareSpec | IRibbonTrailSpec;

export interface IEffectTarget {
    readonly meshes?: readonly Mesh[];
    readonly sceneRoot?: Object3D;
    readonly color?: string;
}

export interface IWorldContext {
    readonly physicsWorld: PhysicsWorld;
    readonly sceneRoot: Group;
    readonly assetLibrary: AssetLibrary;
    readonly combatRegistry: CombatRegistry;
    readonly events: GameEvents;
    readonly timeDilation: TimeDilation;
    readonly attackCoordinator: AttackCoordinator;
    readonly projectiles: ProjectileSystem;
    readonly environment: IThemeEnvironment;
    readonly worldEnvironment: WorldEnvironment;
}

export interface IModelPart {
    geometry: BufferGeometry;
    material: Material | Material[];
    isFoliage: boolean;
}

export interface IModelTemplate {
    parts: IModelPart[];
    height: number;
    halfExtents: Vector3;
    centerOffset: Vector3;
}

export interface ISkinnedModel {
    scene: Object3D;
    animations: AnimationClip[];
    height: number;
    rootMotion: ReadonlyMap<string, KeyframeTrack>;
}

export type SpawnProgressListener = (stageLabel: string) => void;

export enum SettlementCellKind {
    Empty = "empty",
    Floor = "floor",
    Wall = "wall",
    Door = "door",
    Window = "window",
}

interface ISettlementClutterAnchor {
    offsetCellX: number;
    offsetCellZ: number;
    rotationY: number;
    allowedProps: IThemeProp[];
}

export interface ISettlementBuildingTemplate {
    id: string;
    widthCells: number;
    depthCells: number;
    roof: IThemeProp;
    roofYaw: number;
    footprint: SettlementCellKind[][];
    clutterAnchors: ISettlementClutterAnchor[];
}

export interface ISettlementCollider {
    localX: number;
    localZ: number;
    elevation: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
    rotationY: number;
}

export interface ISettlementPlacement {
    prop: IThemeProp;
    localX: number;
    localZ: number;
    elevation: number;
    rotationY: number;
    scale: number;
    hasCollider: boolean;
}

export interface ISettlementKeepOutDisc {
    localX: number;
    localZ: number;
    radius: number;
}

export interface ISettlementLayoutResult {
    placements: ISettlementPlacement[];
    colliders: ISettlementCollider[];
    keepOutDiscs: ISettlementKeepOutDisc[];
    keepOutLanes: ICorridorLane[];
}

export enum PropLayer {
    Canopy = "canopy",
    Rock = "rock",
    Understory = "understory",
    Groundcover = "groundcover",
    Debris = "debris",
}

export interface IThemeProp {
    modelPath: string;
    layer: PropLayer;
    footprintRadius: number;
    scaleRange: [number, number];
    family: string;
    pack: string;
    groundOffset?: number;
    rotationSteps?: number;
    collides?: boolean;
    colliderShape?: "cylinder" | "cuboid";
    slopeLimit?: number;
}

export interface IPropGroup {
    modelPath: string;
    layer: PropLayer;
    hasCollider: boolean;
    colliderShape?: "cylinder" | "cuboid";
    footprintRadius: number;
    instanceCount: number;
    transforms: Float32Array;
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
}

export interface IThemeLighting {
    sunLightColor: string;
    sunLightIntensity: number;
    rimColor: string;
    rimIntensity: number;
    hemisphereSkyColor: string;
    hemisphereGroundColor: string;
    hemisphereIntensity: number;
}

interface ISoilTint extends ISeasonTint {
    lightnessShift: number;
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

interface IWaterProfile {
    shallowColor: string;
    deepColor: string;
}

export interface IThemeEnvironment {
    sky: ISkyGradient;
    lighting: IThemeLighting;
    fogDensity: number;
    outlineColor: string;
    terrain: ITerrainProfile;
    water: IWaterProfile;
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

export interface ISeasonProfile {
    groundColorShift: IColorShift;
    soilTint: ISoilTint;
    skyTint: ISeasonTint;
    lightTint: ISeasonTint;
    keyIntensityScale: number;
    hemisphereIntensityScale: number;
    fogDensityScale: number;
    sunElevationDelta: number;
}

export interface IEnvironmentOverrides extends Partial<
    Omit<IThemeEnvironment, "sky" | "lighting">
> {
    sky?: Partial<ISkyGradient>;
    lighting?: Partial<IThemeLighting>;
}

export interface IModelPack {
    pack: string;
    directory: string;
    unitScale: number;
}

export interface IThemeConfig {
    props: IThemeProp[];
    environment: IThemeEnvironment;
    extraPreloadModelPaths?: string[];
}

export interface IRegionLink {
    fromIndex: number;
    toIndex: number;
}

export interface IWaterPoint {
    x: number;
    z: number;
    waterlineElevation: number;
    halfWidth: number;
    bedRatio: number;
}

export interface IWaterCourse {
    points: IWaterPoint[];
    isMudhole?: boolean;
}

export interface ISurfaceHeightProbe {
    elevationAt(localX: number, localZ: number): number;
    footprintDistanceAt(localX: number, localZ: number): number;
}

export interface IRegionBox {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
}

export interface IRegionFloor extends IRegionBox {
    floorElevation: number;
    nestingDepth: number;
    fileCount: number;
    isBossRegion?: boolean;
}

export enum CorridorClimbStyle {
    Ramp = "ramp",
    Straight = "straight",
    Zigzag = "zigzag",
    Hidden = "hidden",
}

export interface ICorridorPath extends ICorridorLane {
    fromElevation: number;
    toElevation: number;
    climbStyle: CorridorClimbStyle;
    lateralSeed: number;
}

export interface ICorridorLane {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
}

export interface IGroundSurface {
    sampleGrid: TerrainSampleGrid;
    fieldTexture: DataTexture;
    groundSplat: CanvasTexture;
    groundDetail: CanvasTexture;
    materials: IGroundMaterials;
}

export interface IPropFieldInput {
    manifest: IThemeConfig;
    sampleGrid: TerrainSampleGrid;
    sites: IRegionFloor[];
    lanes: ICorridorLane[];
    chapterSpawnPoints: [number, number][];
    center: Vector3Tuple;
    fieldRadius: number;
    seed: number;
    waterCourses: IWaterCourse[];
    settlement: ISettlementLayoutResult | null;
}

export type ISpeciesByLayer = Record<PropLayer, IThemeProp[]>;
