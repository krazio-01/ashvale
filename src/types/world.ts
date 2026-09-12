import type { AnimationClip, BufferGeometry, Group, Material, Object3D } from "three";
import type { World as PhysicsWorld, ColliderDesc } from "@dimforge/rapier3d-compat";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { AssetLibrary } from "@/world/assets/AssetLibrary";
import type { IThemeEnvironment } from "@/types/theme";

export interface IWorldEntity {
    readonly sceneObject: Object3D;
    /* Runs once per fixed physics step, before World.step(), for anything that writes
       into the solver. Keeping this off the render tick is what stops movement being
       dropped or doubled when the render rate beats against the fixed timestep. */
    fixedUpdate?(fixedTimestep: number): void;
    /* Runs once per fixed physics step, after World.step(), to latch the simulated
       transform that `update` interpolates towards. */
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

export interface ICharacterModel {
    build(materialLibrary: MaterialLibrary): Object3D;
    colliderDesc(): ColliderDesc;
    dispose(): void;
}

export interface IModelPart {
    geometry: BufferGeometry;
    material: Material | Material[];
    isFoliage: boolean;
}

export interface IModelTemplate {
    parts: IModelPart[];
    height: number;
}

export interface ISkinnedModel {
    scene: Object3D;
    animations: AnimationClip[];
    height: number;
}

export type SpawnProgressListener = (stageLabel: string) => void;
