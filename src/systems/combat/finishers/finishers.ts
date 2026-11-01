import { CLIP } from "@/constants/characters";
import { metresToUnits } from "@/lib/helpers";
import type { IFinisherDefinition } from "@/types/combat";

const MOCAP_TO_PLAYER_SCALE = 2.1 / 1.83;

const KICKDOWN_FINISHER_PLACEMENT = {
    distance: metresToUnits(0.902 * MOCAP_TO_PLAYER_SCALE),
    bearing: -0.154,
    relativeYaw: 2.939,
};

const KNOCKDOWN_FINISHER_PLACEMENT = {
    distance: metresToUnits(0.944 * MOCAP_TO_PLAYER_SCALE),
    bearing: -0.686,
    relativeYaw: 2.601,
};

const FACING_VICTIM = { bearing: 0, relativeYaw: Math.PI };
const BEHIND_VICTIM = { bearing: 0, relativeYaw: 0 };

export const FINISHERS: readonly IFinisherDefinition[] = [
    {
        id: "kickdown",
        kind: "execution",
        attackerClip: CLIP.finisherKickdownAttacker,
        finisherVictimClip: CLIP.finisherKickdownVictim,
        ...KICKDOWN_FINISHER_PLACEMENT,
        killAt: 0.45,
    },
    {
        id: "knockdown",
        kind: "execution",
        attackerClip: CLIP.finisherKnockdownAttacker,
        finisherVictimClip: CLIP.finisherKnockdownVictim,
        ...KNOCKDOWN_FINISHER_PLACEMENT,
        killAt: 0.5,
    },
    {
        id: "execution-slash",
        kind: "execution",
        attackerClip: CLIP.finisherExecution,
        finisherVictimClip: null,
        distance: metresToUnits(1.5),
        ...FACING_VICTIM,
        blendInSeconds: 0.2,
        impactAt: [0.28],
        victimDeath: CLIP.deathKnockback,
        killAt: 0.29,
    },
    {
        id: "execution-slam",
        kind: "execution",
        attackerClip: CLIP.finisherExecutionSlam,
        finisherVictimClip: null,
        distance: metresToUnits(1.5),
        ...FACING_VICTIM,
        blendInSeconds: 0.2,
        impactAt: [0.17],
        victimDeath: CLIP.deathKnockback,
        killAt: 0.18,
    },
    {
        id: "counter-kickdown",
        kind: "counter",
        attackerClip: CLIP.finisherKickdownAttacker,
        finisherVictimClip: CLIP.finisherKickdownVictim,
        ...KICKDOWN_FINISHER_PLACEMENT,
        killAt: 0.45,
    },
    {
        id: "backstab",
        kind: "backstab",
        attackerClip: CLIP.finisherBackstab,
        finisherVictimClip: null,
        distance: metresToUnits(0.8),
        ...BEHIND_VICTIM,
        killAt: 0.5,
    },
];
