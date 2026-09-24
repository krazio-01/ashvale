import RAPIER from "@dimforge/rapier3d-compat";
import type {
    Collider,
    KinematicCharacterController,
    RigidBody,
    World as PhysicsWorld,
} from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Vector3Tuple } from "three";
import { KNOCKBACK_DECAY } from "@/constants/combat";
import { COLLISION_GROUPS, WORLD } from "@/constants/world";

export interface IMotorSpec {
    height: number;
    radius: number;
    colliderOffset: number;
    maxSlopeClimbAngle: number;
    minSlopeSlideAngle: number;
    autostepMaxHeight: number;
    autostepMinWidth: number;
    snapToGroundDistance: number;
    terminalVelocity: number;
    groundAcceleration: number;
    airAcceleration: number;
    pushesDynamicBodies: boolean;
}

const REST_EPSILON = 1e-4;
const WALKABLE_NORMAL_Y = 0.6;
const PROBE_HEIGHT_FRACTION = 0.25;

export class CharacterMotor {
    readonly collider: Collider;
    readonly velocity = new Vector3();
    readonly renderPosition = new Vector3();
    readonly groundNormal = new Vector3(0, 1, 0);

    private readonly physicsWorld: PhysicsWorld;
    private readonly rigidBody: RigidBody;
    private readonly controller: KinematicCharacterController;
    private readonly spec: IMotorSpec;
    private readonly knockback = new Vector3();
    private readonly previousPosition = new Vector3();
    private readonly simulatedPosition = new Vector3();
    private readonly movementRequest = { x: 0, y: 0, z: 0 };
    private readonly nextTranslation = { x: 0, y: 0, z: 0 };
    private readonly obstacleProbe = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    private readonly groundProbe = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    private autostepEnabled = true;
    private verticalVelocity = 0;
    private grounded = false;

    constructor(physicsWorld: PhysicsWorld, spec: IMotorSpec, spawn: Vector3Tuple) {
        this.physicsWorld = physicsWorld;
        this.spec = spec;

        const [x, y, z] = spawn;
        this.previousPosition.set(x, y, z);
        this.simulatedPosition.set(x, y, z);
        this.renderPosition.set(x, y, z);

        this.rigidBody = physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z)
        );

        const cylinderHalf = Math.max(spec.height - spec.radius * 2, 0) / 2;
        this.collider = physicsWorld.createCollider(
            RAPIER.ColliderDesc.capsule(cylinderHalf, spec.radius).setCollisionGroups(
                COLLISION_GROUPS.character
            ),
            this.rigidBody
        );

        this.controller = physicsWorld.createCharacterController(spec.colliderOffset);
        this.controller.setUp({ x: 0, y: 1, z: 0 });
        this.controller.setMaxSlopeClimbAngle(spec.maxSlopeClimbAngle);
        this.controller.setMinSlopeSlideAngle(spec.minSlopeSlideAngle);
        this.controller.enableAutostep(spec.autostepMaxHeight, spec.autostepMinWidth, true);
        this.controller.enableSnapToGround(spec.snapToGroundDistance);
        this.controller.setApplyImpulsesToDynamicBodies(spec.pushesDynamicBodies);
    }

    get isGrounded(): boolean {
        return this.grounded;
    }

    get position(): Vector3 {
        return this.simulatedPosition;
    }

    get isCollidable(): boolean {
        return this.collider.isEnabled();
    }

    disableCollision(): void {
        this.collider.setEnabled(false);
    }

    enableCollision(): void {
        this.collider.setEnabled(true);
    }

    step(
        deltaSeconds: number,
        desiredVelocity: Vector3,
        displacement: Vector3 | null,
        followGround = false
    ): void {
        this.previousPosition.copy(this.simulatedPosition);
        if (deltaSeconds <= 0 || !this.isCollidable) return;

        this.grounded = this.controller.computedGrounded();
        if (this.grounded && this.verticalVelocity <= 0) this.verticalVelocity = 0;

        this.verticalVelocity = Math.max(
            this.verticalVelocity + WORLD.gravity * deltaSeconds,
            this.spec.terminalVelocity
        );

        const acceleration = this.grounded
            ? this.spec.groundAcceleration
            : this.spec.airAcceleration;
        this.velocity.x +=
            (desiredVelocity.x - this.velocity.x) * (1 - Math.exp(-acceleration * deltaSeconds));
        this.velocity.z +=
            (desiredVelocity.z - this.velocity.z) * (1 - Math.exp(-acceleration * deltaSeconds));
        if (Math.abs(this.velocity.x) < REST_EPSILON && Math.abs(this.velocity.z) < REST_EPSILON)
            this.velocity.set(0, 0, 0);

        this.knockback.multiplyScalar(Math.exp(-KNOCKBACK_DECAY * deltaSeconds));
        if (this.knockback.lengthSq() < REST_EPSILON * REST_EPSILON) this.knockback.set(0, 0, 0);

        const moveX = (this.velocity.x + this.knockback.x) * deltaSeconds + (displacement?.x ?? 0);
        const moveZ = (this.velocity.z + this.knockback.z) * deltaSeconds + (displacement?.z ?? 0);
        const isResting =
            this.grounded &&
            moveX === 0 &&
            moveZ === 0 &&
            this.verticalVelocity === WORLD.gravity * deltaSeconds;

        if (isResting) return;

        const isPressedToGround = this.grounded && this.verticalVelocity <= 0;
        const moveY = isPressedToGround
            ? this.slopeRise(moveX, moveZ, followGround) - this.spec.colliderOffset
            : this.verticalVelocity * deltaSeconds;
        const request = this.movementRequest;
        request.x = moveX;
        request.y = moveY;
        request.z = moveZ;
        this.controller.computeColliderMovement(this.collider, request);

        const resolved = this.controller.computedMovement();
        const current = this.simulatedPosition;
        const next = this.nextTranslation;
        next.x = current.x + resolved.x;
        next.y = current.y + resolved.y;
        next.z = current.z + resolved.z;
        this.rigidBody.setNextKinematicTranslation(next);
    }

    isPathBlocked(directionX: number, directionZ: number, distance: number): boolean {
        const origin = this.obstacleProbe.origin;
        origin.x = this.simulatedPosition.x;
        origin.y = this.simulatedPosition.y - this.spec.height * PROBE_HEIGHT_FRACTION;
        origin.z = this.simulatedPosition.z;
        const direction = this.obstacleProbe.dir;
        direction.x = directionX;
        direction.y = 0;
        direction.z = directionZ;

        const hit = this.physicsWorld.castRayAndGetNormal(
            this.obstacleProbe,
            distance + this.spec.radius,
            true,
            undefined,
            COLLISION_GROUPS.obstacleProbe,
            this.collider
        );
        return hit !== null && hit.normal.y < WALKABLE_NORMAL_Y;
    }

    groundGap(maxGap: number): number {
        const halfHeight = this.spec.height / 2;
        const origin = this.groundProbe.origin;
        origin.x = this.simulatedPosition.x;
        origin.y = this.simulatedPosition.y;
        origin.z = this.simulatedPosition.z;

        const hit = this.physicsWorld.castRayAndGetNormal(
            this.groundProbe,
            halfHeight + maxGap,
            true,
            undefined,
            COLLISION_GROUPS.character,
            this.collider
        );
        if (!hit) return Number.POSITIVE_INFINITY;

        this.groundNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        return hit.timeOfImpact - halfHeight;
    }

    setAutostep(enabled: boolean): void {
        if (enabled === this.autostepEnabled) return;

        this.autostepEnabled = enabled;
        if (enabled)
            this.controller.enableAutostep(
                this.spec.autostepMaxHeight,
                this.spec.autostepMinWidth,
                true
            );
        else this.controller.disableAutostep();
    }

    private slopeRise(moveX: number, moveZ: number, followGround: boolean): number {
        const slopeReach =
            this.spec.snapToGroundDistance +
            this.spec.radius * (1 / WALKABLE_NORMAL_Y - 1) +
            this.spec.colliderOffset;
        if (!followGround || !Number.isFinite(this.groundGap(slopeReach))) return 0;

        const normal = this.groundNormal;
        if (normal.y < WALKABLE_NORMAL_Y) return 0;
        return -(normal.x * moveX + normal.z * moveZ) / normal.y;
    }

    hold(): void {
        this.previousPosition.copy(this.simulatedPosition);
    }

    translate(delta: Vector3): void {
        this.previousPosition.copy(this.simulatedPosition);
        const next = this.nextTranslation;
        next.x = this.simulatedPosition.x + delta.x;
        next.y = this.simulatedPosition.y + delta.y;
        next.z = this.simulatedPosition.z + delta.z;
        this.rigidBody.setNextKinematicTranslation(next);
    }

    jump(force: number): void {
        this.verticalVelocity = force;
        this.grounded = false;
    }

    addKnockback(directionX: number, directionZ: number, impulse: number): void {
        this.knockback.set(directionX * impulse, 0, directionZ * impulse);
    }

    stop(): void {
        this.velocity.set(0, 0, 0);
        this.knockback.set(0, 0, 0);
    }

    teleport(position: Vector3): void {
        const next = this.nextTranslation;
        next.x = position.x;
        next.y = position.y;
        next.z = position.z;
        this.rigidBody.setTranslation(next, true);
        this.rigidBody.setNextKinematicTranslation(next);
        this.previousPosition.copy(position);
        this.simulatedPosition.copy(position);
        this.renderPosition.copy(position);
        this.verticalVelocity = 0;
        this.stop();
    }

    postStep(): void {
        const translation = this.rigidBody.translation();
        this.simulatedPosition.set(translation.x, translation.y, translation.z);
    }

    interpolate(alpha: number): Vector3 {
        return this.renderPosition.lerpVectors(
            this.previousPosition,
            this.simulatedPosition,
            alpha
        );
    }

    dispose(): void {
        this.physicsWorld.removeCharacterController(this.controller);
        this.physicsWorld.removeCollider(this.collider, false);
        this.physicsWorld.removeRigidBody(this.rigidBody);
    }
}
