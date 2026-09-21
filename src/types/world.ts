import type { AnimationClip, BufferGeometry, Group, Material, Object3D, Vector3 } from "three";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { AssetLibrary } from "@/world/assets/AssetLibrary";
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
    readonly environment: IThemeEnvironment;
}

export interface ICharacterSpec {
    modelPath: string;
    height: number;
    radius: number;
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
}

export type SpawnProgressListener = (stageLabel: string) => void;
