import { SCALE, metresToUnits } from "@/constants/world";
import { CLIP } from "@/constants/characters";
import type { IFinisherDefinition } from "@/types/combat";

const MOCAP_ACTOR_HEIGHT_METRES = 1.83;

const MOCAP_TO_PLAYER_SCALE = SCALE.heroHeightMetres / MOCAP_ACTOR_HEIGHT_METRES;

const BEHIND_VICTIM = { bearing: 0, relativeYaw: 0 };

const KICKDOWN = {
    attackerClip: CLIP.finisherKickdownAttacker,
    finisherVictimClip: CLIP.finisherKickdownVictim,
    distance: metresToUnits(0.902 * MOCAP_TO_PLAYER_SCALE),
    bearing: -0.154,
    relativeYaw: 2.939,
    killAt: 0.45,
};

const FRONTAL_EXECUTION = {
    finisherVictimClip: null,
    distance: metresToUnits(1.5),
    bearing: 0,
    relativeYaw: Math.PI,
    blendInSeconds: 0.2,
    victimDeath: CLIP.deathKnockback,
};

export const FINISHERS: readonly IFinisherDefinition[] = [
    { id: "kickdown", kind: "execution", ...KICKDOWN },
    {
        id: "knockdown",
        kind: "execution",
        attackerClip: CLIP.finisherKnockdownAttacker,
        finisherVictimClip: CLIP.finisherKnockdownVictim,
        distance: metresToUnits(0.944 * MOCAP_TO_PLAYER_SCALE),
        bearing: -0.686,
        relativeYaw: 2.601,
        killAt: 0.5,
    },
    {
        id: "execution-slash",
        kind: "execution",
        attackerClip: CLIP.finisherExecution,
        ...FRONTAL_EXECUTION,
        impactAt: [0.28],
        killAt: 0.29,
    },
    {
        id: "execution-slam",
        kind: "execution",
        attackerClip: CLIP.finisherExecutionSlam,
        ...FRONTAL_EXECUTION,
        impactAt: [0.17],
        killAt: 0.18,
    },
    { id: "counter-kickdown", kind: "counter", ...KICKDOWN },
    {
        id: "backstab",
        kind: "backstab",
        attackerClip: CLIP.finisherBackstab,
        finisherVictimClip: null,
        distance: metresToUnits(0.8),
        ...BEHIND_VICTIM,
        killAt: 0.5,
        isSilent: true,
    },
];
