import type { ChapterSeason, ChapterTheme } from "@/types/realm";
import type {
    AnimationClip,
    BufferGeometry,
    Group,
    KeyframeTrack,
    Material,
    Object3D,
    Vector3,
} from "three";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { AssetLibrary } from "@/world/assets/AssetLibrary";
import type { AttackCoordinator } from "@/systems/combat/AttackCoordinator";
import type { ProjectileSystem } from "@/systems/combat/ProjectileSystem";
import type { CombatEvents } from "@/events/CombatEvents";
import type { CombatRegistry } from "@/systems/combat/CombatRegistry";
import type { TimeDilation } from "@/systems/combat/TimeDilation";

export const PROP_TRANSFORM_STRIDE = 5;

export const DEFAULT_FAMILY = "default";

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

interface ISoilTint {
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

export interface IWaterProfile {
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

interface ISeasonColorShift {
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
    extraPreloadModelPaths?: string[];
}

export interface IWorldEntity {
    readonly sceneObject: Object3D;
    readonly updatesAfterBodies?: boolean;
    fixedUpdate?(fixedTimestep: number): void;
    postStep?(): void;
    update(deltaSeconds: number, interpolationAlpha: number): void;
    dispose(): void;
}

export interface IWorldContext {
    readonly physicsWorld: PhysicsWorld;
    readonly sceneRoot: Group;
    readonly materialLibrary: MaterialLibrary;
    readonly assetLibrary: AssetLibrary;
    readonly combatRegistry: CombatRegistry;
    readonly combatEvents: CombatEvents;
    readonly timeDilation: TimeDilation;
    readonly attackCoordinator: AttackCoordinator;
    readonly projectiles: ProjectileSystem;
    readonly environment: IThemeEnvironment;
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
    allowedModelPaths: string[];
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

export interface ISettlementColliderDesc {
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

interface ISettlementKeepOutLane {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
}

export interface ISettlementLayoutResult {
    placements: ISettlementPlacement[];
    colliders: ISettlementColliderDesc[];
    keepOutDiscs: ISettlementKeepOutDisc[];
    keepOutLanes: ISettlementKeepOutLane[];
}
