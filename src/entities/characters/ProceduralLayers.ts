import { Line3, Matrix4, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import {
    OTHER_HAND,
    PROCEDURAL_ANIMATION,
    PROCEDURAL_EPSILON,
    SKELETON_BONES,
} from "@/constants/characters";
import type { ImpactProfileName } from "@/constants/characters";
import { BoneMath } from "@/lib/boneMath";
import {
    clamp,
    lerp,
    FULL_TURN,
    smoothingFactor,
    forwardFromYaw,
    horizontalLength,
} from "@/lib/helpers";
import type {
    IBladeSource,
    IGroundProbe,
    ILimb,
    IProceduralFrame,
    ProceduralDetail,
} from "@/types/characters";
import type { Handedness } from "@/types/combat";

interface IJointSpring {
    bone: Object3D;
    rotationVector: Vector3;
    velocity: Vector3;
    stiffness: number;
    damping: number;
}

interface IDelayedImpulse {
    spring: IJointSpring;
    delaySeconds: number;
    impulse: Vector3;
    stiffness: number;
    damping: number;
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

interface IBladeContact {
    own: IBladeSource;
    other: IBladeSource;
    arm: ILimb;
    maxCorrection: number;
    elapsedSeconds: number;
}

export abstract class ProceduralLayer {
    abstract readonly minimumDetail: ProceduralDetail;
    abstract apply(frame: IProceduralFrame): void;

    reset(): void {}

    captureAnimatedPose(_frame: IProceduralFrame): void {}
}

abstract class ArmIkLayer extends ProceduralLayer {
    constructor(protected readonly arms: Record<Handedness, ILimb>) {
        super();
    }
}

export class ImpactSpringLayer extends ProceduralLayer {
    readonly minimumDetail = "impact";
    private static readonly scratch = { impulseAxis: new Vector3(), acceleration: new Vector3() };
    private readonly springsByBone = new Map<string, IJointSpring>();
    private readonly springsRootFirst: IJointSpring[];
    private readonly delayedImpulses: IDelayedImpulse[] = [];
    private areSpringsAtRest = true;

    constructor(model: Object3D) {
        super();
        const boneNames = new Set(
            Object.values(PROCEDURAL_ANIMATION.impacts).flatMap((profile) =>
                profile.chain.map((link) => link.bone)
            )
        );
        for (const bone of BoneMath.findBones(model, [...boneNames])) {
            this.springsByBone.set(bone.name, {
                bone,
                rotationVector: new Vector3(),
                velocity: new Vector3(),
                stiffness: 0,
                damping: 0,
            });
        }
        this.springsRootFirst = [...this.springsByBone.values()].sort(
            (first, second) =>
                BoneMath.hierarchyDepth(first.bone) - BoneMath.hierarchyDepth(second.bone)
        );
    }

    reset(): void {
        this.delayedImpulses.length = 0;
        for (const spring of this.springsRootFirst) {
            spring.rotationVector.set(0, 0, 0);
            spring.velocity.set(0, 0, 0);
        }
        this.areSpringsAtRest = true;
    }

    addImpulse(push: Vector3, profileName: ImpactProfileName): void {
        const profile = PROCEDURAL_ANIMATION.impacts[profileName];
        const { impulseAxis } = ImpactSpringLayer.scratch;
        impulseAxis.crossVectors(BoneMath.UP, push);
        if (impulseAxis.lengthSq() < PROCEDURAL_EPSILON.degenerateLengthSquared) return;
        impulseAxis.normalize();
        const chain = profile.chain;
        for (let index = 0; index < chain.length; index += 1) {
            const link = chain[index];
            const spring = this.springsByBone.get(link.bone);
            if (!spring) continue;
            this.delayedImpulses.push({
                spring,
                delaySeconds: index * PROCEDURAL_ANIMATION.springs.linkDelaySeconds,
                impulse: impulseAxis.clone().multiplyScalar(profile.strength * link.weight),
                stiffness: profile.stiffness,
                damping: profile.damping,
            });
        }
    }

    apply(frame: IProceduralFrame): void {
        const { acceleration } = ImpactSpringLayer.scratch;
        this.releaseDelayedImpulses(frame.deltaSeconds);
        if (this.areSpringsAtRest) return;

        const { maxStepSeconds, maxSubsteps, maxRadians } = PROCEDURAL_ANIMATION.springs;
        let areAllAtRest = true;
        for (const spring of this.springsRootFirst) {
            let remaining = Math.min(frame.deltaSeconds, maxStepSeconds * maxSubsteps);
            while (remaining > 0) {
                const step = Math.min(remaining, maxStepSeconds);
                acceleration
                    .copy(spring.rotationVector)
                    .multiplyScalar(-spring.stiffness)
                    .addScaledVector(spring.velocity, -spring.damping);
                spring.velocity.addScaledVector(acceleration, step);
                spring.rotationVector.addScaledVector(spring.velocity, step);
                spring.rotationVector.clampLength(0, maxRadians);
                remaining -= step;
            }
            const isAtRest =
                spring.rotationVector.lengthSq() < PROCEDURAL_EPSILON.springRestSquared &&
                spring.velocity.lengthSq() < PROCEDURAL_EPSILON.springRestSquared;
            if (isAtRest) {
                spring.rotationVector.set(0, 0, 0);
                spring.velocity.set(0, 0, 0);
                continue;
            }
            areAllAtRest = false;
            BoneMath.rotateByRotationVector(spring.bone, spring.rotationVector);
        }
        this.areSpringsAtRest = areAllAtRest;
    }

    private releaseDelayedImpulses(deltaSeconds: number): void {
        const delayedImpulses = this.delayedImpulses;
        for (let index = delayedImpulses.length - 1; index >= 0; index--) {
            const delayed = delayedImpulses[index];
            delayed.delaySeconds -= deltaSeconds;
            if (delayed.delaySeconds > 0) continue;
            delayed.spring.velocity.add(delayed.impulse);
            delayed.spring.stiffness = delayed.stiffness;
            delayed.spring.damping = delayed.damping;
            this.areSpringsAtRest = false;
            delayedImpulses.splice(index, 1);
        }
    }
}

export class BreathingAndLookLayer extends ProceduralLayer {
    readonly minimumDetail = "full";
    private static readonly scratch = {
        bodyPosition: new Vector3(),
        bodyVelocity: new Vector3(),
        bodyAcceleration: new Vector3(),
        leanTarget: new Vector3(),
        forward: new Vector3(),
        right: new Vector3(),
        look: new Vector3(),
        headPosition: new Vector3(),
        boneTurn: new Vector3(),
    };
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
        const settings = PROCEDURAL_ANIMATION.breathingAndLook;
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
        const { forward, right, boneTurn } = BreathingAndLookLayer.scratch;
        const settings = PROCEDURAL_ANIMATION.breathingAndLook;
        const step = frame.deltaSeconds;
        const yaw = this.body.rotation.y;
        forwardFromYaw(yaw, forward);
        right.crossVectors(forward, BoneMath.UP);

        if (step > 0) {
            this.trackLean(step);
            this.breathPhase =
                (this.breathPhase + step * settings.breathHz * FULL_TURN) % FULL_TURN;
        }
        const breath = Math.sin(this.breathPhase) * settings.breathRadians;
        for (const { bone, leanShare, breathPitchShare, breathRollShare } of this.torso) {
            boneTurn
                .copy(this.lean)
                .multiplyScalar(leanShare)
                .addScaledVector(right, breath * breathPitchShare)
                .addScaledVector(forward, breath * breathRollShare);
            BoneMath.rotateByRotationVector(bone, boneTurn);
        }

        this.trackLook(frame.lookTarget, step);
        for (const { bone, share } of this.lookBones) {
            boneTurn
                .copy(BoneMath.UP)
                .multiplyScalar(this.lookYaw * share)
                .addScaledVector(right, this.lookPitch * share);
            BoneMath.rotateByRotationVector(bone, boneTurn);
        }
    }

    private trackLean(step: number): void {
        const { bodyPosition, bodyVelocity, bodyAcceleration, leanTarget } =
            BreathingAndLookLayer.scratch;
        const settings = PROCEDURAL_ANIMATION.breathingAndLook;
        BoneMath.worldPosition(this.body, bodyPosition);
        leanTarget.set(0, 0, 0);
        if (this.hasPreviousPosition) {
            bodyVelocity.subVectors(bodyPosition, this.previousPosition).divideScalar(step);
            if (this.hasPreviousVelocity) {
                bodyAcceleration
                    .subVectors(bodyVelocity, this.previousVelocity)
                    .divideScalar(step)
                    .setY(0);
                leanTarget
                    .crossVectors(BoneMath.UP, bodyAcceleration)
                    .multiplyScalar(settings.leanGain)
                    .clampLength(0, settings.leanMaxRadians);
            }
            this.previousVelocity.copy(bodyVelocity);
            this.hasPreviousVelocity = true;
        }
        this.previousPosition.copy(bodyPosition);
        this.hasPreviousPosition = true;
        this.lean.lerp(leanTarget, smoothingFactor(settings.leanResponse, step));
    }

    private trackLook(lookTarget: Vector3 | null, step: number): void {
        const { forward, look, headPosition } = BreathingAndLookLayer.scratch;
        const settings = PROCEDURAL_ANIMATION.breathingAndLook;
        let targetYaw = 0;
        let targetPitch = 0;
        if (lookTarget && this.head) {
            BoneMath.worldPosition(this.head, headPosition);
            look.subVectors(lookTarget, headPosition);
            const horizontal = horizontalLength(look);
            if (horizontal > PROCEDURAL_EPSILON.lookDistance) {
                const sideways = forward.z * look.x - forward.x * look.z;
                const ahead = forward.x * look.x + forward.z * look.z;
                targetYaw = clamp(
                    Math.atan2(sideways, ahead),
                    -settings.lookMaxYaw,
                    settings.lookMaxYaw
                );
                targetPitch = clamp(
                    Math.atan2(look.y, horizontal),
                    -settings.lookMaxPitch,
                    settings.lookMaxPitch
                );
            }
        }
        const follow = smoothingFactor(settings.lookResponse, step);
        this.lookYaw = lerp(this.lookYaw, targetYaw, follow);
        this.lookPitch = lerp(this.lookPitch, targetPitch, follow);
    }
}

export class FootPlantingLayer extends ProceduralLayer {
    readonly minimumDetail = "impact";
    private static readonly scratch = {
        modelOrigin: new Vector3(),
        footTarget: new Vector3(),
        pelvis: new Vector3(),
        drift: new Vector3(),
    };
    private readonly model: Object3D;
    private readonly probe: IGroundProbe;
    private readonly pelvis: Object3D;
    private readonly feet: IFootState[];

    private constructor(model: Object3D, probe: IGroundProbe, pelvis: Object3D, legs: ILimb[]) {
        super();
        const { modelOrigin, footTarget } = FootPlantingLayer.scratch;
        this.model = model;
        this.probe = probe;
        this.pelvis = pelvis;
        model.updateWorldMatrix(true, true);
        const modelHeight = BoneMath.worldPosition(model, modelOrigin).y;
        this.feet = legs.map((limb) => {
            const restHeight = BoneMath.worldPosition(limb.end, footTarget).y - modelHeight;
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

    static create(model: Object3D, probe: IGroundProbe): FootPlantingLayer | null {
        const pelvis = model.getObjectByName(SKELETON_BONES.pelvis);
        const legs = BoneMath.findLimbs(model, SKELETON_BONES.legs);
        return pelvis && legs
            ? new FootPlantingLayer(model, probe, pelvis, [legs.left, legs.right])
            : null;
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
        const { modelOrigin, footTarget, drift } = FootPlantingLayer.scratch;
        const settings = PROCEDURAL_ANIMATION.feet;
        const step = frame.deltaSeconds;
        const modelHeight = BoneMath.worldPosition(this.model, modelOrigin).y;
        const unplantBlend = smoothingFactor(step / settings.blendSeconds);
        const correctionBlend = smoothingFactor(step / settings.correctionSeconds);
        let pelvisDrop = 0;
        for (const foot of this.feet) {
            BoneMath.worldPosition(foot.limb.end, foot.animatedPosition);
            BoneMath.worldRotation(foot.limb.end, foot.animatedRotation);
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
            foot.heightCorrection = lerp(foot.heightCorrection, targetCorrection, correctionBlend);
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
                drift
                    .set(
                        foot.plantedPosition.x - foot.animatedPosition.x,
                        0,
                        foot.plantedPosition.z - foot.animatedPosition.z
                    )
                    .clampLength(0, settings.maxDrift);
                foot.plantedPosition.x = foot.animatedPosition.x + drift.x;
                foot.plantedPosition.z = foot.animatedPosition.z + drift.z;
            } else {
                foot.plantWeight -= foot.plantWeight * unplantBlend;
            }
        }
        this.lowerPelvis(pelvisDrop);
        for (const foot of this.feet) {
            const { animatedPosition, plantedPosition, plantWeight } = foot;
            footTarget
                .lerpVectors(animatedPosition, plantedPosition, plantWeight)
                .setY(animatedPosition.y + foot.heightCorrection);
            BoneMath.solveLimbIk(foot.limb, footTarget, foot.animatedRotation, 1);
        }
    }

    private lowerPelvis(drop: number): void {
        const parent = this.pelvis.parent;
        if (drop >= 0 || !parent) return;
        const { pelvis } = FootPlantingLayer.scratch;
        BoneMath.worldPosition(this.pelvis, pelvis).y += drop;
        this.pelvis.position.copy(parent.worldToLocal(pelvis));
        this.pelvis.updateMatrixWorld(true);
    }
}

export class BladeContactLayer extends ArmIkLayer {
    readonly minimumDetail = "full";
    private static readonly scratch = {
        ownHilt: new Vector3(),
        ownTip: new Vector3(),
        otherHilt: new Vector3(),
        otherTip: new Vector3(),
        ownPoint: new Vector3(),
        otherPoint: new Vector3(),
        bladeLine: new Line3(),
        otherBladeLine: new Line3(),
        contactTarget: new Vector3(),
        contactRotation: new Quaternion(),
    };
    private contact: IBladeContact | null = null;

    reset(): void {
        this.contact = null;
    }

    begin(own: IBladeSource, other: IBladeSource, hand: Handedness, maxCorrection: number): void {
        this.contact = { own, other, arm: this.arms[hand], maxCorrection, elapsedSeconds: 0 };
    }

    apply(frame: IProceduralFrame): void {
        const contact = this.contact;
        if (!contact) return;
        const {
            ownHilt,
            ownTip,
            otherHilt,
            otherTip,
            ownPoint,
            otherPoint,
            bladeLine,
            otherBladeLine,
            contactTarget,
            contactRotation,
        } = BladeContactLayer.scratch;
        const duration = PROCEDURAL_ANIMATION.bladeContact.seconds;
        contact.elapsedSeconds += frame.deltaSeconds;
        if (contact.elapsedSeconds >= duration) {
            this.contact = null;
            return;
        }
        const hasBothBlades =
            contact.own.getBladeSegment(ownHilt, ownTip) &&
            contact.other.getBladeSegment(otherHilt, otherTip);
        if (!hasBothBlades) return;
        bladeLine
            .set(ownHilt, ownTip)
            .distanceSqToLine3(otherBladeLine.set(otherHilt, otherTip), ownPoint, otherPoint);
        const correction = otherPoint.sub(ownPoint).clampLength(0, contact.maxCorrection);
        const progress = contact.elapsedSeconds / duration;
        const fade = 1 - progress * progress;
        const hand = contact.arm.end;
        BoneMath.worldPosition(hand, contactTarget).addScaledVector(correction, fade);
        BoneMath.solveLimbIk(
            contact.arm,
            contactTarget,
            BoneMath.worldRotation(hand, contactRotation),
            1
        );
    }
}

export class OffHandGripLayer extends ArmIkLayer {
    readonly minimumDetail = "full";
    private static readonly scratch = {
        matrix: new Matrix4(),
        position: new Vector3(),
        rotation: new Quaternion(),
        scale: new Vector3(),
    };
    private readonly clipOffHandOffset = new Matrix4();
    private weaponHand: Handedness = "right";

    captureAnimatedPose(frame: IProceduralFrame): void {
        if (frame.twoHandGripWeight <= 0) return;
        this.weaponHand = frame.weaponHand;
        const weaponHandBone = this.arms[this.weaponHand].end;
        const offHand = this.arms[OTHER_HAND[this.weaponHand]].end;
        this.clipOffHandOffset
            .copy(weaponHandBone.matrixWorld)
            .invert()
            .multiply(offHand.matrixWorld);
    }

    apply(frame: IProceduralFrame): void {
        if (frame.twoHandGripWeight <= 0) return;
        const { matrix, position, rotation, scale } = OffHandGripLayer.scratch;
        const weaponHandBone = this.arms[this.weaponHand].end;
        matrix
            .multiplyMatrices(weaponHandBone.matrixWorld, this.clipOffHandOffset)
            .decompose(position, rotation, scale);
        BoneMath.solveLimbIk(
            this.arms[OTHER_HAND[this.weaponHand]],
            position,
            rotation,
            frame.twoHandGripWeight
        );
    }
}
