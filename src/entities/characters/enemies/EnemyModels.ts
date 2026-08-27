import RAPIER from "@dimforge/rapier3d-compat";
import type { ColliderDesc } from "@dimforge/rapier3d-compat";
import {
    BoxGeometry,
    BufferGeometry,
    ConeGeometry,
    IcosahedronGeometry,
    Mesh,
    OctahedronGeometry,
} from "three";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { ICharacterModel } from "@/types/world";
import { EnemyArchetype, PALETTE } from "@/constants/characters";

interface IPlaceholderShape {
    geometry: () => BufferGeometry;
    collider: () => ColliderDesc;
    color: string;
}

const shapes: Record<EnemyArchetype, IPlaceholderShape> = {
    [EnemyArchetype.Sentinel]: {
        geometry: () => new BoxGeometry(0.9, 2.2, 0.9),
        collider: () => RAPIER.ColliderDesc.cuboid(0.45, 1.1, 0.45),
        color: PALETTE.stoneLight,
    },
    [EnemyArchetype.Wraith]: {
        geometry: () => new ConeGeometry(0.6, 2.4, 6),
        collider: () => RAPIER.ColliderDesc.capsule(0.9, 0.5),
        color: PALETTE.haze,
    },
    [EnemyArchetype.Golem]: {
        geometry: () => new IcosahedronGeometry(1.1, 0),
        collider: () => RAPIER.ColliderDesc.ball(1.1),
        color: PALETTE.stoneDark,
    },
    [EnemyArchetype.Gremlin]: {
        geometry: () => new OctahedronGeometry(0.55, 0),
        collider: () => RAPIER.ColliderDesc.ball(0.55),
        color: PALETTE.moss,
    },
};

class PlaceholderModel implements ICharacterModel {
    private readonly shape: IPlaceholderShape;
    private geometry: BufferGeometry | null = null;

    constructor(shape: IPlaceholderShape) {
        this.shape = shape;
    }

    build(materialLibrary: MaterialLibrary): Mesh {
        this.geometry = this.shape.geometry();
        return new Mesh(this.geometry, materialLibrary.getToonMaterial(this.shape.color));
    }

    colliderDesc(): ColliderDesc {
        return this.shape.collider();
    }

    dispose(): void {
        this.geometry?.dispose();
    }
}

export function modelFor(archetype: EnemyArchetype): ICharacterModel {
    return new PlaceholderModel(shapes[archetype]);
}
