import type { Object3D, Vector3Tuple } from "three";

export type Handedness = "right" | "left";

export interface IHandRig {
    hand: Object3D;
    indexBase: Object3D;
    middleBase: Object3D;
    ringBase: Object3D;
    pinkyBase: Object3D | null;
    thumbBase: Object3D;
}

export type WeaponMount = "hand" | "carry";

export interface IWeaponCarry {
    bone: string;
    position: Vector3Tuple;
    rotationDegrees: Vector3Tuple;
}

export interface ICarryRig {
    bone: Object3D;
}

export interface IWeaponSpec {
    id: string;
    modelPath: string;
    gripHand: Handedness;
    handleCentreFraction: number;
    gripRoll: number;
    worldLength: number;
    guardFraction: number;
    damage: number;
    carry?: IWeaponCarry;
}

export interface IMeleeWeaponSpec extends IWeaponSpec {
    kind: "melee";
    bladeRadius: number;
    trailColor: string;
}

export type WeaponDefinition = IMeleeWeaponSpec;
