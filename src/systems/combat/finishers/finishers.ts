import { CLIP } from "@/constants/characters";
import { metres } from "@/lib/helpers";
import type { IFinisherDefinition } from "@/types/combat";

const MOCAP_TO_PLAYER_SCALE = 2.1 / 1.83;

const KICKDOWN_PAIRING = {
    distance: metres(0.902 * MOCAP_TO_PLAYER_SCALE),
    bearing: -0.154,
    relativeYaw: 2.939,
};

const KNOCKDOWN_PAIRING = {
    distance: metres(0.944 * MOCAP_TO_PLAYER_SCALE),
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
        pairedVictimClip: CLIP.finisherKickdownVictim,
        ...KICKDOWN_PAIRING,
        killAt: 0.45,
    },
    {
        id: "knockdown",
        kind: "execution",
        attackerClip: CLIP.finisherKnockdownAttacker,
        pairedVictimClip: CLIP.finisherKnockdownVictim,
        ...KNOCKDOWN_PAIRING,
        killAt: 0.5,
    },
    {
        id: "execution-slash",
        kind: "execution",
        attackerClip: CLIP.finisherExecution,
        pairedVictimClip: null,
        distance: metres(1.5),
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
        pairedVictimClip: null,
        distance: metres(1.5),
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
        pairedVictimClip: CLIP.finisherKickdownVictim,
        ...KICKDOWN_PAIRING,
        killAt: 0.45,
    },
    {
        id: "backstab",
        kind: "backstab",
        attackerClip: CLIP.finisherBackstab,
        pairedVictimClip: null,
        distance: metres(0.8),
        ...BEHIND_VICTIM,
        killAt: 0.5,
    },
];
