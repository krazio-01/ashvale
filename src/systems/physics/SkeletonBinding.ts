import { Matrix3, Matrix4, Quaternion, SkinnedMesh, Vector3 } from "three";
import type { Bone, Object3D, Skeleton } from "three";
import { PHYSICS } from "@/constants/physics";
import { sheetTangents } from "@/systems/physics/ClothBody";
import type { IPhysicsBinding, IPhysicsBodyDefinition, IPhysicsDefinition } from "@/types/physics";
import { ERRORS } from "@/constants/strings";

interface ISkinBone {
    bone: Object3D;
    inverse: Matrix4;
    matrix: Matrix4;
}

interface IBodyBinding {
    columns: number;
    rows: number;
    bones: Object3D[];
    nodeBindWorld: Matrix4[];
    nodeGroup: Int32Array;
    groupNode: Int32Array;
    groupSkin: Matrix4[];
    skinSlots: Int32Array;
    skinWeights: Float64Array;
    restPositions: Float64Array;
    restNormals: Float64Array;
    homes: Float64Array;
    normals: Float64Array;
}

export class SkeletonBinding implements IPhysicsBinding {
    private static readonly scratchBasisDown = new Vector3();

    private static readonly scratchBasisAcross = new Vector3();

    private static readonly scratchBasisNormal = new Vector3();

    private static readonly scratchBasisMatrix = new Matrix4();

    private static readonly DEGENERATE_LENGTH_SQ = PHYSICS.epsilon.geometry;

    private static readonly scratchPoint = new Vector3();

    private static readonly scratchHomeDown = new Vector3();

    private static readonly scratchHomeAcross = new Vector3();

    private static readonly scratchRotationMatrix = new Matrix4();

    private static readonly scratchNormalMatrix = new Matrix3();

    private static readonly scratchHomeRotation = new Quaternion();

    private static readonly scratchDelta = new Quaternion();

    private static readonly scratchScale = new Vector3();

    private static readonly SKIN_INFLUENCES = 4;

    private static basisQuaternion(across: Vector3, down: Vector3, out: Quaternion): Quaternion {
        if (down.lengthSq() < SkeletonBinding.DEGENERATE_LENGTH_SQ)
            SkeletonBinding.scratchBasisDown.set(0, -1, 0);
        else SkeletonBinding.scratchBasisDown.copy(down).normalize();
        SkeletonBinding.scratchBasisAcross
            .copy(across)
            .addScaledVector(
                SkeletonBinding.scratchBasisDown,
                -across.dot(SkeletonBinding.scratchBasisDown)
            );
        if (SkeletonBinding.scratchBasisAcross.lengthSq() < SkeletonBinding.DEGENERATE_LENGTH_SQ) {
            if (Math.abs(SkeletonBinding.scratchBasisDown.x) > 0.9)
                SkeletonBinding.scratchBasisAcross.set(0, 1, 0);
            else SkeletonBinding.scratchBasisAcross.set(1, 0, 0);
            SkeletonBinding.scratchBasisAcross.addScaledVector(
                SkeletonBinding.scratchBasisDown,
                -SkeletonBinding.scratchBasisAcross.dot(SkeletonBinding.scratchBasisDown)
            );
        }
        SkeletonBinding.scratchBasisAcross.normalize();
        SkeletonBinding.scratchBasisNormal.crossVectors(
            SkeletonBinding.scratchBasisAcross,
            SkeletonBinding.scratchBasisDown
        );
        SkeletonBinding.scratchBasisMatrix.makeBasis(
            SkeletonBinding.scratchBasisAcross,
            SkeletonBinding.scratchBasisDown,
            SkeletonBinding.scratchBasisNormal
        );
        return out.setFromRotationMatrix(SkeletonBinding.scratchBasisMatrix);
    }

    private static composeAnimatedNode(body: IBodyBinding, node: number): Matrix4 {
        return body.bones[node].matrixWorld.multiplyMatrices(
            body.groupSkin[body.nodeGroup[node]],
            body.nodeBindWorld[node]
        );
    }

    private static boneIndexIn(
        skeleton: Skeleton,
        bone: Object3D,
        missingError: (name: string) => string
    ): number {
        const index = skeleton.bones.indexOf(bone as Bone);
        if (index < 0) throw new Error(missingError(bone.name));
        return index;
    }

    private readonly model: Object3D;
    private readonly definition: IPhysicsDefinition;
    private readonly attachBones: Object3D[];
    private readonly colliderBones: Object3D[];
    private readonly referenceBone: Object3D;
    private readonly skinBones: ISkinBone[] = [];
    private readonly bodies: IBodyBinding[];

    constructor(model: Object3D, definition: IPhysicsDefinition) {
        this.model = model;
        this.definition = definition;
        const find = (name: string): Object3D => {
            const bone = model.getObjectByName(name);
            if (!bone) throw new Error(ERRORS.physicsBoneMissing(name));
            return bone;
        };
        const skeleton = SkeletonBinding.findSkeleton(
            model,
            find(definition.bodies[0].nodeBones[0])
        );
        this.referenceBone = find(definition.referenceBone);
        const slots = new Map<string, number>();
        this.attachBones = definition.bodies.map((body) => find(body.attachBone));
        this.colliderBones = definition.colliders.map((collider) => find(collider.bone));
        this.bodies = definition.bodies.map((body) => this.bindBody(body, skeleton, find, slots));
    }

    prepareFrame(includeHomes = true, isPoseCurrent = false): void {
        if (!isPoseCurrent) this.model.updateWorldMatrix(true, true);
        for (const skin of this.skinBones)
            skin.matrix.multiplyMatrices(skin.bone.matrixWorld, skin.inverse);
        for (const body of this.bodies) {
            for (let group = 0; group < body.groupSkin.length; group++) this.blendSkin(body, group);
            if (!includeHomes) continue;
            for (let node = 0; node < body.nodeGroup.length; node++) this.placeHome(body, node);
        }
    }

    referenceWorld(outPosition: Vector3, outRotation: Quaternion): void {
        this.referenceBone.matrixWorld.decompose(
            outPosition,
            outRotation,
            SkeletonBinding.scratchScale
        );
    }

    unitScale(bodyIndex: number): number {
        return this.attachBones[bodyIndex].matrixWorld.getMaxScaleOnAxis();
    }

    homeWorld(
        bodyIndex: number,
        nodeIndex: number,
        outPosition: Vector3,
        outNormal: Vector3
    ): void {
        const body = this.bodies[bodyIndex];
        outPosition.fromArray(body.homes, nodeIndex * 3);
        outNormal.fromArray(body.normals, nodeIndex * 3);
    }

    colliderWorld(colliderIndex: number, outStart: Vector3, outEnd: Vector3): number {
        const collider = this.definition.colliders[colliderIndex];
        const bone = this.colliderBones[colliderIndex];
        outStart.fromArray(collider.start).applyMatrix4(bone.matrixWorld);
        outEnd.fromArray(collider.end).applyMatrix4(bone.matrixWorld);
        return collider.radius * bone.matrixWorld.getMaxScaleOnAxis();
    }

    writeAnimatedNode(bodyIndex: number, nodeIndex: number): void {
        SkeletonBinding.composeAnimatedNode(this.bodies[bodyIndex], nodeIndex);
    }

    writeNode(
        bodyIndex: number,
        nodeIndex: number,
        position: Vector3,
        down: Vector3,
        across: Vector3
    ): void {
        const body = this.bodies[bodyIndex];
        sheetTangents(
            body,
            nodeIndex,
            body.homes,
            0,
            SkeletonBinding.scratchHomeDown,
            SkeletonBinding.scratchHomeAcross
        );
        SkeletonBinding.basisQuaternion(
            SkeletonBinding.scratchHomeAcross,
            SkeletonBinding.scratchHomeDown,
            SkeletonBinding.scratchHomeRotation
        ).invert();
        SkeletonBinding.basisQuaternion(across, down, SkeletonBinding.scratchDelta).multiply(
            SkeletonBinding.scratchHomeRotation
        );
        const world = SkeletonBinding.composeAnimatedNode(body, nodeIndex);
        world.premultiply(
            SkeletonBinding.scratchRotationMatrix.makeRotationFromQuaternion(
                SkeletonBinding.scratchDelta
            )
        );
        SkeletonBinding.scratchPoint
            .fromArray(body.homes, nodeIndex * 3)
            .applyQuaternion(SkeletonBinding.scratchDelta);
        world.elements[12] += position.x - SkeletonBinding.scratchPoint.x;
        world.elements[13] += position.y - SkeletonBinding.scratchPoint.y;
        world.elements[14] += position.z - SkeletonBinding.scratchPoint.z;
    }

    private blendSkin(body: IBodyBinding, group: number): void {
        const elements = body.groupSkin[group].elements;
        elements.fill(0);
        const first = body.groupNode[group] * SkeletonBinding.SKIN_INFLUENCES;
        for (let slot = first; slot < first + SkeletonBinding.SKIN_INFLUENCES; slot++) {
            const weight = body.skinWeights[slot];
            if (weight === 0) continue;
            const source = this.skinBones[body.skinSlots[slot]].matrix.elements;
            for (let element = 0; element < 16; element++)
                elements[element] += source[element] * weight;
        }
    }

    private placeHome(body: IBodyBinding, node: number): void {
        const skin = body.groupSkin[body.nodeGroup[node]];
        SkeletonBinding.scratchPoint
            .fromArray(body.restPositions, node * 3)
            .applyMatrix4(skin)
            .toArray(body.homes, node * 3);
        SkeletonBinding.scratchNormalMatrix.setFromMatrix4(skin);
        SkeletonBinding.scratchPoint
            .fromArray(body.restNormals, node * 3)
            .applyMatrix3(SkeletonBinding.scratchNormalMatrix)
            .normalize()
            .toArray(body.normals, node * 3);
    }

    private bindBody(
        body: IPhysicsBodyDefinition,
        skeleton: Skeleton,
        find: (name: string) => Object3D,
        slots: Map<string, number>
    ): IBodyBinding {
        const nodes = body.columns * body.rows;
        const bones = body.nodeBones.map(find);
        const nodeBindWorld = bones.map((bone) =>
            skeleton.boneInverses[
                SkeletonBinding.boneIndexIn(skeleton, bone, ERRORS.latticeBoneMissing)
            ]
                .clone()
                .invert()
        );
        for (const bone of bones) {
            bone.matrixAutoUpdate = false;
            bone.matrixWorldAutoUpdate = false;
        }
        const skinSlots = Int32Array.from(body.skinBones, (name) =>
            this.skinSlot(name, skeleton, find, slots)
        );
        const skinWeights = Float64Array.from(body.skinWeights);
        const groups = new Map<string, number>();
        const nodeGroup = new Int32Array(nodes);
        const groupNode: number[] = [];
        for (let node = 0; node < nodes; node++) {
            const first = node * SkeletonBinding.SKIN_INFLUENCES;
            const key = `${skinSlots.subarray(first, first + SkeletonBinding.SKIN_INFLUENCES).join()}|${skinWeights.subarray(first, first + SkeletonBinding.SKIN_INFLUENCES).join()}`;
            let group = groups.get(key);
            if (group === undefined) {
                group = groupNode.length;
                groups.set(key, group);
                groupNode.push(node);
            }
            nodeGroup[node] = group;
        }
        return {
            columns: body.columns,
            rows: body.rows,
            bones,
            nodeBindWorld,
            nodeGroup,
            groupNode: Int32Array.from(groupNode),
            groupSkin: groupNode.map(() => new Matrix4()),
            skinSlots,
            skinWeights,
            restPositions: Float64Array.from(body.restPositions),
            restNormals: Float64Array.from(body.restNormals),
            homes: new Float64Array(nodes * 3),
            normals: new Float64Array(nodes * 3),
        };
    }

    private skinSlot(
        name: string,
        skeleton: Skeleton,
        find: (name: string) => Object3D,
        slots: Map<string, number>
    ): number {
        const known = slots.get(name);
        if (known !== undefined) return known;
        const bone = find(name);
        const inverse =
            skeleton.boneInverses[
                SkeletonBinding.boneIndexIn(skeleton, bone, ERRORS.skinBoneMissing)
            ];
        slots.set(name, this.skinBones.length);
        this.skinBones.push({ bone, inverse, matrix: new Matrix4() });
        return this.skinBones.length - 1;
    }

    private static findSkeleton(model: Object3D, anyNodeBone: Object3D): Skeleton {
        let found: Skeleton | null = null;
        model.traverse((object) => {
            if (
                !found &&
                object instanceof SkinnedMesh &&
                object.skeleton.bones.includes(anyNodeBone as Bone)
            )
                found = object.skeleton;
        });
        if (!found) throw new Error(ERRORS.latticeWithoutSkin);
        return found;
    }
}
