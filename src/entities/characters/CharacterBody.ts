import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, KinematicCharacterController, RigidBody } from "@dimforge/rapier3d-compat";
import { Group, Skeleton, SkinnedMesh } from "three";
import type { Object3D, Vector3Tuple } from "three";
import { clone as cloneSkinnedModel } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CharacterAnimator } from "@/entities/characters/CharacterAnimator";
import { CharacterMotion, NON_PLAYER } from "@/constants/characters";
import { COLLISION_GROUPS, WORLD } from "@/constants/world";
import type { ICharacterSpec, IWorldContext, IWorldEntity } from "@/types/world";

export class CharacterBody implements IWorldEntity {
    readonly sceneObject: Group;

    private readonly context: IWorldContext;
    private readonly animator: CharacterAnimator;
    private readonly skeletons: Skeleton[];
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;
    private readonly controller: KinematicCharacterController;
    private verticalVelocity = 0;

    constructor(
        spec: ICharacterSpec,
        context: IWorldContext,
        spawnPosition: Vector3Tuple,
        spawnYaw = 0
    ) {
        this.context = context;

        const skinnedModel = context.assetLibrary.getSkinnedModel(spec.modelPath);
        if (!skinnedModel) throw new Error(`character model not loaded: ${spec.modelPath}`);

        const [spawnX, spawnY, spawnZ] = spawnPosition;

        this.sceneObject = new Group();
        this.sceneObject.position.set(spawnX, spawnY, spawnZ);
        this.sceneObject.rotation.y = spawnYaw;

        const modelInstance = cloneSkinnedModel(skinnedModel.scene);
        modelInstance.scale.setScalar(spec.height / skinnedModel.height);
        modelInstance.position.y = -spec.height / 2;
        this.sceneObject.add(modelInstance);

        this.skeletons = collectSkeletons(modelInstance);
        this.animator = new CharacterAnimator(modelInstance, skinnedModel.animations);
        this.animator.setMotion(CharacterMotion.Idle, 0);

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawnX, spawnY, spawnZ)
        );

        const cylinderLength = Math.max(spec.height - spec.radius * 2, 0);

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.capsule(cylinderLength / 2, spec.radius).setCollisionGroups(
                COLLISION_GROUPS.character
            ),
            this.rigidBody
        );

        this.controller = context.physicsWorld.createCharacterController(NON_PLAYER.colliderOffset);
        this.controller.setUp({ x: 0, y: 1, z: 0 });
        this.controller.setMaxSlopeClimbAngle(NON_PLAYER.maxSlopeClimbAngle);
        this.controller.setMinSlopeSlideAngle(NON_PLAYER.minSlopeSlideAngle);
        this.controller.enableAutostep(
            NON_PLAYER.autostepMaxHeight,
            NON_PLAYER.autostepMinWidth,
            true
        );
        this.controller.enableSnapToGround(NON_PLAYER.snapToGroundDistance);
    }

    fixedUpdate(fixedTimestep: number): void {
        const isGrounded = this.controller.computedGrounded();

        if (isGrounded && this.verticalVelocity <= 0) this.verticalVelocity = 0;

        this.verticalVelocity = Math.max(
            this.verticalVelocity + WORLD.gravity * fixedTimestep,
            NON_PLAYER.terminalVelocity
        );

        if (isGrounded && this.verticalVelocity === WORLD.gravity * fixedTimestep) return;

        this.controller.computeColliderMovement(this.collider, {
            x: 0,
            y: this.verticalVelocity * fixedTimestep,
            z: 0,
        });

        const resolvedMovement = this.controller.computedMovement();
        const translation = this.rigidBody.translation();

        this.rigidBody.setNextKinematicTranslation({
            x: translation.x + resolvedMovement.x,
            y: translation.y + resolvedMovement.y,
            z: translation.z + resolvedMovement.z,
        });
    }

    update(deltaSeconds: number): void {
        const translation = this.rigidBody.translation();
        this.sceneObject.position.set(translation.x, translation.y, translation.z);
        this.animator.update(deltaSeconds);
    }

    dispose(): void {
        this.animator.dispose();
        for (const skeleton of this.skeletons) skeleton.dispose();
        this.context.physicsWorld.removeCharacterController(this.controller);
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
    }
}

function collectSkeletons(root: Object3D): Skeleton[] {
    const skeletons: Skeleton[] = [];
    root.traverse((object) => {
        if (object instanceof SkinnedMesh) skeletons.push(object.skeleton);
    });
    return skeletons;
}
