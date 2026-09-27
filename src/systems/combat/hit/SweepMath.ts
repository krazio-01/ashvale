import type { Vector3 } from "three";
import { clamp } from "@/lib/helpers";

const EPSILON = 1e-9;

function segmentDistanceSquared(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
    const d1x = q1.x - p1.x;
    const d1y = q1.y - p1.y;
    const d1z = q1.z - p1.z;
    const d2x = q2.x - p2.x;
    const d2y = q2.y - p2.y;
    const d2z = q2.z - p2.z;
    const rx = p1.x - p2.x;
    const ry = p1.y - p2.y;
    const rz = p1.z - p2.z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z;
    const e = d2x * d2x + d2y * d2y + d2z * d2z;
    const f = d2x * rx + d2y * ry + d2z * rz;

    let s = 0;
    let t = 0;

    if (a <= EPSILON && e <= EPSILON) return rx * rx + ry * ry + rz * rz;

    if (a <= EPSILON) {
        t = clamp(f / e, 0, 1);
    } else {
        const c = d1x * rx + d1y * ry + d1z * rz;

        if (e <= EPSILON) {
            s = clamp(-c / a, 0, 1);
        } else {
            const b = d1x * d2x + d1y * d2y + d1z * d2z;
            const denominator = a * e - b * b;
            s = denominator > EPSILON ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
            t = (b * s + f) / e;

            if (t < 0) {
                t = 0;
                s = clamp(-c / a, 0, 1);
            } else if (t > 1) {
                t = 1;
                s = clamp((b - c) / a, 0, 1);
            }
        }
    }

    const cx = p1.x + d1x * s - (p2.x + d2x * t);
    const cy = p1.y + d1y * s - (p2.y + d2y * t);
    const cz = p1.z + d1z * s - (p2.z + d2z * t);

    return cx * cx + cy * cy + cz * cz;
}

export function capsulesOverlap(
    aStart: Vector3,
    aEnd: Vector3,
    aRadius: number,
    bStart: Vector3,
    bEnd: Vector3,
    bRadius: number
): boolean {
    const reach = aRadius + bRadius;
    return segmentDistanceSquared(aStart, aEnd, bStart, bEnd) <= reach * reach;
}
