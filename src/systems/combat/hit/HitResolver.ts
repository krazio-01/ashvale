import type { IHitOutcome, ImpactTier, ReactionTier } from "@/types/combat";

type DefenseResult = "ignored" | "evaded" | "perfectEvaded" | "parried" | "connected";

export interface IDefenderSnapshot {
    isDead: boolean;
    isUntouchable: boolean;
    isInvulnerable: boolean;
    isDodging: boolean;
    invulnerableSeconds: number;
    isParrying: boolean;
    isArmored: boolean;
    isStaggered: boolean;
}

const REACTION_BY_IMPACT: Record<ImpactTier, ReactionTier> = {
    light: "flinch",
    heavy: "knockback",
    finisher: "knockdown",
};

export function resolveDefense(
    defender: IDefenderSnapshot,
    parryable: boolean,
    perilous: boolean,
    perfectWindowSeconds: number
): DefenseResult {
    if (defender.isDead || defender.isUntouchable) return "ignored";
    if (defender.isInvulnerable)
        return defender.isDodging && defender.invulnerableSeconds <= perfectWindowSeconds
            ? "perfectEvaded"
            : "evaded";
    if (defender.isParrying && parryable && !perilous) return "parried";

    return "connected";
}

export function isConnected(outcome: IHitOutcome): boolean {
    return outcome.kind === "damaged" || outcome.kind === "staggered" || outcome.kind === "killed";
}

export function reactionFor(impact: ImpactTier, defender: IDefenderSnapshot): ReactionTier {
    if (defender.isArmored || defender.isStaggered) return "none";
    return REACTION_BY_IMPACT[impact];
}
