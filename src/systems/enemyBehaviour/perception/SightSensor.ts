import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import type { Vector3 } from "three";
import { SIGHT } from "@/constants/enemies";
import { isSegmentBlocked } from "@/world/SegmentQuery";
import { angleDelta, clamp, horizontalDistance, lerp, smoothstep, yawTowards } from "@/lib/helpers";

export class SightSensor implements ISightSensor {
    private readonly physicsWorld: PhysicsWorld;
    private readonly ownCollider: Collider;
    private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    private secondsUntilCheck = 0;
    private wasInCone = false;
    private isLineClear = false;

    constructor(physicsWorld: PhysicsWorld, ownCollider: Collider) {
        this.physicsWorld = physicsWorld;
        this.ownCollider = ownCollider;
    }

    sense(
        eye: Vector3,
        facingYaw: number,
        target: Vector3,
        visibility: number,
        deltaSeconds: number
    ): number {
        const closeSense = closeSenseStrength(horizontalDistance(eye, target), visibility);
        const cone = coneStrength(eye, facingYaw, target);
        if (cone <= 0) {
            this.wasInCone = false;
            return closeSense;
        }

        this.secondsUntilCheck -= deltaSeconds;
        if (!this.wasInCone || this.secondsUntilCheck <= 0) {
            this.isLineClear = this.hasClearLine(eye, target);
            this.secondsUntilCheck = SIGHT.lineOfSightInterval;
        }
        this.wasInCone = true;

        return Math.max(closeSense, this.isLineClear ? cone * visibility : 0);
    }

    private hasClearLine(eye: Vector3, target: Vector3): boolean {
        return !isSegmentBlocked(this.physicsWorld, this.ray, eye, target, this.ownCollider);
    }
}

export interface ISightSensor {
    sense(
        eye: Vector3,
        facingYaw: number,
        target: Vector3,
        visibility: number,
        deltaSeconds: number
    ): number;
}

function coneStrength(eye: Vector3, facingYaw: number, target: Vector3): number {
    const distance = horizontalDistance(eye, target);
    if (distance < 1e-4) return 1;

    const bearing = Math.abs(angleDelta(facingYaw, yawTowards(eye, target)));

    if (distance <= SIGHT.nearRange && bearing <= SIGHT.nearHalfAngle)
        return lerp(
            1,
            SIGHT.nearEdgeStrength,
            smoothstep(SIGHT.nearRange * 0.4, SIGHT.nearRange, distance)
        );

    if (distance <= SIGHT.farRange && bearing <= SIGHT.farHalfAngle)
        return (
            SIGHT.farStrength *
            (1 - (distance - SIGHT.nearRange) / (SIGHT.farRange - SIGHT.nearRange))
        );

    return 0;
}

export function closeSenseStrength(distance: number, visibility: number): number {
    if (distance > SIGHT.closeSenseRange) return 0;

    const standingShare = clamp(
        (visibility - SIGHT.crouchedVisibility) / (1 - SIGHT.crouchedVisibility),
        0,
        1
    );
    return SIGHT.closeSenseStrength * standingShare;
}
