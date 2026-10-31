import { Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { PROCEDURAL_ANIMATION, PROCEDURAL_EPSILON } from "@/constants/characters";
import { clamp } from "@/lib/helpers";
import type { ILimb } from "@/types/characters";
import type { Handedness } from "@/types/combat";

type LimbNames = readonly [string, string, string];

export class BoneMath {
    static readonly UP = new Vector3(0, 1, 0);

    private static readonly decomposed = { position: new Vector3(), scale: new Vector3() };
    private static readonly rotation = {
        parent: new Quaternion(),
        world: new Quaternion(),
        turn: new Quaternion(),
        turnAxis: new Vector3(),
    };
    private static readonly limb = {
        root: new Vector3(),
        joint: new Vector3(),
        tip: new Vector3(),
        goal: new Vector3(),
        reach: new Vector3(),
        bendAxis: new Vector3(),
        bent: new Vector3(),
        from: new Vector3(),
        to: new Vector3(),
        swing: new Quaternion(),
        endRotation: new Quaternion(),
    };

    static findBones(model: Object3D, names: readonly string[]): Object3D[] {
        return names.flatMap((name) => model.getObjectByName(name) ?? []);
    }

    private static findLimb(model: Object3D, names: LimbNames): ILimb | null {
        const [upper, lower, end] = BoneMath.findBones(model, names);
        return end ? { upper, lower, end, bend: new Vector3() } : null;
    }

    static findLimbs(
        model: Object3D,
        names: Record<Handedness, LimbNames>
    ): Record<Handedness, ILimb> | null {
        const left = BoneMath.findLimb(model, names.left);
        const right = BoneMath.findLimb(model, names.right);
        return left && right ? { left, right } : null;
    }

    static hierarchyDepth(bone: Object3D): number {
        let depth = 0;
        for (let parent = bone.parent; parent; parent = parent.parent) depth++;
        return depth;
    }

    static worldPosition(object: Object3D, out: Vector3): Vector3 {
        return out.setFromMatrixPosition(object.matrixWorld);
    }

    static worldRotation(object: Object3D, out: Quaternion): Quaternion {
        const { position, scale } = BoneMath.decomposed;
        object.matrixWorld.decompose(position, out, scale);
        return out;
    }

    private static setWorldRotation(bone: Object3D, world: Quaternion): void {
        const { parent } = BoneMath.rotation;
        if (bone.parent) BoneMath.worldRotation(bone.parent, parent).invert();
        else parent.identity();
        bone.quaternion.multiplyQuaternions(parent, world);
        bone.updateMatrixWorld(true);
    }

    private static rotateInWorld(bone: Object3D, rotation: Quaternion): void {
        BoneMath.setWorldRotation(
            bone,
            BoneMath.worldRotation(bone, BoneMath.rotation.world).premultiply(rotation)
        );
    }

    static rotateByRotationVector(bone: Object3D, turn: Vector3): void {
        const angle = turn.length();
        if (angle < PROCEDURAL_EPSILON.turnRadians) return;
        const { turn: turnRotation, turnAxis } = BoneMath.rotation;
        turnRotation.setFromAxisAngle(turnAxis.copy(turn).divideScalar(angle), angle);
        BoneMath.rotateInWorld(bone, turnRotation);
    }

    static solveLimbIk(
        limb: ILimb,
        target: Vector3,
        endRotation: Quaternion,
        weight: number
    ): void {
        if (weight <= 0) return;
        const { upper, lower, end, bend } = limb;
        const { root, joint, tip, goal, reach, bendAxis, bent, from, to, swing } = BoneMath.limb;
        BoneMath.worldPosition(upper, root);
        BoneMath.worldPosition(lower, joint);
        BoneMath.worldPosition(end, tip);
        BoneMath.worldRotation(end, BoneMath.limb.endRotation).slerp(endRotation, weight);
        goal.copy(tip).lerp(target, weight);

        const upperLength = joint.distanceTo(root);
        const lowerLength = tip.distanceTo(joint);
        reach.subVectors(goal, root);
        const distance = clamp(
            reach.length(),
            PROCEDURAL_EPSILON.reach,
            (upperLength + lowerLength) * PROCEDURAL_ANIMATION.ik.reachLimit
        );
        reach.normalize();

        from.subVectors(joint, root);
        bendAxis.subVectors(tip, root).cross(from);
        bendAxis.addScaledVector(reach, -bendAxis.dot(reach));
        if (bendAxis.lengthSq() > PROCEDURAL_EPSILON.bend) bend.copy(bendAxis).normalize();
        else if (bend.lengthSq() > PROCEDURAL_EPSILON.bend) bendAxis.copy(bend);
        else bendAxis.crossVectors(reach, BoneMath.UP);
        bendAxis.addScaledVector(reach, -bendAxis.dot(reach)).normalize();
        const elbowCosine = clamp(
            (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
                (2 * upperLength * distance),
            -1,
            1
        );
        bent.copy(reach).applyAxisAngle(bendAxis, Math.acos(elbowCosine));

        from.normalize();
        swing.setFromUnitVectors(from, bent);
        BoneMath.rotateInWorld(upper, swing);

        BoneMath.worldPosition(lower, joint);
        BoneMath.worldPosition(end, tip);
        from.subVectors(tip, joint).normalize();
        to.copy(root).addScaledVector(reach, distance).sub(joint).normalize();
        swing.setFromUnitVectors(from, to);
        BoneMath.rotateInWorld(lower, swing);

        BoneMath.setWorldRotation(end, BoneMath.limb.endRotation);
    }
}
