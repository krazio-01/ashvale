import type { Object3D, Vector3 } from "three";
import type { PhysicsDetail } from "@/types/physics";
import type { Handedness } from "@/types/combat";

export type ProceduralDetail = "full" | "impact" | "none";

export interface IGroundProbe {
    groundHeightAt(x: number, z: number, fromY: number): number | null;
}

export interface IBladeSource {
    getBladeSegment(hilt: Vector3, tip: Vector3): boolean;
}

export interface IProceduralFrame {
    deltaSeconds: number;
    detail: ProceduralDetail;
    physicsDetail: PhysicsDetail;
    weaponHand: Handedness;
    twoHandGripWeight: number;
    grounded: boolean;
    plantFeet: boolean;
    lookTarget: Vector3 | null;
}

export interface ILimb {
    readonly upper: Object3D;
    readonly lower: Object3D;
    readonly end: Object3D;
    readonly bend: Vector3;
}

export type SkeletonSide = "left" | "right";

export type ColliderGroup = "torso" | "upperArm" | "lowerArm" | "thigh" | "calf";

type SpineRegion = "torso" | "neck" | "head";

export interface ISkeletonDescriptor {
    sides: Record<SkeletonSide, string>;
    sideSigns: Record<SkeletonSide, number>;
    bones: {
        pelvis: string;
        chest: string;
        neck: string;
        head: string;
        headTop: string;
        root: string;
        spine: readonly string[];
        clavicles: Record<SkeletonSide, string>;
        arms: Record<SkeletonSide, readonly string[]>;
        legs: Record<SkeletonSide, readonly string[]>;
        feet: Record<SkeletonSide, readonly string[]>;
        handTips: Record<SkeletonSide, string>;
    };
    chains: Record<string, string>;
    limbs: Record<
        string,
        {
            segments: readonly (readonly [string, number])[];
            bones: readonly string[];
            distal: readonly string[];
            zone?: string;
        }
    >;
    regions: Record<string, readonly string[]>;
    rig: {
        coreBones: readonly string[];
        dampedBones: readonly string[];
    };
    spineCurve: readonly (readonly [string, SpineRegion])[];
    placedJoints: readonly string[];
    segmentTails: Record<string, string>;
    hiddenBoneParts: readonly string[];
    propAnchors: readonly string[];
    colliderSegments: readonly (readonly [string, string, string, ColliderGroup])[];
    fingerBones: readonly string[];
    leafMarker: string;
    physicsBonePrefix: string;
    previewClips: Record<"standard" | "extreme", readonly (readonly [string, number])[]>;
    measuredJoints: readonly string[];
}
