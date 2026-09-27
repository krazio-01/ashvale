import RAPIER from "@dimforge/rapier3d-compat";
import type {
    Collider,
    Ray,
    RayColliderHit,
    World as PhysicsWorld,
} from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Camera, PerspectiveCamera } from "three";
import { CAMERA, CAMERA_SHAKE, KILL_CAMERA, LOCK_CAMERA } from "@/constants/player";
import { angleDelta, clamp, lerp, smoothstep } from "@/lib/helpers";
import { settings } from "@/settings/SettingsStore";

export class PlayerCamera {
    private readonly camera: PerspectiveCamera;
    private readonly physicsWorld: PhysicsWorld;
    private readonly ignoredCollider: Collider;
    private readonly sightRay: Ray;
    private readonly smoothedPivot = new Vector3();
    private readonly blendedPivot = new Vector3();
    private readonly killCamFocus = new Vector3();
    private readonly lockPoint = new Vector3();
    private orbitYaw = 0;
    private orbitPitch = CAMERA.startPitch;
    private followDistance = CAMERA.targetFollowDistance;
    private desiredFollowDistance = CAMERA.targetFollowDistance;
    private speedBlend = 0;
    private hasPivot = false;
    private punchRemaining = 0;
    private isLocked = false;
    private killCamShot: IKillCamShot | null = null;
    private isKillCamActive = false;
    private killCamLevel = 0;
    private trauma = 0;
    private shakeClock = 0;

    constructor(
        camera: Camera,
        physicsWorld: PhysicsWorld,
        ignoredCollider: Collider,
        startYaw: number
    ) {
        this.camera = camera as PerspectiveCamera;
        this.physicsWorld = physicsWorld;
        this.ignoredCollider = ignoredCollider;
        this.orbitYaw = startYaw;
        this.sightRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    }

    get yaw(): number {
        return this.orbitYaw;
    }

    punch(): void {
        this.punchRemaining = 1;
    }

    addTrauma(amount: number): void {
        this.trauma = Math.min(1, this.trauma + amount);
    }

    resetPivot(): void {
        this.hasPivot = false;
    }

    setLockPoint(point: Vector3 | null): void {
        this.isLocked = point !== null;
        if (point) this.lockPoint.copy(point);
    }

    beginKillCam(shot: IKillCamShot, focus: Vector3): void {
        this.killCamShot = shot;
        this.killCamFocus.copy(focus);
        this.isKillCamActive = true;
    }

    setKillCamFocus(focus: Vector3): void {
        this.killCamFocus.copy(focus);
    }

    endKillCam(): void {
        this.isKillCamActive = false;
    }

    isShotClear(focus: Vector3, yaw: number, pitch: number, distance: number): boolean {
        setOrbitDirection(candidateShotDirection, yaw, pitch);
        return this.castSight(focus, candidateShotDirection, distance) === null;
    }

    turnBy(yawDelta: number, pitchDelta: number): void {
        if (this.isLocked || this.killCamLevel > 0) return;
        this.orbitYaw -= yawDelta;
        this.orbitPitch = clamp(
            this.orbitPitch + pitchDelta,
            CAMERA.pitchRange[0],
            CAMERA.pitchRange[1]
        );
    }

    follow(
        deltaSeconds: number,
        targetX: number,
        targetY: number,
        targetZ: number,
        isSprinting: boolean
    ): void {
        this.steerOrbit(deltaSeconds, targetX, targetZ);

        const shoulderRightX = Math.cos(this.orbitYaw);
        const shoulderRightZ = -Math.sin(this.orbitYaw);
        this.trackPivot(
            deltaSeconds,
            targetX + shoulderRightX * CAMERA.shoulderOffset,
            targetY + CAMERA.pivotHeight,
            targetZ + shoulderRightZ * CAMERA.shoulderOffset
        );

        const blendStepSeconds = Math.min(deltaSeconds, MAXIMUM_KILL_CAM_BLEND_STEP_SECONDS);
        const blendRate = this.isKillCamActive
            ? blendStepSeconds / KILL_CAMERA.blendInSeconds
            : -blendStepSeconds / KILL_CAMERA.blendOutSeconds;
        this.killCamLevel = clamp(this.killCamLevel + blendRate, 0, 1);

        const shot = this.killCamShot;
        const weight = shot ? smoothstep(0, 1, this.killCamLevel) : 0;
        const yaw = shot
            ? this.orbitYaw + angleDelta(this.orbitYaw, shot.yaw) * weight
            : this.orbitYaw;
        const pitch = shot ? lerp(this.orbitPitch, shot.pitch, weight) : this.orbitPitch;
        this.blendedPivot.lerpVectors(this.smoothedPivot, this.killCamFocus, weight);
        setOrbitDirection(orbitDirection, yaw, pitch);

        const speedBlendFactor = 1 - Math.exp(-CAMERA.speedBlendSmoothing * deltaSeconds);
        this.speedBlend += ((isSprinting ? 1 : 0) - this.speedBlend) * speedBlendFactor;
        this.desiredFollowDistance = lerp(
            CAMERA.targetFollowDistance,
            CAMERA.sprintFollowDistance,
            this.speedBlend
        );
        this.punchRemaining *= Math.exp(-CAMERA.hitPunchDecay * deltaSeconds);
        const fov =
            settings.fov +
            CAMERA.sprintFovBoost * this.speedBlend +
            CAMERA.hitPunchFov * this.punchRemaining;
        if (fov !== this.camera.fov) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }

        const desiredDistance = shot
            ? lerp(this.desiredFollowDistance, shot.distance, weight)
            : this.desiredFollowDistance;
        this.easeToUnobstructedDistance(
            weight > 0 ? blendStepSeconds : deltaSeconds,
            desiredDistance,
            weight > 0
        );

        this.camera.position
            .copy(this.blendedPivot)
            .addScaledVector(orbitDirection, this.followDistance);
        this.camera.lookAt(this.blendedPivot);
        this.applyShake(deltaSeconds);

        if (!this.isKillCamActive && this.killCamLevel === 0) this.killCamShot = null;
    }

    private steerOrbit(deltaSeconds: number, targetX: number, targetZ: number): void {
        if (!this.isLocked) return;

        const desiredYaw = Math.atan2(targetX - this.lockPoint.x, targetZ - this.lockPoint.z);
        const yawFactor = 1 - Math.exp(-LOCK_CAMERA.yawSmoothing * deltaSeconds);
        const pitchFactor = 1 - Math.exp(-LOCK_CAMERA.pitchSmoothing * deltaSeconds);
        this.orbitYaw += angleDelta(this.orbitYaw, desiredYaw) * yawFactor;
        this.orbitPitch += (LOCK_CAMERA.pitch - this.orbitPitch) * pitchFactor;
    }

    private applyShake(deltaSeconds: number): void {
        if (this.trauma <= 0) return;

        this.shakeClock += deltaSeconds;
        this.trauma = Math.max(0, this.trauma - CAMERA_SHAKE.decay * deltaSeconds);

        const intensity = this.trauma * this.trauma;
        const phase = this.shakeClock * CAMERA_SHAKE.frequency;
        const offsetX = Math.sin(phase) * Math.sin(phase * 0.37 + 1.3);
        const offsetY = Math.sin(phase * 1.21 + 2.1) * Math.sin(phase * 0.53);
        const roll = Math.sin(phase * 0.83 + 0.7);

        this.camera.translateX(offsetX * CAMERA_SHAKE.maxOffset * intensity);
        this.camera.translateY(offsetY * CAMERA_SHAKE.maxOffset * intensity);
        this.camera.rotateZ(roll * CAMERA_SHAKE.maxRoll * intensity);
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

    private castSight(
        origin: Vector3,
        direction: Vector3,
        distance: number
    ): RayColliderHit | null {
        this.sightRay.origin.x = origin.x;
        this.sightRay.origin.y = origin.y;
        this.sightRay.origin.z = origin.z;
        this.sightRay.dir.x = direction.x;
        this.sightRay.dir.y = direction.y;
        this.sightRay.dir.z = direction.z;

        return this.physicsWorld.castRay(
            this.sightRay,
            distance,
            true,
            undefined,
            undefined,
            this.ignoredCollider
        );
    }

    private easeToUnobstructedDistance(
        deltaSeconds: number,
        desiredDistance: number,
        easesInward: boolean
    ): void {
        const hit = this.castSight(this.blendedPivot, orbitDirection, desiredDistance);
        const unobstructedDistance = hit
            ? Math.max(hit.timeOfImpact - CAMERA.collisionPadding, CAMERA.minimumFollowDistance)
            : desiredDistance;
        const isPullingIn = unobstructedDistance <= this.followDistance;

        if (isPullingIn && !easesInward) {
            this.followDistance = unobstructedDistance;
            return;
        }

        const smoothing = isDistanceOccluded(hit !== null, unobstructedDistance, desiredDistance)
            ? KILL_CAMERA.occlusionPullInSmoothing
            : CAMERA.pullOutSmoothing;
        const easeFactor = 1 - Math.exp(-smoothing * deltaSeconds);
        this.followDistance += (unobstructedDistance - this.followDistance) * easeFactor;
    }
}

interface IKillCamShot {
    yaw: number;
    pitch: number;
    distance: number;
}

export function chooseKillCamShot(
    pairAxisYaw: number,
    currentYaw: number,
    pairSpan: number,
    isClear: (yaw: number, pitch: number, distance: number) => boolean
): IKillCamShot {
    let chosen: IKillCamShot | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of KILL_CAMERA.candidates) {
        const yaw = pairAxisYaw + candidate.yawOffset;
        const distance = KILL_CAMERA.baseDistance + pairSpan * candidate.distanceScale;
        if (!isClear(yaw, candidate.pitch, distance)) continue;

        const score = Math.abs(angleDelta(currentYaw, yaw)) + candidate.penalty;
        if (score >= bestScore) continue;

        bestScore = score;
        chosen = { yaw, pitch: candidate.pitch, distance };
    }

    return (
        chosen ?? {
            yaw: currentYaw,
            pitch: KILL_CAMERA.fallbackPitch,
            distance: CAMERA.targetFollowDistance,
        }
    );
}

function isDistanceOccluded(
    hasHit: boolean,
    unobstructedDistance: number,
    desiredDistance: number
): boolean {
    return hasHit && unobstructedDistance < desiredDistance;
}

function setOrbitDirection(out: Vector3, yaw: number, pitch: number): Vector3 {
    const horizontal = Math.cos(pitch);
    return out.set(Math.sin(yaw) * horizontal, Math.sin(pitch), Math.cos(yaw) * horizontal);
}

const orbitDirection = new Vector3();
const candidateShotDirection = new Vector3();

const MAXIMUM_KILL_CAM_BLEND_STEP_SECONDS = 1 / 30;
