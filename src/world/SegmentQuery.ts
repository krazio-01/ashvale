import type { Collider, Ray, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import type { Vector3 } from "three";
import { COLLISION_GROUPS } from "@/constants/world";
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
    if (length < 1e-4) return false;

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
