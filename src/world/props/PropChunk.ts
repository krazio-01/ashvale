import RAPIER from "@dimforge/rapier3d-compat";
import { createFixedBody } from "@/systems/physics/RapierWorld";
import type { RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Camera, Group, InstancedMesh, Object3D, Vector3 } from "three";
import type { IPropGroup, IModelTemplate, IWorldContext, IWorldEntity } from "@/types/world";
import { FOLIAGE_LAYER } from "@/constants/world";
import { PROP_SCATTER, PROP_TRANSFORM_STRIDE, PROP_LAYER_RULES } from "@/constants/placement";
import {
    createSeededRandom,
    hashString,
    lerp,
    freezeTransform,
    yawQuaternion,
} from "@/lib/helpers";

export class PropChunk implements IWorldEntity {
    private static readonly instanceTransform = new Object3D();

    private static readonly cameraGroundPosition = new Vector3();

    private static buildInstanceMatrices(group: IPropGroup): Float32Array {
        const matrices = new Float32Array(group.instanceCount * 16);

        for (let instance = 0; instance < group.instanceCount; instance += 1) {
            const offset = instance * PROP_TRANSFORM_STRIDE;

            PropChunk.instanceTransform.position.set(
                group.transforms[offset],
                group.transforms[offset + 1],
                group.transforms[offset + 2]
            );
            PropChunk.instanceTransform.rotation.y = group.transforms[offset + 3];
            PropChunk.instanceTransform.scale.setScalar(group.transforms[offset + 4]);
            PropChunk.instanceTransform.updateMatrix();
            PropChunk.instanceTransform.matrix.toArray(matrices, instance * 16);
        }

        return matrices;
    }

    readonly sceneObject = new Group();

    private readonly physicsWorld: PhysicsWorld;
    private readonly camera: Camera;
    private readonly instancedMeshes: InstancedMesh[] = [];
    private readonly rigidBody: RigidBody;

    private footprintCenterX = 0;
    private footprintCenterZ = 0;
    private activationDistanceSquared = Infinity;
    private deactivationDistanceSquared = Infinity;

    constructor(context: IWorldContext, camera: Camera, groups: IPropGroup[]) {
        this.camera = camera;
        this.physicsWorld = context.physicsWorld;
        this.rigidBody = createFixedBody(context.physicsWorld);

        for (const group of groups) {
            if (group.instanceCount === 0) continue;

            const template = context.assetLibrary.getTemplate(group.modelPath);
            if (!template) continue;

            this.addInstancedMeshes(group, template);
            if (group.hasCollider) this.addColliders(group, template);
        }

        freezeTransform(this.sceneObject);
        for (const instancedMesh of this.instancedMeshes)
            instancedMesh.matrixWorldAutoUpdate = false;

        this.measureFootprint(groups);
        this.sceneObject.visible = false;
        this.update();
    }

    update(): void {
        this.camera.getWorldPosition(PropChunk.cameraGroundPosition);

        const offsetX = PropChunk.cameraGroundPosition.x - this.footprintCenterX;
        const offsetZ = PropChunk.cameraGroundPosition.z - this.footprintCenterZ;
        const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

        this.sceneObject.visible = this.sceneObject.visible
            ? distanceSquared <= this.deactivationDistanceSquared
            : distanceSquared <= this.activationDistanceSquared;
    }

    dispose(): void {
        this.physicsWorld.removeRigidBody(this.rigidBody);

        for (const instancedMesh of this.instancedMeshes) instancedMesh.dispose();

        this.instancedMeshes.length = 0;
        this.sceneObject.clear();
    }

    private addInstancedMeshes(group: IPropGroup, template: IModelTemplate): void {
        const matrices = PropChunk.buildInstanceMatrices(group);
        const castsShadow = PROP_LAYER_RULES[group.layer].castsShadow;

        for (const part of template.parts) {
            const instancedMesh = new InstancedMesh(
                part.geometry,
                part.material,
                group.instanceCount
            );
            instancedMesh.castShadow = castsShadow;
            instancedMesh.receiveShadow = true;
            instancedMesh.matrixAutoUpdate = false;
            if (part.isFoliage) instancedMesh.layers.enable(FOLIAGE_LAYER);

            instancedMesh.instanceMatrix.array.set(matrices);
            instancedMesh.instanceMatrix.needsUpdate = true;
            instancedMesh.computeBoundingSphere();

            this.instancedMeshes.push(instancedMesh);
            this.sceneObject.add(instancedMesh);
        }
    }

    private addColliders(group: IPropGroup, template: IModelTemplate): void {
        const isCuboid = group.colliderShape === "cuboid";

        for (let instance = 0; instance < group.instanceCount; instance += 1) {
            const offset = instance * PROP_TRANSFORM_STRIDE;
            const scale = group.transforms[offset + 4];
            const x = group.transforms[offset];
            const y = group.transforms[offset + 1];
            const z = group.transforms[offset + 2];
            const yaw = group.transforms[offset + 3];

            if (isCuboid) {
                const hx = template.halfExtents.x * scale;
                const hy = template.halfExtents.y * scale;
                const hz = template.halfExtents.z * scale;
                if (!(hx > 0) || !(hy > 0) || !(hz > 0)) continue;

                const cosYaw = Math.cos(yaw);
                const sinYaw = Math.sin(yaw);
                const offsetX =
                    (template.centerOffset.x * cosYaw + template.centerOffset.z * sinYaw) * scale;
                const offsetY = template.centerOffset.y * scale;
                const offsetZ =
                    (-template.centerOffset.x * sinYaw + template.centerOffset.z * cosYaw) * scale;

                const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
                    .setTranslation(x + offsetX, y + offsetY, z + offsetZ)
                    .setRotation(yawQuaternion(yaw));

                this.physicsWorld.createCollider(colliderDesc, this.rigidBody);
            } else {
                const halfHeight = (template.height * scale) / 2;
                const radius = group.footprintRadius * scale;
                if (!(halfHeight > 0) || !(radius > 0)) continue;

                const colliderDesc = RAPIER.ColliderDesc.cylinder(
                    halfHeight,
                    radius
                ).setTranslation(x, y + halfHeight, z);

                this.physicsWorld.createCollider(colliderDesc, this.rigidBody);
            }
        }
    }

    private measureFootprint(groups: IPropGroup[]): void {
        let minimumX = Infinity;
        let maximumX = -Infinity;
        let minimumZ = Infinity;
        let maximumZ = -Infinity;

        for (const group of groups) {
            const transforms = group.transforms;
            const count = group.instanceCount;
            for (let i = 0; i < count; i++) {
                const offset = i * PROP_TRANSFORM_STRIDE;
                const x = transforms[offset];
                const z = transforms[offset + 2];
                const scale = transforms[offset + 4];
                const radius = group.footprintRadius * scale;

                minimumX = Math.min(minimumX, x - radius);
                maximumX = Math.max(maximumX, x + radius);
                minimumZ = Math.min(minimumZ, z - radius);
                maximumZ = Math.max(maximumZ, z + radius);
            }
        }

        if (minimumX > maximumX) return;

        this.footprintCenterX = (minimumX + maximumX) / 2;
        this.footprintCenterZ = (minimumZ + maximumZ) / 2;

        const footprintReach = Math.hypot(maximumX - minimumX, maximumZ - minimumZ) / 2;
        const jitterSeed = hashString(
            `${this.footprintCenterX.toFixed(1)},${this.footprintCenterZ.toFixed(1)}`
        );
        const jitterRatio = createSeededRandom(jitterSeed)();
        const jitteredRadius =
            PROP_SCATTER.activationRadius *
            lerp(1 - PROP_SCATTER.activationJitter, 1 + PROP_SCATTER.activationJitter, jitterRatio);
        const activationDistance = jitteredRadius + footprintReach;
        const deactivationDistance = activationDistance + PROP_SCATTER.deactivationMargin;

        this.activationDistanceSquared = activationDistance * activationDistance;
        this.deactivationDistanceSquared = deactivationDistance * deactivationDistance;
    }
}
