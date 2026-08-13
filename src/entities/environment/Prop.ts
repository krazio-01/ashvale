import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, ColliderDesc, RigidBody } from "@dimforge/rapier3d-compat";
import { BoxGeometry, BufferGeometry, CylinderGeometry, IcosahedronGeometry, Mesh } from "three";
import { Entity } from "@/entities/Entity";
import type { IPropPlacement, IWorldContext } from "@/types/world";
import { PROP, PropShape } from "@/constants/game";

export class Prop extends Entity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: BufferGeometry;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(id: string, context: IWorldContext, placement: IPropPlacement) {
        super(id);

        this.context = context;
        this.geometry = this.buildGeometry(placement);

        this.sceneObject = new Mesh(
            this.geometry,
            context.materialLibrary.getToonMaterial(placement.color)
        );
        this.sceneObject.castShadow = true;
        this.sceneObject.receiveShadow = true;
        this.sceneObject.position.set(...placement.position);
        this.sceneObject.rotation.y = placement.rotationY;

        const [x, y, z] = placement.position;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
        );

        this.collider = context.physicsWorld.createCollider(
            this.buildColliderDesc(placement),
            this.rigidBody
        );
    }

    update(): void { }

    dispose(): void {
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.geometry.dispose();
    }

    private buildGeometry({ shape, scale }: IPropPlacement): BufferGeometry {
        switch (shape) {
            case PropShape.Pillar:
                return new CylinderGeometry(
                    PROP.pillarRadius * PROP.pillarTaper * scale,
                    PROP.pillarRadius * scale,
                    PROP.pillarHeight * scale,
                    PROP.pillarSides
                );

            case PropShape.Boulder:
                return new IcosahedronGeometry(PROP.boulderRadius * scale, 0);

            case PropShape.Slab:
                return new BoxGeometry(
                    PROP.slabWidth * scale,
                    PROP.slabHeight * scale,
                    PROP.slabDepth * scale
                );
        }
    }

    private buildColliderDesc({ shape, scale }: IPropPlacement): ColliderDesc {
        switch (shape) {
            case PropShape.Pillar:
                return RAPIER.ColliderDesc.cylinder(
                    (PROP.pillarHeight * scale) / 2,
                    PROP.pillarRadius * scale
                );

            case PropShape.Boulder:
                return RAPIER.ColliderDesc.ball(PROP.boulderRadius * scale);

            case PropShape.Slab:
                return RAPIER.ColliderDesc.cuboid(
                    (PROP.slabWidth * scale) / 2,
                    (PROP.slabHeight * scale) / 2,
                    (PROP.slabDepth * scale) / 2
                );
        }
    }
}
