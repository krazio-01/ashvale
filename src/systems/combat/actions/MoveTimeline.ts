import { PROJECTILES, ATTACK_WARNING } from "@/constants/combat";
import type { IMoveDefinition, IMoveWindow, MoveTag, AttackWarningDanger } from "@/types/combat";

export function isWithin(window: IMoveWindow | undefined, time: number): boolean {
    return window !== undefined && time >= window.from && time <= window.to;
}

export function overlapsInterval(window: IMoveWindow, from: number, to: number): boolean {
    return window.from <= to && window.to >= from;
}

export function hasCrossed(mark: number | undefined, previous: number, current: number): boolean {
    return mark !== undefined && previous < mark && current >= mark;
}

export function allowsCancel(
    move: IMoveDefinition,
    time: number,
    tag: MoveTag,
    opensEarly: boolean
): boolean {
    for (const cancel of move.cancels)
        if (cancel.into.includes(tag) && (opensEarly ? time <= cancel.to : isWithin(cancel, time)))
            return true;
    return false;
}

export function secondsSinceStart(window: IMoveWindow, time: number, moveSeconds: number): number {
    return Math.max(0, time - window.from) * moveSeconds;
}

export function isStrikeMove(move: IMoveDefinition): boolean {
    return move.hits.length > 0 || move.projectile !== undefined;
}

export function firstStrikeAt(move: IMoveDefinition): number | null {
    let strikeAt = move.projectile?.at ?? Number.POSITIVE_INFINITY;
    for (const hit of move.hits) strikeAt = Math.min(strikeAt, hit.from);
    return Number.isFinite(strikeAt) ? strikeAt : null;
}

export function attackWarningTime(
    move: IMoveDefinition,
    moveSecondsDuringWindup: number
): number | null {
    const strikeAt = firstStrikeAt(move);
    if (strikeAt === null) return null;
    return Math.max(
        0,
        strikeAt - ATTACK_WARNING.flashLeadSeconds / Math.max(moveSecondsDuringWindup, 1e-3)
    );
}

export function attackWarningDanger(move: IMoveDefinition): AttackWarningDanger {
    const isDodgeOnly =
        move.hits.some((hit) => hit.dodgeOnly) ||
        (move.projectile !== undefined && PROJECTILES[move.projectile.kind].dodgeOnly);
    return isDodgeOnly ? "dodgeOnly" : "parryable";
}
