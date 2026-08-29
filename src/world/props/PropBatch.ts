import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group, InstancedMesh, Object3D } from "three";
import { Entity } from "@/entities/Entity";
import { PropRole } from "@/types/theme";
import type { IPropGroup } from "@/types/theme";
import type { IModelTemplate, IWorldContext, IWorldEntity } from "@/types/world";
import { FOLIAGE_LAYER } from "@/world/effects/FoliageMaskPass";

const instanceTransform = new Object3D();

export class PropBatch extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly physicsWorld: PhysicsWorld;
    private readonly batches: InstancedMesh[] = [];
    private readonly rigidBody: RigidBody;

    constructor(regionId: string, context: IWorldContext, groups: IPropGroup[]) {
        super(`${regionId}-props`);
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();

        this.physicsWorld = context.physicsWorld;
        this.rigidBody = context.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());

        for (const group of groups) {
            if (group.placements.length === 0) continue;

            const template = context.assetLibrary.getTemplate(group.modelPath);
            if (!template) continue;

            this.addBatches(group, template);
            if (group.hasCollider) this.addColliders(group, template.height);
        }

        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;
        for (const batch of this.batches) batch.matrixWorldAutoUpdate = false;
    }

    update(): void {}

    dispose(): void {
        this.physicsWorld.removeRigidBody(this.rigidBody);

        for (const batch of this.batches) batch.dispose();

        this.batches.length = 0;
        this.sceneObject.clear();
    }

    private addBatches(group: IPropGroup, template: IModelTemplate): void {
        const placementCount = group.placements.length;
        const castsShadow = group.role !== PropRole.Scatter;
        const instanceMatrices = new Float32Array(placementCount * 16);

        for (let index = 0; index < placementCount; index += 1) {
            const placement = group.placements[index];

            instanceTransform.position.set(
                placement.position[0],
                placement.position[1],
                placement.position[2]
            );
            instanceTransform.rotation.y = placement.rotationY;
            instanceTransform.scale.setScalar(placement.scale);
            instanceTransform.updateMatrix();
            instanceTransform.matrix.toArray(instanceMatrices, index * 16);
        }

        for (const part of template.parts) {
            const batch = new InstancedMesh(part.geometry, part.material, placementCount);
            batch.castShadow = castsShadow;
            batch.receiveShadow = true;
            batch.matrixAutoUpdate = false;
            batch.updateMatrix();
            if (part.isFoliage) batch.layers.enable(FOLIAGE_LAYER);

            const instanceMatrixArray = batch.instanceMatrix.array as Float32Array;
            instanceMatrixArray.set(instanceMatrices);
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

            this.physicsWorld.createCollider(colliderDesc, this.rigidBody);
        }
    }
}
