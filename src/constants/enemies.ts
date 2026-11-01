import { degreesToRadians, metresToUnits, range } from "@/lib/helpers";
import type {
    IVitalsSpec,
    ArchetypeId,
    IEnemyAttack,
    IEnemyArchetype,
    IWanderTuning,
    EnemyArchetype,
} from "@/types/combat";
import {
    GOLEM_MOVES,
    GOLEM_MOVE_IDS,
    GREMLIN_MOVES,
    GREMLIN_MOVE_IDS,
    SENTINEL_MOVES,
    SENTINEL_MOVE_IDS,
    WRAITH_MOVES,
    WRAITH_MOVE_IDS,
} from "@/systems/combat/moveSets/enemyMoves";
import { CREATURE_MODELS, GAIT_SPEED_PER_HEIGHT } from "@/constants/characters";
import { WEAPONS } from "@/constants/combat";
import type { MotorTuning } from "@/types/physics";
import { ENEMY_NAMES } from "@/constants/strings";

export const ENEMY_ARCHETYPES = ["sentinel", "wraith", "golem", "gremlin"] as const;

export const REGION_ARCHETYPES: {
    rules: readonly { directoryPattern: RegExp; archetype: EnemyArchetype }[];
    fallback: EnemyArchetype;
} = {
    rules: [
        { directoryPattern: /^(__tests__|tests?|specs?|e2e)$/i, archetype: "wraith" },
        { directoryPattern: /^(dist|build|out|\.next|target|bin)$/i, archetype: "golem" },
        { directoryPattern: /^(\.github|\.vscode|\.circleci|scripts|ci)$/i, archetype: "gremlin" },
    ],
    fallback: "sentinel",
};

export const SPAWNING = {
    filesPerEnemy: 8,
    maximumEnemiesPerRegion: 4,
    spawnClearanceBuffer: metresToUnits(0.15),
    playerSpawnHeight: 2,
};

const BODY_SIZES = {
    sentinel: { height: metresToUnits(2.2), radius: metresToUnits(0.71) },
    golem: { height: metresToUnits(2.8), radius: metresToUnits(0.91) },
    gremlin: { height: metresToUnits(2.1), radius: metresToUnits(0.58) },
    wraith: { height: metresToUnits(2.4), radius: metresToUnits(0.64) },
    boss: { height: metresToUnits(3), radius: metresToUnits(0.85) },
};

export const ENEMY_PLACEMENT = {
    campProbability: 0.7,
    smallestCamp: 2,
    largestCamp: 3,
    campRadius: metresToUnits(3.2),
    minimumMemberSpacing: metresToUnits(2.2),
    minimumCampSpacing: metresToUnits(8),
    regionEdgeMargin: metresToUnits(4),
    maximumSteepness: 0.6,
    playerSpawnClearance: metresToUnits(12),
    spawnClearanceRegionFraction: 0.5,
    propClearanceRadius: BODY_SIZES.golem.radius + metresToUnits(0.3),
    samplingAttempts: 12,
    facingJitter: degreesToRadians(25),
    dominantArchetypeShare: 0.6,
};

const ENEMY_ACCELERATION = 18;

export const ENEMY_MOVEMENT = {
    turnSmoothing: 8,
    motor: {
        colliderOffset: 0.02,
        maxSlopeClimbAngle: degreesToRadians(50),
        minSlopeSlideAngle: degreesToRadians(40),
        autostepMaxHeight: metresToUnits(0.3),
        autostepMinWidth: metresToUnits(0.2),
        snapToGroundDistance: metresToUnits(0.25),
        terminalVelocity: -45,
        groundAcceleration: ENEMY_ACCELERATION,
        airAcceleration: ENEMY_ACCELERATION * 0.5,
    } satisfies MotorTuning,
};

export const ENEMY_STEERING = {
    separationMargin: metresToUnits(0.6),
    separationStrength: 1.3,
    maximumSeparationPush: 2,
    obstacleLookaheadSeconds: 0.45,
    avoidanceTurnStep: Math.PI / 5,
    avoidanceAttempts: 3,
};

export const OBSTACLE_PROBE = {
    cacheSeconds: 0.15,
    reprobeHeadingChange: degreesToRadians(12),
    reprobeLookaheadGrowth: 1.25,
};

export const AWARENESS = {
    sightGainPerSecond: 1.6,
    searchingSightGainMultiplier: 2.5,
    noiseImpulse: 0.35,
    alarmLoudness: 0.7,
    suspiciousThreshold: 0.3,
    forgetDelaySeconds: 1.5,
    decayPerSecond: 0.25,
    loseTrackSeconds: 3,
    searchSeconds: 10,
    alarmRadius: metresToUnits(12),
};

export const SIGHT = {
    eyeHeightFraction: 0.4,
    targetLift: metresToUnits(0.5),
    nearRange: metresToUnits(14),
    nearHalfAngle: degreesToRadians(55),
    nearEdgeStrength: 0.55,
    farRange: metresToUnits(24),
    farHalfAngle: degreesToRadians(25),
    farStrength: 0.35,
    proximitySenseRange: metresToUnits(1.8),
    proximitySenseStrength: 0.3,
    crouchedVisibility: 0.5,
    lineOfSightInterval: 1 / 8,
};

export const HEARING = {
    footstepIntervalSeconds: 0.4,
    footstepRadius: { still: 0, crouch: 0, walk: metresToUnits(3.5), sprint: metresToUnits(10) },
    combatRadius: metresToUnits(12),
    deathCryRadius: metresToUnits(6),
};

export const PATROL: IWanderTuning = {
    arriveDistance: metresToUnits(0.6),
    pauseSeconds: range(3, 7),
    maxWalkSeconds: 8,
    distanceFraction: range(0.35, 1),
};

export const LOOK_AROUND = {
    glanceSeconds: range(1.4, 2.8),
    maxTurn: degreesToRadians(80),
};

export const INVESTIGATE = {
    hesitateSeconds: 0.8,
    arriveDistance: metresToUnits(1),
};

export const SEARCH = {
    radius: metresToUnits(6),
    arriveDistance: metresToUnits(0.8),
    pauseSeconds: range(1, 2.5),
    maxWalkSeconds: 6,
    distanceFraction: range(0, 1),
} satisfies IWanderTuning & { radius: number };

export const RETURN_HOME = {
    arriveDistance: metresToUnits(0.8),
    giveUpSeconds: 20,
};

export const ATTACK_COORDINATOR = {
    maxSimultaneousAttackers: 2,
    holdSeconds: 1.5,
    comboStepSeconds: 0.5,
    ringSlotCount: 6,
};

export const SPAM_TRACKER = {
    windowSeconds: 2.5,
    bonusPerHit: 0.15,
    maxBonus: 0.6,
};

export const ENGAGE_TACTICS = {
    tacticChoiceSeconds: 0.25,
    closeStopFraction: 0.6,
    waitingGap: metresToUnits(2.5),
    waitingMinGap: metresToUnits(1.2),
    ringDeadZone: metresToUnits(0.35),
    ringSettleDistance: metresToUnits(0.08),
    circleSpeedFraction: 0.55,
    orbitLookaheadSeconds: 0.5,
    punishCooldownRate: 2,
};

const SENTINEL_REACH = metresToUnits(1.2);

const GOLEM_REACH = metresToUnits(1.6);

const GREMLIN_REACH = metresToUnits(0.8);

const WRAITH_RETREAT_RANGE = metresToUnits(2.5);

const WRAITH_CAST_RANGE: readonly [number, number] = [WRAITH_RETREAT_RANGE, metresToUnits(8)];

const GOLEM_ATTACKS: readonly IEnemyAttack[] = [
    defineEnemyAttack("great_cleave", GOLEM_MOVE_IDS.greatCleave, [0, GOLEM_REACH], 3, 2.2, {
        tokenCost: 2,
    }),
    defineEnemyAttack("backhand", GOLEM_MOVE_IDS.backhand, [0, metresToUnits(1.1)], 2, 1.4, {
        tokenCost: 2,
    }),
    defineEnemyAttack("low_sweep", GOLEM_MOVE_IDS.lowSweep, [0, GOLEM_REACH], 1, 4, {
        tokenCost: 2,
    }),
    defineEnemyAttack("slam", GOLEM_MOVE_IDS.slam, [0, metresToUnits(1.1)], 2, 2, { tokenCost: 2 }),
];

export const ARCHETYPES: Readonly<Record<ArchetypeId, IEnemyArchetype>> = {
    sentinel: {
        label: ENEMY_NAMES.sentinel,
        weapon: WEAPONS.longsword,
        modelPath: CREATURE_MODELS.puglinModelPath,
        ...BODY_SIZES.sentinel,
        victimRig: "creature",
        vitals: makeEnemyVitals(100, 60),
        attackPower: 8,
        tactics: {
            preferredRange: SENTINEL_REACH,
            retreatRange: metresToUnits(0.3),
            frenzyBelowHealth: 0,
            frenzyCooldownScale: 1,
            reactionSeconds: 0.1,
            parryChance: 0.35,
            evadeChance: 0.15,
        },
        attacks: [
            defineEnemyAttack("slash", SENTINEL_MOVE_IDS.slashA, [0, SENTINEL_REACH], 3, 1.2, {
                chain: [SENTINEL_MOVE_IDS.slashB, SENTINEL_MOVE_IDS.slashC],
                continueChance: 0.6,
            }),
            defineEnemyAttack("cleave", SENTINEL_MOVE_IDS.cleave, [0, SENTINEL_REACH], 2, 1.8),
            defineEnemyAttack("rising", SENTINEL_MOVE_IDS.risingCut, [0, SENTINEL_REACH], 2, 1.4),
            defineEnemyAttack(
                "lunge",
                SENTINEL_MOVE_IDS.lunge,
                [SENTINEL_REACH, metresToUnits(3)],
                1,
                6
            ),
            defineEnemyAttack("thrust", SENTINEL_MOVE_IDS.thrust, [0, SENTINEL_REACH], 0.6, 4.5),
        ],
        moveSet: SENTINEL_MOVES,
        counterAttackMove: SENTINEL_MOVE_IDS.slashA,
        ...movementSpeedsFor(BODY_SIZES.sentinel.height, 1),
        wanderRadius: metresToUnits(4),
        counterKillable: true,
        alwaysAware: false,
    },
    golem: {
        label: ENEMY_NAMES.golem,
        weapon: WEAPONS.greatsword,
        modelPath: CREATURE_MODELS.puglinModelPath,
        ...BODY_SIZES.golem,
        victimRig: "creature",
        vitals: makeEnemyVitals(220, 140),
        attackPower: 18,
        tactics: {
            preferredRange: GOLEM_REACH,
            retreatRange: 0,
            frenzyBelowHealth: 0,
            frenzyCooldownScale: 1,
            reactionSeconds: 0.4,
            parryChance: 0,
            evadeChance: 0,
        },
        attacks: GOLEM_ATTACKS,
        moveSet: GOLEM_MOVES,
        counterAttackMove: GOLEM_MOVE_IDS.backhand,
        ...movementSpeedsFor(BODY_SIZES.golem.height, 0.8),
        wanderRadius: metresToUnits(1.5),
        counterKillable: false,
        alwaysAware: false,
    },
    gremlin: {
        label: ENEMY_NAMES.gremlin,
        weapon: WEAPONS.dagger,
        modelPath: CREATURE_MODELS.impModelPath,
        ...BODY_SIZES.gremlin,
        victimRig: "humanoid",
        vitals: makeEnemyVitals(40, 25),
        attackPower: 4,
        tactics: {
            preferredRange: GREMLIN_REACH,
            retreatRange: metresToUnits(0.25),
            frenzyBelowHealth: 0.5,
            frenzyCooldownScale: 0.5,
            reactionSeconds: 0.08,
            parryChance: 0,
            evadeChance: 0.45,
        },
        attacks: [
            defineEnemyAttack("flurry", GREMLIN_MOVE_IDS.jab, [0, GREMLIN_REACH], 3, 1, {
                chain: [GREMLIN_MOVE_IDS.stab, GREMLIN_MOVE_IDS.hook],
                continueChance: 0.7,
            }),
            defineEnemyAttack("scratch", GREMLIN_MOVE_IDS.scratch, [0, GREMLIN_REACH], 2, 1.4),
            defineEnemyAttack(
                "pounce",
                GREMLIN_MOVE_IDS.pounce,
                [GREMLIN_REACH, metresToUnits(2.5)],
                1,
                5
            ),
        ],
        moveSet: GREMLIN_MOVES,
        counterAttackMove: GREMLIN_MOVE_IDS.jab,
        ...movementSpeedsFor(BODY_SIZES.gremlin.height, 1.2),
        wanderRadius: metresToUnits(5),
        counterKillable: true,
        alwaysAware: false,
    },
    wraith: {
        label: ENEMY_NAMES.wraith,
        weapon: null,
        modelPath: CREATURE_MODELS.impModelPath,
        ...BODY_SIZES.wraith,
        victimRig: "humanoid",
        vitals: makeEnemyVitals(60, 35),
        attackPower: 6,
        tactics: {
            preferredRange: metresToUnits(6),
            retreatRange: WRAITH_RETREAT_RANGE,
            frenzyBelowHealth: 0,
            frenzyCooldownScale: 1,
            reactionSeconds: 0.1,
            parryChance: 0,
            evadeChance: 0.3,
        },
        attacks: [
            defineEnemyAttack("bolt", WRAITH_MOVE_IDS.bolt, WRAITH_CAST_RANGE, 3, 1.6, {
                chain: [WRAITH_MOVE_IDS.followUpBolt],
                continueChance: 0.4,
            }),
            defineEnemyAttack("blast", WRAITH_MOVE_IDS.blast, WRAITH_CAST_RANGE, 0.5, 6),
            defineEnemyAttack("scratch", WRAITH_MOVE_IDS.scratch, [0, metresToUnits(1)], 2, 1.2),
        ],
        moveSet: WRAITH_MOVES,
        counterAttackMove: WRAITH_MOVE_IDS.scratch,
        ...movementSpeedsFor(BODY_SIZES.wraith.height, 1),
        wanderRadius: metresToUnits(3),
        counterKillable: true,
        alwaysAware: false,
    },
    boss: {
        label: ENEMY_NAMES.boss,
        weapon: WEAPONS.axe,
        modelPath: CREATURE_MODELS.impModelPath,
        ...BODY_SIZES.boss,
        victimRig: "humanoid",
        vitals: makeEnemyVitals(400, 260),
        attackPower: 20,
        tactics: {
            preferredRange: GOLEM_REACH,
            retreatRange: 0,
            frenzyBelowHealth: 0,
            frenzyCooldownScale: 1,
            reactionSeconds: 0.12,
            parryChance: 0.2,
            evadeChance: 0.1,
        },
        attacks: GOLEM_ATTACKS,
        moveSet: GOLEM_MOVES,
        counterAttackMove: GOLEM_MOVE_IDS.backhand,
        ...movementSpeedsFor(BODY_SIZES.boss.height, 1),
        wanderRadius: 0,
        counterKillable: false,
        alwaysAware: true,
    },
};

interface IAttackOptions {
    tokenCost?: number;
    chain?: readonly string[];
    continueChance?: number;
}

function makeEnemyVitals(maxHealth: number, maxPoise: number): IVitalsSpec {
    return {
        maxHealth,
        maxPoise,
        maxStamina: 0,
        maxFocus: 0,
        poiseRegenDelay: 2.5,
        poiseRegenRate: maxPoise * 0.35,
        staminaRegenDelay: 0,
        staminaRegenRate: 0,
        staggerSeconds: 2.5,
    };
}

function movementSpeedsFor(
    height: number,
    combatPace: number
): Pick<IEnemyArchetype, "patrolSpeed" | "combatSpeed"> {
    return {
        patrolSpeed: height * GAIT_SPEED_PER_HEIGHT.walk,
        combatSpeed: height * GAIT_SPEED_PER_HEIGHT.strafe * combatPace,
    };
}

function defineEnemyAttack(
    id: string,
    openingMove: string,
    range: readonly [number, number],
    weight: number,
    cooldownSeconds: number,
    options: IAttackOptions = {}
): IEnemyAttack {
    return {
        id,
        openingMove,
        range,
        weight,
        cooldownSeconds,
        tokenCost: options.tokenCost ?? 1,
        chain: options.chain ?? [],
        continueChance: options.continueChance ?? 0,
    };
}
