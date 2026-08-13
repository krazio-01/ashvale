import type { Vector3Tuple } from "three";

export function vec3(x: number, y: number, z: number): Vector3Tuple {
    return [x, y, z];
}

export function pair(a: number, b: number): [number, number] {
    return [a, b];
}
