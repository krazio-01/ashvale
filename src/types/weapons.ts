import type { Object3D } from "three";

type Handedness = "right" | "left";

export interface IHandRig {
    hand: Object3D;
    indexBase: Object3D;
    middleBase: Object3D;
    ringBase: Object3D;
    pinkyBase: Object3D | null;
    thumbBase: Object3D;
}

export interface IWeaponSpec {
    id: string;
    modelPath: string;
    gripHand: Handedness;
    handleCentreFraction: number;
    gripRoll: number;
    worldLength: number;
    damage: number;
}

export interface IMeleeWeaponSpec extends IWeaponSpec {
    kind: "melee";
    guardFraction: number;
    bladeRadius: number;
    trailColor: string;
}

export type WeaponDefinition = IMeleeWeaponSpec;
