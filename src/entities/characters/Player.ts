import RAPIER from "@dimforge/rapier3d-compat";
import type {
    Collider,
    KinematicCharacterController,
    Ray,
    RigidBody,
} from "@dimforge/rapier3d-compat";
import { CapsuleGeometry, Camera, Mesh, Vector3 } from "three";
import type { Vector3Tuple } from "three";
import { Character } from "@/entities/characters/Character";
import { InputManager } from "@/entities/characters/InputManager";
import type { IWeapon } from "@/types/entities";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { CAMERA, PALETTE, PLAYER } from "@/constants/characters";
import { WORLD } from "@/constants/world";
import { clamp } from "@/lib/helpers";

const forwardDirection = new Vector3();
const rightDirection = new Vector3();
const moveDirection = new Vector3();
const orbitDirection = new Vector3();
const smoothedPivot = new Vector3();
const mouseDelta = { x: 0, y: 0 };

export class Player extends Character implements IWorldEntity {
    readonly sceneObject: Mesh;

    equippedWeapon: IWeapon | null = null;

    private readonly context: IWorldContext;
    private readonly camera: Camera;
    private readonly input = new InputManager();
    private readonly geometry: CapsuleGeometry;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;
    private readonly controller: KinematicCharacterController;
    private readonly cameraSightRay: Ray;
    private verticalVelocity = 0;
    private facingYaw = 0;
    private orbitYaw = 0;
    private orbitPitch = CAMERA.startPitch;
    private currentFollowDistance = CAMERA.targetFollowDistance;
    private pivotInitialized = false;

    constructor(id: string, context: IWorldContext, camera: Camera, spawnPosition: Vector3Tuple) {
        super(id, PLAYER.maxHealth);

        this.context = context;
        this.camera = camera;

        const cylinderLength = PLAYER.height - PLAYER.radius * 2;

        this.geometry = new CapsuleGeometry(PLAYER.radius, cylinderLength, 4, 8);
        this.sceneObject = new Mesh(
            this.geometry,
            context.materialLibrary.getToonMaterial(PALETTE.playerBody)
        );
        this.sceneObject.castShadow = true;

        const [spawnX, spawnY, spawnZ] = spawnPosition;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawnX, spawnY, spawnZ)
        );

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.capsule(cylinderLength / 2, PLAYER.radius),
            this.rigidBody
        );

        this.controller = context.physicsWorld.createCharacterController(PLAYER.colliderOffset);
        this.controller.setUp({ x: 0, y: 1, z: 0 });
        this.controller.setMaxSlopeClimbAngle(PLAYER.maxSlopeClimbAngle);
        this.controller.setMinSlopeSlideAngle(PLAYER.minSlopeSlideAngle);
        this.controller.enableAutostep(PLAYER.autostepMaxHeight, PLAYER.autostepMinWidth, true);
        this.controller.enableSnapToGround(PLAYER.snapToGroundDistance);
        this.controller.setApplyImpulsesToDynamicBodies(true);

        this.cameraSightRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    }

    get attackDamage(): number {
        return this.equippedWeapon?.damage ?? PLAYER.unarmedDamage;
    }

    update(deltaSeconds: number): void {
        this.applyMouseLook();
        this.applyMovement(deltaSeconds);
        this.syncSceneObject(deltaSeconds);
        this.followWithCamera(deltaSeconds);
    }

    dispose(): void {
        this.input.dispose();
        this.context.physicsWorld.removeCharacterController(this.controller);
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.geometry.dispose();
    }

    private applyMouseLook(): void {
        this.input.consumeMouseDelta(mouseDelta);

        this.orbitYaw -= mouseDelta.x * CAMERA.mouseSensitivity;
        this.orbitPitch = clamp(
            this.orbitPitch + mouseDelta.y * CAMERA.mouseSensitivity,
            CAMERA.pitchRange[0],
            CAMERA.pitchRange[1]
        );
    }

    private applyMovement(deltaSeconds: number): void {
        forwardDirection.set(-Math.sin(this.orbitYaw), 0, -Math.cos(this.orbitYaw));
        rightDirection.set(-forwardDirection.z, 0, forwardDirection.x);

        moveDirection
            .set(0, 0, 0)
            .addScaledVector(forwardDirection, this.input.axis("backward", "forward"))
            .addScaledVector(rightDirection, this.input.axis("left", "right"));

        if (moveDirection.lengthSq() > 0) {
            const speed = this.input.isPressed("sprint") ? PLAYER.sprintSpeed : PLAYER.speed;
            moveDirection.normalize().multiplyScalar(speed * deltaSeconds);
            this.facingYaw = Math.atan2(moveDirection.x, moveDirection.z);
        }

        const isGrounded = this.controller.computedGrounded();

        if (isGrounded && this.verticalVelocity <= 0) this.verticalVelocity = 0;
        if (isGrounded && this.input.consumeJump()) this.verticalVelocity = PLAYER.jumpForce;

        this.verticalVelocity = Math.max(
            this.verticalVelocity + WORLD.gravity * deltaSeconds,
            PLAYER.terminalVelocity
        );

        this.controller.computeColliderMovement(this.collider, {
            x: moveDirection.x,
            y: this.verticalVelocity * deltaSeconds,
            z: moveDirection.z,
        });

        const resolvedMovement = this.controller.computedMovement();
        const translation = this.rigidBody.translation();

        this.rigidBody.setNextKinematicTranslation({
            x: translation.x + resolvedMovement.x,
            y: translation.y + resolvedMovement.y,
            z: translation.z + resolvedMovement.z,
        });
    }

    private syncSceneObject(deltaSeconds: number): void {
        const translation = this.rigidBody.translation();
        this.sceneObject.position.set(translation.x, translation.y, translation.z);

        const turnFactor = 1 - Math.exp(-PLAYER.turnSmoothing * deltaSeconds);
        this.sceneObject.rotation.y += this.shortestAngleTo(this.facingYaw) * turnFactor;
    }

    private followWithCamera(deltaSeconds: number): void {
        const translation = this.rigidBody.translation();

        if (!this.pivotInitialized) {
            smoothedPivot.set(translation.x, translation.y + CAMERA.pivotHeight, translation.z);
            this.pivotInitialized = true;
        } else {
            const pivotFactor = 1 - Math.exp(-CAMERA.pivotSmoothing * deltaSeconds);
            smoothedPivot.x += (translation.x - smoothedPivot.x) * pivotFactor;
            smoothedPivot.y += (translation.y + CAMERA.pivotHeight - smoothedPivot.y) * pivotFactor;
            smoothedPivot.z += (translation.z - smoothedPivot.z) * pivotFactor;
        }

        const pitchHorizontalScale = Math.cos(this.orbitPitch);
        orbitDirection
            .set(
                Math.sin(this.orbitYaw) * pitchHorizontalScale,
                Math.sin(this.orbitPitch),
                Math.cos(this.orbitYaw) * pitchHorizontalScale
            )
            .normalize();

        this.resolveCameraDistance(deltaSeconds);

        this.camera.position
            .copy(smoothedPivot)
            .addScaledVector(orbitDirection, this.currentFollowDistance);
        this.camera.lookAt(smoothedPivot);
    }

    private resolveCameraDistance(deltaSeconds: number): void {
        this.cameraSightRay.origin.x = smoothedPivot.x;
        this.cameraSightRay.origin.y = smoothedPivot.y;
        this.cameraSightRay.origin.z = smoothedPivot.z;
        this.cameraSightRay.dir.x = orbitDirection.x;
        this.cameraSightRay.dir.y = orbitDirection.y;
        this.cameraSightRay.dir.z = orbitDirection.z;

        const hit = this.context.physicsWorld.castRay(
            this.cameraSightRay,
            CAMERA.targetFollowDistance,
            true,
            undefined,
            undefined,
            this.collider
        );

        const unobstructedDistance = hit
            ? Math.max(hit.timeOfImpact - CAMERA.collisionPadding, CAMERA.minimumFollowDistance)
            : CAMERA.targetFollowDistance;

        if (unobstructedDistance <= this.currentFollowDistance) {
            this.currentFollowDistance = unobstructedDistance;
            return;
        }

        const easeFactor = 1 - Math.exp(-CAMERA.pullOutSmoothing * deltaSeconds);
        this.currentFollowDistance +=
            (unobstructedDistance - this.currentFollowDistance) * easeFactor;
    }

    private shortestAngleTo(targetYaw: number): number {
        const difference = (targetYaw - this.sceneObject.rotation.y) % (Math.PI * 2);
        return ((difference + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    }
}
