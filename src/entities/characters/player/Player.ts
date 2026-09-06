import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, KinematicCharacterController, RigidBody } from "@dimforge/rapier3d-compat";
import { Group, Vector3 } from "three";
import type { Camera, Vector3Tuple } from "three";
import { clone as cloneSkinnedModel } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Character } from "@/entities/characters/Character";
import { CharacterAnimator } from "@/entities/characters/CharacterAnimator";
import { PlayerInput } from "@/entities/characters/player/PlayerInput";
import { PlayerCamera } from "@/entities/characters/player/PlayerCamera";
import type { IWeapon } from "@/types/entities";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { CAMERA, CHARACTER, CharacterMotion, PLAYER } from "@/constants/characters";
import { WORLD } from "@/constants/world";
import { FULL_TURN } from "@/lib/helpers";

const forwardDirection = new Vector3();
const rightDirection = new Vector3();
const moveDirection = new Vector3();
const targetVelocity = new Vector3();
const mouseDelta = { x: 0, y: 0 };

export class Player extends Character implements IWorldEntity {
    readonly sceneObject: Group;

    equippedWeapon: IWeapon | null = null;

    private readonly context: IWorldContext;
    private readonly input = new PlayerInput();
    private readonly animator: CharacterAnimator;
    private readonly followCamera: PlayerCamera;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;
    private readonly controller: KinematicCharacterController;
    private readonly horizontalVelocity = new Vector3();
    private readonly jumpStartSeconds: number;
    private readonly jumpLandSeconds: number;
    private verticalVelocity = 0;
    private facingYaw = 0;
    private secondsSinceGrounded = 0;
    private secondsSinceTakeoff = Number.POSITIVE_INFINITY;
    private secondsSinceLanded = Number.POSITIVE_INFINITY;
    private isAirborne = false;

    constructor(
        id: string,
        context: IWorldContext,
        camera: Camera,
        spawnPosition: Vector3Tuple,
        spawnYaw = 0
    ) {
        super(id, PLAYER.maxHealth);

        this.context = context;
        this.facingYaw = spawnYaw;

        this.sceneObject = new Group();
        this.sceneObject.rotation.y = spawnYaw;
        this.animator = this.buildModel();
        this.jumpStartSeconds = this.animator.durationOf(CharacterMotion.JumpStart);
        this.jumpLandSeconds = this.animator.durationOf(CharacterMotion.JumpLand);

        const [spawnX, spawnY, spawnZ] = spawnPosition;
        const cylinderLength = PLAYER.height - PLAYER.radius * 2;

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

        this.followCamera = new PlayerCamera(
            camera,
            context.physicsWorld,
            this.collider,
            spawnYaw + Math.PI
        );
    }

    get attackDamage(): number {
        return this.equippedWeapon?.damage ?? PLAYER.unarmedDamage;
    }

    update(deltaSeconds: number): void {
        const translation = this.rigidBody.translation();

        this.applyMouseLook();
        this.applyMovement(deltaSeconds, translation);
        this.faceTravelDirection(deltaSeconds, translation);
        this.followCamera.follow(deltaSeconds, translation.x, translation.y, translation.z);
        this.animator.update(deltaSeconds);
    }

    dispose(): void {
        this.input.dispose();
        this.animator.dispose();
        this.context.physicsWorld.removeCharacterController(this.controller);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
    }

    private buildModel(): CharacterAnimator {
        const skinnedModel = this.context.assetLibrary.getSkinnedModel(CHARACTER.modelPath);
        if (!skinnedModel) throw new Error(`character model not loaded: ${CHARACTER.modelPath}`);

        const modelInstance = cloneSkinnedModel(skinnedModel.scene);
        modelInstance.scale.setScalar(PLAYER.height / skinnedModel.height);
        modelInstance.position.y = -PLAYER.height / 2;
        modelInstance.rotation.y = CHARACTER.modelYawOffset;
        this.sceneObject.add(modelInstance);

        return new CharacterAnimator(modelInstance, skinnedModel.animations);
    }

    private applyMouseLook(): void {
        this.input.consumeMouseDelta(mouseDelta);

        this.followCamera.turnBy(
            mouseDelta.x * CAMERA.mouseSensitivity,
            mouseDelta.y * CAMERA.mouseSensitivity
        );
    }

    private applyMovement(deltaSeconds: number, translation: IBodyTranslation): void {
        const cameraYaw = this.followCamera.yaw;
        forwardDirection.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
        rightDirection.set(-forwardDirection.z, 0, forwardDirection.x);

        moveDirection
            .set(0, 0, 0)
            .addScaledVector(forwardDirection, this.input.axis("backward", "forward"))
            .addScaledVector(rightDirection, this.input.axis("left", "right"));

        const isSprinting = this.input.isPressed("sprint");
        const isGrounded = this.controller.computedGrounded();

        if (isGrounded && this.verticalVelocity <= 0) this.verticalVelocity = 0;

        this.secondsSinceTakeoff += deltaSeconds;
        this.secondsSinceLanded += deltaSeconds;
        this.updateAirborneState(deltaSeconds, isGrounded);

        this.verticalVelocity = Math.max(
            this.verticalVelocity + WORLD.gravity * deltaSeconds,
            PLAYER.terminalVelocity
        );

        const requestedSpeed = isSprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
        targetVelocity.copy(moveDirection);
        if (targetVelocity.lengthSq() > 0)
            targetVelocity.normalize().multiplyScalar(requestedSpeed);

        const acceleration = isGrounded ? PLAYER.groundAcceleration : PLAYER.airAcceleration;
        this.horizontalVelocity.lerp(targetVelocity, 1 - Math.exp(-acceleration * deltaSeconds));

        const groundSpeed = this.horizontalVelocity.length();
        const isMoving = groundSpeed > PLAYER.movingSpeedThreshold;

        if (isMoving)
            this.facingYaw = Math.atan2(this.horizontalVelocity.x, this.horizontalVelocity.z);

        this.animator.setMotion(this.resolveMotion(isMoving, isSprinting), groundSpeed);

        this.controller.computeColliderMovement(this.collider, {
            x: this.horizontalVelocity.x * deltaSeconds,
            y: this.verticalVelocity * deltaSeconds,
            z: this.horizontalVelocity.z * deltaSeconds,
        });

        const resolvedMovement = this.controller.computedMovement();

        this.rigidBody.setNextKinematicTranslation({
            x: translation.x + resolvedMovement.x,
            y: translation.y + resolvedMovement.y,
            z: translation.z + resolvedMovement.z,
        });
    }

    private updateAirborneState(deltaSeconds: number, isGrounded: boolean): void {
        if (isGrounded && this.input.consumeJump()) {
            this.verticalVelocity = PLAYER.jumpForce;
            this.secondsSinceTakeoff = 0;
            this.secondsSinceGrounded = 0;
            this.isAirborne = true;
            return;
        }

        if (!isGrounded) {
            this.secondsSinceGrounded += deltaSeconds;
            if (this.secondsSinceGrounded > PLAYER.airborneGraceSeconds) this.isAirborne = true;
            return;
        }

        this.secondsSinceGrounded = 0;
        if (!this.isAirborne) return;

        this.isAirborne = false;
        this.secondsSinceLanded = 0;
    }

    private resolveMotion(isMoving: boolean, isSprinting: boolean): CharacterMotion {
        if (this.isAirborne)
            return this.secondsSinceTakeoff < this.jumpStartSeconds
                ? CharacterMotion.JumpStart
                : CharacterMotion.JumpLoop;

        if (!isMoving && this.secondsSinceLanded < this.jumpLandSeconds)
            return CharacterMotion.JumpLand;

        if (!isMoving) return CharacterMotion.Idle;

        return isSprinting ? CharacterMotion.Run : CharacterMotion.Walk;
    }

    private faceTravelDirection(deltaSeconds: number, translation: IBodyTranslation): void {
        this.sceneObject.position.set(translation.x, translation.y, translation.z);

        const turnFactor = 1 - Math.exp(-PLAYER.turnSmoothing * deltaSeconds);
        this.sceneObject.rotation.y += this.shortestAngleTo(this.facingYaw) * turnFactor;
    }

    private shortestAngleTo(targetYaw: number): number {
        const difference = (targetYaw - this.sceneObject.rotation.y) % FULL_TURN;
        return ((difference + Math.PI * 3) % FULL_TURN) - Math.PI;
    }
}

interface IBodyTranslation {
    x: number;
    y: number;
    z: number;
}
