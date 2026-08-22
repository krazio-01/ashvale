import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import { Group, InstancedMesh, Object3D } from "three";
import { Entity } from "@/entities/Entity";
import { PropRole } from "@/types/theme";
import type { IPropGroup } from "@/types/theme";
import type { IModelTemplate, IWorldContext, IWorldEntity } from "@/types/world";
import { FOLIAGE_LAYER } from "@/world/effects/FoliageMaskPass";

export class RegionProps extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly context: IWorldContext;
    private readonly batches: InstancedMesh[] = [];
    private readonly colliders: Collider[] = [];
    private readonly rigidBody: RigidBody;

    constructor(regionId: string, context: IWorldContext, groups: IPropGroup[]) {
        super(`${regionId}-props`);

        this.context = context;
        this.rigidBody = context.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());

        for (const group of groups) {
            const template = context.assetLibrary.getTemplate(group.modelPath);
            if (!template) continue;

            this.addBatches(group, template);
            if (group.hasCollider) this.addColliders(group, template.height);
        }
    }

    update(): void { }

    dispose(): void {
        for (const collider of this.colliders)
            this.context.physicsWorld.removeCollider(collider, false);

        for (const batch of this.batches) batch.dispose();

        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.colliders.length = 0;
        this.batches.length = 0;
        this.sceneObject.clear();
    }

    private addBatches(group: IPropGroup, template: IModelTemplate): void {
        const transform = new Object3D();
        const castsShadow = group.role !== PropRole.Scatter;

        for (const part of template.parts) {
            const batch = new InstancedMesh(part.geometry, part.material, group.placements.length);
            batch.castShadow = castsShadow;
            batch.receiveShadow = true;
            if (part.isFoliage) batch.layers.enable(FOLIAGE_LAYER);

            group.placements.forEach((placement, index) => {
                transform.position.set(...placement.position);
                transform.rotation.y = placement.rotationY;
                transform.scale.setScalar(placement.scale);
                transform.updateMatrix();
                batch.setMatrixAt(index, transform.matrix);
            });

            batch.instanceMatrix.needsUpdate = true;
            batch.computeBoundingSphere();

            this.batches.push(batch);
            this.sceneObject.add(batch);
        }
    }

    private addColliders(group: IPropGroup, modelHeight: number): void {
        for (const placement of group.placements) {
            const [x, y, z] = placement.position;
            const halfHeight = (modelHeight * placement.scale) / 2;
            const radius = group.footprintRadius * placement.scale;

            const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(
                x,
                y + halfHeight,
                z
            );

            this.colliders.push(
                this.context.physicsWorld.createCollider(colliderDesc, this.rigidBody)
            );
        }
    }
}
