import { CLIP } from "@/constants/characters";
import { metres } from "@/lib/helpers";
import { enemyMoveSet, strike } from "@/systems/combat/moveSets/enemy/enemyMoveKit";
import { WEAPON_HIT_SHAPE } from "@/systems/combat/moveSets/moveDefinition";

export const GOLEM_MOVE_IDS = {
    greatCleave: "golem_great_cleave",
    backhand: "golem_backhand",
    lowSweep: "golem_low_sweep",
    slam: "golem_slam",
};

export const GOLEM_MOVES = enemyMoveSet(
    [
        strike({
            id: GOLEM_MOVE_IDS.greatCleave,
            clip: CLIP.enemyGreatCleave,
            window: [0.31, 0.4],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.6,
            poiseDamage: 40,
            impact: "heavy",
            knockback: 8,
            swing: "high",
            armor: { from: 0.1, to: 0.4 },
        }),
        strike({
            id: GOLEM_MOVE_IDS.backhand,
            clip: CLIP.enemyBackhand,
            window: [0.21, 0.3],
            shape: { kind: "socket", bone: "hand_l", radius: metres(0.45) },
            damageScale: 1,
            poiseDamage: 25,
            impact: "light",
            knockback: 6,
            swing: "side",
        }),
        strike({
            id: GOLEM_MOVE_IDS.lowSweep,
            clip: CLIP.enemyLowSweep,
            window: [0.26, 0.4],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.8,
            poiseDamage: 50,
            impact: "heavy",
            knockback: 9,
            swing: "side",
            perilous: true,
            armor: { from: 0.1, to: 0.4 },
        }),
        strike({
            id: GOLEM_MOVE_IDS.slam,
            clip: CLIP.enemySwipe,
            playbackRate: 1.6,
            window: [0.42, 0.48],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.6,
            poiseDamage: 40,
            impact: "heavy",
            knockback: 8,
            swing: "high",
            armor: { from: 0.2, to: 0.48 },
        }),
    ],
    CLIP.dodgeBackstep
);
