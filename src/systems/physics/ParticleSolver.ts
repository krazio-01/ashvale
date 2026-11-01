import { PHYSICS } from "@/constants/physics";
import type { IClothTuning, IVector3 } from "@/types/physics";
import { ERRORS } from "@/constants/strings";

interface IParticleSpec {
    x: number;
    y: number;
    z: number;
    body: number;
    pinned: boolean;
    hemShare: number;
}

interface ISolverCapacity {
    particles: number;
    stretchLinks: number;
    bendLinks: number;
    tethers: number;
    colliders: number;
}

export interface ISolverEnvironment {
    gravity: number;
    windX: number;
    windY: number;
    windZ: number;
    originX: number;
    originY: number;
    originZ: number;
    flingX: number;
    flingY: number;
    flingZ: number;
    flingScale: number;
    floorY: number | null;
}

export interface ICarriedMotion {
    originX: number;
    originY: number;
    originZ: number;
    referenceMoveX: number;
    referenceMoveY: number;
    referenceMoveZ: number;
    axisX: number;
    axisY: number;
    axisZ: number;
    angle: number;
    moveX: number;
    moveY: number;
    moveZ: number;
}

export type LinkKind = "stretch" | "bend";

interface ILinkSet {
    count: number;
    readonly a: Uint16Array;
    readonly b: Uint16Array;
    readonly restLength: Float64Array;
    readonly body: Uint8Array;
    readonly softness: Float64Array;
}

export class ParticleSolver {
    private static readonly COLLIDER_STRIDE = 7;

    private static readonly BOUND_STRIDE = 4;

    private static readonly DEGENERATE = PHYSICS.epsilon.geometry;

    private static readonly LINK_KINDS: readonly LinkKind[] = ["stretch", "bend"];

    private static readonly MAX_COLLIDERS = 255;

    private static readonly SOFTNESS_KEY = {
        stretch: "stretchSoftness",
        bend: "bendSoftness",
    } as const;

    private static createLinkSet(capacity: number): ILinkSet {
        return {
            count: 0,
            a: new Uint16Array(capacity),
            b: new Uint16Array(capacity),
            restLength: new Float64Array(capacity),
            body: new Uint8Array(capacity),
            softness: new Float64Array(capacity),
        };
    }

    dampingScale = 1;
    particleCount = 0;
    private tetherCount = 0;
    private colliderCount = 0;
    private settledSeconds = 0;
    private closestX = 0;
    private closestY = 0;
    private closestZ = 0;
    private carried: ICarriedMotion | null = null;
    private readonly carryRotation = new Float64Array(9);
    private carryPending = false;
    private readonly tuningByBody: IClothTuning[] = [];
    private readonly dampingDecay: number[] = [];
    private readonly frictionKeep: number[] = [];
    private readonly links: Record<LinkKind, ILinkSet>;
    readonly position: Float64Array;
    private readonly predicted: Float64Array;
    private readonly velocity: Float64Array;
    private readonly homeFrom: Float64Array;
    private readonly homeTo: Float64Array;
    private readonly homeNow: Float64Array;
    private readonly driftCentreFrom: Float64Array;
    private readonly driftCentreTo: Float64Array;
    private readonly driftCentre: Float64Array;
    private readonly homeNormal: Float64Array;
    private readonly inverseMass: Float64Array;
    private readonly bodyOf: Uint8Array;
    private readonly hemShare: Float64Array;
    private readonly maxDrift: Float64Array;
    private readonly inContact: Uint8Array;
    private readonly contactNormal: Float64Array;
    private readonly tetherParticle: Uint16Array;
    private readonly tetherPin: Uint16Array;
    private readonly tetherRest: Float64Array;
    private readonly tetherLength: Float64Array;
    private readonly colliderFrom: Float64Array;
    private readonly colliderTo: Float64Array;
    private readonly colliderNow: Float64Array;
    private readonly colliderBound: Float64Array;
    private readonly colliderEnabled: Uint8Array;
    private readonly candidates: Uint8Array;
    private readonly candidateCount: Uint8Array;
    private readonly colliderCapacity: number;

    constructor(capacity: ISolverCapacity) {
        const { particles, stretchLinks, bendLinks, tethers, colliders } = capacity;
        if (colliders > ParticleSolver.MAX_COLLIDERS)
            throw new Error(ERRORS.tooManyColliders(ParticleSolver.MAX_COLLIDERS, colliders));
        this.links = {
            stretch: ParticleSolver.createLinkSet(stretchLinks),
            bend: ParticleSolver.createLinkSet(bendLinks),
        };
        this.position = new Float64Array(particles * 3);
        this.predicted = new Float64Array(particles * 3);
        this.velocity = new Float64Array(particles * 3);
        this.homeFrom = new Float64Array(particles * 3);
        this.homeTo = new Float64Array(particles * 3);
        this.homeNow = new Float64Array(particles * 3);
        this.driftCentreFrom = new Float64Array(particles * 3);
        this.driftCentreTo = new Float64Array(particles * 3);
        this.driftCentre = new Float64Array(particles * 3);
        this.homeNormal = new Float64Array(particles * 3);
        this.inverseMass = new Float64Array(particles);
        this.bodyOf = new Uint8Array(particles);
        this.hemShare = new Float64Array(particles);
        this.maxDrift = new Float64Array(particles);
        this.inContact = new Uint8Array(particles);
        this.contactNormal = new Float64Array(particles * 3);
        this.tetherParticle = new Uint16Array(tethers);
        this.tetherPin = new Uint16Array(tethers);
        this.tetherRest = new Float64Array(tethers);
        this.tetherLength = new Float64Array(tethers);
        this.colliderFrom = new Float64Array(colliders * ParticleSolver.COLLIDER_STRIDE);
        this.colliderTo = new Float64Array(colliders * ParticleSolver.COLLIDER_STRIDE);
        this.colliderNow = new Float64Array(colliders * ParticleSolver.COLLIDER_STRIDE);
        this.colliderBound = new Float64Array(colliders * ParticleSolver.BOUND_STRIDE);
        this.colliderEnabled = new Uint8Array(colliders);
        this.candidates = new Uint8Array(particles * colliders);
        this.candidateCount = new Uint8Array(particles);
        this.colliderCapacity = colliders;
    }

    addBody(tuning: IClothTuning): number {
        this.tuningByBody.push(tuning);
        this.dampingDecay.push(1);
        this.frictionKeep.push(1);
        return this.tuningByBody.length - 1;
    }

    addParticle(spec: IParticleSpec): number {
        const index = this.particleCount++;
        this.inverseMass[index] = spec.pinned ? 0 : 1;
        this.bodyOf[index] = spec.body;
        this.hemShare[index] = spec.hemShare;
        this.resetParticleTo(index, spec);
        return index;
    }

    addLink(kind: LinkKind, a: number, b: number, restLength: number, body: number): void {
        const links = this.links[kind];
        const index = links.count++;
        links.a[index] = a;
        links.b[index] = b;
        links.restLength[index] = restLength;
        links.body[index] = body;
    }

    addTether(particle: number, pin: number, restLength: number): void {
        const index = this.tetherCount++;
        this.tetherParticle[index] = particle;
        this.tetherPin[index] = pin;
        this.tetherRest[index] = restLength;
    }

    setHome(index: number, home: IVector3, normal: IVector3): void {
        const offset = index * 3;
        this.homeTo[offset] = home.x;
        this.homeTo[offset + 1] = home.y;
        this.homeTo[offset + 2] = home.z;
        this.homeNormal[offset] = normal.x;
        this.homeNormal[offset + 1] = normal.y;
        this.homeNormal[offset + 2] = normal.z;
    }

    setCollider(index: number, start: IVector3, end: IVector3, radius: number): void {
        const offset = index * ParticleSolver.COLLIDER_STRIDE;
        this.colliderTo[offset] = start.x;
        this.colliderTo[offset + 1] = start.y;
        this.colliderTo[offset + 2] = start.z;
        this.colliderTo[offset + 3] = end.x;
        this.colliderTo[offset + 4] = end.y;
        this.colliderTo[offset + 5] = end.z;
        this.colliderTo[offset + 6] = radius;
        this.colliderCount = Math.max(this.colliderCount, index + 1);
        if (this.colliderEnabled[index]) return;
        this.colliderEnabled[index] = 1;
        for (let field = 0; field < ParticleSolver.COLLIDER_STRIDE; field++)
            this.colliderFrom[offset + field] = this.colliderNow[offset + field] =
                this.colliderTo[offset + field];
        this.wake();
    }

    disableCollider(index: number): void {
        if (!this.colliderEnabled[index]) return;
        this.colliderEnabled[index] = 0;
        this.wake();
    }

    resetParticleTo(index: number, position: IVector3): void {
        const offset = index * 3;
        this.position[offset] = this.predicted[offset] = position.x;
        this.position[offset + 1] = this.predicted[offset + 1] = position.y;
        this.position[offset + 2] = this.predicted[offset + 2] = position.z;
        this.homeFrom[offset] = this.homeTo[offset] = this.homeNow[offset] = position.x;
        this.homeFrom[offset + 1] = this.homeTo[offset + 1] = this.homeNow[offset + 1] = position.y;
        this.homeFrom[offset + 2] = this.homeTo[offset + 2] = this.homeNow[offset + 2] = position.z;
        this.velocity[offset] = this.velocity[offset + 1] = this.velocity[offset + 2] = 0;
        this.settledSeconds = 0;
    }

    syncPreviousFrame(): void {
        this.homeFrom.set(this.homeTo);
        this.homeNow.set(this.homeTo);
        this.colliderFrom.set(this.colliderTo);
        this.colliderNow.set(this.colliderTo);
    }

    carry(motion: ICarriedMotion): void {
        this.carried = motion;
        this.carryPending = true;
    }

    addImpulse(x: number, y: number, z: number): void {
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const weight =
                this.tuningByBody[this.bodyOf[particle]].hitImpulseScale * this.hemShare[particle];
            const offset = particle * 3;
            this.velocity[offset] += x * weight;
            this.velocity[offset + 1] += y * weight;
            this.velocity[offset + 2] += z * weight;
        }
        this.wake();
    }

    wake(): void {
        this.settledSeconds = 0;
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
        const seconds = Math.min(frameSeconds, PHYSICS.step.maxFrameSeconds);
        const carried = this.carryPending ? this.carried : null;
        this.carryPending = false;
        if (!(seconds > 0)) return false;
        if (this.movedEnoughToWake(seconds)) this.wake();
        if (this.isSettled()) {
            this.shiftByHomeMovement();
            this.endFrame();
            return true;
        }
        const substeps = ParticleSolver.substepCount(seconds, reduced);
        const stepSeconds = seconds / substeps;
        this.pushDriftCentresOutOfColliders();
        this.beginFrame(seconds, stepSeconds, carried);
        if (carried) this.prepareCarry(carried, substeps);
        for (let substep = 1; substep <= substeps; substep++) {
            if (carried) this.carryParticles(carried, substep - 1, substeps);
            this.interpolate(substep / substeps);
            this.predict(stepSeconds, environment);
            this.solveLinks(this.links.stretch, stepSeconds);
            this.solveLinks(this.links.bend, stepSeconds);
            this.limitDrift();
            this.keepOutsideBody();
            this.solveTethers();
            this.collide(environment);
            this.updateVelocities(stepSeconds);
        }
        this.updateSleep(seconds);
        this.endFrame();
        return true;
    }

    private static travelSquared(from: Float64Array, to: Float64Array, offset: number): number {
        return (
            (to[offset] - from[offset]) ** 2 +
            (to[offset + 1] - from[offset + 1]) ** 2 +
            (to[offset + 2] - from[offset + 2]) ** 2
        );
    }

    private movedEnoughToWake(seconds: number): boolean {
        const limitSquared = (PHYSICS.solver.wakeSpeed * seconds) ** 2;
        for (let offset = 0; offset < this.particleCount * 3; offset += 3)
            if (ParticleSolver.travelSquared(this.homeFrom, this.homeTo, offset) >= limitSquared)
                return true;
        for (let collider = 0; collider < this.colliderCount; collider++) {
            if (!this.colliderEnabled[collider]) continue;
            const offset = collider * ParticleSolver.COLLIDER_STRIDE;
            if (
                ParticleSolver.travelSquared(this.colliderFrom, this.colliderTo, offset) >=
                    limitSquared ||
                ParticleSolver.travelSquared(this.colliderFrom, this.colliderTo, offset + 3) >=
                    limitSquared
            )
                return true;
        }
        return false;
    }

    private pushDriftCentresOutOfColliders(): void {
        this.driftCentreFrom.set(this.homeFrom);
        this.driftCentreTo.set(this.homeTo);
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            this.deflectOutOfColliders(particle, this.colliderFrom, this.driftCentreFrom);
            this.deflectOutOfColliders(particle, this.colliderTo, this.driftCentreTo);
        }
    }

    private deflectOutOfColliders(
        particle: number,
        colliders: Float64Array,
        centres: Float64Array
    ): void {
        const offset = particle * 3;
        const tuning = this.tuningByBody[this.bodyOf[particle]];
        const clearanceBlend = tuning.targetClearanceBlend;
        let x = centres[offset];
        let y = centres[offset + 1];
        let z = centres[offset + 2];
        for (let collider = 0; collider < this.colliderCount; collider++) {
            if (!this.colliderEnabled[collider]) continue;
            const start = collider * ParticleSolver.COLLIDER_STRIDE;
            const surface =
                colliders[start + 6] + tuning.collisionThickness + tuning.targetClearance;
            const reach = surface + clearanceBlend;
            const distanceSquared = this.capsuleDistanceSquared(colliders, start, x, y, z);
            if (distanceSquared >= reach * reach) continue;
            const distance = Math.sqrt(distanceSquared);
            const blend =
                clearanceBlend > 0 ? Math.max(clearanceBlend - Math.abs(distance - surface), 0) : 0;
            const deflected =
                Math.max(distance, surface) +
                (clearanceBlend > 0 ? (blend * blend) / (4 * clearanceBlend) : 0);
            let nx = this.homeNormal[offset];
            let ny = this.homeNormal[offset + 1];
            let nz = this.homeNormal[offset + 2];
            if (distance > ParticleSolver.DEGENERATE) {
                nx = (x - this.closestX) / distance;
                ny = (y - this.closestY) / distance;
                nz = (z - this.closestZ) / distance;
            }
            x = this.closestX + nx * deflected;
            y = this.closestY + ny * deflected;
            z = this.closestZ + nz * deflected;
        }
        centres[offset] = x;
        centres[offset + 1] = y;
        centres[offset + 2] = z;
    }

    private isSettled(): boolean {
        return this.settledSeconds >= PHYSICS.solver.sleepSeconds;
    }

    private shiftByHomeMovement(): void {
        for (let offset = 0; offset < this.particleCount * 3; offset++)
            this.position[offset] += this.homeTo[offset] - this.homeFrom[offset];
    }

    private static substepCount(seconds: number, reduced: boolean): number {
        const { substepsPerFrame, referenceFrameSeconds, maxSubsteps, reducedSubstepShare } =
            PHYSICS.step;
        const share = reduced ? reducedSubstepShare : 1;
        return Math.min(
            maxSubsteps,
            Math.max(1, Math.ceil((substepsPerFrame * share * seconds) / referenceFrameSeconds))
        );
    }

    private beginFrame(seconds: number, stepSeconds: number, carried: ICarriedMotion | null): void {
        for (let body = 0; body < this.tuningByBody.length; body++) {
            this.dampingDecay[body] = Math.exp(
                -this.tuningByBody[body].damping * this.dampingScale * stepSeconds
            );
            this.frictionKeep[body] = Math.exp(-this.tuningByBody[body].friction * stepSeconds);
        }
        for (let particle = 0; particle < this.particleCount; particle++) {
            const tuning = this.tuningByBody[this.bodyOf[particle]];
            this.maxDrift[particle] =
                tuning.maxDriftAtHem * this.hemShare[particle] ** tuning.driftCurve;
        }
        for (const kind of ParticleSolver.LINK_KINDS) {
            const links = this.links[kind];
            for (let link = 0; link < links.count; link++)
                links.softness[link] =
                    this.tuningByBody[links.body[link]][ParticleSolver.SOFTNESS_KEY[kind]];
        }
        for (let tether = 0; tether < this.tetherCount; tether++)
            this.tetherLength[tether] =
                this.tetherRest[tether] *
                this.tuningByBody[this.bodyOf[this.tetherParticle[tether]]].pinSlack;
        this.boundColliders();
        this.gatherCandidates(PHYSICS.solver.maxSpeed * seconds, carried);
    }

    private boundColliders(): void {
        for (let collider = 0; collider < this.colliderCount; collider++) {
            if (!this.colliderEnabled[collider]) continue;
            const from = collider * ParticleSolver.COLLIDER_STRIDE;
            const bound = collider * ParticleSolver.BOUND_STRIDE;
            let reach = 0;
            for (let axis = 0; axis < 3; axis++)
                this.colliderBound[bound + axis] =
                    (this.colliderFrom[from + axis] +
                        this.colliderFrom[from + 3 + axis] +
                        this.colliderTo[from + axis] +
                        this.colliderTo[from + 3 + axis]) /
                    4;
            for (let corner = 0; corner < 4; corner++) {
                const ends = corner < 2 ? this.colliderFrom : this.colliderTo;
                const end = from + (corner % 2) * 3;
                reach = Math.max(
                    reach,
                    Math.hypot(
                        ends[end] - this.colliderBound[bound],
                        ends[end + 1] - this.colliderBound[bound + 1],
                        ends[end + 2] - this.colliderBound[bound + 2]
                    )
                );
            }
            this.colliderBound[bound + 3] =
                reach + Math.max(this.colliderFrom[from + 6], this.colliderTo[from + 6]);
        }
    }

    private gatherCandidates(travel: number, motion: ICarriedMotion | null): void {
        const moveLength = motion
            ? Math.sqrt(motion.moveX ** 2 + motion.moveY ** 2 + motion.moveZ ** 2)
            : 0;
        for (let particle = 0; particle < this.particleCount; particle++) {
            let count = 0;
            if (this.inverseMass[particle] !== 0) {
                const offset = particle * 3;
                let margin = travel + this.tuningByBody[this.bodyOf[particle]].collisionThickness;
                if (motion)
                    margin +=
                        moveLength +
                        motion.angle *
                            Math.sqrt(
                                (this.position[offset] - motion.originX) ** 2 +
                                    (this.position[offset + 1] - motion.originY) ** 2 +
                                    (this.position[offset + 2] - motion.originZ) ** 2
                            );
                for (let collider = 0; collider < this.colliderCount; collider++) {
                    if (!this.colliderEnabled[collider]) continue;
                    const bound = collider * ParticleSolver.BOUND_STRIDE;
                    const reach = this.colliderBound[bound + 3] + margin;
                    const dx = this.position[offset] - this.colliderBound[bound];
                    const dy = this.position[offset + 1] - this.colliderBound[bound + 1];
                    const dz = this.position[offset + 2] - this.colliderBound[bound + 2];
                    if (dx * dx + dy * dy + dz * dz <= reach * reach)
                        this.candidates[particle * this.colliderCapacity + count++] = collider;
                }
            }
            this.candidateCount[particle] = count;
        }
    }

    private prepareCarry(motion: ICarriedMotion, substeps: number): void {
        const { axisX, axisY, axisZ, angle } = motion;
        const stepAngle = angle / substeps;
        const cosine = Math.cos(stepAngle);
        const sine = Math.sin(stepAngle);
        const rest = 1 - cosine;
        const m = this.carryRotation;
        m[0] = cosine + axisX * axisX * rest;
        m[1] = axisX * axisY * rest - axisZ * sine;
        m[2] = axisX * axisZ * rest + axisY * sine;
        m[3] = axisY * axisX * rest + axisZ * sine;
        m[4] = cosine + axisY * axisY * rest;
        m[5] = axisY * axisZ * rest - axisX * sine;
        m[6] = axisZ * axisX * rest - axisY * sine;
        m[7] = axisZ * axisY * rest + axisX * sine;
        m[8] = cosine + axisZ * axisZ * rest;
    }

    private carryParticles(motion: ICarriedMotion, substepIndex: number, substeps: number): void {
        const m = this.carryRotation;
        const progress = substepIndex / substeps;
        const originX = motion.originX + motion.referenceMoveX * progress;
        const originY = motion.originY + motion.referenceMoveY * progress;
        const originZ = motion.originZ + motion.referenceMoveZ * progress;
        const moveX = motion.moveX / substeps;
        const moveY = motion.moveY / substeps;
        const moveZ = motion.moveZ / substeps;
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const offset = particle * 3;
            const rx = this.position[offset] - originX;
            const ry = this.position[offset + 1] - originY;
            const rz = this.position[offset + 2] - originZ;
            this.position[offset] = originX + m[0] * rx + m[1] * ry + m[2] * rz + moveX;
            this.position[offset + 1] = originY + m[3] * rx + m[4] * ry + m[5] * rz + moveY;
            this.position[offset + 2] = originZ + m[6] * rx + m[7] * ry + m[8] * rz + moveZ;
            const vx = this.velocity[offset];
            const vy = this.velocity[offset + 1];
            const vz = this.velocity[offset + 2];
            this.velocity[offset] = m[0] * vx + m[1] * vy + m[2] * vz;
            this.velocity[offset + 1] = m[3] * vx + m[4] * vy + m[5] * vz;
            this.velocity[offset + 2] = m[6] * vx + m[7] * vy + m[8] * vz;
        }
    }

    private static lerpInto(
        out: Float64Array,
        from: Float64Array,
        to: Float64Array,
        length: number,
        blend: number
    ): void {
        for (let index = 0; index < length; index++)
            out[index] = from[index] + (to[index] - from[index]) * blend;
    }

    private interpolate(blend: number): void {
        const triples = this.particleCount * 3;
        ParticleSolver.lerpInto(this.homeNow, this.homeFrom, this.homeTo, triples, blend);
        ParticleSolver.lerpInto(
            this.driftCentre,
            this.driftCentreFrom,
            this.driftCentreTo,
            triples,
            blend
        );
        ParticleSolver.lerpInto(
            this.colliderNow,
            this.colliderFrom,
            this.colliderTo,
            this.colliderCount * ParticleSolver.COLLIDER_STRIDE,
            blend
        );
    }

    private predict(stepSeconds: number, environment: ISolverEnvironment): void {
        const { flingX, flingY, flingZ, flingScale } = environment;
        const flingSquared = flingX * flingX + flingY * flingY + flingZ * flingZ;
        for (let particle = 0; particle < this.particleCount; particle++) {
            const offset = particle * 3;
            if (this.inverseMass[particle] === 0) {
                this.predicted[offset] = this.homeNow[offset];
                this.predicted[offset + 1] = this.homeNow[offset + 1];
                this.predicted[offset + 2] = this.homeNow[offset + 2];
                continue;
            }
            const tuning = this.tuningByBody[this.bodyOf[particle]];
            const decay = this.dampingDecay[this.bodyOf[particle]];
            const exposure = tuning.windExposure * this.hemShare[particle];
            const rx = this.position[offset] - environment.originX;
            const ry = this.position[offset + 1] - environment.originY;
            const rz = this.position[offset + 2] - environment.originZ;
            const along = flingX * rx + flingY * ry + flingZ * rz;
            const ax =
                environment.windX * exposure + flingScale * (flingSquared * rx - along * flingX);
            const ay =
                environment.windY * exposure +
                flingScale * (flingSquared * ry - along * flingY) -
                environment.gravity * tuning.gravityScale;
            const az =
                environment.windZ * exposure + flingScale * (flingSquared * rz - along * flingZ);
            this.predicted[offset] =
                this.position[offset] +
                (this.velocity[offset] * decay + ax * stepSeconds) * stepSeconds;
            this.predicted[offset + 1] =
                this.position[offset + 1] +
                (this.velocity[offset + 1] * decay + ay * stepSeconds) * stepSeconds;
            this.predicted[offset + 2] =
                this.position[offset + 2] +
                (this.velocity[offset + 2] * decay + az * stepSeconds) * stepSeconds;
        }
    }

    private solveLinks(links: ILinkSet, stepSeconds: number): void {
        const inverseStepSquared = 1 / (stepSeconds * stepSeconds);
        for (let link = 0; link < links.count; link++) {
            const a = links.a[link];
            const b = links.b[link];
            const weightA = this.inverseMass[a];
            const weightB = this.inverseMass[b];
            if (weightA + weightB === 0) continue;
            const oa = a * 3;
            const ob = b * 3;
            const dx = this.predicted[oa] - this.predicted[ob];
            const dy = this.predicted[oa + 1] - this.predicted[ob + 1];
            const dz = this.predicted[oa + 2] - this.predicted[ob + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (length < ParticleSolver.DEGENERATE) continue;
            const lambda =
                -(length - links.restLength[link]) /
                (weightA + weightB + links.softness[link] * inverseStepSquared);
            const scale = lambda / length;
            this.predicted[oa] += weightA * scale * dx;
            this.predicted[oa + 1] += weightA * scale * dy;
            this.predicted[oa + 2] += weightA * scale * dz;
            this.predicted[ob] -= weightB * scale * dx;
            this.predicted[ob + 1] -= weightB * scale * dy;
            this.predicted[ob + 2] -= weightB * scale * dz;
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
            const tetherLength = this.tetherLength[tether];
            if (length <= tetherLength || length < ParticleSolver.DEGENERATE) continue;
            const scale = tetherLength / length;
            this.predicted[particle] = this.predicted[pin] + dx * scale;
            this.predicted[particle + 1] = this.predicted[pin + 1] + dy * scale;
            this.predicted[particle + 2] = this.predicted[pin + 2] + dz * scale;
        }
    }

    private limitDrift(): void {
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const offset = particle * 3;
            const dx = this.predicted[offset] - this.driftCentre[offset];
            const dy = this.predicted[offset + 1] - this.driftCentre[offset + 1];
            const dz = this.predicted[offset + 2] - this.driftCentre[offset + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const maxDrift = this.maxDrift[particle];
            if (length <= maxDrift) continue;
            const scale = maxDrift / length;
            this.predicted[offset] = this.driftCentre[offset] + dx * scale;
            this.predicted[offset + 1] = this.driftCentre[offset + 1] + dy * scale;
            this.predicted[offset + 2] = this.driftCentre[offset + 2] + dz * scale;
        }
    }

    private keepOutsideBody(): void {
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const tuning = this.tuningByBody[this.bodyOf[particle]];
            const radius = tuning.bodyGuardRadius;
            if (radius <= 0) continue;
            const offset = particle * 3;
            const reach = radius + tuning.bodyGuardDepth;
            const nx = this.homeNormal[offset];
            const ny = this.homeNormal[offset + 1];
            const nz = this.homeNormal[offset + 2];
            const cx = this.homeNow[offset] - nx * reach;
            const cy = this.homeNow[offset + 1] - ny * reach;
            const cz = this.homeNow[offset + 2] - nz * reach;
            const ex = this.predicted[offset] - cx;
            const ey = this.predicted[offset + 1] - cy;
            const ez = this.predicted[offset + 2] - cz;
            const length = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (length >= radius) continue;
            const scale = length > ParticleSolver.DEGENERATE ? radius / length : 0;
            this.predicted[offset] = cx + (scale === 0 ? nx * radius : ex * scale);
            this.predicted[offset + 1] = cy + (scale === 0 ? ny * radius : ey * scale);
            this.predicted[offset + 2] = cz + (scale === 0 ? nz * radius : ez * scale);
        }
    }

    private collide(environment: ISolverEnvironment): void {
        const floor =
            environment.floorY === null ? null : environment.floorY + PHYSICS.solver.floorClearance;
        for (let particle = 0; particle < this.particleCount; particle++) {
            if (this.inverseMass[particle] === 0) continue;
            const offset = particle * 3;
            const thickness = this.tuningByBody[this.bodyOf[particle]].collisionThickness;
            let x = this.predicted[offset];
            let y = this.predicted[offset + 1];
            let z = this.predicted[offset + 2];
            let touched = 0;
            const first = particle * this.colliderCapacity;
            const last = first + this.candidateCount[particle];
            for (let pass = 0; pass < PHYSICS.solver.collisionPasses; pass++)
                for (let slot = first; slot < last; slot++) {
                    const colliderIndex = this.candidates[slot];
                    const collider = colliderIndex * ParticleSolver.COLLIDER_STRIDE;
                    const surface = this.colliderNow[collider + 6] + thickness;
                    const distanceSquared = this.capsuleDistanceSquared(
                        this.colliderNow,
                        collider,
                        x,
                        y,
                        z
                    );
                    if (distanceSquared >= surface * surface) continue;
                    const distance = Math.sqrt(distanceSquared);
                    let nx = 0;
                    let ny = 1;
                    let nz = 0;
                    if (distance > ParticleSolver.DEGENERATE) {
                        nx = (x - this.closestX) / distance;
                        ny = (y - this.closestY) / distance;
                        nz = (z - this.closestZ) / distance;
                    }
                    x = this.closestX + nx * surface;
                    y = this.closestY + ny * surface;
                    z = this.closestZ + nz * surface;
                    this.contactNormal[offset] = nx;
                    this.contactNormal[offset + 1] = ny;
                    this.contactNormal[offset + 2] = nz;
                    touched = 1;
                }
            if (floor !== null && y < floor) {
                y = floor;
                this.contactNormal[offset] = 0;
                this.contactNormal[offset + 1] = 1;
                this.contactNormal[offset + 2] = 0;
                touched = 1;
            }
            this.predicted[offset] = x;
            this.predicted[offset + 1] = y;
            this.predicted[offset + 2] = z;
            this.inContact[particle] = touched;
        }
    }

    private capsuleDistanceSquared(
        colliders: Float64Array,
        collider: number,
        x: number,
        y: number,
        z: number
    ): number {
        const ax = colliders[collider];
        const ay = colliders[collider + 1];
        const az = colliders[collider + 2];
        const abx = colliders[collider + 3] - ax;
        const aby = colliders[collider + 4] - ay;
        const abz = colliders[collider + 5] - az;
        const lengthSquared = abx * abx + aby * aby + abz * abz;
        let along =
            lengthSquared > ParticleSolver.DEGENERATE
                ? ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / lengthSquared
                : 0;
        along = along < 0 ? 0 : along > 1 ? 1 : along;
        this.closestX = ax + abx * along;
        this.closestY = ay + aby * along;
        this.closestZ = az + abz * along;
        const dx = x - this.closestX;
        const dy = y - this.closestY;
        const dz = z - this.closestZ;
        return dx * dx + dy * dy + dz * dz;
    }

    private updateVelocities(stepSeconds: number): void {
        const maxSpeed = PHYSICS.solver.maxSpeed;
        for (let particle = 0; particle < this.particleCount; particle++) {
            const offset = particle * 3;
            if (this.inverseMass[particle] === 0) {
                this.position[offset] = this.predicted[offset];
                this.position[offset + 1] = this.predicted[offset + 1];
                this.position[offset + 2] = this.predicted[offset + 2];
                continue;
            }
            let vx = (this.predicted[offset] - this.position[offset]) / stepSeconds;
            let vy = (this.predicted[offset + 1] - this.position[offset + 1]) / stepSeconds;
            let vz = (this.predicted[offset + 2] - this.position[offset + 2]) / stepSeconds;
            if (this.inContact[particle]) {
                const nx = this.contactNormal[offset];
                const ny = this.contactNormal[offset + 1];
                const nz = this.contactNormal[offset + 2];
                const normalSpeed = vx * nx + vy * ny + vz * nz;
                const separatingSpeed = Math.max(normalSpeed, 0);
                const keep = this.frictionKeep[this.bodyOf[particle]];
                vx = nx * separatingSpeed + (vx - nx * normalSpeed) * keep;
                vy = ny * separatingSpeed + (vy - ny * normalSpeed) * keep;
                vz = nz * separatingSpeed + (vz - nz * normalSpeed) * keep;
            }
            const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
            const scale = speed > maxSpeed ? maxSpeed / speed : 1;
            this.velocity[offset] = vx * scale;
            this.velocity[offset + 1] = vy * scale;
            this.velocity[offset + 2] = vz * scale;
            this.position[offset] = this.predicted[offset];
            this.position[offset + 1] = this.predicted[offset + 1];
            this.position[offset + 2] = this.predicted[offset + 2];
        }
    }

    private updateSleep(seconds: number): void {
        const limit = PHYSICS.solver.sleepSpeed * PHYSICS.solver.sleepSpeed;
        let fastest = 0;
        for (let particle = 0; particle < this.particleCount; particle++) {
            const offset = particle * 3;
            fastest = Math.max(
                fastest,
                this.velocity[offset] ** 2 +
                    this.velocity[offset + 1] ** 2 +
                    this.velocity[offset + 2] ** 2
            );
        }
        this.settledSeconds = fastest < limit ? this.settledSeconds + seconds : 0;
    }

    private endFrame(): void {
        this.homeFrom.set(this.homeTo);
        this.colliderFrom.set(this.colliderTo);
    }
}
