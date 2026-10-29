import { Matrix4, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { OTHER_HAND, PROCEDURAL, PROCEDURAL_EPSILON, SKELETON_BONES } from "@/constants/characters";
import type { ImpactProfileName } from "@/constants/characters";
import { BoneMath } from "@/lib/boneMath";
import { clamp, FULL_TURN } from "@/lib/helpers";
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

interface IPendingKick {
    spring: IJointSpring;
    delaySeconds: number;
    kick: Vector3;
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

abstract class ArmLayer extends ProceduralLayer {
    constructor(protected readonly arms: Record<Handedness, ILimb>) {
        super();
    }

    static create<Layer extends ArmLayer>(
        this: new (arms: Record<Handedness, ILimb>) => Layer,
        model: Object3D
    ): Layer | null {
        const arms = BoneMath.findLimbs(model, SKELETON_BONES.arms);
        return arms ? new this(arms) : null;
    }
}

export class ImpactSpringLayer extends ProceduralLayer {
    readonly minimumDetail = "impact";
    private static readonly scratch = { kickAxis: new Vector3(), acceleration: new Vector3() };
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
            (first, second) => BoneMath.depthOf(first.bone) - BoneMath.depthOf(second.bone)
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
        const { kickAxis } = ImpactSpringLayer.scratch;
        kickAxis.crossVectors(BoneMath.UP, push);
        if (kickAxis.lengthSq() < PROCEDURAL_EPSILON.degenerateLengthSquared) return;
        kickAxis.normalize();
        for (const [index, link] of profile.chain.entries()) {
            const spring = this.springsByBone.get(link.bone);
            if (!spring) continue;
            this.pendingKicks.push({
                spring,
                delaySeconds: index * PROCEDURAL.springs.linkDelaySeconds,
                kick: kickAxis.clone().multiplyScalar(profile.strength * link.gain),
                stiffness: profile.stiffness,
                damping: profile.damping,
            });
        }
    }

    apply(frame: IProceduralFrame): void {
        const { acceleration } = ImpactSpringLayer.scratch;
        this.releaseDueKicks(frame.deltaSeconds);
        const { maxStepSeconds, maxSubsteps, maxRadians } = PROCEDURAL.springs;
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
            BoneMath.applyWorldTurn(spring.bone, spring.rotationVector);
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

export class AmbientLayer extends ProceduralLayer {
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
        const { forward, right, boneTurn } = AmbientLayer.scratch;
        const settings = PROCEDURAL.ambient;
        const step = frame.deltaSeconds;
        const yaw = this.body.rotation.y;
        BoneMath.forwardFromYaw(yaw, forward);
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
            BoneMath.applyWorldTurn(bone, boneTurn);
        }

        this.trackLook(frame.lookTarget, step);
        for (const { bone, share } of this.lookBones) {
            boneTurn
                .copy(BoneMath.UP)
                .multiplyScalar(this.lookYaw * share)
                .addScaledVector(right, this.lookPitch * share);
            BoneMath.applyWorldTurn(bone, boneTurn);
        }
    }

    private trackLean(step: number): void {
        const { bodyPosition, bodyVelocity, bodyAcceleration, leanTarget } = AmbientLayer.scratch;
        const settings = PROCEDURAL.ambient;
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
        this.lean.lerp(leanTarget, 1 - Math.exp(-settings.leanResponse * step));
    }

    private trackLook(lookTarget: Vector3 | null, step: number): void {
        const { forward, look, headPosition } = AmbientLayer.scratch;
        const settings = PROCEDURAL.ambient;
        let targetYaw = 0;
        let targetPitch = 0;
        if (lookTarget && this.head) {
            BoneMath.worldPosition(this.head, headPosition);
            look.subVectors(lookTarget, headPosition);
            const horizontal = Math.hypot(look.x, look.z);
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
        const follow = 1 - Math.exp(-settings.lookResponse * step);
        this.lookYaw += (targetYaw - this.lookYaw) * follow;
        this.lookPitch += (targetPitch - this.lookPitch) * follow;
    }
}

export class FootLayer extends ProceduralLayer {
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
        const { modelOrigin, footTarget } = FootLayer.scratch;
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

    static create(model: Object3D, probe: IGroundProbe): FootLayer | null {
        const pelvis = model.getObjectByName(SKELETON_BONES.pelvis);
        const legs = BoneMath.findLimbs(model, SKELETON_BONES.legs);
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
        const { modelOrigin, footTarget, drift } = FootLayer.scratch;
        const settings = PROCEDURAL.feet;
        const step = frame.deltaSeconds;
        const modelHeight = BoneMath.worldPosition(this.model, modelOrigin).y;
        const unplantBlend = 1 - Math.exp(-step / settings.blendSeconds);
        const correctionBlend = 1 - Math.exp(-step / settings.correctionSeconds);
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
            footTarget.set(
                animatedPosition.x + (plantedPosition.x - animatedPosition.x) * plantWeight,
                animatedPosition.y + foot.heightCorrection,
                animatedPosition.z + (plantedPosition.z - animatedPosition.z) * plantWeight
            );
            BoneMath.solveTwoBone(foot.limb, footTarget, foot.animatedRotation, 1);
        }
    }

    private lowerPelvis(drop: number): void {
        const parent = this.pelvis.parent;
        if (drop >= 0 || !parent) return;
        const { pelvis } = FootLayer.scratch;
        BoneMath.worldPosition(this.pelvis, pelvis).y += drop;
        this.pelvis.position.copy(parent.worldToLocal(pelvis));
        this.pelvis.updateMatrixWorld(true);
    }
}

export class BladeContactLayer extends ArmLayer {
    readonly minimumDetail = "full";
    private static readonly scratch = {
        ownHilt: new Vector3(),
        ownTip: new Vector3(),
        otherHilt: new Vector3(),
        otherTip: new Vector3(),
        ownPoint: new Vector3(),
        otherPoint: new Vector3(),
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
            contactTarget,
            contactRotation,
        } = BladeContactLayer.scratch;
        const duration = PROCEDURAL.bladeContact.seconds;
        contact.elapsedSeconds += frame.deltaSeconds;
        if (contact.elapsedSeconds >= duration) {
            this.contact = null;
            return;
        }
        const hasBothBlades =
            contact.own.bladeSegment(ownHilt, ownTip) &&
            contact.other.bladeSegment(otherHilt, otherTip);
        if (!hasBothBlades) return;
        BoneMath.closestPointsBetweenSegments(
            ownHilt,
            ownTip,
            otherHilt,
            otherTip,
            ownPoint,
            otherPoint
        );
        const correction = otherPoint.sub(ownPoint).clampLength(0, contact.maxCorrection);
        const progress = contact.elapsedSeconds / duration;
        const fade = 1 - progress * progress;
        const hand = contact.arm.end;
        BoneMath.worldPosition(hand, contactTarget).addScaledVector(correction, fade);
        BoneMath.solveTwoBone(
            contact.arm,
            contactTarget,
            BoneMath.worldRotation(hand, contactRotation),
            1
        );
    }
}

export class GripLayer extends ArmLayer {
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
        if (frame.gripWeight <= 0) return;
        this.weaponHand = frame.weaponHand;
        const swordHand = this.arms[this.weaponHand].end;
        const offHand = this.arms[OTHER_HAND[this.weaponHand]].end;
        this.clipOffHandOffset.copy(swordHand.matrixWorld).invert().multiply(offHand.matrixWorld);
    }

    apply(frame: IProceduralFrame): void {
        if (frame.gripWeight <= 0) return;
        const { matrix, position, rotation, scale } = GripLayer.scratch;
        const swordHand = this.arms[this.weaponHand].end;
        matrix
            .multiplyMatrices(swordHand.matrixWorld, this.clipOffHandOffset)
            .decompose(position, rotation, scale);
        BoneMath.solveTwoBone(
            this.arms[OTHER_HAND[this.weaponHand]],
            position,
            rotation,
            frame.gripWeight
        );
    }
}
