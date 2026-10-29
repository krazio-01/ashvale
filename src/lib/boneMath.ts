import { Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { PROCEDURAL, PROCEDURAL_EPSILON } from "@/constants/characters";
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
    private static readonly segment = {
        a: new Vector3(),
        b: new Vector3(),
        gap: new Vector3(),
    };

    static forwardFromYaw(yaw: number, out: Vector3, length = 1): Vector3 {
        return out.set(Math.sin(yaw) * length, 0, Math.cos(yaw) * length);
    }

    static findBones(model: Object3D, names: readonly string[]): Object3D[] {
        return names.flatMap((name) => model.getObjectByName(name) ?? []);
    }

    static findLimb(model: Object3D, names: LimbNames): ILimb | null {
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

    static depthOf(bone: Object3D): number {
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

    static setWorldRotation(bone: Object3D, world: Quaternion): void {
        const { parent } = BoneMath.rotation;
        if (bone.parent) BoneMath.worldRotation(bone.parent, parent).invert();
        else parent.identity();
        bone.quaternion.multiplyQuaternions(parent, world);
        bone.updateMatrixWorld(true);
    }

    static rotateInWorld(bone: Object3D, rotation: Quaternion): void {
        BoneMath.setWorldRotation(
            bone,
            BoneMath.worldRotation(bone, BoneMath.rotation.world).premultiply(rotation)
        );
    }

    static applyWorldTurn(bone: Object3D, turn: Vector3): void {
        const angle = turn.length();
        if (angle < PROCEDURAL_EPSILON.turnRadians) return;
        const { turn: turnRotation, turnAxis } = BoneMath.rotation;
        turnRotation.setFromAxisAngle(turnAxis.copy(turn).divideScalar(angle), angle);
        BoneMath.rotateInWorld(bone, turnRotation);
    }

    static solveTwoBone(
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
            (upperLength + lowerLength) * PROCEDURAL.ik.reachLimit
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

    static closestPointsBetweenSegments(
        startA: Vector3,
        endA: Vector3,
        startB: Vector3,
        endB: Vector3,
        outA: Vector3,
        outB: Vector3
    ): void {
        const { a, b, gap } = BoneMath.segment;
        const degenerate = PROCEDURAL_EPSILON.degenerateLengthSquared;
        a.subVectors(endA, startA);
        b.subVectors(endB, startB);
        gap.subVectors(startA, startB);
        const lengthA = a.dot(a);
        const lengthB = b.dot(b);
        const gapAlongB = b.dot(gap);
        let alongA = 0;
        let alongB = 0;
        if (lengthA <= degenerate && lengthB > degenerate) {
            alongB = clamp(gapAlongB / lengthB, 0, 1);
        } else if (lengthA > degenerate) {
            const gapAlongA = a.dot(gap);
            if (lengthB <= degenerate) {
                alongA = clamp(-gapAlongA / lengthA, 0, 1);
            } else {
                const cross = a.dot(b);
                const denominator = lengthA * lengthB - cross * cross;
                alongA =
                    denominator > degenerate
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
        outA.copy(startA).addScaledVector(a, alongA);
        outB.copy(startB).addScaledVector(b, alongB);
    }
}
