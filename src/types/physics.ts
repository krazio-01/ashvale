import type { Quaternion, Vector3 } from "three";

export type PhysicsBodyKind = "sheet";

export type PhysicsDetail = "full" | "reduced" | "frozen";

export interface IVector3 {
    x: number;
    y: number;
    z: number;
}

export interface IClothFeel {
    damping: number;
    stretchCompliance: number;
    bendCompliance: number;
    gravityScale: number;
    windExposure: number;
    tetherScale: number;
    leashMax: number;
    leashCurve: number;
    backstopRadius: number;
    backstopOffset: number;
    collisionThickness: number;
    deflectionMargin: number;
    deflectionSoftness: number;
    friction: number;
    impulseScale: number;
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
    feel?: Partial<IClothFeel>;
}

export interface IPhysicsCollider {
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
    prepareFrame(): void;
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
