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
import {
    shortestAngleBetween,
    clamp,
    lerp,
    smoothstep,
    smoothingFactor,
    lerpAngle,
    moveTowards,
    yawFromDirection,
} from "@/lib/helpers";
import { store } from "@/store/store";

interface IKillCamShot {
    yaw: number;
    pitch: number;
    distance: number;
}

export class PlayerCamera {
    private static setOrbitDirection(out: Vector3, yaw: number, pitch: number): Vector3 {
        const horizontal = Math.cos(pitch);
        return out.set(Math.sin(yaw) * horizontal, Math.sin(pitch), Math.cos(yaw) * horizontal);
    }

    private static readonly orbitDirection = new Vector3();

    private static readonly candidateShotDirection = new Vector3();

    private static readonly targetPivot = new Vector3();

    private static readonly MAXIMUM_KILL_CAM_BLEND_STEP_SECONDS = 1 / 30;

    private readonly camera: PerspectiveCamera;
    private readonly physicsWorld: PhysicsWorld;
    private readonly ignoredCollider: Collider;
    private readonly cameraRay: Ray;
    private readonly smoothedPivot = new Vector3();
    private readonly blendedPivot = new Vector3();
    private readonly killCamFocus = new Vector3();
    private readonly lockPoint = new Vector3();
    private orbitYaw = 0;
    private orbitPitch = CAMERA.startPitch;
    private followDistance = CAMERA.targetFollowDistance;
    private sprintBlend = 0;
    private hasPivot = false;
    private fovPunchAmount = 0;
    private isLocked = false;
    private killCamShot: IKillCamShot = { yaw: 0, pitch: 0, distance: 0 };
    private isKillCamActive = false;
    private killCamBlend = 0;
    private shakeLevel = 0;
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
        this.cameraRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    }

    get yaw(): number {
        return this.orbitYaw;
    }

    punchFov(): void {
        this.fovPunchAmount = 1;
    }

    addShake(amount: number): void {
        this.shakeLevel = Math.min(1, this.shakeLevel + amount);
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
        PlayerCamera.setOrbitDirection(PlayerCamera.candidateShotDirection, yaw, pitch);
        return this.castCameraRay(focus, PlayerCamera.candidateShotDirection, distance) === null;
    }

    turnBy(yawDelta: number, pitchDelta: number): void {
        if (this.isLocked || this.killCamBlend > 0) return;
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
        this.orbitTowardsLockTarget(deltaSeconds, targetX, targetZ);

        const shoulderRightX = Math.cos(this.orbitYaw);
        const shoulderRightZ = -Math.sin(this.orbitYaw);
        this.trackPivot(
            deltaSeconds,
            targetX + shoulderRightX * CAMERA.shoulderOffset,
            targetY + CAMERA.pivotHeight,
            targetZ + shoulderRightZ * CAMERA.shoulderOffset
        );

        const blendStepSeconds = Math.min(
            deltaSeconds,
            PlayerCamera.MAXIMUM_KILL_CAM_BLEND_STEP_SECONDS
        );
        const blendStep = this.isKillCamActive
            ? blendStepSeconds / KILL_CAMERA.blendInSeconds
            : blendStepSeconds / KILL_CAMERA.blendOutSeconds;
        this.killCamBlend = moveTowards(this.killCamBlend, this.isKillCamActive ? 1 : 0, blendStep);

        const shot = this.killCamShot;
        const weight = smoothstep(0, 1, this.killCamBlend);
        const yaw = lerpAngle(this.orbitYaw, shot.yaw, weight);
        const pitch = lerp(this.orbitPitch, shot.pitch, weight);
        this.blendedPivot.lerpVectors(this.smoothedPivot, this.killCamFocus, weight);
        PlayerCamera.setOrbitDirection(PlayerCamera.orbitDirection, yaw, pitch);

        const speedBlendFactor = smoothingFactor(CAMERA.sprintBlendSmoothing, deltaSeconds);
        this.sprintBlend = lerp(this.sprintBlend, isSprinting ? 1 : 0, speedBlendFactor);
        const relaxedDistance = lerp(
            CAMERA.targetFollowDistance,
            CAMERA.sprintFollowDistance,
            this.sprintBlend
        );
        this.fovPunchAmount *= Math.exp(-CAMERA.hitPunchDecay * deltaSeconds);
        const fov =
            store.getState().settings.values.fov +
            CAMERA.sprintFovBoost * this.sprintBlend +
            CAMERA.hitPunchFov * this.fovPunchAmount;
        if (fov !== this.camera.fov) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }

        const desiredDistance = lerp(relaxedDistance, shot.distance, weight);
        this.easeToUnobstructedDistance(
            weight > 0 ? blendStepSeconds : deltaSeconds,
            desiredDistance,
            weight > 0
        );

        this.camera.position
            .copy(this.blendedPivot)
            .addScaledVector(PlayerCamera.orbitDirection, this.followDistance);
        this.camera.lookAt(this.blendedPivot);
        this.applyShake(deltaSeconds);
    }

    private orbitTowardsLockTarget(deltaSeconds: number, targetX: number, targetZ: number): void {
        if (!this.isLocked) return;

        const desiredYaw = yawFromDirection(targetX - this.lockPoint.x, targetZ - this.lockPoint.z);
        const yawFactor = smoothingFactor(LOCK_CAMERA.yawSmoothing, deltaSeconds);
        const pitchFactor = smoothingFactor(LOCK_CAMERA.pitchSmoothing, deltaSeconds);
        this.orbitYaw += shortestAngleBetween(this.orbitYaw, desiredYaw) * yawFactor;
        this.orbitPitch = lerp(this.orbitPitch, LOCK_CAMERA.pitch, pitchFactor);
    }

    private applyShake(deltaSeconds: number): void {
        if (this.shakeLevel <= 0) return;

        this.shakeClock += deltaSeconds;
        this.shakeLevel = Math.max(0, this.shakeLevel - CAMERA_SHAKE.decay * deltaSeconds);

        const intensity = this.shakeLevel * this.shakeLevel;
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

        const pivotFactor = smoothingFactor(CAMERA.pivotSmoothing, deltaSeconds);
        this.smoothedPivot.lerp(PlayerCamera.targetPivot.set(pivotX, pivotY, pivotZ), pivotFactor);
    }

    private castCameraRay(
        origin: Vector3,
        direction: Vector3,
        distance: number
    ): RayColliderHit | null {
        this.cameraRay.origin.x = origin.x;
        this.cameraRay.origin.y = origin.y;
        this.cameraRay.origin.z = origin.z;
        this.cameraRay.dir.x = direction.x;
        this.cameraRay.dir.y = direction.y;
        this.cameraRay.dir.z = direction.z;

        return this.physicsWorld.castRay(
            this.cameraRay,
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
        const hit = this.castCameraRay(
            this.blendedPivot,
            PlayerCamera.orbitDirection,
            desiredDistance
        );
        const unobstructedDistance = hit
            ? Math.max(hit.timeOfImpact - CAMERA.collisionPadding, CAMERA.minimumFollowDistance)
            : desiredDistance;
        const isPullingIn = unobstructedDistance <= this.followDistance;

        if (isPullingIn && !easesInward) {
            this.followDistance = unobstructedDistance;
            return;
        }

        const smoothing =
            hit !== null && unobstructedDistance < desiredDistance
                ? KILL_CAMERA.occlusionPullInSmoothing
                : CAMERA.pullOutSmoothing;
        const easeFactor = smoothingFactor(smoothing, deltaSeconds);
        this.followDistance = lerp(this.followDistance, unobstructedDistance, easeFactor);
    }
}

export function chooseKillCamShot(
    attackerToVictimYaw: number,
    currentYaw: number,
    finisherBodySpan: number,
    isClear: (yaw: number, pitch: number, distance: number) => boolean
): IKillCamShot {
    let chosen: IKillCamShot | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of KILL_CAMERA.cameraAngles) {
        const yaw = attackerToVictimYaw + candidate.yawOffset;
        const distance = KILL_CAMERA.baseDistance + finisherBodySpan * candidate.distanceScale;
        if (!isClear(yaw, candidate.pitch, distance)) continue;

        const score = Math.abs(shortestAngleBetween(currentYaw, yaw)) + candidate.penalty;
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
