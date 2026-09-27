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
import type { AttackCoordinator } from "@/systems/combat/services/AttackCoordinator";
import type { ProjectileSystem } from "@/systems/combat/services/ProjectileSystem";
import type { CombatEvents } from "@/systems/combat/services/CombatEvents";
import type { CombatRegistry } from "@/systems/combat/services/CombatRegistry";
import type { TimeDilation } from "@/systems/combat/services/TimeDilation";
import type { IThemeEnvironment } from "@/types/theme";

export interface IWorldEntity {
    readonly sceneObject: Object3D;
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
