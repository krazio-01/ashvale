import { Color } from "three";
import type { Vector3Tuple } from "three";

export function vec3(x: number, y: number, z: number): Vector3Tuple {
    return [x, y, z];
}

export function pair(a: number, b: number): [number, number] {
    return [a, b];
}

export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

export function lerp(from: number, to: number, ratio: number): number {
    return from + (to - from) * ratio;
}

export function hashString(value: string): number {
    let hash = 0;

    for (let index = 0; index < value.length; index++)
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;

    return hash;
}

export function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function blendColors(fromHex: string, toHex: string, ratio: number): string {
    const blended = new Color(fromHex).lerp(new Color(toHex), clamp(ratio, 0, 1));

    return `#${blended.getHexString()}`;
}

export function shiftColorHsl(
    hex: string,
    hueShift: number,
    saturationScale: number,
    lightnessShift: number
): string {
    const hsl = { h: 0, s: 0, l: 0 };
    new Color(hex).getHSL(hsl);

    const shifted = new Color().setHSL(
        (((hsl.h + hueShift) % 1) + 1) % 1,
        clamp(hsl.s * saturationScale, 0, 1),
        clamp(hsl.l + lightnessShift, 0, 1)
    );

    return `#${shifted.getHexString()}`;
}
