import { PHYSICS } from "@/constants/physics";
import type { IVector3 } from "@/types/physics";

export interface IParticleSpec {
    x: number;
    y: number;
    z: number;
    inverseMass: number;
    gravityScale: number;
    windExposure: number;
    damping: number;
    impulseWeight: number;
    friction: number;
}

export interface ISolverCapacity {
    particles: number;
    links: number;
    tethers: number;
    colliders: number;
}

export interface ISolverEnvironment {
    gravity: number;
    windX: number;
    windY: number;
    windZ: number;
    floorY: number | null;
}

export interface ISolverMetrics {
    maxStrain: number;
    maxPenetration: number;
    maxSpeed: number;
    maxRelativeSpeed: number;
    settled: boolean;
}

const COLLIDER_STRIDE = 7;
const DEGENERATE = 1e-12;

export class ParticleSolver {
    readonly metrics: ISolverMetrics = {
        maxStrain: 0,
        maxPenetration: 0,
        maxSpeed: 0,
        maxRelativeSpeed: 0,
        settled: false,
    };
    particleCount = 0;
    private linkCount = 0;
    private tetherCount = 0;
    private colliderCount = 0;
    private settledSeconds = 0;

    private readonly position: Float64Array;
    private readonly predicted: Float64Array;
    private readonly velocity: Float64Array;
    private readonly anchorFrom: Float64Array;
    private readonly anchorTo: Float64Array;
    private readonly inverseMass: Float64Array;
    private readonly gravityScale: Float64Array;
    private readonly windExposure: Float64Array;
    private readonly damping: Float64Array;
    private readonly impulseWeight: Float64Array;
    private readonly friction: Float64Array;
    private readonly inContact: Uint8Array;
    private readonly linkA: Uint16Array;
    private readonly linkB: Uint16Array;
    private readonly restLength: Float64Array;
    private readonly linkStiffness: Float64Array;
    private readonly linkMeasured: Uint8Array;
    private readonly tetherParticle: Uint16Array;
    private readonly tetherPin: Uint16Array;
    private readonly tetherLimit: Float64Array;
    private readonly collider: Float64Array;
    private readonly particlePin: Int32Array;
    private readonly particleReach: Float64Array;
    private readonly pinDistance: Float64Array;
    private readonly colliderCapacity: number;

    constructor(capacity: ISolverCapacity) {
        const { particles, links, tethers, colliders } = capacity;
        this.position = new Float64Array(particles * 3);
        this.predicted = new Float64Array(particles * 3);
        this.velocity = new Float64Array(particles * 3);
        this.anchorFrom = new Float64Array(particles * 3);
        this.anchorTo = new Float64Array(particles * 3);
        this.inverseMass = new Float64Array(particles);
        this.gravityScale = new Float64Array(particles);
        this.windExposure = new Float64Array(particles);
        this.damping = new Float64Array(particles);
        this.impulseWeight = new Float64Array(particles);
        this.friction = new Float64Array(particles);
        this.inContact = new Uint8Array(particles);
        this.linkA = new Uint16Array(links);
        this.linkB = new Uint16Array(links);
        this.restLength = new Float64Array(links);
        this.linkStiffness = new Float64Array(links);
        this.linkMeasured = new Uint8Array(links);
        this.tetherParticle = new Uint16Array(tethers);
        this.tetherPin = new Uint16Array(tethers);
        this.tetherLimit = new Float64Array(tethers);
        this.collider = new Float64Array(colliders * COLLIDER_STRIDE);
        this.particlePin = new Int32Array(particles).fill(-1);
        this.particleReach = new Float64Array(particles);
        this.pinDistance = new Float64Array(particles * colliders);
        this.colliderCapacity = colliders;
    }

    addParticle(spec: IParticleSpec): number {
        const index = this.particleCount++;
        const offset = index * 3;
        for (const array of [this.position, this.predicted, this.anchorFrom, this.anchorTo]) {
            array[offset] = spec.x;
            array[offset + 1] = spec.y;
            array[offset + 2] = spec.z;
        }
        this.inverseMass[index] = spec.inverseMass;
        this.gravityScale[index] = spec.gravityScale;
        this.windExposure[index] = spec.windExposure;
        this.damping[index] = spec.damping;
        this.impulseWeight[index] = spec.impulseWeight;
        this.friction[index] = spec.friction;
        return index;
    }

    addLink(
        a: number,
        b: number,
        restLength: number,
        stiffness: number,
        isStructural = true
    ): void {
        const index = this.linkCount++;
        this.linkA[index] = a;
        this.linkB[index] = b;
        this.restLength[index] = restLength;
        this.linkStiffness[index] = stiffness;
        this.linkMeasured[index] = isStructural ? 1 : 0;
    }

    addTether(particle: number, pin: number, maxDistance: number): void {
        const index = this.tetherCount++;
        this.tetherParticle[index] = particle;
        this.tetherPin[index] = pin;
        this.tetherLimit[index] = maxDistance;
        this.particlePin[particle] = pin;
        this.particleReach[particle] = maxDistance;
    }

    setCollider(
        index: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        radius: number
    ): void {
        const offset = index * COLLIDER_STRIDE;
        this.collider[offset] = ax;
        this.collider[offset + 1] = ay;
        this.collider[offset + 2] = az;
        this.collider[offset + 3] = bx;
        this.collider[offset + 4] = by;
        this.collider[offset + 5] = bz;
        this.collider[offset + 6] = radius;
        this.colliderCount = Math.max(this.colliderCount, index + 1);
    }

    setAnchor(index: number, x: number, y: number, z: number): void {
        const offset = index * 3;
        this.anchorTo[offset] = x;
        this.anchorTo[offset + 1] = y;
        this.anchorTo[offset + 2] = z;
    }

    place(index: number, x: number, y: number, z: number): void {
        const offset = index * 3;
        for (const array of [this.position, this.predicted, this.anchorFrom, this.anchorTo]) {
            array[offset] = x;
            array[offset + 1] = y;
            array[offset + 2] = z;
        }
        this.velocity[offset] = 0;
        this.velocity[offset + 1] = 0;
        this.velocity[offset + 2] = 0;
        this.settledSeconds = 0;
    }

    kick(x: number, y: number, z: number): void {
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const weight = this.impulseWeight[particle];
            const offset = particle * 3;
            this.velocity[offset] += x * weight;
            this.velocity[offset + 1] += y * weight;
            this.velocity[offset + 2] += z * weight;
        }
        this.wake();
    }

    wake(): void {
        this.settledSeconds = 0;
        this.metrics.settled = false;
    }

    pinnedTravel(): number {
        let travel = 0;
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] !== 0) continue;
            const offset = particle * 3;
            const dx = this.anchorTo[offset] - this.position[offset];
            const dy = this.anchorTo[offset + 1] - this.position[offset + 1];
            const dz = this.anchorTo[offset + 2] - this.position[offset + 2];
            travel = Math.max(travel, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        return travel;
    }

    readPosition(index: number, out: IVector3): void {
        const offset = index * 3;
        out.x = this.position[offset];
        out.y = this.position[offset + 1];
        out.z = this.position[offset + 2];
    }

    isFinite(): boolean {
        for (let index = 0; index < this.particleCount * 3; index++)
            if (!Number.isFinite(this.position[index])) return false;
        return true;
    }

    step(frameSeconds: number, environment: ISolverEnvironment, reduced: boolean): boolean {
        const seconds = Math.min(frameSeconds, PHYSICS.step.maxStepSeconds);
        if (!(seconds > 0)) return false;
        const travel = this.pinnedTravel();
        const isAsleep = this.settledSeconds >= PHYSICS.solver.sleepSeconds;
        if (isAsleep && travel < PHYSICS.solver.wakeDistance) return false;
        if (travel >= PHYSICS.solver.wakeDistance) this.wake();

        const { substepSeconds, maxSubsteps } = PHYSICS.step;
        const substeps = reduced
            ? 1
            : Math.min(maxSubsteps, Math.max(1, Math.ceil(seconds / substepSeconds)));
        const iterations = reduced ? PHYSICS.solver.reducedIterations : PHYSICS.solver.iterations;
        const stepSeconds = seconds / substeps;
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] !== 0) continue;
            const offset = particle * 3;
            this.anchorFrom[offset] = this.position[offset];
            this.anchorFrom[offset + 1] = this.position[offset + 1];
            this.anchorFrom[offset + 2] = this.position[offset + 2];
        }
        this.followPins();
        for (let substep = 0; substep < substeps; substep++) {
            this.predict(stepSeconds, (substep + 1) / substeps, environment);
            this.measurePinDistances();
            for (let iteration = 0; iteration < iterations; iteration++) {
                this.solveLinks();
                this.solveTethers();
                this.collide(environment);
            }
            this.commit(stepSeconds);
        }
        this.measure(seconds, travel);
        return true;
    }

    private followPins(): void {
        const share = PHYSICS.solver.pinFollowShare;
        for (let particle = 0; particle < this.particleCount; particle++) {
            const pin = this.particlePin[particle];
            if (pin < 0) continue;
            const offset = particle * 3;
            const pinOffset = pin * 3;
            for (let axis = 0; axis < 3; axis++)
                this.position[offset + axis] +=
                    (this.anchorTo[pinOffset + axis] - this.anchorFrom[pinOffset + axis]) * share;
        }
    }

    private predict(stepSeconds: number, blend: number, environment: ISolverEnvironment): void {
        const maxSpeed = PHYSICS.solver.maxSpeed;
        for (let particle = 0; particle < this.particleCount; particle++) {
            const offset = particle * 3;
            if (this.inverseMass[particle] === 0) {
                for (let axis = 0; axis < 3; axis++)
                    this.predicted[offset + axis] =
                        this.anchorFrom[offset + axis] +
                        (this.anchorTo[offset + axis] - this.anchorFrom[offset + axis]) * blend;
                continue;
            }
            const decay = Math.exp(-this.damping[particle] * stepSeconds);
            const exposure = this.windExposure[particle];
            let vx = this.velocity[offset] * decay + environment.windX * exposure * stepSeconds;
            let vy =
                this.velocity[offset + 1] * decay +
                (environment.windY * exposure - environment.gravity * this.gravityScale[particle]) *
                    stepSeconds;
            let vz = this.velocity[offset + 2] * decay + environment.windZ * exposure * stepSeconds;
            const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                vx *= scale;
                vy *= scale;
                vz *= scale;
            }
            this.velocity[offset] = vx;
            this.velocity[offset + 1] = vy;
            this.velocity[offset + 2] = vz;
            this.predicted[offset] = this.position[offset] + vx * stepSeconds;
            this.predicted[offset + 1] = this.position[offset + 1] + vy * stepSeconds;
            this.predicted[offset + 2] = this.position[offset + 2] + vz * stepSeconds;
        }
    }

    private solveLinks(): void {
        for (let link = 0; link < this.linkCount; link++) {
            const a = this.linkA[link];
            const b = this.linkB[link];
            const weightA = this.inverseMass[a];
            const weightB = this.inverseMass[b];
            const weightSum = weightA + weightB;
            if (weightSum === 0) continue;
            const oa = a * 3;
            const ob = b * 3;
            const dx = this.predicted[oa] - this.predicted[ob];
            const dy = this.predicted[oa + 1] - this.predicted[ob + 1];
            const dz = this.predicted[oa + 2] - this.predicted[ob + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (length < DEGENERATE) continue;
            const correction =
                ((length - this.restLength[link]) / length / weightSum) * this.linkStiffness[link];
            this.predicted[oa] -= weightA * correction * dx;
            this.predicted[oa + 1] -= weightA * correction * dy;
            this.predicted[oa + 2] -= weightA * correction * dz;
            this.predicted[ob] += weightB * correction * dx;
            this.predicted[ob + 1] += weightB * correction * dy;
            this.predicted[ob + 2] += weightB * correction * dz;
        }
    }

    private solveTethers(): void {
        for (let tether = 0; tether < this.tetherCount; tether++) {
            const particle = this.tetherParticle[tether] * 3;
            const pin = this.tetherPin[tether] * 3;
            const dx = this.predicted[particle] - this.predicted[pin];
            const dy = this.predicted[particle + 1] - this.predicted[pin + 1];
            const dz = this.predicted[particle + 2] - this.predicted[pin + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const limit = this.tetherLimit[tether];
            if (length <= limit || length < DEGENERATE) continue;
            const scale = limit / length;
            this.predicted[particle] = this.predicted[pin] + dx * scale;
            this.predicted[particle + 1] = this.predicted[pin + 1] + dy * scale;
            this.predicted[particle + 2] = this.predicted[pin + 2] + dz * scale;
        }
    }

    private collide(environment: ISolverEnvironment): void {
        const { particleRadius, colliderMargin, floorClearance, tetherReachShare } = PHYSICS.solver;
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const offset = particle * 3;
            const pin = this.particlePin[particle];
            let px = this.predicted[offset];
            let py = this.predicted[offset + 1];
            let pz = this.predicted[offset + 2];
            for (let capsule = 0; capsule < this.colliderCount; capsule++) {
                const k = capsule * COLLIDER_STRIDE;
                const distance = this.distanceToCapsule(k, px, py, pz);
                let minimum = this.collider[k + 6] + particleRadius + colliderMargin;
                if (pin >= 0)
                    minimum = Math.min(
                        minimum,
                        this.pinDistance[pin * this.colliderCapacity + capsule] +
                            this.particleReach[particle] * tetherReachShare
                    );
                if (distance >= minimum) continue;
                const ax = this.collider[k];
                const ay = this.collider[k + 1];
                const az = this.collider[k + 2];
                const abx = this.collider[k + 3] - ax;
                const aby = this.collider[k + 4] - ay;
                const abz = this.collider[k + 5] - az;
                const lengthSquared = abx * abx + aby * aby + abz * abz;
                let along =
                    lengthSquared > DEGENERATE
                        ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lengthSquared
                        : 0;
                along = along < 0 ? 0 : along > 1 ? 1 : along;
                const dx = px - (ax + abx * along);
                const dy = py - (ay + aby * along);
                const dz = pz - (az + abz * along);
                if (distance > 1e-9) {
                    const push = (minimum - distance) / distance;
                    px += dx * push;
                    py += dy * push;
                    pz += dz * push;
                } else py += minimum;
                this.inContact[particle] = 1;
            }
            if (environment.floorY !== null && py < environment.floorY + floorClearance) {
                py = environment.floorY + floorClearance;
                this.inContact[particle] = 1;
            }
            this.predicted[offset] = px;
            this.predicted[offset + 1] = py;
            this.predicted[offset + 2] = pz;
        }
    }

    private measurePinDistances(): void {
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] !== 0) continue;
            const offset = particle * 3;
            for (let capsule = 0; capsule < this.colliderCount; capsule++)
                this.pinDistance[particle * this.colliderCapacity + capsule] =
                    this.distanceToCapsule(
                        capsule * COLLIDER_STRIDE,
                        this.predicted[offset],
                        this.predicted[offset + 1],
                        this.predicted[offset + 2]
                    );
        }
    }

    private distanceToCapsule(k: number, x: number, y: number, z: number): number {
        const abx = this.collider[k + 3] - this.collider[k];
        const aby = this.collider[k + 4] - this.collider[k + 1];
        const abz = this.collider[k + 5] - this.collider[k + 2];
        const lengthSquared = abx * abx + aby * aby + abz * abz;
        let along =
            lengthSquared > DEGENERATE
                ? ((x - this.collider[k]) * abx +
                      (y - this.collider[k + 1]) * aby +
                      (z - this.collider[k + 2]) * abz) /
                  lengthSquared
                : 0;
        along = along < 0 ? 0 : along > 1 ? 1 : along;
        const dx = x - (this.collider[k] + abx * along);
        const dy = y - (this.collider[k + 1] + aby * along);
        const dz = z - (this.collider[k + 2] + abz * along);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private commit(stepSeconds: number): void {
        for (let particle = 0; particle < this.particleCount; particle++) {
            const offset = particle * 3;
            if (this.inverseMass[particle] === 0) {
                for (let axis = 0; axis < 3; axis++) {
                    this.position[offset + axis] = this.predicted[offset + axis];
                    this.velocity[offset + axis] = 0;
                }
                continue;
            }
            const keep = this.inContact[particle] ? 1 - this.friction[particle] : 1;
            this.inContact[particle] = 0;
            for (let axis = 0; axis < 3; axis++) {
                this.velocity[offset + axis] =
                    ((this.predicted[offset + axis] - this.position[offset + axis]) / stepSeconds) *
                    keep;
                this.position[offset + axis] = this.predicted[offset + axis];
            }
        }
    }

    private relativeSpeed(particle: number, seconds: number): number {
        let pin = -1;
        for (let tether = 0; tether < this.tetherCount; tether++)
            if (this.tetherParticle[tether] === particle) pin = this.tetherPin[tether];
        if (pin < 0) return 0;
        const offset = particle * 3;
        const pinOffset = pin * 3;
        let sum = 0;
        for (let axis = 0; axis < 3; axis++) {
            const pinVelocity =
                (this.position[pinOffset + axis] - this.anchorFrom[pinOffset + axis]) / seconds;
            const difference = this.velocity[offset + axis] - pinVelocity;
            sum += difference * difference;
        }
        return Math.sqrt(sum);
    }

    private measure(seconds: number, travel: number): void {
        let maxStrain = 0;
        for (let link = 0; link < this.linkCount; link++) {
            if (!this.linkMeasured[link]) continue;
            const oa = this.linkA[link] * 3;
            const ob = this.linkB[link] * 3;
            const dx = this.position[oa] - this.position[ob];
            const dy = this.position[oa + 1] - this.position[ob + 1];
            const dz = this.position[oa + 2] - this.position[ob + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            maxStrain = Math.max(
                maxStrain,
                Math.abs(length - this.restLength[link]) / this.restLength[link]
            );
        }
        let maxSpeed = 0;
        let maxRelativeSpeed = 0;
        let maxPenetration = 0;
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const offset = particle * 3;
            const vx = this.velocity[offset];
            const vy = this.velocity[offset + 1];
            const vz = this.velocity[offset + 2];
            maxSpeed = Math.max(maxSpeed, Math.sqrt(vx * vx + vy * vy + vz * vz));
            maxRelativeSpeed = Math.max(maxRelativeSpeed, this.relativeSpeed(particle, seconds));
            for (let capsule = 0; capsule < this.colliderCount; capsule++) {
                const k = capsule * COLLIDER_STRIDE;
                const abx = this.collider[k + 3] - this.collider[k];
                const aby = this.collider[k + 4] - this.collider[k + 1];
                const abz = this.collider[k + 5] - this.collider[k + 2];
                const lengthSquared = abx * abx + aby * aby + abz * abz;
                const px = this.position[offset] - this.collider[k];
                const py = this.position[offset + 1] - this.collider[k + 1];
                const pz = this.position[offset + 2] - this.collider[k + 2];
                let along =
                    lengthSquared > DEGENERATE
                        ? (px * abx + py * aby + pz * abz) / lengthSquared
                        : 0;
                along = along < 0 ? 0 : along > 1 ? 1 : along;
                const dx = px - abx * along;
                const dy = py - aby * along;
                const dz = pz - abz * along;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                maxPenetration = Math.max(maxPenetration, this.collider[k + 6] - distance);
            }
        }
        this.metrics.maxStrain = maxStrain;
        this.metrics.maxSpeed = maxSpeed;
        this.metrics.maxRelativeSpeed = maxRelativeSpeed;
        this.metrics.maxPenetration = maxPenetration;
        const isQuiet =
            maxSpeed < PHYSICS.solver.sleepSpeed && travel < PHYSICS.solver.wakeDistance;
        this.settledSeconds = isQuiet ? this.settledSeconds + seconds : 0;
        this.metrics.settled = this.settledSeconds >= PHYSICS.solver.sleepSeconds;
    }
}
