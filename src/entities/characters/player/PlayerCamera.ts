import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, Ray, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Camera } from "three";
import { CAMERA } from "@/constants/characters";
import { clamp } from "@/lib/helpers";

const orbitDirection = new Vector3();

export class PlayerCamera {
    private readonly camera: Camera;
    private readonly physicsWorld: PhysicsWorld;
    private readonly ignoredCollider: Collider;
    private readonly sightRay: Ray;
    private readonly smoothedPivot = new Vector3();
    private orbitYaw = 0;
    private orbitPitch = CAMERA.startPitch;
    private followDistance = CAMERA.targetFollowDistance;
    private hasPivot = false;

    constructor(
        camera: Camera,
        physicsWorld: PhysicsWorld,
        ignoredCollider: Collider,
        startYaw: number
    ) {
        this.camera = camera;
        this.physicsWorld = physicsWorld;
        this.ignoredCollider = ignoredCollider;
        this.orbitYaw = startYaw;
        this.sightRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    }

    get yaw(): number {
        return this.orbitYaw;
    }

    turnBy(yawDelta: number, pitchDelta: number): void {
        this.orbitYaw -= yawDelta;
        this.orbitPitch = clamp(
            this.orbitPitch + pitchDelta,
            CAMERA.pitchRange[0],
            CAMERA.pitchRange[1]
        );
    }

    follow(deltaSeconds: number, targetX: number, targetY: number, targetZ: number): void {
        this.trackPivot(deltaSeconds, targetX, targetY + CAMERA.pivotHeight, targetZ);

        const pitchHorizontalScale = Math.cos(this.orbitPitch);
        orbitDirection.set(
            Math.sin(this.orbitYaw) * pitchHorizontalScale,
            Math.sin(this.orbitPitch),
            Math.cos(this.orbitYaw) * pitchHorizontalScale
        );

        this.easeToUnobstructedDistance(deltaSeconds);

        this.camera.position
            .copy(this.smoothedPivot)
            .addScaledVector(orbitDirection, this.followDistance);
        this.camera.lookAt(this.smoothedPivot);
    }

    private trackPivot(deltaSeconds: number, pivotX: number, pivotY: number, pivotZ: number): void {
        if (!this.hasPivot) {
            this.smoothedPivot.set(pivotX, pivotY, pivotZ);
            this.hasPivot = true;
            return;
        }

        const pivotFactor = 1 - Math.exp(-CAMERA.pivotSmoothing * deltaSeconds);
        this.smoothedPivot.x += (pivotX - this.smoothedPivot.x) * pivotFactor;
        this.smoothedPivot.y += (pivotY - this.smoothedPivot.y) * pivotFactor;
        this.smoothedPivot.z += (pivotZ - this.smoothedPivot.z) * pivotFactor;
    }

    private easeToUnobstructedDistance(deltaSeconds: number): void {
        this.sightRay.origin.x = this.smoothedPivot.x;
        this.sightRay.origin.y = this.smoothedPivot.y;
        this.sightRay.origin.z = this.smoothedPivot.z;
        this.sightRay.dir.x = orbitDirection.x;
        this.sightRay.dir.y = orbitDirection.y;
        this.sightRay.dir.z = orbitDirection.z;

        const hit = this.physicsWorld.castRay(
            this.sightRay,
            CAMERA.targetFollowDistance,
            true,
            undefined,
            undefined,
            this.ignoredCollider
        );

        const unobstructedDistance = hit
            ? Math.max(hit.timeOfImpact - CAMERA.collisionPadding, CAMERA.minimumFollowDistance)
            : CAMERA.targetFollowDistance;

        if (unobstructedDistance <= this.followDistance) {
            this.followDistance = unobstructedDistance;
            return;
        }

        const easeFactor = 1 - Math.exp(-CAMERA.pullOutSmoothing * deltaSeconds);
        this.followDistance += (unobstructedDistance - this.followDistance) * easeFactor;
    }
}
