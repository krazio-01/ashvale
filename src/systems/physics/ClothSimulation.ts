import { Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { PHYSICS } from "@/constants/physics";
import { FULL_TURN, lerp } from "@/lib/helpers";
import { ClothSheet } from "@/systems/physics/ClothBody";
import { ParticleSolver } from "@/systems/physics/ParticleSolver";
import type { ICarriedMotion, ISolverEnvironment } from "@/systems/physics/ParticleSolver";
import { SkeletonBinding } from "@/systems/physics/SkeletonBinding";
import type { IGroundProbe } from "@/types/characters";
import type {
    ICapsuleSource,
    IPhysicsBinding,
    IPhysicsDefinition,
    PhysicsDetail,
} from "@/types/physics";
import { ERRORS } from "@/constants/strings";

const DEGENERATE = PHYSICS.epsilon.motion;
const scratchStart = new Vector3();
const scratchEnd = new Vector3();
const scratchMove = new Vector3();
const scratchAxis = new Vector3();
const scratchTurn = new Quaternion();
const scratchOrigin = new Vector3();
const scratchPush = new Vector3();

export class ClothSimulation {
    readonly solver: ParticleSolver;
    private readonly bodies: ClothSheet[];
    private readonly binding: IPhysicsBinding;
    private readonly character: Object3D;
    private readonly groundProbe: IGroundProbe;
    private readonly colliderCount: number;
    private readonly capsuleSources: (ICapsuleSource | null)[] = Object.values(
        PHYSICS.capsuleSlots
    ).map(() => null);
    private readonly environment: ISolverEnvironment = {
        gravity: PHYSICS.environment.gravity,
        windX: 0,
        windY: 0,
        windZ: 0,
        originX: 0,
        originY: 0,
        originZ: 0,
        flingX: 0,
        flingY: 0,
        flingZ: 0,
        flingScale: 0,
        floorY: null,
    };
    private readonly motion: ICarriedMotion = {
        originX: 0,
        originY: 0,
        originZ: 0,
        referenceMoveX: 0,
        referenceMoveY: 0,
        referenceMoveZ: 0,
        axisX: 0,
        axisY: 1,
        axisZ: 0,
        angle: 0,
        moveX: 0,
        moveY: 0,
        moveZ: 0,
    };
    private readonly referencePosition = new Vector3();
    private readonly referenceRotation = new Quaternion();
    private readonly nextPosition = new Vector3();
    private readonly nextRotation = new Quaternion();
    private previousDetail: PhysicsDetail = "full";
    private hasReference = false;
    private windTime = 0;
    private restartDampingRemaining = 0;

    private constructor(
        model: Object3D,
        character: Object3D,
        probe: IGroundProbe,
        definition: IPhysicsDefinition
    ) {
        const binding = new SkeletonBinding(model, definition);
        if (definition.version !== PHYSICS.dataVersion)
            throw new Error(ERRORS.physicsDataVersion(definition.version, PHYSICS.dataVersion));
        this.binding = binding;
        this.character = character;
        this.groundProbe = probe;
        this.colliderCount = definition.colliders.length;
        this.bodies = definition.bodies.map((body, index) => new ClothSheet(body, index));
        const totals = this.bodies.reduce(
            (sum, body) => ({
                particles: sum.particles + body.counts.particles,
                stretchLinks: sum.stretchLinks + body.counts.stretchLinks,
                bendLinks: sum.bendLinks + body.counts.bendLinks,
                tethers: sum.tethers + body.counts.tethers,
            }),
            { particles: 0, stretchLinks: 0, bendLinks: 0, tethers: 0 }
        );
        this.solver = new ParticleSolver({
            ...totals,
            colliders: this.colliderCount + this.capsuleSources.length,
        });
        binding.prepareFrame();
        for (const body of this.bodies) body.build(this.solver, binding);
        this.updateColliders();
        this.solver.syncPreviousFrame();
        this.writeAnimatedPose();
    }

    static create(
        model: Object3D,
        character: Object3D,
        probe: IGroundProbe
    ): ClothSimulation | null {
        const definition = model.userData[PHYSICS.dataKey] as IPhysicsDefinition | undefined;
        return definition ? new ClothSimulation(model, character, probe, definition) : null;
    }

    update(deltaSeconds: number, detail: PhysicsDetail, isPoseCurrent: boolean): void {
        const floorY = detail === "frozen" ? null : this.floorHeightBelowCharacter();
        const wasFrozen = this.previousDetail === "frozen";
        this.previousDetail = detail;
        const isFrozen = detail === "frozen";
        this.binding.prepareFrame(!isFrozen, isPoseCurrent);
        if (isFrozen) {
            this.writeAnimatedPose();
            this.hasReference = false;
            return;
        }
        const seconds = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
        for (const body of this.bodies) {
            body.reloadTuning();
            body.updateHomeTargets(this.solver, this.binding);
        }
        this.updateColliders();
        this.binding.referenceWorld(this.nextPosition, this.nextRotation);
        if (!this.hasReference || this.isTeleport(seconds)) this.restart(wasFrozen);
        else this.carryClothWithCharacter(seconds);
        this.rememberReference();
        const { dampingSeconds, dampingScale } = PHYSICS.restart;
        this.solver.dampingScale = lerp(
            1,
            dampingScale,
            this.restartDampingRemaining / dampingSeconds
        );
        this.restartDampingRemaining = Math.max(0, this.restartDampingRemaining - seconds);
        this.windTime += seconds;
        this.updateWind();
        this.environment.floorY = floorY;
        if (this.solver.step(seconds, this.environment, detail === "reduced")) {
            if (!this.solver.isFinite()) this.reset();
            for (const body of this.bodies) body.writeSimulatedPose(this.solver, this.binding);
        }
    }

    attachCapsule(slot: number, source: ICapsuleSource): void {
        this.capsuleSources[slot] = source;
    }

    reset(): void {
        this.binding.prepareFrame();
        this.binding.referenceWorld(this.nextPosition, this.nextRotation);
        this.restart(false);
    }

    applyHitImpulse(push: Vector3, strength: number): void {
        if (push.lengthSq() < PHYSICS.impulse.minimumPushLengthSquared) return;
        const speed = strength * PHYSICS.impulse.speedPerStrength;
        const scaled = scratchPush.copy(push).normalize().multiplyScalar(speed);
        this.solver.addImpulse(scaled.x, scaled.y, scaled.z);
    }

    private restart(isCalmed: boolean): void {
        this.restartDampingRemaining = isCalmed ? PHYSICS.restart.dampingSeconds : 0;
        for (const body of this.bodies) body.resetToRest(this.solver, this.binding);
        this.updateColliders();
        this.solver.syncPreviousFrame();
        this.rememberReference();
        this.environment.flingX = this.environment.flingY = this.environment.flingZ = 0;
        this.writeAnimatedPose();
    }

    private writeAnimatedPose(): void {
        for (const body of this.bodies) body.writeAnimatedPose(this.binding);
    }

    private updateColliders(): void {
        for (let collider = 0; collider < this.colliderCount; collider++) {
            const radius = this.binding.colliderWorld(collider, scratchStart, scratchEnd);
            this.solver.setCollider(collider, scratchStart, scratchEnd, radius);
        }
        for (let slot = 0; slot < this.capsuleSources.length; slot++) {
            const source = this.capsuleSources[slot];
            const radius = source ? source.worldCapsule(scratchStart, scratchEnd) : null;
            if (radius === null) this.solver.disableCollider(this.colliderCount + slot);
            else
                this.solver.setCollider(
                    this.colliderCount + slot,
                    scratchStart,
                    scratchEnd,
                    radius
                );
        }
    }

    private isTeleport(seconds: number): boolean {
        const { maxLagMoveSpeed, maxLagTurnSpeed, teleportDistance, teleportAngle } =
            PHYSICS.reference;
        return (
            this.nextPosition.distanceTo(this.referencePosition) - maxLagMoveSpeed * seconds >
                teleportDistance ||
            this.nextRotation.angleTo(this.referenceRotation) - maxLagTurnSpeed * seconds >
                teleportAngle
        );
    }

    private carryClothWithCharacter(seconds: number): void {
        const { moveLag, turnLag, turnFlingScale, maxLagMoveSpeed, maxLagTurnSpeed } =
            PHYSICS.reference;
        const move = scratchMove.subVectors(this.nextPosition, this.referencePosition);
        const turn = scratchTurn
            .copy(this.referenceRotation)
            .invert()
            .premultiply(this.nextRotation);
        if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
        const angle = 2 * Math.acos(Math.min(turn.w, 1));
        const sine = Math.sqrt(Math.max(1 - turn.w * turn.w, 0));
        const axis =
            sine > DEGENERATE
                ? scratchAxis.set(turn.x / sine, turn.y / sine, turn.z / sine)
                : scratchAxis.set(0, 1, 0);
        this.motion.referenceMoveX = move.x;
        this.motion.referenceMoveY = move.y;
        this.motion.referenceMoveZ = move.z;
        const distance = move.length();
        const simulatedSeconds = Math.min(seconds, PHYSICS.step.maxFrameSeconds);
        const cappedDistance = Math.min(distance, maxLagMoveSpeed * simulatedSeconds);
        const cappedAngle = Math.min(angle, maxLagTurnSpeed * simulatedSeconds);
        const carriedDistance = distance - cappedDistance + (1 - moveLag) * cappedDistance;
        const carriedAngle = angle - cappedAngle + (1 - turnLag) * cappedAngle;
        if (distance > DEGENERATE) move.multiplyScalar(carriedDistance / distance);
        this.motion.axisX = axis.x;
        this.motion.axisY = axis.y;
        this.motion.axisZ = axis.z;
        this.motion.angle = carriedAngle;
        this.motion.originX = this.referencePosition.x;
        this.motion.originY = this.referencePosition.y;
        this.motion.originZ = this.referencePosition.z;
        this.motion.moveX = move.x;
        this.motion.moveY = move.y;
        this.motion.moveZ = move.z;
        this.solver.carry(this.motion);
        const removedRate =
            simulatedSeconds > 0 ? ((1 - turnLag) * cappedAngle) / simulatedSeconds : 0;
        this.environment.flingX = axis.x * removedRate;
        this.environment.flingY = axis.y * removedRate;
        this.environment.flingZ = axis.z * removedRate;
        this.environment.flingScale = turnFlingScale;
        if (
            distance > PHYSICS.solver.wakeSpeed * seconds ||
            angle > PHYSICS.solver.wakeAngularSpeed * seconds
        )
            this.solver.wake();
    }

    private rememberReference(): void {
        this.referencePosition.copy(this.nextPosition);
        this.referenceRotation.copy(this.nextRotation);
        this.environment.originX = this.nextPosition.x;
        this.environment.originY = this.nextPosition.y;
        this.environment.originZ = this.nextPosition.z;
        this.hasReference = true;
    }

    private updateWind(): void {
        const { direction, base, gustAmplitude, gustHertz } = PHYSICS.environment.wind;
        const gust =
            0.6 * Math.sin(FULL_TURN * gustHertz * this.windTime) +
            0.4 * Math.sin(FULL_TURN * gustHertz * 2.3 * this.windTime + 1.3);
        const strength = Math.max(0, base + gustAmplitude * gust);
        this.environment.windX = direction[0] * strength;
        this.environment.windY = direction[1] * strength;
        this.environment.windZ = direction[2] * strength;
    }

    private floorHeightBelowCharacter(): number | null {
        const origin = this.character.getWorldPosition(scratchOrigin);
        return this.groundProbe.groundHeightAt(origin.x, origin.z, origin.y);
    }
}
