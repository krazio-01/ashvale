import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Camera, Group, InstancedMesh, Object3D, Vector3 } from "three";
import { Entity } from "@/entities/Entity";
import { PROP_TRANSFORM_STRIDE, PropLayer } from "@/types/theme";
import type { IPropGroup } from "@/types/theme";
import type { IModelTemplate, IWorldContext, IWorldEntity } from "@/types/world";
import { FOLIAGE_LAYER } from "@/world/effects/FoliageMaskPass";
import { PROP_FIELD } from "@/constants/placement";

const instanceTransform = new Object3D();
const cameraGroundPosition = new Vector3();
let matrixScratch = new Float32Array(0);

export class PropBatch extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly physicsWorld: PhysicsWorld;
    private readonly camera: Camera;
    private readonly batches: InstancedMesh[] = [];
    private readonly rigidBody: RigidBody;

    private footprintCenterX = 0;
    private footprintCenterZ = 0;
    private activationDistanceSquared = Infinity;

    constructor(batchId: string, context: IWorldContext, camera: Camera, groups: IPropGroup[]) {
        super(`${batchId}-props`);
        this.sceneObject.matrixAutoUpdate = false;

        this.camera = camera;
        this.physicsWorld = context.physicsWorld;
        this.rigidBody = context.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());

        for (const group of groups) {
            if (group.instanceCount === 0) continue;

            const template = context.assetLibrary.getTemplate(group.modelPath);
            if (!template) continue;

            this.addBatches(group, template);
            if (group.hasCollider) this.addColliders(group, template.height);
        }

        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;
        for (const batch of this.batches) batch.matrixWorldAutoUpdate = false;

        this.measureFootprint();
    }

    update(): void {
        this.camera.getWorldPosition(cameraGroundPosition);

        const offsetX = cameraGroundPosition.x - this.footprintCenterX;
        const offsetZ = cameraGroundPosition.z - this.footprintCenterZ;

        this.sceneObject.visible =
            offsetX * offsetX + offsetZ * offsetZ <= this.activationDistanceSquared;
    }

    dispose(): void {
        this.physicsWorld.removeRigidBody(this.rigidBody);

        for (const batch of this.batches) batch.dispose();

        this.batches.length = 0;
        this.sceneObject.clear();
    }

    private addBatches(group: IPropGroup, template: IModelTemplate): void {
        const matrices = buildInstanceMatrices(group);
        const castsShadow = shadowCastingLayer(group.layer);

        for (const part of template.parts) {
            const batch = new InstancedMesh(part.geometry, part.material, group.instanceCount);
            batch.castShadow = castsShadow;
            batch.receiveShadow = true;
            batch.matrixAutoUpdate = false;
            batch.updateMatrixWorld(true);
            if (part.isFoliage) batch.layers.enable(FOLIAGE_LAYER);

            batch.instanceMatrix.array.set(matrices.subarray(0, group.instanceCount * 16));
            batch.instanceMatrix.needsUpdate = true;
            batch.computeBoundingSphere();

            this.batches.push(batch);
            this.sceneObject.add(batch);
        }
    }

    private addColliders(group: IPropGroup, modelHeight: number): void {
        for (let instance = 0; instance < group.instanceCount; instance += 1) {
            const offset = instance * PROP_TRANSFORM_STRIDE;
            const scale = group.transforms[offset + 4] ?? 1;
            const halfHeight = (modelHeight * scale) / 2;

            const colliderDesc = RAPIER.ColliderDesc.cylinder(
                halfHeight,
                group.footprintRadius * scale
            ).setTranslation(
                group.transforms[offset] ?? 0,
                (group.transforms[offset + 1] ?? 0) + halfHeight,
                group.transforms[offset + 2] ?? 0
            );

            this.physicsWorld.createCollider(colliderDesc, this.rigidBody);
        }
    }

    private measureFootprint(): void {
        let minimumX = Infinity;
        let maximumX = -Infinity;
        let minimumZ = Infinity;
        let maximumZ = -Infinity;

        for (const batch of this.batches) {
            const sphere = batch.boundingSphere;
            if (!sphere) continue;

            minimumX = Math.min(minimumX, sphere.center.x - sphere.radius);
            maximumX = Math.max(maximumX, sphere.center.x + sphere.radius);
            minimumZ = Math.min(minimumZ, sphere.center.z - sphere.radius);
            maximumZ = Math.max(maximumZ, sphere.center.z + sphere.radius);
        }

        if (minimumX > maximumX) return;

        this.footprintCenterX = (minimumX + maximumX) / 2;
        this.footprintCenterZ = (minimumZ + maximumZ) / 2;

        const footprintReach = Math.hypot(maximumX - minimumX, maximumZ - minimumZ) / 2;
        const activationDistance = PROP_FIELD.activationRadius + footprintReach;

        this.activationDistanceSquared = activationDistance * activationDistance;
    }
}

function buildInstanceMatrices(group: IPropGroup): Float32Array {
    const requiredLength = group.instanceCount * 16;
    if (matrixScratch.length < requiredLength) matrixScratch = new Float32Array(requiredLength);

    for (let instance = 0; instance < group.instanceCount; instance += 1) {
        const offset = instance * PROP_TRANSFORM_STRIDE;

        instanceTransform.position.set(
            group.transforms[offset] ?? 0,
            group.transforms[offset + 1] ?? 0,
            group.transforms[offset + 2] ?? 0
        );
        instanceTransform.rotation.y = group.transforms[offset + 3] ?? 0;
        instanceTransform.scale.setScalar(group.transforms[offset + 4] ?? 1);
        instanceTransform.updateMatrix();
        instanceTransform.matrix.toArray(matrixScratch, instance * 16);
    }

    return matrixScratch;
}

function shadowCastingLayer(layer: PropLayer): boolean {
    return layer === PropLayer.Canopy || layer === PropLayer.Rock || layer === PropLayer.Understory;
}
