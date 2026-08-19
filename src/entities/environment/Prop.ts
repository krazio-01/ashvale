import type { Collider, ColliderDesc, RigidBody } from "@dimforge/rapier3d-compat";
import RAPIER from "@dimforge/rapier3d-compat";
import { Box3, Object3D, Vector3 } from "three";
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { IPropPlacement } from "@/types/theme";

export class Prop extends Entity implements IWorldEntity {
    readonly sceneObject: Object3D;

    private readonly context: IWorldContext;
    private readonly rigidBody: RigidBody | null = null;
    private readonly collider: Collider | null = null;

    constructor(id: string, context: IWorldContext, placement: IPropPlacement) {
        super(id);
        this.context = context;

        const template = context.assetLibrary.cloneProp(placement.modelPath);
        if (!template) throw new Error(`no loaded asset for prop path "${placement.modelPath}"`);

        this.sceneObject = template;
        this.sceneObject.position.set(...placement.position);
        this.sceneObject.rotation.y = placement.rotationY;
        this.sceneObject.scale.setScalar(placement.scale);

        if (!placement.hasCollider) return;

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
        if (this.collider) this.context.physicsWorld.removeCollider(this.collider, false);
        if (this.rigidBody) this.context.physicsWorld.removeRigidBody(this.rigidBody);
    }

    private buildColliderDesc(placement: IPropPlacement): ColliderDesc {
        const bounds = new Box3().setFromObject(this.sceneObject);
        const height = bounds.getSize(new Vector3()).y;
        const radius = placement.footprintRadius * placement.scale;

        return RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(0, height / 2, 0);
    }
}
