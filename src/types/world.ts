import type { BufferGeometry, Group, Material, Object3D } from "three";
import type { World as PhysicsWorld, ColliderDesc } from "@dimforge/rapier3d-compat";
import type { MaterialLibrary } from "@/world/MaterialLibrary";
import type { AssetLibrary } from "@/world/AssetLibrary";

export interface IWorldEntity {
    readonly sceneObject: Object3D;
    update(deltaSeconds: number): void;
    dispose(): void;
}

export interface IWorldContext {
    readonly physicsWorld: PhysicsWorld;
    readonly sceneRoot: Group;
    readonly materialLibrary: MaterialLibrary;
    readonly assetLibrary: AssetLibrary;
}

export interface ICharacterModel {
    build(materialLibrary: MaterialLibrary): Object3D;
    colliderDesc(): ColliderDesc;
    dispose(): void;
}

export interface IModelPart {
    geometry: BufferGeometry;
    material: Material | Material[];
}

export interface IModelTemplate {
    parts: IModelPart[];
    height: number;
}
