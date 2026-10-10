import { Quaternion, Vector3 } from "three";
import { PHYSICS } from "@/constants/physics";
import { FULL_TURN } from "@/lib/helpers";
import { createPhysicsBody } from "@/systems/physics/bodies/PhysicsBody";
import type { PhysicsBody } from "@/systems/physics/bodies/PhysicsBody";
import { ParticleSolver } from "@/systems/physics/core/ParticleSolver";
import type { ICarriedMotion, ISolverEnvironment } from "@/systems/physics/core/ParticleSolver";
import type {
    ICapsuleSource,
    IPhysicsBinding,
    IPhysicsDefinition,
    PhysicsDetail,
} from "@/types/physics";

export interface IPhysicsFrame {
    deltaSeconds: number;
    detail: PhysicsDetail;
    floorY: number | null;
}

const DEGENERATE = PHYSICS.epsilon.motion;
const scratchStart = new Vector3();
const scratchEnd = new Vector3();
const scratchMove = new Vector3();
const scratchAxis = new Vector3();
const scratchTurn = new Quaternion();

export class PhysicsSimulation {
    readonly solver: ParticleSolver;
    private readonly bodies: PhysicsBody[];
    private readonly binding: IPhysicsBinding;
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
    private clock = 0;

    constructor(definition: IPhysicsDefinition, binding: IPhysicsBinding) {
        if (definition.version !== PHYSICS.dataVersion)
            throw new Error(
                `physics data version ${definition.version} is not ${PHYSICS.dataVersion}: re-import and cook the model`
            );
        this.binding = binding;
        this.colliderCount = definition.colliders.length;
        this.bodies = definition.bodies.map(createPhysicsBody);
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
        this.solver.snapFrame();
        this.writeAnimated();
    }

    update(frame: IPhysicsFrame): void {
        const wasFrozen = this.previousDetail === "frozen";
        this.previousDetail = frame.detail;
        this.binding.prepareFrame();
        if (frame.detail === "frozen") {
            this.writeAnimated();
            this.hasReference = false;
            return;
        }
        const seconds = Number.isFinite(frame.deltaSeconds) ? Math.max(frame.deltaSeconds, 0) : 0;
        for (const body of this.bodies) {
            body.refreshFeel();
            body.followHomes(this.solver, this.binding);
        }
        this.updateColliders();
        this.binding.referenceWorld(this.nextPosition, this.nextRotation);
        if (!this.hasReference || wasFrozen || this.isTeleport(seconds)) this.restart();
        else this.carryReference(seconds);
        this.rememberReference();
        this.clock += seconds;
        this.updateWind();
        this.environment.floorY = frame.floorY;
        if (this.solver.step(seconds, this.environment, frame.detail === "reduced")) {
            if (!this.solver.isFinite()) this.reset();
            for (const body of this.bodies) body.writeBack(this.solver, this.binding);
        }
    }

    attachCapsule(slot: number, source: ICapsuleSource | null): void {
        this.capsuleSources[slot] = source;
    }

    reset(): void {
        this.binding.prepareFrame();
        this.binding.referenceWorld(this.nextPosition, this.nextRotation);
        this.restart();
    }

    private restart(): void {
        for (const body of this.bodies) body.resetToRest(this.solver, this.binding);
        this.updateColliders();
        this.solver.snapFrame();
        this.rememberReference();
        this.environment.flingX = this.environment.flingY = this.environment.flingZ = 0;
        this.writeAnimated();
    }

    set measuring(on: boolean) {
        this.solver.measuring = on;
    }

    private writeAnimated(): void {
        for (const body of this.bodies) body.writeAnimated(this.binding);
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
        const { maxLinearSpeed, maxAngularSpeed, teleportDistance, teleportAngle } =
            PHYSICS.reference;
        return (
            this.nextPosition.distanceTo(this.referencePosition) - maxLinearSpeed * seconds >
                teleportDistance ||
            this.nextRotation.angleTo(this.referenceRotation) - maxAngularSpeed * seconds >
                teleportAngle
        );
    }

    private carryReference(seconds: number): void {
        const { linearInertia, angularInertia, flingScale, maxLinearSpeed, maxAngularSpeed } =
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
        const cappedDistance = Math.min(distance, maxLinearSpeed * simulatedSeconds);
        const cappedAngle = Math.min(angle, maxAngularSpeed * simulatedSeconds);
        const carriedDistance = distance - cappedDistance + (1 - linearInertia) * cappedDistance;
        const carriedAngle = angle - cappedAngle + (1 - angularInertia) * cappedAngle;
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
            simulatedSeconds > 0 ? ((1 - angularInertia) * cappedAngle) / simulatedSeconds : 0;
        this.environment.flingX = axis.x * removedRate;
        this.environment.flingY = axis.y * removedRate;
        this.environment.flingZ = axis.z * removedRate;
        this.environment.flingScale = flingScale;
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
            0.6 * Math.sin(FULL_TURN * gustHertz * this.clock) +
            0.4 * Math.sin(FULL_TURN * gustHertz * 2.3 * this.clock + 1.3);
        const strength = Math.max(0, base + gustAmplitude * gust);
        this.environment.windX = direction[0] * strength;
        this.environment.windY = direction[1] * strength;
        this.environment.windZ = direction[2] * strength;
    }
}
