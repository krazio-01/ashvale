import type { Quaternion, Vector3 } from "three";

export type PhysicsBodyKind = "sheet";

export type PhysicsDetail = "full" | "reduced" | "frozen";

export interface ICapsuleSource {
    worldCapsule(start: Vector3, end: Vector3): number | null;
}

export interface IVector3 {
    x: number;
    y: number;
    z: number;
}

export interface IClothTuning {
    damping: number;
    stretchSoftness: number;
    bendSoftness: number;
    gravityScale: number;
    windExposure: number;
    pinSlack: number;
    maxDriftAtHem: number;
    driftCurve: number;
    bodyGuardRadius: number;
    bodyGuardDepth: number;
    collisionThickness: number;
    targetClearance: number;
    targetClearanceBlend: number;
    friction: number;
    hitImpulseScale: number;
}

export interface IPhysicsBodyDefinition {
    name: string;
    kind: PhysicsBodyKind;
    attachBone: string;
    columns: number;
    rows: number;
    nodeBones: string[];
    restPositions: number[];
    restNormals: number[];
    pinned: boolean[];
    nearestPin: number[];
    geodesicDistance: number[];
    skinBones: string[];
    skinWeights: number[];
    feel?: Partial<IClothTuning>;
}

interface IPhysicsCollider {
    bone: string;
    start: [number, number, number];
    end: [number, number, number];
    radius: number;
}

export interface IPhysicsDefinition {
    version: 3;
    referenceBone: string;
    bodies: IPhysicsBodyDefinition[];
    colliders: IPhysicsCollider[];
}

export interface IPhysicsBinding {
    prepareFrame(includeHomes?: boolean, isPoseCurrent?: boolean): void;
    unitScale(bodyIndex: number): number;
    referenceWorld(outPosition: Vector3, outRotation: Quaternion): void;
    homeWorld(bodyIndex: number, nodeIndex: number, outPosition: Vector3, outNormal: Vector3): void;
    colliderWorld(colliderIndex: number, outStart: Vector3, outEnd: Vector3): number;
    writeNode(
        bodyIndex: number,
        nodeIndex: number,
        position: Vector3,
        down: Vector3,
        across: Vector3
    ): void;
    writeAnimatedNode(bodyIndex: number, nodeIndex: number): void;
}

export interface IMotorSpec {
    height: number;
    radius: number;
    colliderOffset: number;
    maxSlopeClimbAngle: number;
    minSlopeSlideAngle: number;
    autostepMaxHeight: number;
    autostepMinWidth: number;
    snapToGroundDistance: number;
    terminalVelocity: number;
    groundAcceleration: number;
    airAcceleration: number;
    pushesDynamicBodies: boolean;
}

export type MotorTuning = Omit<IMotorSpec, "height" | "radius" | "pushesDynamicBodies">;

export interface IQuaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}
