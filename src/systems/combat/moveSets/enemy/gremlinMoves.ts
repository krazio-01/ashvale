import { CLIP } from "@/constants/characters";
import { metres } from "@/lib/helpers";
import {
    enemyMoveSet,
    strike,
    strikeWithRecovery,
} from "@/systems/combat/moveSets/enemy/enemyMoveKit";
import { WEAPON_HIT_SHAPE } from "@/systems/combat/moveSets/moveDefinition";

export const GREMLIN_MOVE_IDS = {
    jab: "gremlin_jab",
    stab: "gremlin_stab",
    hook: "gremlin_hook",
    scratch: "gremlin_scratch",
    pounce: "gremlin_pounce",
};

export const GREMLIN_MOVES = enemyMoveSet(
    [
        strike({
            id: GREMLIN_MOVE_IDS.jab,
            clip: CLIP.enemyJab,
            playbackRate: 1.2,
            window: [0.16, 0.24],
            shape: { kind: "socket", bone: "hand_l", radius: metres(0.3) },
            damageScale: 0.8,
            poiseDamage: 8,
            impact: "light",
            knockback: 2,
            chainAt: 0.24,
        }),
        strike({
            id: GREMLIN_MOVE_IDS.stab,
            clip: CLIP.enemyPunch,
            playbackRate: 1.2,
            window: [0.17, 0.27],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1,
            poiseDamage: 10,
            impact: "light",
            knockback: 3,
            chainAt: 0.27,
        }),
        ...strikeWithRecovery(
            {
                id: GREMLIN_MOVE_IDS.hook,
                clip: CLIP.enemyHook,
                window: [0.5, 0.64],
                shape: WEAPON_HIT_SHAPE,
                damageScale: 1.2,
                poiseDamage: 14,
                impact: "light",
                knockback: 4,
            },
            CLIP.enemyHookRecover
        ),
        strike({
            id: GREMLIN_MOVE_IDS.scratch,
            clip: CLIP.enemyScratch,
            playbackRate: 1.2,
            window: [0.3, 0.39],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.1,
            poiseDamage: 12,
            impact: "light",
            knockback: 3,
        }),
        strike({
            id: GREMLIN_MOVE_IDS.pounce,
            clip: CLIP.swordDash,
            window: [0.17, 0.26],
            shape: WEAPON_HIT_SHAPE,
            damageScale: 1.2,
            poiseDamage: 14,
            impact: "light",
            knockback: 4,
            warp: { from: 0, to: 0.17, maxDistance: metres(2.5), strikeDistance: metres(0.5) },
        }),
    ],
    CLIP.dodgeRoll
);
