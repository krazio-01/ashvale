import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group } from "three";
import type { Vector3Tuple } from "three";
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { ISettlementColliderDesc } from "@/types/settlement";

export class SettlementColliders extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly physicsWorld: PhysicsWorld;
    private readonly rigidBody: RigidBody;

    constructor(
        id: string,
        context: IWorldContext,
        center: Vector3Tuple,
        colliders: ISettlementColliderDesc[]
    ) {
        super(id);

        this.physicsWorld = context.physicsWorld;
        this.rigidBody = context.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());

        const [centerX, , centerZ] = center;

        for (const desc of colliders) {
            const halfYaw = desc.rotationY / 2;

            this.physicsWorld.createCollider(
                RAPIER.ColliderDesc.cuboid(desc.halfWidth, desc.halfHeight, desc.halfDepth)
                    .setTranslation(
                        centerX + desc.localX,
                        desc.elevation + desc.halfHeight,
                        centerZ + desc.localZ
                    )
                    .setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) }),
                this.rigidBody
            );
        }
    }

    update(): void {}

    dispose(): void {
        this.physicsWorld.removeRigidBody(this.rigidBody);
    }
}
