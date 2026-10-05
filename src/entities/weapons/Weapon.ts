import { Box3, Group, Mesh, Quaternion, Vector3 } from "three";
import { GRIP } from "@/constants/combat";
import type { IStrikeSegment } from "@/types/combat";
import type { IHandRig, IWeaponSpec } from "@/types/weapons";
import type { IModelTemplate } from "@/types/world";

type Axis = "x" | "y" | "z";

const scratchSize = new Vector3();
const scratchHandScale = new Vector3();
const knuckleCentre = new Vector3();
const fingerDirection = new Vector3();
const acrossPalm = new Vector3();
const palmSide = new Vector3();
const bladeInModel = new Vector3();
const widthInModel = new Vector3();
const handleCentre = new Vector3();
const alignBlade = new Quaternion();
const alignEdge = new Quaternion();
const edgeCross = new Vector3();

function longestAxis(size: Vector3): Axis {
    if (size.x >= size.y && size.x >= size.z) return "x";
    return size.y >= size.z ? "y" : "z";
}

export abstract class Weapon<Spec extends IWeaponSpec = IWeaponSpec> {
    readonly model = new Group();
    readonly spec: Spec;

    protected readonly lengthAxis: Axis;
    protected readonly tipCoordinate: number;
    protected readonly pommelCoordinate: number;

    protected constructor(template: IModelTemplate, spec: Spec, handRig: IHandRig) {
        this.spec = spec;

        for (const part of template.parts) {
            const mesh = new Mesh(part.geometry, part.material);
            mesh.castShadow = true;
            this.model.add(mesh);
        }

        const bounds = new Box3().setFromObject(this.model);
        bounds.getSize(scratchSize);
        this.lengthAxis = longestAxis(scratchSize);
        const tipAtMaximum =
            Math.abs(bounds.max[this.lengthAxis]) >= Math.abs(bounds.min[this.lengthAxis]);
        this.tipCoordinate = tipAtMaximum
            ? bounds.max[this.lengthAxis]
            : bounds.min[this.lengthAxis];
        this.pommelCoordinate = tipAtMaximum
            ? bounds.min[this.lengthAxis]
            : bounds.max[this.lengthAxis];

        const { hand } = handRig;
        hand.updateWorldMatrix(true, false);
        hand.getWorldScale(scratchHandScale);
        const modelLength = Math.max(scratchSize[this.lengthAxis], 1e-4);
        const scale = spec.worldLength / (modelLength * scratchHandScale.x);
        this.model.scale.setScalar(scale);

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

        bladeInModel.set(0, 0, 0);
        bladeInModel[this.lengthAxis] = tipAtMaximum ? 1 : -1;
        alignBlade.setFromUnitVectors(bladeInModel, acrossPalm);

        const widthAxis = (["x", "y", "z"] as const)
            .filter((axis) => axis !== this.lengthAxis)
            .reduce((wider, axis) => (scratchSize[axis] > scratchSize[wider] ? axis : wider));
        widthInModel.set(0, 0, 0);
        widthInModel[widthAxis] = 1;
        widthInModel.applyQuaternion(alignBlade);
        const edgeTurn = Math.atan2(
            edgeCross.crossVectors(widthInModel, fingerDirection).dot(acrossPalm),
            widthInModel.dot(fingerDirection)
        );
        alignEdge.setFromAxisAngle(acrossPalm, edgeTurn + spec.gripRoll);
        this.model.quaternion.multiplyQuaternions(alignEdge, alignBlade);

        handleCentre.set(0, 0, 0);
        handleCentre[this.lengthAxis] =
            this.pommelCoordinate +
            (this.tipCoordinate - this.pommelCoordinate) * spec.handleCentreFraction;
        handleCentre.multiplyScalar(scale).applyQuaternion(this.model.quaternion);

        this.model.position
            .copy(knuckleCentre)
            .multiplyScalar(GRIP.knuckleReach)
            .addScaledVector(palmSide, Math.abs(thumbDepth) * GRIP.palmDepth)
            .sub(handleCentre);
        hand.add(this.model);
    }

    get damage(): number {
        return this.spec.damage;
    }

    abstract sampleStrike(segment: IStrikeSegment): boolean;

    bladeSegment(pommel: Vector3, tip: Vector3): void {
        this.model.updateWorldMatrix(true, false);
        pommel.set(0, 0, 0);
        pommel[this.lengthAxis] = this.pommelCoordinate;
        this.model.localToWorld(pommel);
        tip.set(0, 0, 0);
        tip[this.lengthAxis] = this.tipCoordinate;
        this.model.localToWorld(tip);
    }

    update(_deltaSeconds: number, _isStriking: boolean): void {}

    dispose(): void {
        this.model.removeFromParent();
    }
}
