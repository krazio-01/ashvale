import { Matrix3, Matrix4, Quaternion, SkinnedMesh, Vector3 } from "three";
import type { Bone, Object3D, Skeleton } from "three";
import { PHYSICS } from "@/constants/physics";
import { sheetTangents } from "@/systems/physics/ClothBody";
import type { IPhysicsBinding, IPhysicsBodyDefinition, IPhysicsDefinition } from "@/types/physics";

const scratchPoint = new Vector3();
const scratchHomeDown = new Vector3();
const scratchHomeAcross = new Vector3();
const scratchBasisDown = new Vector3();
const scratchBasisAcross = new Vector3();
const scratchBasisNormal = new Vector3();
const scratchBasisMatrix = new Matrix4();
const scratchRotationMatrix = new Matrix4();
const scratchNormalMatrix = new Matrix3();
const scratchHomeRotation = new Quaternion();
const scratchDelta = new Quaternion();
const scratchScale = new Vector3();

const DEGENERATE_LENGTH_SQ = PHYSICS.epsilon.geometry;
const SKIN_INFLUENCES = 4;

function basisQuaternion(across: Vector3, down: Vector3, out: Quaternion): Quaternion {
    if (down.lengthSq() < DEGENERATE_LENGTH_SQ) scratchBasisDown.set(0, -1, 0);
    else scratchBasisDown.copy(down).normalize();
    scratchBasisAcross
        .copy(across)
        .addScaledVector(scratchBasisDown, -across.dot(scratchBasisDown));
    if (scratchBasisAcross.lengthSq() < DEGENERATE_LENGTH_SQ) {
        if (Math.abs(scratchBasisDown.x) > 0.9) scratchBasisAcross.set(0, 1, 0);
        else scratchBasisAcross.set(1, 0, 0);
        scratchBasisAcross.addScaledVector(
            scratchBasisDown,
            -scratchBasisAcross.dot(scratchBasisDown)
        );
    }
    scratchBasisAcross.normalize();
    scratchBasisNormal.crossVectors(scratchBasisAcross, scratchBasisDown);
    scratchBasisMatrix.makeBasis(scratchBasisAcross, scratchBasisDown, scratchBasisNormal);
    return out.setFromRotationMatrix(scratchBasisMatrix);
}

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
            if (!bone) throw new Error(`physics data names bone ${name} but the model has none`);
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

    prepareFrame(): void {
        this.model.updateWorldMatrix(true, true);
        for (const skin of this.skinBones)
            skin.matrix.multiplyMatrices(skin.bone.matrixWorld, skin.inverse);
        for (const body of this.bodies) {
            for (let group = 0; group < body.groupSkin.length; group++) this.blendSkin(body, group);
            for (let node = 0; node < body.nodeGroup.length; node++) this.placeHome(body, node);
        }
    }

    referenceWorld(outPosition: Vector3, outRotation: Quaternion): void {
        this.referenceBone.matrixWorld.decompose(outPosition, outRotation, scratchScale);
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
        const body = this.bodies[bodyIndex];
        body.bones[nodeIndex].matrixWorld.multiplyMatrices(
            body.groupSkin[body.nodeGroup[nodeIndex]],
            body.nodeBindWorld[nodeIndex]
        );
    }

    writeNode(
        bodyIndex: number,
        nodeIndex: number,
        position: Vector3,
        down: Vector3,
        across: Vector3
    ): void {
        const body = this.bodies[bodyIndex];
        sheetTangents(body, nodeIndex, body.homes, 0, scratchHomeDown, scratchHomeAcross);
        basisQuaternion(scratchHomeAcross, scratchHomeDown, scratchHomeRotation).invert();
        basisQuaternion(across, down, scratchDelta).multiply(scratchHomeRotation);
        const world = body.bones[nodeIndex].matrixWorld;
        world.multiplyMatrices(
            body.groupSkin[body.nodeGroup[nodeIndex]],
            body.nodeBindWorld[nodeIndex]
        );
        world.premultiply(scratchRotationMatrix.makeRotationFromQuaternion(scratchDelta));
        scratchPoint.fromArray(body.homes, nodeIndex * 3).applyQuaternion(scratchDelta);
        world.elements[12] += position.x - scratchPoint.x;
        world.elements[13] += position.y - scratchPoint.y;
        world.elements[14] += position.z - scratchPoint.z;
    }

    private blendSkin(body: IBodyBinding, group: number): void {
        const elements = body.groupSkin[group].elements;
        elements.fill(0);
        const first = body.groupNode[group] * SKIN_INFLUENCES;
        for (let slot = first; slot < first + SKIN_INFLUENCES; slot++) {
            const weight = body.skinWeights[slot];
            if (weight === 0) continue;
            const source = this.skinBones[body.skinSlots[slot]].matrix.elements;
            for (let element = 0; element < 16; element++)
                elements[element] += source[element] * weight;
        }
    }

    private placeHome(body: IBodyBinding, node: number): void {
        const skin = body.groupSkin[body.nodeGroup[node]];
        scratchPoint
            .fromArray(body.restPositions, node * 3)
            .applyMatrix4(skin)
            .toArray(body.homes, node * 3);
        scratchNormalMatrix.setFromMatrix4(skin);
        scratchPoint
            .fromArray(body.restNormals, node * 3)
            .applyMatrix3(scratchNormalMatrix)
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
        const nodeBindWorld = bones.map((bone) => {
            const index = skeleton.bones.indexOf(bone as Bone);
            if (index < 0)
                throw new Error(`physics lattice bone ${bone.name} is not in the model skeleton`);
            return skeleton.boneInverses[index].clone().invert();
        });
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
            const first = node * SKIN_INFLUENCES;
            const key = `${skinSlots.subarray(first, first + SKIN_INFLUENCES).join()}|${skinWeights.subarray(first, first + SKIN_INFLUENCES).join()}`;
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
        const index = skeleton.bones.indexOf(bone as Bone);
        if (index < 0) throw new Error(`physics skin bone ${name} is not in the model skeleton`);
        slots.set(name, this.skinBones.length);
        this.skinBones.push({ bone, inverse: skeleton.boneInverses[index], matrix: new Matrix4() });
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
        if (!found) throw new Error("physics lattice bones belong to no skinned mesh");
        return found;
    }
}
