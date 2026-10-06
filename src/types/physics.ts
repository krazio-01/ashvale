export type PhysicsBodyKind = "sheet";

export type PhysicsDetail = "full" | "reduced" | "frozen";

export interface IVector3 {
    x: number;
    y: number;
    z: number;
}

export interface IPhysicsFeel {
    stiffness: number;
    bendStiffness: number;
    damping: number;
    gravityScale: number;
    windExposure: number;
    tetherSlack: number;
    contactFriction: number;
    impulseScale: number;
}

export interface IPhysicsBodyDefinition {
    name: string;
    kind: PhysicsBodyKind;
    attachBone: string;
    columns: number;
    rows: number;
    nodeBones: string[];
    restOffsets: number[];
    ignoredColliders?: string[];
    feel?: Partial<IPhysicsFeel>;
}

export interface IPhysicsCollider {
    bone: string;
    start: [number, number, number];
    end: [number, number, number];
    radius: number;
}

export interface IPhysicsDefinition {
    version: 1;
    bodies: IPhysicsBodyDefinition[];
    colliders: IPhysicsCollider[];
}

export interface IPhysicsBinding {
    prepareFrame(): void;
    unitScale(bodyIndex: number): number;
    anchorWorld(bodyIndex: number, nodeIndex: number, out: IVector3): void;
    colliderWorld(colliderIndex: number, outStart: IVector3, outEnd: IVector3): number;
    writeNode(
        bodyIndex: number,
        nodeIndex: number,
        position: IVector3,
        down: IVector3,
        across: IVector3
    ): void;
}
