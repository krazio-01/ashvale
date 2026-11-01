import { CLIP } from "@/constants/characters";
import { metresToUnits } from "@/lib/helpers";
import {
    enemyMoveSet,
    strike,
    strikeWithRecovery,
    projectileMove,
} from "@/systems/combat/moveSets/enemyMoveBuilders";

const WRAITH_LAUNCH_AT = 0.3;

export const GOLEM_MOVE_IDS = {
    greatCleave: "golem_great_cleave",
    backhand: "golem_backhand",
    lowSweep: "golem_low_sweep",
    slam: "golem_slam",
};

export const GOLEM_MOVES = enemyMoveSet([
    strike({
        id: GOLEM_MOVE_IDS.greatCleave,
        clip: CLIP.enemyGreatCleave,
        window: [0.31, 0.4],
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
        shape: { kind: "socket", bone: "hand_l", radius: metresToUnits(0.45) },
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
        damageScale: 1.8,
        poiseDamage: 50,
        impact: "heavy",
        knockback: 9,
        swing: "side",
        dodgeOnly: true,
        armor: { from: 0.1, to: 0.4 },
    }),
    strike({
        id: GOLEM_MOVE_IDS.slam,
        clip: CLIP.enemySwipe,
        playbackRate: 1.6,
        window: [0.42, 0.48],
        damageScale: 1.6,
        poiseDamage: 40,
        impact: "heavy",
        knockback: 8,
        swing: "high",
        armor: { from: 0.2, to: 0.48 },
    }),
]);

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
            shape: { kind: "socket", bone: "hand_l", radius: metresToUnits(0.3) },
            damageScale: 0.8,
            poiseDamage: 8,
            impact: "light",
            knockback: 2,
            swing: "side",
            chainAt: 0.24,
        }),
        strike({
            id: GREMLIN_MOVE_IDS.stab,
            clip: CLIP.enemyPunch,
            playbackRate: 1.2,
            window: [0.17, 0.27],
            damageScale: 1,
            poiseDamage: 10,
            impact: "light",
            knockback: 3,
            swing: "side",
            chainAt: 0.27,
        }),
        ...strikeWithRecovery(
            {
                id: GREMLIN_MOVE_IDS.hook,
                clip: CLIP.enemyHook,
                window: [0.5, 0.64],
                damageScale: 1.2,
                poiseDamage: 14,
                impact: "light",
                knockback: 4,
                swing: "side",
            },
            CLIP.enemyHookRecover
        ),
        strike({
            id: GREMLIN_MOVE_IDS.scratch,
            clip: CLIP.enemyScratch,
            playbackRate: 1.2,
            window: [0.3, 0.39],
            damageScale: 1.1,
            poiseDamage: 12,
            impact: "light",
            knockback: 3,
            swing: "side",
        }),
        strike({
            id: GREMLIN_MOVE_IDS.pounce,
            clip: CLIP.enemyLunge,
            window: [0.17, 0.26],
            damageScale: 1.2,
            poiseDamage: 14,
            impact: "light",
            knockback: 4,
            swing: "side",
            gapClose: {
                from: 0,
                to: 0.17,
                maxDistance: metresToUnits(2.5),
                strikeDistance: metresToUnits(0.5),
            },
        }),
    ],
    CLIP.dodgeRoll
);

export const SENTINEL_MOVE_IDS = {
    slashA: "sentinel_slash_a",
    slashB: "sentinel_slash_b",
    slashC: "sentinel_slash_c",
    cleave: "sentinel_cleave",
    risingCut: "sentinel_rising_cut",
    lunge: "sentinel_lunge",
    thrust: "sentinel_thrust",
};

export const SENTINEL_MOVES = enemyMoveSet([
    ...strikeWithRecovery(
        {
            id: SENTINEL_MOVE_IDS.slashA,
            clip: CLIP.enemySlashA,
            window: [0.5, 0.75],
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
        damageScale: 1.1,
        poiseDamage: 18,
        impact: "light",
        knockback: 4,
        swing: "high",
    }),
    strike({
        id: SENTINEL_MOVE_IDS.lunge,
        clip: CLIP.enemyLunge,
        window: [0.17, 0.26],
        damageScale: 1.2,
        poiseDamage: 18,
        impact: "light",
        knockback: 5,
        swing: "side",
        gapClose: {
            from: 0,
            to: 0.17,
            maxDistance: metresToUnits(3),
            strikeDistance: metresToUnits(0.6),
        },
    }),
    strike({
        id: SENTINEL_MOVE_IDS.thrust,
        clip: CLIP.enemyThrust,
        window: [0.24, 0.32],
        damageScale: 1.8,
        poiseDamage: 40,
        impact: "heavy",
        knockback: 8,
        swing: "side",
        dodgeOnly: true,
    }),
]);

export const WRAITH_MOVE_IDS = {
    bolt: "wraith_bolt",
    followUpBolt: "wraith_bolt_2",
    blast: "wraith_blast",
    scratch: "wraith_scratch",
};

export const WRAITH_MOVES = enemyMoveSet([
    projectileMove({
        id: WRAITH_MOVE_IDS.bolt,
        clip: CLIP.enemyHurl,
        playbackRate: 1.2,
        projectile: { at: WRAITH_LAUNCH_AT, kind: "bolt", socket: "hand_r" },
        chainAt: 0.5,
    }),
    projectileMove({
        id: WRAITH_MOVE_IDS.followUpBolt,
        clip: CLIP.enemyHurl,
        playbackRate: 1.2,
        projectile: { at: WRAITH_LAUNCH_AT, kind: "bolt", socket: "hand_r" },
    }),
    projectileMove({
        id: WRAITH_MOVE_IDS.blast,
        clip: CLIP.enemyHurl,
        playbackRate: 0.75,
        projectile: { at: WRAITH_LAUNCH_AT, kind: "blast", socket: "hand_r" },
    }),
    strike({
        id: WRAITH_MOVE_IDS.scratch,
        clip: CLIP.enemyScratch,
        playbackRate: 1.2,
        window: [0.3, 0.39],
        shape: { kind: "socket", bone: "hand_r", radius: metresToUnits(0.35) },
        damageScale: 1,
        poiseDamage: 12,
        impact: "light",
        knockback: 3,
        swing: "side",
    }),
]);
