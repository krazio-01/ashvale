import { Bone, Matrix4, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { PROCEDURAL, SKELETON_BONES } from "@/constants/characters";
import type { ImpactProfileName } from "@/constants/characters";
import { clamp } from "@/lib/helpers";
import type { Handedness } from "@/types/weapons";

export interface IGroundProbe {
    groundHeightAt(x: number, z: number, fromY: number): number | null;
}

export interface IBladeSource {
    bladeSegment(hilt: Vector3, tip: Vector3): boolean;
}

export type ProceduralDetail = "full" | "impact" | "none";

export interface IProceduralFrame {
    deltaSeconds: number;
    detail: ProceduralDetail;
    weaponHand: Handedness;
    gripWeight: number;
    grounded: boolean;
    plantFeet: boolean;
    lookTarget: Vector3 | null;
}

const DETAIL_RANK: Record<ProceduralDetail, number> = { none: 0, impact: 1, full: 2 };
const OTHER_HAND: Record<Handedness, Handedness> = { left: "right", right: "left" };
const UP = new Vector3(0, 1, 0);

const MIN_TURN_RADIANS = 1e-5;
const MIN_REACH = 1e-4;
const MIN_LOOK_DISTANCE = 1e-4;
const BEND_EPSILON = 1e-6;
const DEGENERATE_LENGTH_SQ = 1e-8;
const SPRING_REST_SQ = 1e-8;

const scratchDecomposedPosition = new Vector3();
const scratchDecomposedScale = new Vector3();
const scratchParentRotation = new Quaternion();
const scratchWorldRotation = new Quaternion();
const scratchTurn = new Quaternion();
const scratchTurnAxis = new Vector3();

const scratchRoot = new Vector3();
const scratchJoint = new Vector3();
const scratchTip = new Vector3();
const scratchGoal = new Vector3();
const scratchReach = new Vector3();
const scratchBend = new Vector3();
const scratchBent = new Vector3();
const scratchFrom = new Vector3();
const scratchTo = new Vector3();
const scratchSwing = new Quaternion();
const scratchEndRotation = new Quaternion();

const scratchKickAxis = new Vector3();
const scratchSpringAcceleration = new Vector3();

const scratchModelOrigin = new Vector3();
const scratchFootTarget = new Vector3();
const scratchPelvis = new Vector3();
const scratchDrift = new Vector3();

const scratchGripMatrix = new Matrix4();
const scratchGripPosition = new Vector3();
const scratchGripRotation = new Quaternion();
const scratchGripScale = new Vector3();

const scratchOwnHilt = new Vector3();
const scratchOwnTip = new Vector3();
const scratchOtherHilt = new Vector3();
const scratchOtherTip = new Vector3();
const scratchOwnPoint = new Vector3();
const scratchOtherPoint = new Vector3();
const scratchSegmentA = new Vector3();
const scratchSegmentB = new Vector3();
const scratchSegmentGap = new Vector3();
const scratchContactTarget = new Vector3();
const scratchContactRotation = new Quaternion();

const scratchBodyPosition = new Vector3();
const scratchBodyVelocity = new Vector3();
const scratchBodyAcceleration = new Vector3();
const scratchLeanTarget = new Vector3();
const scratchForward = new Vector3();
const scratchRight = new Vector3();
const scratchLook = new Vector3();
const scratchHeadPosition = new Vector3();
const scratchBoneTurn = new Vector3();

interface ILimb {
    readonly upper: Object3D;
    readonly lower: Object3D;
    readonly end: Object3D;
    readonly bend: Vector3;
}

function limbNamed(model: Object3D, names: readonly [string, string, string]): ILimb | null {
    const [upper, lower, end] = names.map((name) => model.getObjectByName(name));
    return upper && lower && end ? { upper, lower, end, bend: new Vector3() } : null;
}

function limbsNamed(
    model: Object3D,
    names: Record<Handedness, readonly [string, string, string]>
): Record<Handedness, ILimb> | null {
    const left = limbNamed(model, names.left);
    const right = limbNamed(model, names.right);
    return left && right ? { left, right } : null;
}

function depthOf(bone: Object3D): number {
    let depth = 0;
    for (let parent = bone.parent; parent; parent = parent.parent) depth++;
    return depth;
}

function worldPositionOf(object: Object3D, out: Vector3): Vector3 {
    return out.setFromMatrixPosition(object.matrixWorld);
}

function worldRotationOf(object: Object3D, out: Quaternion): Quaternion {
    object.matrixWorld.decompose(scratchDecomposedPosition, out, scratchDecomposedScale);
    return out;
}

function setWorldRotation(bone: Object3D, world: Quaternion): void {
    if (bone.parent) worldRotationOf(bone.parent, scratchParentRotation).invert();
    else scratchParentRotation.identity();
    bone.quaternion.multiplyQuaternions(scratchParentRotation, world);
    bone.updateMatrixWorld(true);
}

function rotateInWorld(bone: Object3D, rotation: Quaternion): void {
    setWorldRotation(bone, worldRotationOf(bone, scratchWorldRotation).premultiply(rotation));
}

function applyWorldTurn(bone: Object3D, turn: Vector3): void {
    const angle = turn.length();
    if (angle < MIN_TURN_RADIANS) return;
    scratchTurn.setFromAxisAngle(scratchTurnAxis.copy(turn).divideScalar(angle), angle);
    rotateInWorld(bone, scratchTurn);
}

function solveTwoBone(limb: ILimb, target: Vector3, endRotation: Quaternion, weight: number): void {
    if (weight <= 0) return;
    const { upper, lower, end, bend } = limb;
    worldPositionOf(upper, scratchRoot);
    worldPositionOf(lower, scratchJoint);
    worldPositionOf(end, scratchTip);
    worldRotationOf(end, scratchEndRotation).slerp(endRotation, weight);
    scratchGoal.copy(scratchTip).lerp(target, weight);

    const upperLength = scratchJoint.distanceTo(scratchRoot);
    const lowerLength = scratchTip.distanceTo(scratchJoint);
    scratchReach.subVectors(scratchGoal, scratchRoot);
    const distance = clamp(
        scratchReach.length(),
        MIN_REACH,
        (upperLength + lowerLength) * PROCEDURAL.ik.reachLimit
    );
    scratchReach.normalize();

    scratchFrom.subVectors(scratchJoint, scratchRoot);
    scratchBend.subVectors(scratchTip, scratchRoot).cross(scratchFrom);
    scratchBend.addScaledVector(scratchReach, -scratchBend.dot(scratchReach));
    if (scratchBend.lengthSq() > BEND_EPSILON) bend.copy(scratchBend).normalize();
    else if (bend.lengthSq() > BEND_EPSILON) scratchBend.copy(bend);
    else scratchBend.crossVectors(scratchReach, UP);
    scratchBend.addScaledVector(scratchReach, -scratchBend.dot(scratchReach)).normalize();
    const elbowCosine = clamp(
        (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
            (2 * upperLength * distance),
        -1,
        1
    );
    scratchBent.copy(scratchReach).applyAxisAngle(scratchBend, Math.acos(elbowCosine));

    scratchFrom.normalize();
    scratchSwing.setFromUnitVectors(scratchFrom, scratchBent);
    rotateInWorld(upper, scratchSwing);

    worldPositionOf(lower, scratchJoint);
    worldPositionOf(end, scratchTip);
    scratchFrom.subVectors(scratchTip, scratchJoint).normalize();
    scratchTo
        .copy(scratchRoot)
        .addScaledVector(scratchReach, distance)
        .sub(scratchJoint)
        .normalize();
    scratchSwing.setFromUnitVectors(scratchFrom, scratchTo);
    rotateInWorld(lower, scratchSwing);

    setWorldRotation(end, scratchEndRotation);
}

function closestPointsBetweenSegments(
    startA: Vector3,
    endA: Vector3,
    startB: Vector3,
    endB: Vector3,
    outA: Vector3,
    outB: Vector3
): void {
    scratchSegmentA.subVectors(endA, startA);
    scratchSegmentB.subVectors(endB, startB);
    scratchSegmentGap.subVectors(startA, startB);
    const lengthA = scratchSegmentA.dot(scratchSegmentA);
    const lengthB = scratchSegmentB.dot(scratchSegmentB);
    const gapAlongB = scratchSegmentB.dot(scratchSegmentGap);
    let alongA = 0;
    let alongB = 0;
    if (lengthA <= DEGENERATE_LENGTH_SQ && lengthB > DEGENERATE_LENGTH_SQ) {
        alongB = clamp(gapAlongB / lengthB, 0, 1);
    } else if (lengthA > DEGENERATE_LENGTH_SQ) {
        const gapAlongA = scratchSegmentA.dot(scratchSegmentGap);
        if (lengthB <= DEGENERATE_LENGTH_SQ) {
            alongA = clamp(-gapAlongA / lengthA, 0, 1);
        } else {
            const cross = scratchSegmentA.dot(scratchSegmentB);
            const denominator = lengthA * lengthB - cross * cross;
            alongA =
                denominator > DEGENERATE_LENGTH_SQ
                    ? clamp((cross * gapAlongB - gapAlongA * lengthB) / denominator, 0, 1)
                    : 0;
            alongB = (cross * alongA + gapAlongB) / lengthB;
            if (alongB < 0) {
                alongB = 0;
                alongA = clamp(-gapAlongA / lengthA, 0, 1);
            } else if (alongB > 1) {
                alongB = 1;
                alongA = clamp((cross - gapAlongA) / lengthA, 0, 1);
            }
        }
    }
    outA.copy(startA).addScaledVector(scratchSegmentA, alongA);
    outB.copy(startB).addScaledVector(scratchSegmentB, alongB);
}

abstract class ProceduralLayer {
    abstract readonly minimumDetail: ProceduralDetail;
    abstract apply(frame: IProceduralFrame): void;

    reset(): void {}

    captureAnimatedPose(_frame: IProceduralFrame): void {}
}

interface IJointSpring {
    bone: Object3D;
    rotationVector: Vector3;
    velocity: Vector3;
    stiffness: number;
    damping: number;
}

interface IPendingKick {
    spring: IJointSpring;
    delaySeconds: number;
    kick: Vector3;
    stiffness: number;
    damping: number;
}

class ImpactSpringLayer extends ProceduralLayer {
    readonly minimumDetail = "impact";
    private readonly springsByBone = new Map<string, IJointSpring>();
    private readonly springsRootFirst: IJointSpring[];
    private readonly pendingKicks: IPendingKick[] = [];

    constructor(model: Object3D) {
        super();
        const boneNames = new Set(
            Object.values(PROCEDURAL.impacts).flatMap((profile) =>
                profile.chain.map((link) => link.bone)
            )
        );
        for (const name of boneNames) {
            const bone = model.getObjectByName(name);
            if (!bone) continue;
            this.springsByBone.set(name, {
                bone,
                rotationVector: new Vector3(),
                velocity: new Vector3(),
                stiffness: 0,
                damping: 0,
            });
        }
        this.springsRootFirst = [...this.springsByBone.values()].sort(
            (first, second) => depthOf(first.bone) - depthOf(second.bone)
        );
    }

    reset(): void {
        this.pendingKicks.length = 0;
        for (const spring of this.springsRootFirst) {
            spring.rotationVector.set(0, 0, 0);
            spring.velocity.set(0, 0, 0);
        }
    }

    kick(push: Vector3, profileName: ImpactProfileName): void {
        const profile = PROCEDURAL.impacts[profileName];
        scratchKickAxis.crossVectors(UP, push);
        if (scratchKickAxis.lengthSq() < DEGENERATE_LENGTH_SQ) return;
        scratchKickAxis.normalize();
        for (const [index, link] of profile.chain.entries()) {
            const spring = this.springsByBone.get(link.bone);
            if (!spring) continue;
            this.pendingKicks.push({
                spring,
                delaySeconds: index * PROCEDURAL.springs.linkDelaySeconds,
                kick: scratchKickAxis.clone().multiplyScalar(profile.strength * link.gain),
                stiffness: profile.stiffness,
                damping: profile.damping,
            });
        }
    }

    apply(frame: IProceduralFrame): void {
        this.releaseDueKicks(frame.deltaSeconds);
        const { maxStepSeconds, maxSubsteps, maxRadians } = PROCEDURAL.springs;
        for (const spring of this.springsRootFirst) {
            let remaining = Math.min(frame.deltaSeconds, maxStepSeconds * maxSubsteps);
            while (remaining > 0) {
                const step = Math.min(remaining, maxStepSeconds);
                scratchSpringAcceleration
                    .copy(spring.rotationVector)
                    .multiplyScalar(-spring.stiffness)
                    .addScaledVector(spring.velocity, -spring.damping);
                spring.velocity.addScaledVector(scratchSpringAcceleration, step);
                spring.rotationVector.addScaledVector(spring.velocity, step);
                spring.rotationVector.clampLength(0, maxRadians);
                remaining -= step;
            }
            const isAtRest =
                spring.rotationVector.lengthSq() < SPRING_REST_SQ &&
                spring.velocity.lengthSq() < SPRING_REST_SQ;
            if (isAtRest) {
                spring.rotationVector.set(0, 0, 0);
                spring.velocity.set(0, 0, 0);
                continue;
            }
            applyWorldTurn(spring.bone, spring.rotationVector);
        }
    }

    private releaseDueKicks(deltaSeconds: number): void {
        for (let index = this.pendingKicks.length - 1; index >= 0; index--) {
            const pending = this.pendingKicks[index];
            pending.delaySeconds -= deltaSeconds;
            if (pending.delaySeconds > 0) continue;
            pending.spring.velocity.add(pending.kick);
            pending.spring.stiffness = pending.stiffness;
            pending.spring.damping = pending.damping;
            this.pendingKicks.splice(index, 1);
        }
    }
}

interface ITorsoBone {
    bone: Object3D;
    leanShare: number;
    breathPitchShare: number;
    breathRollShare: number;
}

interface ILookBone {
    bone: Object3D;
    share: number;
}

class AmbientLayer extends ProceduralLayer {
    readonly minimumDetail = "full";
    private readonly body: Object3D;
    private readonly torso: ITorsoBone[];
    private readonly lookBones: ILookBone[];
    private readonly head: Object3D | null;
    private readonly previousPosition = new Vector3();
    private readonly previousVelocity = new Vector3();
    private readonly lean = new Vector3();
    private hasPreviousPosition = false;
    private hasPreviousVelocity = false;
    private breathPhase = 0;
    private lookYaw = 0;
    private lookPitch = 0;

    constructor(model: Object3D, body: Object3D) {
        super();
        const settings = PROCEDURAL.ambient;
        this.body = body;
        const torsoByName = new Map<string, Omit<ITorsoBone, "bone">>();
        const torsoEntry = (name: string) => {
            const entry = torsoByName.get(name) ?? {
                leanShare: 0,
                breathPitchShare: 0,
                breathRollShare: 0,
            };
            torsoByName.set(name, entry);
            return entry;
        };
        for (const [name, share] of settings.leanShares) torsoEntry(name).leanShare = share;
        torsoEntry(SKELETON_BONES.chest).breathPitchShare = 1;
        torsoEntry(SKELETON_BONES.clavicles.left).breathRollShare = settings.clavicleBreathShare;
        torsoEntry(SKELETON_BONES.clavicles.right).breathRollShare = -settings.clavicleBreathShare;
        this.torso = [...torsoByName].flatMap(([name, shares]) => {
            const bone = model.getObjectByName(name);
            return bone ? [{ bone, ...shares }] : [];
        });
        this.lookBones = (
            [
                [SKELETON_BONES.neck, settings.neckShare],
                [SKELETON_BONES.head, settings.headShare],
            ] as const
        ).flatMap(([name, share]) => {
            const bone = model.getObjectByName(name);
            return bone ? [{ bone, share }] : [];
        });
        this.head = model.getObjectByName(SKELETON_BONES.head) ?? null;
    }

    reset(): void {
        this.hasPreviousPosition = false;
        this.hasPreviousVelocity = false;
        this.lean.set(0, 0, 0);
        this.lookYaw = 0;
        this.lookPitch = 0;
    }

    apply(frame: IProceduralFrame): void {
        const settings = PROCEDURAL.ambient;
        const step = frame.deltaSeconds;
        const yaw = this.body.rotation.y;
        scratchForward.set(Math.sin(yaw), 0, Math.cos(yaw));
        scratchRight.crossVectors(scratchForward, UP);

        if (step > 0) {
            this.trackLean(step);
            this.breathPhase =
                (this.breathPhase + step * settings.breathHz * Math.PI * 2) % (Math.PI * 2);
        }
        const breath = Math.sin(this.breathPhase) * settings.breathRadians;
        for (const { bone, leanShare, breathPitchShare, breathRollShare } of this.torso) {
            scratchBoneTurn
                .copy(this.lean)
                .multiplyScalar(leanShare)
                .addScaledVector(scratchRight, breath * breathPitchShare)
                .addScaledVector(scratchForward, breath * breathRollShare);
            applyWorldTurn(bone, scratchBoneTurn);
        }

        this.trackLook(frame.lookTarget, step);
        for (const { bone, share } of this.lookBones) {
            scratchBoneTurn
                .copy(UP)
                .multiplyScalar(this.lookYaw * share)
                .addScaledVector(scratchRight, this.lookPitch * share);
            applyWorldTurn(bone, scratchBoneTurn);
        }
    }

    private trackLean(step: number): void {
        const settings = PROCEDURAL.ambient;
        worldPositionOf(this.body, scratchBodyPosition);
        scratchLeanTarget.set(0, 0, 0);
        if (this.hasPreviousPosition) {
            scratchBodyVelocity
                .subVectors(scratchBodyPosition, this.previousPosition)
                .divideScalar(step);
            if (this.hasPreviousVelocity) {
                scratchBodyAcceleration
                    .subVectors(scratchBodyVelocity, this.previousVelocity)
                    .divideScalar(step)
                    .setY(0);
                scratchLeanTarget
                    .crossVectors(UP, scratchBodyAcceleration)
                    .multiplyScalar(settings.leanGain)
                    .clampLength(0, settings.leanMaxRadians);
            }
            this.previousVelocity.copy(scratchBodyVelocity);
            this.hasPreviousVelocity = true;
        }
        this.previousPosition.copy(scratchBodyPosition);
        this.hasPreviousPosition = true;
        this.lean.lerp(scratchLeanTarget, 1 - Math.exp(-settings.leanResponse * step));
    }

    private trackLook(lookTarget: Vector3 | null, step: number): void {
        const settings = PROCEDURAL.ambient;
        let targetYaw = 0;
        let targetPitch = 0;
        if (lookTarget && this.head) {
            worldPositionOf(this.head, scratchHeadPosition);
            scratchLook.subVectors(lookTarget, scratchHeadPosition);
            const horizontal = Math.hypot(scratchLook.x, scratchLook.z);
            if (horizontal > MIN_LOOK_DISTANCE) {
                const sideways =
                    scratchForward.z * scratchLook.x - scratchForward.x * scratchLook.z;
                const ahead = scratchForward.x * scratchLook.x + scratchForward.z * scratchLook.z;
                targetYaw = clamp(
                    Math.atan2(sideways, ahead),
                    -settings.lookMaxYaw,
                    settings.lookMaxYaw
                );
                targetPitch = clamp(
                    Math.atan2(scratchLook.y, horizontal),
                    -settings.lookMaxPitch,
                    settings.lookMaxPitch
                );
            }
        }
        const follow = 1 - Math.exp(-settings.lookResponse * step);
        this.lookYaw += (targetYaw - this.lookYaw) * follow;
        this.lookPitch += (targetPitch - this.lookPitch) * follow;
    }
}

interface IFootState {
    limb: ILimb;
    restHeight: number;
    lowestAnimatedHeight: number;
    animatedPosition: Vector3;
    animatedRotation: Quaternion;
    plantedPosition: Vector3;
    isPlanted: boolean;
    plantWeight: number;
    heightCorrection: number;
}

class FootLayer extends ProceduralLayer {
    readonly minimumDetail = "impact";
    private readonly model: Object3D;
    private readonly probe: IGroundProbe;
    private readonly pelvis: Object3D;
    private readonly feet: IFootState[];

    private constructor(model: Object3D, probe: IGroundProbe, pelvis: Object3D, legs: ILimb[]) {
        super();
        this.model = model;
        this.probe = probe;
        this.pelvis = pelvis;
        model.updateWorldMatrix(true, true);
        const modelHeight = worldPositionOf(model, scratchModelOrigin).y;
        this.feet = legs.map((limb) => {
            const restHeight = worldPositionOf(limb.end, scratchFootTarget).y - modelHeight;
            return {
                limb,
                restHeight,
                lowestAnimatedHeight: restHeight,
                animatedPosition: new Vector3(),
                animatedRotation: new Quaternion(),
                plantedPosition: new Vector3(),
                isPlanted: false,
                plantWeight: 0,
                heightCorrection: 0,
            };
        });
    }

    static create(model: Object3D, probe: IGroundProbe): FootLayer | null {
        const pelvis = model.getObjectByName(SKELETON_BONES.pelvis);
        const legs = limbsNamed(model, SKELETON_BONES.legs);
        return pelvis && legs ? new FootLayer(model, probe, pelvis, [legs.left, legs.right]) : null;
    }

    reset(): void {
        for (const foot of this.feet) {
            foot.isPlanted = false;
            foot.plantWeight = 0;
            foot.heightCorrection = 0;
            foot.lowestAnimatedHeight = foot.restHeight;
        }
    }

    apply(frame: IProceduralFrame): void {
        if (!frame.grounded) {
            this.reset();
            return;
        }
        const settings = PROCEDURAL.feet;
        const step = frame.deltaSeconds;
        const modelHeight = worldPositionOf(this.model, scratchModelOrigin).y;
        const unplantBlend = 1 - Math.exp(-step / settings.blendSeconds);
        const correctionBlend = 1 - Math.exp(-step / settings.correctionSeconds);
        let pelvisDrop = 0;
        for (const foot of this.feet) {
            worldPositionOf(foot.limb.end, foot.animatedPosition);
            worldRotationOf(foot.limb.end, foot.animatedRotation);
            const height = foot.animatedPosition.y - modelHeight;
            foot.lowestAnimatedHeight = Math.min(
                foot.lowestAnimatedHeight + settings.floorRise * step,
                height
            );
            const ground = this.probe.groundHeightAt(
                foot.animatedPosition.x,
                foot.animatedPosition.z,
                modelHeight + settings.probeAbove
            );
            const targetCorrection = frame.plantFeet
                ? clamp(
                      (ground ?? modelHeight) -
                          modelHeight -
                          (foot.lowestAnimatedHeight - foot.restHeight),
                      -settings.maxPelvisDrop,
                      settings.maxRaise
                  )
                : 0;
            foot.heightCorrection += (targetCorrection - foot.heightCorrection) * correctionBlend;
            pelvisDrop = Math.min(pelvisDrop, foot.heightCorrection);

            const shouldPlant =
                frame.plantFeet && height - foot.lowestAnimatedHeight < settings.liftHeight;
            if (!shouldPlant) {
                foot.isPlanted = false;
            } else if (!foot.isPlanted) {
                foot.plantedPosition.copy(foot.animatedPosition);
                foot.isPlanted = true;
                foot.plantWeight = 1;
            }
            if (foot.isPlanted) {
                scratchDrift
                    .set(
                        foot.plantedPosition.x - foot.animatedPosition.x,
                        0,
                        foot.plantedPosition.z - foot.animatedPosition.z
                    )
                    .clampLength(0, settings.maxDrift);
                foot.plantedPosition.x = foot.animatedPosition.x + scratchDrift.x;
                foot.plantedPosition.z = foot.animatedPosition.z + scratchDrift.z;
            } else {
                foot.plantWeight -= foot.plantWeight * unplantBlend;
            }
        }
        this.lowerPelvis(pelvisDrop);
        for (const foot of this.feet) {
            const { animatedPosition, plantedPosition, plantWeight } = foot;
            scratchFootTarget.set(
                animatedPosition.x + (plantedPosition.x - animatedPosition.x) * plantWeight,
                animatedPosition.y + foot.heightCorrection,
                animatedPosition.z + (plantedPosition.z - animatedPosition.z) * plantWeight
            );
            solveTwoBone(foot.limb, scratchFootTarget, foot.animatedRotation, 1);
        }
    }

    private lowerPelvis(drop: number): void {
        const parent = this.pelvis.parent;
        if (drop >= 0 || !parent) return;
        worldPositionOf(this.pelvis, scratchPelvis).y += drop;
        this.pelvis.position.copy(parent.worldToLocal(scratchPelvis));
        this.pelvis.updateMatrixWorld(true);
    }
}

interface IBladeContact {
    own: IBladeSource;
    other: IBladeSource;
    arm: ILimb;
    maxCorrection: number;
    elapsedSeconds: number;
}

class BladeContactLayer extends ProceduralLayer {
    readonly minimumDetail = "full";
    private readonly arms: Record<Handedness, ILimb>;
    private contact: IBladeContact | null = null;

    private constructor(arms: Record<Handedness, ILimb>) {
        super();
        this.arms = arms;
    }

    static create(model: Object3D): BladeContactLayer | null {
        const arms = limbsNamed(model, SKELETON_BONES.arms);
        return arms ? new BladeContactLayer(arms) : null;
    }

    reset(): void {
        this.contact = null;
    }

    begin(own: IBladeSource, other: IBladeSource, hand: Handedness, maxCorrection: number): void {
        this.contact = { own, other, arm: this.arms[hand], maxCorrection, elapsedSeconds: 0 };
    }

    apply(frame: IProceduralFrame): void {
        const contact = this.contact;
        if (!contact) return;
        const duration = PROCEDURAL.bladeContact.seconds;
        contact.elapsedSeconds += frame.deltaSeconds;
        if (contact.elapsedSeconds >= duration) {
            this.contact = null;
            return;
        }
        const hasBothBlades =
            contact.own.bladeSegment(scratchOwnHilt, scratchOwnTip) &&
            contact.other.bladeSegment(scratchOtherHilt, scratchOtherTip);
        if (!hasBothBlades) return;
        closestPointsBetweenSegments(
            scratchOwnHilt,
            scratchOwnTip,
            scratchOtherHilt,
            scratchOtherTip,
            scratchOwnPoint,
            scratchOtherPoint
        );
        const correction = scratchOtherPoint
            .sub(scratchOwnPoint)
            .clampLength(0, contact.maxCorrection);
        const progress = contact.elapsedSeconds / duration;
        const fade = 1 - progress * progress;
        const hand = contact.arm.end;
        worldPositionOf(hand, scratchContactTarget).addScaledVector(correction, fade);
        solveTwoBone(
            contact.arm,
            scratchContactTarget,
            worldRotationOf(hand, scratchContactRotation),
            1
        );
    }
}

class GripLayer extends ProceduralLayer {
    readonly minimumDetail = "full";
    private readonly arms: Record<Handedness, ILimb>;
    private readonly clipOffHandOffset = new Matrix4();
    private weaponHand: Handedness = "right";

    private constructor(arms: Record<Handedness, ILimb>) {
        super();
        this.arms = arms;
    }

    static create(model: Object3D): GripLayer | null {
        const arms = limbsNamed(model, SKELETON_BONES.arms);
        return arms ? new GripLayer(arms) : null;
    }

    captureAnimatedPose(frame: IProceduralFrame): void {
        if (frame.gripWeight <= 0) return;
        this.weaponHand = frame.weaponHand;
        const swordHand = this.arms[this.weaponHand].end;
        const offHand = this.arms[OTHER_HAND[this.weaponHand]].end;
        this.clipOffHandOffset.copy(swordHand.matrixWorld).invert().multiply(offHand.matrixWorld);
    }

    apply(frame: IProceduralFrame): void {
        if (frame.gripWeight <= 0) return;
        const swordHand = this.arms[this.weaponHand].end;
        scratchGripMatrix
            .multiplyMatrices(swordHand.matrixWorld, this.clipOffHandOffset)
            .decompose(scratchGripPosition, scratchGripRotation, scratchGripScale);
        solveTwoBone(
            this.arms[OTHER_HAND[this.weaponHand]],
            scratchGripPosition,
            scratchGripRotation,
            frame.gripWeight
        );
    }
}

export class ProceduralRig {
    private readonly model: Object3D;
    private readonly pelvis: Object3D | null;
    private readonly impactSprings: ImpactSpringLayer;
    private readonly bladeContact: BladeContactLayer | null;
    private readonly layers: ProceduralLayer[];
    private readonly activeLayers: ProceduralLayer[] = [];
    private readonly bones: Bone[] = [];
    private readonly animatedRotations: Quaternion[] = [];
    private readonly animatedPelvisPosition = new Vector3();
    private isPoseModified = false;
    private previousRank = DETAIL_RANK.none;

    constructor(model: Object3D, body: Object3D, probe: IGroundProbe) {
        this.model = model;
        model.traverse((object) => {
            if (!(object instanceof Bone)) return;
            this.bones.push(object);
            this.animatedRotations.push(new Quaternion());
        });
        this.pelvis = model.getObjectByName(SKELETON_BONES.pelvis) ?? null;
        this.impactSprings = new ImpactSpringLayer(model);
        this.bladeContact = BladeContactLayer.create(model);
        const layers: (ProceduralLayer | null)[] = [
            this.impactSprings,
            new AmbientLayer(model, body),
            FootLayer.create(model, probe),
            this.bladeContact,
            GripLayer.create(model),
        ];
        this.layers = layers.filter((layer): layer is ProceduralLayer => layer !== null);
    }

    impact(push: Vector3, profile: ImpactProfileName): void {
        this.impactSprings.kick(push, profile);
    }

    beginBladeContact(
        own: IBladeSource,
        other: IBladeSource,
        hand: Handedness,
        maxCorrection: number
    ): void {
        this.bladeContact?.begin(own, other, hand, maxCorrection);
    }

    restore(): void {
        if (!this.isPoseModified) return;
        for (let index = 0; index < this.bones.length; index++)
            this.bones[index].quaternion.copy(this.animatedRotations[index]);
        if (this.pelvis) this.pelvis.position.copy(this.animatedPelvisPosition);
        this.isPoseModified = false;
    }

    update(frame: IProceduralFrame): void {
        const rank = DETAIL_RANK[frame.detail];
        const previousRank = this.previousRank;
        this.previousRank = rank;
        if (rank === DETAIL_RANK.none) return;

        for (let index = 0; index < this.bones.length; index++)
            this.animatedRotations[index].copy(this.bones[index].quaternion);
        if (this.pelvis) this.animatedPelvisPosition.copy(this.pelvis.position);
        this.isPoseModified = true;
        this.model.updateWorldMatrix(true, true);

        this.activeLayers.length = 0;
        for (const layer of this.layers) {
            const minimumRank = DETAIL_RANK[layer.minimumDetail];
            if (rank < minimumRank) continue;
            if (previousRank < minimumRank) layer.reset();
            layer.captureAnimatedPose(frame);
            this.activeLayers.push(layer);
        }
        for (const layer of this.activeLayers) layer.apply(frame);
    }
}
