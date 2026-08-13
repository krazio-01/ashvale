import type { Group, Object3D, Vector3Tuple } from "three";
import type { World as PhysicsWorld, ColliderDesc } from "@dimforge/rapier3d-compat";
import type { MaterialLibrary } from "@/world/MaterialLibrary";
import type { PropShape } from "@/constants/game";

export interface IWorldEntity {
    readonly sceneObject: Object3D;
    update(deltaSeconds: number): void;
    dispose(): void;
}

export interface IWorldContext {
    readonly physicsWorld: PhysicsWorld;
    readonly sceneRoot: Group;
    readonly materialLibrary: MaterialLibrary;
}

export interface IPropPlacement {
    shape: PropShape;
    position: Vector3Tuple;
    rotationY: number;
    scale: number;
    color: string;
}

export interface ICharacterModel {
    build(materialLibrary: MaterialLibrary): Object3D;
    colliderDesc(): ColliderDesc;
    dispose(): void;
}
