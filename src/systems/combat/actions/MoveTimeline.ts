import { PROJECTILES, TELEGRAPH } from "@/constants/combat";
import type { IMoveDefinition, IMoveWindow, MoveTag, TelegraphDanger } from "@/types/combat";

export function isWithin(window: IMoveWindow | undefined, time: number): boolean {
    return window !== undefined && time >= window.from && time <= window.to;
}

export function overlapsInterval(window: IMoveWindow, from: number, to: number): boolean {
    return window.from <= to && window.to >= from;
}

export function hasCrossed(mark: number | undefined, previous: number, current: number): boolean {
    return mark !== undefined && previous < mark && current >= mark;
}

export function allowsCancel(move: IMoveDefinition, time: number, tag: MoveTag): boolean {
    for (const cancel of move.cancels)
        if (cancel.into.includes(tag) && isWithin(cancel, time)) return true;
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

export function telegraphTime(move: IMoveDefinition, windupUnitSeconds: number): number | null {
    const strikeAt = firstStrikeAt(move);
    if (strikeAt === null) return null;
    return Math.max(0, strikeAt - TELEGRAPH.leadSeconds / Math.max(windupUnitSeconds, 1e-3));
}

export function telegraphDanger(move: IMoveDefinition): TelegraphDanger {
    const isPerilous =
        move.hits.some((hit) => hit.perilous) ||
        (move.projectile !== undefined && PROJECTILES[move.projectile.kind].perilous);
    return isPerilous ? "perilous" : "parryable";
}
