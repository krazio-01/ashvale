import type { Vector3 } from "three";
import { TARGETING } from "@/constants/combat";
import { horizontalDistance } from "@/lib/helpers";
import type { ICombatant } from "@/types/combat";

function signedAngleTo(origin: Vector3, facing: Vector3, point: Vector3): number {
    const dx = point.x - origin.x;
    const dz = point.z - origin.z;
    return Math.atan2(facing.x * dz - facing.z * dx, facing.x * dx + facing.z * dz);
}

function scoreCandidate(
    origin: Vector3,
    facing: Vector3,
    point: Vector3,
    maxRange: number,
    minDot: number,
    isThreat: boolean
): number {
    const dx = point.x - origin.x;
    const dz = point.z - origin.z;
    const distance = Math.hypot(dx, dz);

    if (distance > maxRange) return Number.NEGATIVE_INFINITY;
    if (distance < 1e-4) return TARGETING.angleWeight + TARGETING.distanceWeight;

    const dot = (dx * facing.x + dz * facing.z) / distance;
    if (dot < minDot) return Number.NEGATIVE_INFINITY;

    return (
        TARGETING.angleWeight * dot +
        TARGETING.distanceWeight * (1 - distance / maxRange) +
        (isThreat ? TARGETING.threatBonus : 0)
    );
}

export function selectTarget(
    origin: Vector3,
    facing: Vector3,
    candidates: readonly ICombatant[],
    maxRange: number,
    minDot: number
): ICombatant | null {
    let best: ICombatant | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
        if (candidate.isDead) continue;

        const score = scoreCandidate(
            origin,
            facing,
            candidate.sceneObject.position,
            maxRange,
            minDot,
            candidate.isAttacking
        );

        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }

    return best;
}

export function cycleTarget(
    origin: Vector3,
    facing: Vector3,
    current: ICombatant | null,
    candidates: readonly ICombatant[],
    step: 1 | -1,
    maxRange: number
): ICombatant | null {
    const currentAngle = current ? signedAngleTo(origin, facing, current.sceneObject.position) : 0;
    let chosen: ICombatant | null = null;
    let chosenGap = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        if (candidate.isDead || candidate === current) continue;

        const position = candidate.sceneObject.position;
        if (horizontalDistance(origin, position) > maxRange) continue;

        const gap = (signedAngleTo(origin, facing, position) - currentAngle) * step;
        if (gap > 0 && gap < chosenGap) {
            chosen = candidate;
            chosenGap = gap;
        }
    }

    if (chosen) return chosen;
    return current && !current.isDead ? current : null;
}
