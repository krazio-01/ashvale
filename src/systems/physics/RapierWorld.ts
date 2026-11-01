import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, Ray, RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import type { Vector3, Vector3Tuple } from "three";
import { COLLISION_GROUPS } from "@/constants/world";
import { COMBAT_MOVEMENT } from "@/constants/combat";

export function createFixedBody(physicsWorld: PhysicsWorld, center?: Vector3Tuple): RigidBody {
    const description = RAPIER.RigidBodyDesc.fixed();
    if (center) description.setTranslation(center[0], 0, center[2]);
    return physicsWorld.createRigidBody(description);
}

export function isSegmentBlocked(
    physicsWorld: PhysicsWorld,
    ray: Ray,
    from: Vector3,
    to: Vector3,
    excludeCollider?: Collider
): boolean {
    const offsetX = to.x - from.x;
    const offsetY = to.y - from.y;
    const offsetZ = to.z - from.z;
    const length = Math.hypot(offsetX, offsetY, offsetZ);
    if (length < COMBAT_MOVEMENT.minimumPlanarLength) return false;

    ray.origin.x = from.x;
    ray.origin.y = from.y;
    ray.origin.z = from.z;
    ray.dir.x = offsetX / length;
    ray.dir.y = offsetY / length;
    ray.dir.z = offsetZ / length;
    return (
        physicsWorld.castRay(
            ray,
            length,
            true,
            undefined,
            COLLISION_GROUPS.sightLine,
            excludeCollider
        ) !== null
    );
}
