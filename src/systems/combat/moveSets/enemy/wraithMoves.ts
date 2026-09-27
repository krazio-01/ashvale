import { CLIP } from "@/constants/characters";
import { metres } from "@/lib/helpers";
import { cast, enemyMoveSet, strike } from "@/systems/combat/moveSets/enemy/enemyMoveKit";

const LAUNCH_AT = 0.3;

export const WRAITH_MOVE_IDS = {
    bolt: "wraith_bolt",
    followUpBolt: "wraith_bolt_2",
    blast: "wraith_blast",
    scratch: "wraith_scratch",
};

export const WRAITH_MOVES = enemyMoveSet(
    [
        cast({
            id: WRAITH_MOVE_IDS.bolt,
            clip: CLIP.enemyHurl,
            playbackRate: 1.2,
            projectile: { at: LAUNCH_AT, kind: "bolt", socket: "hand_r" },
            chainAt: 0.5,
        }),
        cast({
            id: WRAITH_MOVE_IDS.followUpBolt,
            clip: CLIP.enemyHurl,
            playbackRate: 1.2,
            projectile: { at: LAUNCH_AT, kind: "bolt", socket: "hand_r" },
        }),
        cast({
            id: WRAITH_MOVE_IDS.blast,
            clip: CLIP.enemyHurl,
            playbackRate: 0.75,
            projectile: { at: LAUNCH_AT, kind: "blast", socket: "hand_r" },
        }),
        strike({
            id: WRAITH_MOVE_IDS.scratch,
            clip: CLIP.enemyScratch,
            playbackRate: 1.2,
            window: [0.3, 0.39],
            shape: { kind: "socket", bone: "hand_r", radius: metres(0.35) },
            damageScale: 1,
            poiseDamage: 12,
            impact: "light",
            knockback: 3,
        }),
    ],
    CLIP.dodgeBackstep
);
