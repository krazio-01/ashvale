import type { Object3D, Vector3 } from "three";
import type { PhysicsDetail } from "@/types/physics";
import type { Handedness } from "@/types/weapons";

export type ProceduralDetail = "full" | "impact" | "none";

export interface IGroundProbe {
    groundHeightAt(x: number, z: number, fromY: number): number | null;
}

export interface IBladeSource {
    bladeSegment(hilt: Vector3, tip: Vector3): boolean;
}

export interface IProceduralFrame {
    deltaSeconds: number;
    detail: ProceduralDetail;
    physicsDetail: PhysicsDetail;
    weaponHand: Handedness;
    gripWeight: number;
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
