import { CLIP } from "@/constants/characters";
import { metres } from "@/lib/helpers";
import {
    enemyMoveSet,
    strike,
    strikeWithRecovery,
} from "@/systems/combat/moveSets/enemy/enemyMoveKit";
import { WEAPON_HIT_SHAPE } from "@/systems/combat/moveSets/moveDefinition";

export const SENTINEL_MOVE_IDS = {
    slashA: "sentinel_slash_a",
    slashB: "sentinel_slash_b",
    slashC: "sentinel_slash_c",
    cleave: "sentinel_cleave",
    risingCut: "sentinel_rising_cut",
    lunge: "sentinel_lunge",
    thrust: "sentinel_thrust",
};

export const SENTINEL_MOVES = enemyMoveSet(
    [
        ...strikeWithRecovery(
            {
                id: SENTINEL_MOVE_IDS.slashA,
                clip: CLIP.enemySlashA,
                window: [0.5, 0.75],
                shape: WEAPON_HIT_SHAPE,
                damageScale: 1,
                poiseDamage: 14,
                impact: "light",
                knockback: 3,
                swing: "side",
                chainAt: 0.75,
            },
            CLIP.enemySlashARecover
        ),
        ...strikeWithRecovery(
            {
                id: SENTINEL_MOVE_IDS.slashB,
                clip: CLIP.enemySlashB,
                window: [0.4, 0.67],
                shape: WEAPON_HIT_SHAPE,
                damageScale: 1,
                poiseDamage: 14,
                impact: "light",
                knockback: 3,
                swing: "side",
                chainAt: 0.67,
            },
            CLIP.enemySlashBRecover
        ),
        strike({
            id: SENTINEL_MOVE_IDS.slashC,
            clip: CLIP.enemySlashC,
            window: [0.3, 0.35],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.4,
            poiseDamage: 24,
            impact: "heavy",
            knockback: 6,
            swing: "side",
        }),
        strike({
            id: SENTINEL_MOVE_IDS.cleave,
            clip: CLIP.enemyCleave,
            window: [0.22, 0.29],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.5,
            poiseDamage: 30,
            impact: "heavy",
            knockback: 7,
            swing: "high",
        }),
        strike({
            id: SENTINEL_MOVE_IDS.risingCut,
            clip: CLIP.enemyRisingCut,
            window: [0.21, 0.3],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.1,
            poiseDamage: 18,
            impact: "light",
            knockback: 4,
            swing: "high",
        }),
        strike({
            id: SENTINEL_MOVE_IDS.lunge,
            clip: CLIP.swordDash,
            window: [0.17, 0.26],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.2,
            poiseDamage: 18,
            impact: "light",
            knockback: 5,
            swing: "side",
            warp: { from: 0, to: 0.17, maxDistance: metres(3), strikeDistance: metres(0.6) },
        }),
        strike({
            id: SENTINEL_MOVE_IDS.thrust,
            clip: CLIP.enemyThrust,
            window: [0.24, 0.32],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.8,
            poiseDamage: 40,
            impact: "heavy",
            knockback: 8,
            swing: "side",
            perilous: true,
        }),
    ],
    CLIP.dodgeBackstep
);
