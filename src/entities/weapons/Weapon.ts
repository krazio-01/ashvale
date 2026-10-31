import { Box3, Euler, Group, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { BLADE_THICKNESS_SLICES, HAND_GRIP } from "@/constants/combat";
import { axisVector, degreesToRadians, lerp, measureBladeAxes } from "@/lib/helpers";
import type { Axis, IBladeAxes } from "@/lib/helpers";
import { EffectSet } from "@/systems/effects/Effects";
import type {
    ICapsule,
    ICarryRig,
    IHandRig,
    IMeleeWeaponSpec,
    IWeaponCarry,
    IWeaponSpec,
    WeaponMount,
    WeaponDefinition,
} from "@/types/combat";
import type { IModelTemplate } from "@/types/world";
import { ERRORS } from "@/constants/strings";

interface IMountPose {
    bone: Object3D;
    position: Vector3;
    quaternion: Quaternion;
    scale: number;
}

export abstract class Weapon<Spec extends IWeaponSpec = IWeaponSpec> {
    private static readonly scratchVertex = new Vector3();

    private static readonly alignedWidth = new Vector3();

    private static readonly lengthAlignment = new Quaternion();

    private static readonly edgeAlignment = new Quaternion();

    private static readonly edgeCrossProduct = new Vector3();

    private static readonly scratchBoneScale = new Vector3();

    private static readonly knuckleCentre = new Vector3();

    private static readonly fingerDirection = new Vector3();

    private static readonly acrossPalm = new Vector3();

    private static readonly palmSide = new Vector3();

    private static readonly bladeInModel = new Vector3();

    private static readonly widthInModel = new Vector3();

    private static readonly handleCentre = new Vector3();

    private static readonly carryEuler = new Euler();

    private static addMeshes(group: Group, template: IModelTemplate): Group {
        for (const part of template.parts) {
            const mesh = new Mesh(part.geometry, part.material);
            mesh.castShadow = true;
            group.add(mesh);
        }
        return group;
    }

    private static measureBladeHalfThickness(
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
                Weapon.scratchVertex
                    .fromBufferAttribute(positions, index)
                    .applyMatrix4(object.matrixWorld);
                const slice = Math.floor((Weapon.scratchVertex[lengthAxis] - low) / sliceLength);
                if (slice < 0 || slice >= BLADE_THICKNESS_SLICES) continue;
                lows[slice] = Math.min(lows[slice], Weapon.scratchVertex[thicknessAxis]);
                highs[slice] = Math.max(highs[slice], Weapon.scratchVertex[thicknessAxis]);
            }
        });
        const thicknesses = highs
            .map((high, slice) => high - lows[slice])
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        if (thicknesses.length === 0) throw new Error(ERRORS.emptyBladeSpan);
        return thicknesses[Math.floor(thicknesses.length / 2)] / 2;
    }

    private static rotationAligningAxes(
        out: Quaternion,
        lengthFrom: Vector3,
        widthFrom: Vector3,
        lengthTo: Vector3,
        widthTo: Vector3,
        roll: number
    ): Quaternion {
        Weapon.lengthAlignment.setFromUnitVectors(lengthFrom, lengthTo);
        Weapon.alignedWidth.copy(widthFrom).applyQuaternion(Weapon.lengthAlignment);
        const widthTurn = Math.atan2(
            Weapon.edgeCrossProduct.crossVectors(Weapon.alignedWidth, widthTo).dot(lengthTo),
            Weapon.alignedWidth.dot(widthTo)
        );
        Weapon.edgeAlignment.setFromAxisAngle(lengthTo, widthTurn + roll);
        return out.multiplyQuaternions(Weapon.edgeAlignment, Weapon.lengthAlignment);
    }

    readonly model = new Group();
    readonly spec: Spec;

    protected readonly tipCoordinate: number;
    protected readonly pommelCoordinate: number;

    private readonly axes: IBladeAxes;
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
        Weapon.addMeshes(this.model, template);

        const bounds = new Box3().setFromObject(this.model);
        this.axes = measureBladeAxes(bounds);
        const { size, lengthAxis } = this.axes;
        const tipAtMaximum = this.axes.tipDirectionSign > 0;
        this.tipCoordinate = tipAtMaximum ? bounds.max[lengthAxis] : bounds.min[lengthAxis];
        this.pommelCoordinate = tipAtMaximum ? bounds.min[lengthAxis] : bounds.max[lengthAxis];
        this.modelLength = Math.max(size[lengthAxis], 1e-4);

        this.poses.hand = this.buildGripPose(handRig);
        if (spec.carry && carryRig) {
            this.poses.carry = this.buildCarryPose(spec.carry, carryRig.bone);
            this.halfThickness = Weapon.measureBladeHalfThickness(
                this.model,
                this.axes.lengthAxis,
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

    mount(target: WeaponMount): void {
        const pose = this.poses[target];
        if (!pose) throw new Error(ERRORS.missingWeaponMount(this.spec.id, target));
        pose.bone.add(this.model);
        this.model.position.copy(pose.position);
        this.model.quaternion.copy(pose.quaternion);
        this.model.scale.setScalar(pose.scale);
        this.mountedOn = target;
    }

    abstract getStrikeCapsule(segment: ICapsule): boolean;

    worldCapsule(pommel: Vector3, tip: Vector3): number {
        this.model.updateWorldMatrix(true, false);
        const matrix = this.model.matrixWorld;
        this.axisPoint(this.pommelCoordinate, pommel).applyMatrix4(matrix);
        this.axisPoint(this.tipCoordinate, tip).applyMatrix4(matrix);
        return this.halfThickness * matrix.getMaxScaleOnAxis();
    }

    getBladeSegment(pommel: Vector3, tip: Vector3): boolean {
        if (this.mountedOn !== "hand") return false;
        this.worldCapsule(pommel, tip);
        return true;
    }

    update(_deltaSeconds: number, _isStriking: boolean): void {}

    dispose(): void {
        this.model.removeFromParent();
    }

    protected coordinateAt(fraction: number): number {
        return lerp(this.pommelCoordinate, this.tipCoordinate, fraction);
    }

    protected axisPoint(coordinate: number, out: Vector3): Vector3 {
        out.set(0, 0, 0);
        out[this.axes.lengthAxis] = coordinate;
        return out;
    }

    private mountScale(boneScale: number): number {
        return this.spec.worldLength / (this.modelLength * boneScale);
    }

    private boneWorldScale(bone: Object3D): number {
        bone.updateWorldMatrix(true, false);
        return bone.getWorldScale(Weapon.scratchBoneScale).x;
    }

    private handleOffset(quaternion: Quaternion, scale: number): Vector3 {
        return this.axisPoint(
            this.coordinateAt(this.spec.handleCentreFraction),
            Weapon.handleCentre
        )
            .multiplyScalar(scale)
            .applyQuaternion(quaternion);
    }

    private buildGripPose(handRig: IHandRig): IMountPose {
        const pose: IMountPose = {
            bone: handRig.hand,
            position: new Vector3(),
            quaternion: new Quaternion(),
            scale: this.mountScale(this.boneWorldScale(handRig.hand)),
        };

        const outerFinger = handRig.pinkyBase ?? handRig.ringBase;
        Weapon.knuckleCentre
            .copy(handRig.indexBase.position)
            .add(handRig.middleBase.position)
            .add(handRig.ringBase.position);
        if (handRig.pinkyBase) Weapon.knuckleCentre.add(handRig.pinkyBase.position);
        Weapon.knuckleCentre.divideScalar(handRig.pinkyBase ? 4 : 3);
        Weapon.fingerDirection.copy(handRig.middleBase.position).normalize();
        Weapon.acrossPalm.subVectors(handRig.indexBase.position, outerFinger.position);
        Weapon.acrossPalm
            .addScaledVector(Weapon.fingerDirection, -Weapon.acrossPalm.dot(Weapon.fingerDirection))
            .normalize();
        Weapon.palmSide.crossVectors(Weapon.fingerDirection, Weapon.acrossPalm);
        const thumbDepth = handRig.thumbBase.position.dot(Weapon.palmSide);
        if (thumbDepth < 0) Weapon.palmSide.negate();

        Weapon.rotationAligningAxes(
            pose.quaternion,
            axisVector(this.axes.lengthAxis, this.axes.tipDirectionSign, Weapon.bladeInModel),
            axisVector(this.axes.widthAxis, 1, Weapon.widthInModel),
            Weapon.acrossPalm,
            Weapon.fingerDirection,
            this.spec.gripRoll
        );

        pose.position
            .copy(Weapon.knuckleCentre)
            .multiplyScalar(HAND_GRIP.knuckleReach)
            .addScaledVector(Weapon.palmSide, Math.abs(thumbDepth) * HAND_GRIP.palmDepth)
            .sub(this.handleOffset(pose.quaternion, pose.scale));
        return pose;
    }

    private buildCarryPose(carry: IWeaponCarry, bone: Object3D): IMountPose {
        const boneScale = this.boneWorldScale(bone);
        const pose: IMountPose = {
            bone,
            position: new Vector3(),
            quaternion: new Quaternion().setFromEuler(
                Weapon.carryEuler.set(
                    degreesToRadians(carry.rotationDegrees[0]),
                    degreesToRadians(carry.rotationDegrees[1]),
                    degreesToRadians(carry.rotationDegrees[2])
                )
            ),
            scale: this.mountScale(boneScale),
        };
        pose.position
            .fromArray(carry.position)
            .divideScalar(boneScale)
            .sub(this.handleOffset(pose.quaternion, pose.scale));
        return pose;
    }
}

class MeleeWeapon extends Weapon<IMeleeWeaponSpec> {
    private readonly effects: EffectSet;
    private readonly localGuard = new Vector3();
    private readonly localTip = new Vector3();
    private readonly trailSegment: ICapsule = {
        start: new Vector3(),
        end: new Vector3(),
        radius: 0,
    };

    constructor(
        template: IModelTemplate,
        spec: IMeleeWeaponSpec,
        handRig: IHandRig,
        effectsRoot: Object3D,
        carryRig?: ICarryRig
    ) {
        super(template, spec, handRig, carryRig);

        this.axisPoint(this.tipCoordinate, this.localTip);
        this.axisPoint(this.coordinateAt(spec.guardFraction), this.localGuard);

        this.effects = new EffectSet(["slashTrail"], {
            sceneRoot: effectsRoot,
            color: spec.trailColor,
        });
    }

    getStrikeCapsule(segment: ICapsule): boolean {
        if (this.mounted !== "hand") return false;
        this.model.updateWorldMatrix(true, false);
        segment.start.copy(this.localGuard).applyMatrix4(this.model.matrixWorld);
        segment.end.copy(this.localTip).applyMatrix4(this.model.matrixWorld);
        segment.radius = this.spec.bladeRadius;
        return true;
    }

    update(deltaSeconds: number, isStriking: boolean): void {
        const emitting = isStriking && this.mounted === "hand";
        if (emitting) {
            this.getStrikeCapsule(this.trailSegment);
            this.effects.get("slashTrail").play(this.trailSegment.start, this.trailSegment.end);
        }

        this.effects.update(deltaSeconds);
    }

    dispose(): void {
        this.effects.dispose();
        super.dispose();
    }
}

export function createWeapon(
    definition: WeaponDefinition,
    template: IModelTemplate,
    handRig: IHandRig,
    effectsRoot: Object3D,
    carryRig?: ICarryRig
): Weapon {
    switch (definition.kind) {
        case "melee":
            return new MeleeWeapon(template, definition, handRig, effectsRoot, carryRig);
    }
}
