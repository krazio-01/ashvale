import { SCALE } from "@/constants/world";
import { Color, MathUtils, Vector3 } from "three";
import type { Box3, Object3D, Vector3Tuple } from "three";
import { CONTROL_TEXT, ERRORS } from "@/constants/strings";
import type { IQuaternion } from "@/types/physics";
import type { IRepoReference } from "@/types/realm";
import type { IColorShift } from "@/types/world";

export const FULL_TURN = Math.PI * 2;

export const QUARTER_TURN = Math.PI / 2;

const REPO_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i;

const SHORTHAND_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

const GIT_SUFFIX_PATTERN = /\.git$/i;

export type RandomSource = () => number;

export interface IPlanarPoint {
    x: number;
    z: number;
}

export interface ISegmentFrame {
    alongX: number;
    alongZ: number;
    acrossX: number;
    acrossZ: number;
    length: number;
}

export type Axis = "x" | "y" | "z";

export interface IBladeAxes {
    size: Vector3;
    lengthAxis: Axis;
    widthAxis: Axis;
    thicknessAxis: Axis;
    tipDirectionSign: 1 | -1;
}

export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

export function lerp(from: number, to: number, ratio: number): number {
    return from + (to - from) * ratio;
}

export function roundTo(value: number, steps: number): number {
    return Math.round(value * steps) / steps;
}

export function range(minimum: number, maximum: number): [number, number] {
    return [minimum, maximum];
}

export function valueInRange([minimum, maximum]: readonly [number, number], ratio: number): number {
    return minimum + ratio * (maximum - minimum);
}

export function vec3(x: number, y: number, z: number): Vector3Tuple {
    return [x, y, z];
}

export function metresToUnits(value: number): number {
    return value * SCALE.unitsPerMetre;
}

export function degreesToRadians(value: number): number {
    return (value * Math.PI) / 180;
}

export function radiansToDegrees(value: number): number {
    return (value * 180) / Math.PI;
}

export function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
    if (edgeEnd === edgeStart) return value < edgeStart ? 0 : 1;

    const ratio = clamp((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);

    return ratio * ratio * (3 - 2 * ratio);
}

export function smoothingFactor(rate: number, deltaSeconds = 1): number {
    return 1 - Math.exp(-rate * deltaSeconds);
}

export function moveTowards(value: number, target: number, maxStep: number): number {
    return target > value ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
}

export function shortestAngleBetween(from: number, to: number): number {
    const difference = (to - from) % FULL_TURN;
    return ((difference + Math.PI * 3) % FULL_TURN) - Math.PI;
}

export function lerpAngle(from: number, to: number, ratio: number): number {
    return from + shortestAngleBetween(from, to) * ratio;
}

export function yawFromDirection(x: number, z: number): number {
    return Math.atan2(x, z);
}

export function yawTowards(from: Vector3, to: Vector3): number {
    return yawFromDirection(to.x - from.x, to.z - from.z);
}

export function horizontalLength(vector: IPlanarPoint): number {
    return Math.hypot(vector.x, vector.z);
}

export function horizontalDistance(from: Vector3, to: Vector3): number {
    return Math.hypot(to.x - from.x, to.z - from.z);
}

export function horizontalDirection(from: Vector3, to: Vector3, out: Vector3): number {
    const offsetX = to.x - from.x;
    const offsetZ = to.z - from.z;
    const distance = Math.hypot(offsetX, offsetZ);

    if (distance > 1e-6) out.set(offsetX / distance, 0, offsetZ / distance);
    else out.set(0, 0, 0);

    return distance;
}

export function forwardFromYaw(yaw: number, out: Vector3, length = 1): Vector3 {
    return out.set(Math.sin(yaw) * length, 0, Math.cos(yaw) * length);
}

export function pointAtYaw(
    centre: Vector3,
    yaw: number,
    distance: number,
    out: Vector3,
    y = centre.y
): Vector3 {
    return out.set(centre.x + Math.sin(yaw) * distance, y, centre.z + Math.cos(yaw) * distance);
}

export function pointAtAngle(
    centreX: number,
    centreZ: number,
    angle: number,
    distance: number
): [number, number] {
    return [centreX + Math.cos(angle) * distance, centreZ + Math.sin(angle) * distance];
}

export function randomPointInDisc(nextRandom: RandomSource, radius: number): [number, number] {
    return pointAtAngle(0, 0, nextRandom() * FULL_TURN, Math.sqrt(nextRandom()) * radius);
}

export function distanceOutsideBox(
    x: number,
    z: number,
    centerX: number,
    centerZ: number,
    halfWidth: number,
    halfDepth: number
): number {
    const outsideX = Math.max(Math.abs(x - centerX) - halfWidth, 0);
    const outsideZ = Math.max(Math.abs(z - centerZ) - halfDepth, 0);

    return Math.hypot(outsideX, outsideZ);
}

export function distanceToSegmentSquared(
    pointX: number,
    pointZ: number,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number
): number {
    const spanX = toX - fromX;
    const spanZ = toZ - fromZ;
    const spanLengthSquared = spanX * spanX + spanZ * spanZ;
    const along =
        spanLengthSquared > 0
            ? clamp(((pointX - fromX) * spanX + (pointZ - fromZ) * spanZ) / spanLengthSquared, 0, 1)
            : 0;
    const gapX = pointX - (fromX + along * spanX);
    const gapZ = pointZ - (fromZ + along * spanZ);

    return gapX * gapX + gapZ * gapZ;
}

export function distanceToSegment(
    pointX: number,
    pointZ: number,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number
): number {
    return Math.sqrt(distanceToSegmentSquared(pointX, pointZ, fromX, fromZ, toX, toZ));
}

export function smoothCurveValue(
    before: number,
    start: number,
    end: number,
    after: number,
    travelRatio: number
): number {
    const squared = travelRatio * travelRatio;
    const cubed = squared * travelRatio;

    return (
        0.5 *
        (2 * start +
            (end - before) * travelRatio +
            (2 * before - 5 * start + 4 * end - after) * squared +
            (-before + 3 * start - 3 * end + after) * cubed)
    );
}

export function resampleSmoothPath<Point extends IPlanarPoint, Output>(
    points: readonly Point[],
    pointSpacing: number,
    createPoint: (x: number, z: number, start: Point, end: Point, travelRatio: number) => Output,
    copyLastPoint: (last: Point) => Output
): Output[] {
    const resampled: Output[] = [];

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const before = points[index - 1] ?? start;
        const after = points[index + 2] ?? end;
        const steps = Math.max(
            Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / pointSpacing),
            1
        );

        for (let step = 0; step < steps; step += 1) {
            const travelRatio = step / steps;
            resampled.push(
                createPoint(
                    smoothCurveValue(before.x, start.x, end.x, after.x, travelRatio),
                    smoothCurveValue(before.z, start.z, end.z, after.z, travelRatio),
                    start,
                    end,
                    travelRatio
                )
            );
        }
    }

    const last = points[points.length - 1];
    if (last) resampled.push(copyLastPoint(last));

    return resampled;
}

export function accumulatePathLengths(
    points: readonly IPlanarPoint[],
    out: Float32Array | Float64Array
): number {
    let travelled = 0;
    if (points.length > 0) out[0] = 0;

    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        const previous = points[index - 1];
        travelled += Math.hypot(point.x - previous.x, point.z - previous.z);
        out[index] = travelled;
    }

    return travelled;
}

export function pathDirectionAt(
    points: readonly IPlanarPoint[],
    index: number,
    out: IPlanarPoint
): IPlanarPoint {
    const point = points[index];
    const previous = points[index - 1] ?? point;
    const next = points[index + 1] ?? point;
    const { alongX, alongZ } = segmentFrame(previous.x, previous.z, next.x, next.z);
    out.x = alongX;
    out.z = alongZ;
    return out;
}

export function segmentFrame(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number
): ISegmentFrame {
    const length = Math.hypot(toX - fromX, toZ - fromZ);
    const alongX = (toX - fromX) / (length || 1);
    const alongZ = (toZ - fromZ) / (length || 1);
    return { alongX, alongZ, acrossX: -alongZ, acrossZ: alongX, length };
}

export function firstFit<Result>(attempts: number, tryOnce: () => Result | null): Result | null {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const result = tryOnce();
        if (result !== null) return result;
    }
    return null;
}

export function countDownTimers<Key>(timers: Map<Key, number>, elapsedSeconds: number): void {
    timers.forEach((remaining, key) => {
        const left = remaining - elapsedSeconds;
        if (left <= 0) timers.delete(key);
        else timers.set(key, left);
    });
}

export function hashString(value: string): number {
    let hash = 0;

    for (let index = 0; index < value.length; index++)
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;

    return hash;
}

export function createSeededRandom(seed: number): RandomSource {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function randomOffset(nextRandom: RandomSource, maximumOffset: number): number {
    return (nextRandom() * 2 - 1) * maximumOffset;
}

export function pickRandom<T>(items: readonly T[], nextRandom: RandomSource = Math.random): T {
    const picked = items[Math.floor(nextRandom() * items.length)];

    if (picked === undefined) throw new Error(ERRORS.pickFromEmptyList);

    return picked;
}

export function pickRandomOrNull<T>(items: readonly T[], nextRandom: RandomSource): T | null {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];

    return items[Math.floor(nextRandom() * items.length)];
}

export function pickRandomSubset<T>(items: T[], count: number, nextRandom: RandomSource): T[] {
    const shuffled = [...items];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(nextRandom() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled.slice(0, count);
}

export function keyLabel(code: string): string {
    return CONTROL_TEXT.keyLabels[code] ?? code.replace(/^(Key|Digit)/, "");
}

export function parseRepoInput(rawInput: string): IRepoReference | null {
    const trimmed = rawInput.trim().replace(/\/+$/, "");
    if (!trimmed) return null;

    const match = trimmed.match(REPO_URL_PATTERN) ?? trimmed.match(SHORTHAND_PATTERN);
    const [, owner, rawName] = match ?? [];
    if (!owner || !rawName) return null;

    const name = rawName.replace(GIT_SUFFIX_PATTERN, "");
    if (!name) return null;

    return { owner, name };
}

export function yawQuaternion(yaw: number): IQuaternion {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export function asArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

export function mapFields<Source extends object, Key extends keyof Source>(
    source: Source,
    keys: readonly Key[],
    transform: (value: Source[Key]) => Source[Key]
): Source {
    const mapped = { ...source };
    for (const key of keys) mapped[key] = transform(source[key]);
    return mapped;
}

export function gridQuadIndices(
    rows: number,
    columns: number,
    vertexAt: (row: number, column: number) => number,
    keepQuad: (nearLeft: number, nearRight: number, farLeft: number, farRight: number) => boolean
): Uint32Array {
    const indices: number[] = [];

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const nearLeft = vertexAt(row, column);
            const nearRight = vertexAt(row, column + 1);
            const farLeft = vertexAt(row + 1, column);
            const farRight = vertexAt(row + 1, column + 1);

            if (!keepQuad(nearLeft, nearRight, farLeft, farRight)) continue;

            indices.push(nearLeft, farLeft, nearRight, nearRight, farLeft, farRight);
        }
    }

    return new Uint32Array(indices);
}

export function freezeTransform(object: Object3D): void {
    object.matrixAutoUpdate = false;
    object.updateMatrix();
    object.updateMatrixWorld(true);
    object.matrixWorldAutoUpdate = false;
}

export function blendColors(fromHex: string, toHex: string, ratio: number): string {
    const blended = new Color(fromHex).lerp(new Color(toHex), clamp(ratio, 0, 1));

    return `#${blended.getHexString()}`;
}

export function shiftColorHsl(
    hex: string,
    { hueShift, saturationScale, lightnessShift }: IColorShift
): string {
    const hsl = { h: 0, s: 0, l: 0 };
    new Color(hex).getHSL(hsl);

    const shifted = new Color().setHSL(
        MathUtils.euclideanModulo(hsl.h + hueShift, 1),
        clamp(hsl.s * saturationScale, 0, 1),
        clamp(hsl.l + lightnessShift, 0, 1)
    );

    return `#${shifted.getHexString()}`;
}

export function tintKeepingLightness(
    hex: string,
    tintHex: string,
    strength: number,
    lightnessShift: number
): string {
    const source = new Color(hex);
    const sourceHsl = { h: 0, s: 0, l: 0 };
    const tintedHsl = { h: 0, s: 0, l: 0 };

    source.getHSL(sourceHsl);
    source
        .clone()
        .lerp(new Color(tintHex), clamp(strength, 0, 1))
        .getHSL(tintedHsl);

    const tinted = new Color().setHSL(
        tintedHsl.h,
        tintedHsl.s,
        clamp(sourceHsl.l + lightnessShift, 0, 1)
    );

    return `#${tinted.getHexString()}`;
}

export function axisVector(axis: Axis, sign: number, out: Vector3): Vector3 {
    out.set(0, 0, 0);
    out[axis] = sign;
    return out;
}

export function measureBladeAxes(bounds: Box3): IBladeAxes {
    const size = bounds.getSize(new Vector3());
    const axes = ["x", "y", "z"] as const;
    const lengthAxis = axes.reduce((longer, axis) => (size[axis] > size[longer] ? axis : longer));
    const widthAxis = axes
        .filter((axis) => axis !== lengthAxis)
        .reduce((wider, axis) => (size[axis] > size[wider] ? axis : wider));
    const thicknessAxis = axes.find((axis) => axis !== lengthAxis && axis !== widthAxis) as Axis;
    const tipAtMaximum = Math.abs(bounds.max[lengthAxis]) >= Math.abs(bounds.min[lengthAxis]);
    return {
        size,
        lengthAxis,
        widthAxis,
        thicknessAxis,
        tipDirectionSign: tipAtMaximum ? 1 : -1,
    };
}
