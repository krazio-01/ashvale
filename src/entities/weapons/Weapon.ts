import { Box3, Euler, Group, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { BLADE_THICKNESS_SLICES, GRIP } from "@/constants/combat";
import { axisVector, degrees, measureBladeAxes } from "@/lib/helpers";
import type { Axis, IBladeAxes } from "@/lib/helpers";
import type { IStrikeSegment } from "@/types/combat";
import type { ICarryRig, IHandRig, IWeaponCarry, IWeaponSpec, WeaponMount } from "@/types/weapons";
import type { IModelTemplate } from "@/types/world";

interface IMountPose {
    bone: Object3D;
    position: Vector3;
    quaternion: Quaternion;
    scale: number;
}

interface IModelAxes extends IBladeAxes {
    bounds: Box3;
}

const scratchBoneScale = new Vector3();
const scratchVertex = new Vector3();
const knuckleCentre = new Vector3();
const fingerDirection = new Vector3();
const acrossPalm = new Vector3();
const palmSide = new Vector3();
const bladeInModel = new Vector3();
const widthInModel = new Vector3();
const alignedWidth = new Vector3();
const handleCentre = new Vector3();
const alignLength = new Quaternion();
const alignEdge = new Quaternion();
const edgeCross = new Vector3();
const carryEuler = new Euler();

function addMeshes(group: Group, template: IModelTemplate): Group {
    for (const part of template.parts) {
        const mesh = new Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        group.add(mesh);
    }
    return group;
}

function measureBladeHalfThickness(
    group: Group,
    lengthAxis: Axis,
    thicknessAxis: Axis,
    spanStart: number,
    spanEnd: number
): number {
    const low = Math.min(spanStart, spanEnd);
    const sliceLength = Math.max(Math.abs(spanEnd - spanStart), 1e-6) / BLADE_THICKNESS_SLICES;
    const lows = new Array<number>(BLADE_THICKNESS_SLICES).fill(Infinity);
    const highs = new Array<number>(BLADE_THICKNESS_SLICES).fill(-Infinity);
    group.updateWorldMatrix(false, true);
    group.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        for (let index = 0; index < positions.count; index++) {
            scratchVertex.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
            const slice = Math.floor((scratchVertex[lengthAxis] - low) / sliceLength);
            if (slice < 0 || slice >= BLADE_THICKNESS_SLICES) continue;
            lows[slice] = Math.min(lows[slice], scratchVertex[thicknessAxis]);
            highs[slice] = Math.max(highs[slice], scratchVertex[thicknessAxis]);
        }
    });
    const thicknesses = highs
        .map((high, slice) => high - lows[slice])
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (thicknesses.length === 0) throw new Error("no vertices inside the blade span, cannot measure thickness");
    return thicknesses[Math.floor(thicknesses.length / 2)] / 2;
}

function alignFrame(
    out: Quaternion,
    lengthFrom: Vector3,
    widthFrom: Vector3,
    lengthTo: Vector3,
    widthTo: Vector3,
    roll: number
): Quaternion {
    alignLength.setFromUnitVectors(lengthFrom, lengthTo);
    alignedWidth.copy(widthFrom).applyQuaternion(alignLength);
    const widthTurn = Math.atan2(
        edgeCross.crossVectors(alignedWidth, widthTo).dot(lengthTo),
        alignedWidth.dot(widthTo)
    );
    alignEdge.setFromAxisAngle(lengthTo, widthTurn + roll);
    return out.multiplyQuaternions(alignEdge, alignLength);
}

export abstract class Weapon<Spec extends IWeaponSpec = IWeaponSpec> {
    readonly model = new Group();
    readonly spec: Spec;

    protected readonly lengthAxis: Axis;
    protected readonly tipCoordinate: number;
    protected readonly pommelCoordinate: number;

    private readonly axes: IModelAxes;
    private readonly bladeSign: number;
    private readonly modelLength: number;
    private readonly halfThickness: number = 0;
    private readonly poses: Partial<Record<WeaponMount, IMountPose>> = {};
    private mountedOn: WeaponMount = "hand";

    protected constructor(
        template: IModelTemplate,
        spec: Spec,
        handRig: IHandRig,
        carryRig?: ICarryRig
    ) {
        this.spec = spec;
        addMeshes(this.model, template);

        const bounds = new Box3().setFromObject(this.model);
        this.axes = { bounds, ...measureBladeAxes(bounds) };
        const { size } = this.axes;
        this.lengthAxis = this.axes.lengthAxis;
        this.bladeSign = this.axes.bladeSign;
        const tipAtMaximum = this.bladeSign > 0;
        this.tipCoordinate = tipAtMaximum
            ? bounds.max[this.lengthAxis]
            : bounds.min[this.lengthAxis];
        this.pommelCoordinate = tipAtMaximum
            ? bounds.min[this.lengthAxis]
            : bounds.max[this.lengthAxis];
        this.modelLength = Math.max(size[this.lengthAxis], 1e-4);

        this.poses.hand = this.buildGripPose(handRig);
        if (spec.carry && carryRig) {
            this.poses.carry = this.buildCarryPose(spec.carry, carryRig.bone);
            this.halfThickness = measureBladeHalfThickness(
                this.model,
                this.lengthAxis,
                this.axes.thicknessAxis,
                this.coordinateAt(spec.guardFraction),
                this.tipCoordinate
            );
        }

        this.mount(this.poses.carry ? "carry" : "hand");
    }

    get mounted(): WeaponMount {
        return this.mountedOn;
    }

    get damage(): number {
        return this.spec.damage;
    }

    mount(target: WeaponMount): void {
        const pose = this.poses[target];
        if (!pose) throw new Error(`${this.spec.id} has no ${target} mount`);
        pose.bone.add(this.model);
        this.model.position.copy(pose.position);
        this.model.quaternion.copy(pose.quaternion);
        this.model.scale.setScalar(pose.scale);
        this.mountedOn = target;
    }

    abstract sampleStrike(segment: IStrikeSegment): boolean;

    worldCapsule(pommel: Vector3, tip: Vector3): number {
        this.model.updateWorldMatrix(true, false);
        pommel.set(0, 0, 0);
        pommel[this.lengthAxis] = this.pommelCoordinate;
        this.model.localToWorld(pommel);
        tip.set(0, 0, 0);
        tip[this.lengthAxis] = this.tipCoordinate;
        this.model.localToWorld(tip);
        return this.halfThickness * this.model.matrixWorld.getMaxScaleOnAxis();
    }

    bladeSegment(pommel: Vector3, tip: Vector3): boolean {
        if (this.mountedOn !== "hand") return false;
        this.worldCapsule(pommel, tip);
        return true;
    }

    update(_deltaSeconds: number, _isStriking: boolean): void {}

    dispose(): void {
        this.model.removeFromParent();
    }

    protected coordinateAt(fraction: number): number {
        return this.pommelCoordinate + (this.tipCoordinate - this.pommelCoordinate) * fraction;
    }

    private boneWorldScale(bone: Object3D): number {
        bone.updateWorldMatrix(true, false);
        return bone.getWorldScale(scratchBoneScale).x;
    }

    private handleOffset(quaternion: Quaternion, scale: number): Vector3 {
        handleCentre.set(0, 0, 0);
        handleCentre[this.lengthAxis] = this.coordinateAt(this.spec.handleCentreFraction);
        return handleCentre.multiplyScalar(scale).applyQuaternion(quaternion);
    }

    private buildGripPose(handRig: IHandRig): IMountPose {
        const pose: IMountPose = {
            bone: handRig.hand,
            position: new Vector3(),
            quaternion: new Quaternion(),
            scale: this.spec.worldLength / (this.modelLength * this.boneWorldScale(handRig.hand)),
        };

        const outerFinger = handRig.pinkyBase ?? handRig.ringBase;
        knuckleCentre
            .copy(handRig.indexBase.position)
            .add(handRig.middleBase.position)
            .add(handRig.ringBase.position);
        if (handRig.pinkyBase) knuckleCentre.add(handRig.pinkyBase.position);
        knuckleCentre.divideScalar(handRig.pinkyBase ? 4 : 3);
        fingerDirection.copy(handRig.middleBase.position).normalize();
        acrossPalm.subVectors(handRig.indexBase.position, outerFinger.position);
        acrossPalm.addScaledVector(fingerDirection, -acrossPalm.dot(fingerDirection)).normalize();
        palmSide.crossVectors(fingerDirection, acrossPalm);
        const thumbDepth = handRig.thumbBase.position.dot(palmSide);
        if (thumbDepth < 0) palmSide.negate();

        alignFrame(
            pose.quaternion,
            axisVector(this.lengthAxis, this.bladeSign, bladeInModel),
            axisVector(this.axes.widthAxis, 1, widthInModel),
            acrossPalm,
            fingerDirection,
            this.spec.gripRoll
        );

        pose.position
            .copy(knuckleCentre)
            .multiplyScalar(GRIP.knuckleReach)
            .addScaledVector(palmSide, Math.abs(thumbDepth) * GRIP.palmDepth)
            .sub(this.handleOffset(pose.quaternion, pose.scale));
        return pose;
    }

    private buildCarryPose(carry: IWeaponCarry, bone: Object3D): IMountPose {
        const boneScale = this.boneWorldScale(bone);
        const pose: IMountPose = {
            bone,
            position: new Vector3(),
            quaternion: new Quaternion().setFromEuler(
                carryEuler.set(
                    degrees(carry.rotationDegrees[0]),
                    degrees(carry.rotationDegrees[1]),
                    degrees(carry.rotationDegrees[2])
                )
            ),
            scale: this.spec.worldLength / (this.modelLength * boneScale),
        };
        pose.position
            .fromArray(carry.position)
            .divideScalar(boneScale)
            .sub(this.handleOffset(pose.quaternion, pose.scale));
        return pose;
    }
}
