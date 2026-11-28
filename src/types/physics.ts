import type { Quaternion, Vector3, Vector3Tuple } from "three";

type PhysicsBodyKind = "sheet";

export interface ITriangleMesh {
    positions: Float32Array;
    indices: Uint32Array;
}

export type StaticColliderShape =
    | ({ kind: "trimesh"; fixesInternalEdges: boolean } & ITriangleMesh)
    | { kind: "cuboid"; halfExtents: Vector3Tuple; at: Vector3Tuple; yaw: number }
    | { kind: "cylinder"; halfHeight: number; radius: number; at: Vector3Tuple }
    | { kind: "hull"; points: Float32Array };

export type StaticCollider = StaticColliderShape & {
    wallRunnable: boolean;
};

export type PhysicsDetail = "full" | "reduced" | "frozen";

export interface ICapsuleSource {
    worldCapsule(start: Vector3, end: Vector3): number | null;
}

export interface IVector3 {
    x: number;
    y: number;
    z: number;
}

export interface ISurfaceHit {
    distance: number;
    point: IVector3;
    normal: IVector3;
    groups: number;
}

export type ContactKind = "ground" | "wall" | "runnableWall" | "ledge" | "none";

export interface ILedgeProbe {
    reach: number;
    turns: readonly number[];
    minimum: number;
    maximum: number;
    requiresWallTouch: boolean;
    flatTopNormalY: number;
    steepFaceNormalY: number;
    levelTolerance: number;
    levelSpread: number;
}

export interface IRunnableWallProbe {
    reachSeconds: number;
    entryGraceSeconds: number;
    seekReach: number;
    minimumAlongSpeed: number;
    turnCosines: readonly number[];
    turnSines: readonly number[];
}

export interface ILedgeReach {
    readonly stand: Vector3;
    readonly normal: Vector3;
    height: number;
}

export interface IMotorStepRequest {
    desiredVelocity: Vector3;
    displacement: Vector3 | null;
    followGround: boolean;
    gravityScale: number;
}

export interface IMotorLaunch {
    up?: number;
    maxUp?: number;
    away?: number;
    along?: number;
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
    start: Vector3Tuple;
    end: Vector3Tuple;
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
    pinNodesToAttachments(): void;
    moveNodesWithAttachments(isPoseCurrent: boolean): void;
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
    groundResponse: number;
    airAccelerationPerHeight: number;
    pushesDynamicBodies: boolean;
}

export type MotorTuning = Omit<IMotorSpec, "height" | "radius" | "pushesDynamicBodies">;

export interface IQuaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}
