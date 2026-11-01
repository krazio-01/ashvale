import RAPIER from "@dimforge/rapier3d-compat";
import { createFixedBody } from "@/systems/physics/RapierWorld";
import type { RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group } from "three";
import type { Vector3Tuple } from "three";
import type { IWorldContext, IWorldEntity, ISettlementCollider } from "@/types/world";
import { yawQuaternion } from "@/lib/helpers";

export class SettlementColliders implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly physicsWorld: PhysicsWorld;
    private readonly rigidBody: RigidBody;

    constructor(context: IWorldContext, center: Vector3Tuple, colliders: ISettlementCollider[]) {
        this.physicsWorld = context.physicsWorld;
        this.rigidBody = createFixedBody(context.physicsWorld);

        const [centerX, , centerZ] = center;

        for (const desc of colliders) {
            this.physicsWorld.createCollider(
                RAPIER.ColliderDesc.cuboid(desc.halfWidth, desc.halfHeight, desc.halfDepth)
                    .setTranslation(
                        centerX + desc.localX,
                        desc.elevation + desc.halfHeight,
                        centerZ + desc.localZ
                    )
                    .setRotation(yawQuaternion(desc.rotationY)),
                this.rigidBody
            );
        }
    }

    update(): void {}

    dispose(): void {
        this.physicsWorld.removeRigidBody(this.rigidBody);
    }
}
