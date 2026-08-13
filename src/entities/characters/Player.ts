import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import { CapsuleGeometry, Camera, Mesh, Vector3 } from "three";
import { Character } from "@/entities/characters/Character";
import { InputManager } from "@/input/InputManager";
import type { IWeapon } from "@/types/entities";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { CAMERA, PALETTE, PLAYER } from "@/constants/game";

const WORLD_UP = new Vector3(0, 1, 0);

const cameraForward = new Vector3();
const cameraRight = new Vector3();
const moveDirection = new Vector3();
const bodyPosition = new Vector3();
const desiredCameraPosition = new Vector3();
const cameraTarget = new Vector3();

export class Player extends Character implements IWorldEntity {
    readonly sceneObject: Mesh;

    equippedWeapon: IWeapon | null = null;

    private readonly context: IWorldContext;
    private readonly camera: Camera;
    private readonly input = new InputManager();
    private readonly geometry: CapsuleGeometry;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;
    private facingYaw = 0;

    constructor(id: string, context: IWorldContext, camera: Camera) {
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

        const [spawnX, spawnY, spawnZ] = PLAYER.spawnPosition;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(spawnX, spawnY, spawnZ)
                .lockRotations()
                .setCanSleep(false)
        );

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.capsule(cylinderLength / 2, PLAYER.radius),
            this.rigidBody
        );
    }

    get attackDamage(): number {
        return this.equippedWeapon?.damage ?? PLAYER.unarmedDamage;
    }

    update(deltaSeconds: number): void {
        this.applyMovement();
        this.syncSceneObject(deltaSeconds);
        this.followWithCamera(deltaSeconds);
    }

    dispose(): void {
        this.input.dispose();
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.geometry.dispose();
    }

    private applyMovement(): void {
        this.camera.getWorldDirection(cameraForward);
        cameraForward.y = 0;
        cameraForward.normalize();

        cameraRight.crossVectors(cameraForward, WORLD_UP).normalize();

        moveDirection
            .set(0, 0, 0)
            .addScaledVector(cameraForward, this.input.axis("backward", "forward"))
            .addScaledVector(cameraRight, this.input.axis("left", "right"));

        const isMoving = moveDirection.lengthSq() > 0;

        if (isMoving) {
            const speed = this.input.isPressed("sprint") ? PLAYER.sprintSpeed : PLAYER.speed;
            moveDirection.normalize().multiplyScalar(speed);
            this.facingYaw = Math.atan2(moveDirection.x, moveDirection.z);
        }

        const velocity = this.rigidBody.linvel();
        const isGrounded = Math.abs(velocity.y) < PLAYER.groundedVelocityThreshold;
        const shouldJump = this.input.isPressed("jump") && isGrounded;

        this.rigidBody.setLinvel(
            {
                x: moveDirection.x,
                y: shouldJump ? PLAYER.jumpForce : velocity.y,
                z: moveDirection.z,
            },
            true
        );
    }

    private syncSceneObject(deltaSeconds: number): void {
        const translation = this.rigidBody.translation();
        this.sceneObject.position.set(translation.x, translation.y, translation.z);

        const turnFactor = 1 - Math.exp(-PLAYER.turnSmoothing * deltaSeconds);
        const yawDelta = this.shortestAngleTo(this.facingYaw);
        this.sceneObject.rotation.y += yawDelta * turnFactor;
    }

    private followWithCamera(deltaSeconds: number): void {
        const translation = this.rigidBody.translation();
        bodyPosition.set(translation.x, translation.y, translation.z);

        desiredCameraPosition
            .copy(bodyPosition)
            .addScaledVector(cameraForward, -CAMERA.followDistance);
        desiredCameraPosition.y = bodyPosition.y + CAMERA.followHeight;

        const followFactor = 1 - Math.exp(-CAMERA.followSmoothing * deltaSeconds);
        this.camera.position.lerp(desiredCameraPosition, followFactor);

        cameraTarget.copy(bodyPosition);
        cameraTarget.y += CAMERA.lookAtHeight;
        this.camera.lookAt(cameraTarget);
    }

    private shortestAngleTo(targetYaw: number): number {
        const difference = (targetYaw - this.sceneObject.rotation.y) % (Math.PI * 2);
        return ((difference + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    }
}
