import { FINISHER_RULES } from "@/constants/combat";
import type { AwarenessState, FinisherKind, IFinisherDefinition } from "@/types/combat";

interface IFinisherCandidate {
    isDead: boolean;
    isStaggered: boolean;
    healthFraction: number;
    awareness: AwarenessState;
    canBeCounterKilled: boolean;
}

export function isBehind(
    victimYaw: number,
    victimX: number,
    victimZ: number,
    attackerX: number,
    attackerZ: number
): boolean {
    const dx = attackerX - victimX;
    const dz = attackerZ - victimZ;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) return false;

    const facingDot = (Math.sin(victimYaw) * dx + Math.cos(victimYaw) * dz) / length;
    return facingDot <= -FINISHER_RULES.backstabConeCos;
}

export function finisherKindFor(
    victim: IFinisherCandidate,
    edgeGap: number,
    attackerIsBehind: boolean,
    inStreak: boolean
): FinisherKind | null {
    if (victim.isDead) return null;

    if (victim.awareness !== "alert" && attackerIsBehind && edgeGap <= FINISHER_RULES.backstabReach)
        return "backstab";

    const executeBelow = victim.canBeCounterKilled
        ? FINISHER_RULES.basicExecutionHealthFraction
        : FINISHER_RULES.toughExecutionHealthFraction;
    const isOpened = victim.isStaggered || victim.healthFraction <= executeBelow;

    if (
        inStreak &&
        edgeGap <= FINISHER_RULES.streakReach &&
        (victim.canBeCounterKilled || isOpened)
    )
        return "execution";

    return edgeGap <= FINISHER_RULES.executionReach && isOpened ? "execution" : null;
}

export function selectFinisher(
    library: readonly IFinisherDefinition[],
    kind: FinisherKind,
    lastUsedId: string | null,
    random: () => number
): IFinisherDefinition | null {
    const valid = library.filter((finisher) => finisher.kind === kind);
    if (valid.length === 0) return null;

    const fresh = valid.length > 1 ? valid.filter((finisher) => finisher.id !== lastUsedId) : valid;
    return fresh[Math.floor(random() * fresh.length)] ?? null;
}
