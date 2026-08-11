import type { Object3D } from "three";
import type { IWorldEntity } from "@/types/world";
export abstract class Entity implements IWorldEntity {
    readonly id: string;

    abstract readonly sceneObject: Object3D;

    constructor(id: string) {
        this.id = id;
    }

    abstract update(deltaSeconds: number): void;
    abstract dispose(): void;
}
