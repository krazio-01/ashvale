import { degrees, metres, pair } from "@/lib/helpers";
import type { IVitalsSpec } from "@/systems/combat/core/Vitals";
import { GOLEM_MOVES, GOLEM_MOVE_IDS } from "@/systems/combat/moveSets/enemy/golemMoves";
import { GREMLIN_MOVES, GREMLIN_MOVE_IDS } from "@/systems/combat/moveSets/enemy/gremlinMoves";
import { SENTINEL_MOVES, SENTINEL_MOVE_IDS } from "@/systems/combat/moveSets/enemy/sentinelMoves";
import { WRAITH_MOVES, WRAITH_MOVE_IDS } from "@/systems/combat/moveSets/enemy/wraithMoves";
import type { IEnemyAttack } from "@/systems/enemyBehaviour/combat/AttackPlanner";
import type { IDefenseTactics } from "@/systems/enemyBehaviour/combat/DefenseReader";
import { CREATURE, STRIDE } from "@/constants/characters";
import { WEAPONS } from "@/constants/combat";
import type { EnemyArchetype, IMoveSet, VictimRig } from "@/types/combat";
import type { WeaponDefinition } from "@/types/weapons";

export const SPAWNING = {
    filesPerEnemy: 8,
    maximumEnemiesPerRegion: 4,
    spawnClearanceBuffer: metres(0.15),
    playerSpawnHeight: 2,
};

export const ENEMY = {
    sentinelHeight: metres(2.2),
    sentinelRadius: metres(0.71),
    golemHeight: metres(2.8),
    golemRadius: metres(0.91),
    gremlinHeight: metres(2.1),
    gremlinRadius: metres(0.58),
    wraithHeight: metres(2.4),
    wraithRadius: metres(0.64),
};

export const ENEMY_PLACEMENT = {
    campProbability: 0.7,
    smallestCamp: 2,
    largestCamp: 3,
    campRadius: metres(3.2),
    minimumMemberSpacing: metres(2.2),
    minimumCampSpacing: metres(8),
    regionEdgeMargin: metres(4),
    maximumSteepness: 0.6,
    playerSpawnClearance: metres(12),
    spawnClearanceRegionFraction: 0.5,
    propClearanceRadius: ENEMY.golemRadius + metres(0.3),
    samplingAttempts: 12,
    facingJitter: (25 * Math.PI) / 180,
    dominantArchetypeShare: 0.6,
};

export const BOSS = {
    height: metres(3),
    radius: metres(0.85),
};

export const NON_PLAYER = {
    colliderOffset: 0.02,
    maxSlopeClimbAngle: (50 * Math.PI) / 180,
    minSlopeSlideAngle: (40 * Math.PI) / 180,
    autostepMaxHeight: metres(0.3),
    autostepMinWidth: metres(0.2),
    snapToGroundDistance: metres(0.25),
    terminalVelocity: -45,
    acceleration: 18,
    airAccelerationFraction: 0.5,
    turnSmoothing: 8,
};

export const ENEMY_STEERING = {
    separationMargin: metres(0.6),
    separationStrength: 1.3,
    maximumSeparationPush: 2,
    obstacleLookaheadSeconds: 0.45,
    avoidanceTurnStep: Math.PI / 5,
    avoidanceAttempts: 3,
};

export const OBSTACLE_PROBE = {
    cacheSeconds: 0.15,
    reprobeHeadingChange: degrees(12),
    reprobeLookaheadGrowth: 1.25,
};

export const AWARENESS = {
    sightGainPerSecond: 1.6,
    primedGainMultiplier: 2.5,
    noiseImpulse: 0.35,
    alarmLoudness: 0.7,
    suspiciousThreshold: 0.3,
    forgetDelaySeconds: 1.5,
    decayPerSecond: 0.25,
    loseTrackSeconds: 3,
    searchSeconds: 10,
    alarmRadius: metres(12),
};

export const SIGHT = {
    eyeHeightFraction: 0.4,
    targetLift: metres(0.5),
    nearRange: metres(14),
    nearHalfAngle: degrees(55),
    nearEdgeStrength: 0.55,
    farRange: metres(24),
    farHalfAngle: degrees(25),
    farStrength: 0.35,
    closeSenseRange: metres(1.8),
    closeSenseStrength: 0.3,
    crouchedVisibility: 0.5,
    lineOfSightInterval: 1 / 8,
};

export const NOISE = {
    footstepIntervalSeconds: 0.4,
    footstepRadius: { still: 0, crouch: 0, walk: metres(3.5), sprint: metres(10) },
    combatRadius: metres(12),
    deathCryRadius: metres(6),
};

export const PATROL = {
    restSeconds: pair(3, 7),
    arriveDistance: metres(0.6),
    maxStrollSeconds: 8,
    minimumStrollFraction: 0.35,
};

export const LOOK_AROUND = {
    glanceSeconds: pair(1.4, 2.8),
    maxTurn: degrees(80),
};

export const INVESTIGATE = {
    hesitateSeconds: 0.8,
    arriveDistance: metres(1),
};

export const SEARCH = {
    radius: metres(6),
    pauseSeconds: pair(1, 2.5),
    arriveDistance: metres(0.8),
    maxLegSeconds: 6,
};

export const RETURN_HOME = {
    arriveDistance: metres(0.8),
    giveUpSeconds: 20,
};

export const ATTACK_COORDINATOR = {
    tokenCapacity: 2,
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
    rescoreSeconds: 0.25,
    closeStopFraction: 0.6,
    waitingGap: metres(2.5),
    waitingMinGap: metres(1.2),
    ringDeadZone: metres(0.35),
    ringSettleDistance: metres(0.08),
    circleSpeedFraction: 0.55,
    orbitLookaheadSeconds: 0.5,
};

interface ICombatTactics extends IDefenseTactics {
    preferredRange: number;
    retreatRange: number;
    frenzyBelowHealth: number;
    frenzyCooldownScale: number;
}

export interface IEnemyArchetype {
    label: string;
    modelPath: string;
    height: number;
    radius: number;
    victimRig: VictimRig;
    vitals: IVitalsSpec;
    attackPower: number;
    tactics: ICombatTactics;
    attacks: readonly IEnemyAttack[];
    weapon: WeaponDefinition | null;
    moveSet: IMoveSet;
    riposteMove: string;
    patrolSpeed: number;
    combatSpeed: number;
    wanderRadius: number;
    counterKillable: boolean;
    alwaysAware: boolean;
}

function vitals(maxHealth: number, maxPoise: number): IVitalsSpec {
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

function gaitSpeeds(
    height: number,
    combatPace: number
): Pick<IEnemyArchetype, "patrolSpeed" | "combatSpeed"> {
    return {
        patrolSpeed: height * STRIDE.walk,
        combatSpeed: height * STRIDE.strafe * combatPace,
    };
}

interface IAttackOptions {
    tokenCost?: number;
    chain?: readonly string[];
    continueChance?: number;
}

function attack(
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

const SENTINEL_REACH = metres(1.2);
const GOLEM_REACH = metres(1.6);
const GREMLIN_REACH = metres(0.8);
const WRAITH_CAST_RANGE: readonly [number, number] = [metres(1.5), metres(8)];

const GOLEM_ATTACKS: readonly IEnemyAttack[] = [
    attack("great_cleave", GOLEM_MOVE_IDS.greatCleave, [0, GOLEM_REACH], 3, 2.2, { tokenCost: 2 }),
    attack("backhand", GOLEM_MOVE_IDS.backhand, [0, metres(1.1)], 2, 1.4, { tokenCost: 2 }),
    attack("low_sweep", GOLEM_MOVE_IDS.lowSweep, [0, GOLEM_REACH], 1, 4, { tokenCost: 2 }),
    attack("slam", GOLEM_MOVE_IDS.slam, [0, metres(1.1)], 2, 2, { tokenCost: 2 }),
];

const ENEMY_ARCHETYPES: Record<EnemyArchetype, IEnemyArchetype> = {
    sentinel: {
        label: "Sentinel",
        weapon: WEAPONS.longsword,
        modelPath: CREATURE.puglinModelPath,
        height: ENEMY.sentinelHeight,
        radius: ENEMY.sentinelRadius,
        victimRig: "creature",
        vitals: vitals(100, 60),
        attackPower: 8,
        tactics: {
            preferredRange: SENTINEL_REACH,
            retreatRange: metres(0.3),
            frenzyBelowHealth: 0,
            frenzyCooldownScale: 1,
            reactionSeconds: 0.1,
            parryChance: 0.35,
            evadeChance: 0.15,
        },
        attacks: [
            attack("slash", SENTINEL_MOVE_IDS.slashA, [0, SENTINEL_REACH], 3, 1.2, {
                chain: [SENTINEL_MOVE_IDS.slashB, SENTINEL_MOVE_IDS.slashC],
                continueChance: 0.6,
            }),
            attack("cleave", SENTINEL_MOVE_IDS.cleave, [0, SENTINEL_REACH], 2, 1.8),
            attack("rising", SENTINEL_MOVE_IDS.risingCut, [0, SENTINEL_REACH], 2, 1.4),
            attack("lunge", SENTINEL_MOVE_IDS.lunge, [SENTINEL_REACH, metres(3)], 1, 6),
            attack("thrust", SENTINEL_MOVE_IDS.thrust, [0, SENTINEL_REACH], 0.6, 4.5),
        ],
        moveSet: SENTINEL_MOVES,
        riposteMove: SENTINEL_MOVE_IDS.slashA,
        ...gaitSpeeds(ENEMY.sentinelHeight, 1),
        wanderRadius: metres(4),
        counterKillable: true,
        alwaysAware: false,
    },
    golem: {
        label: "Golem",
        weapon: WEAPONS.greatsword,
        modelPath: CREATURE.puglinModelPath,
        height: ENEMY.golemHeight,
        radius: ENEMY.golemRadius,
        victimRig: "creature",
        vitals: vitals(220, 140),
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
        riposteMove: GOLEM_MOVE_IDS.backhand,
        ...gaitSpeeds(ENEMY.golemHeight, 0.8),
        wanderRadius: metres(1.5),
        counterKillable: false,
        alwaysAware: false,
    },
    gremlin: {
        label: "Gremlin",
        weapon: WEAPONS.dagger,
        modelPath: CREATURE.impModelPath,
        height: ENEMY.gremlinHeight,
        radius: ENEMY.gremlinRadius,
        victimRig: "humanoid",
        vitals: vitals(40, 25),
        attackPower: 4,
        tactics: {
            preferredRange: GREMLIN_REACH,
            retreatRange: metres(0.25),
            frenzyBelowHealth: 0.5,
            frenzyCooldownScale: 0.5,
            reactionSeconds: 0.08,
            parryChance: 0,
            evadeChance: 0.45,
        },
        attacks: [
            attack("flurry", GREMLIN_MOVE_IDS.jab, [0, GREMLIN_REACH], 3, 1, {
                chain: [GREMLIN_MOVE_IDS.stab, GREMLIN_MOVE_IDS.hook],
                continueChance: 0.7,
            }),
            attack("scratch", GREMLIN_MOVE_IDS.scratch, [0, GREMLIN_REACH], 2, 1.4),
            attack("pounce", GREMLIN_MOVE_IDS.pounce, [GREMLIN_REACH, metres(2.5)], 1, 5),
        ],
        moveSet: GREMLIN_MOVES,
        riposteMove: GREMLIN_MOVE_IDS.jab,
        ...gaitSpeeds(ENEMY.gremlinHeight, 1.2),
        wanderRadius: metres(5),
        counterKillable: true,
        alwaysAware: false,
    },
    wraith: {
        label: "Wraith",
        weapon: null,
        modelPath: CREATURE.impModelPath,
        height: ENEMY.wraithHeight,
        radius: ENEMY.wraithRadius,
        victimRig: "humanoid",
        vitals: vitals(60, 35),
        attackPower: 6,
        tactics: {
            preferredRange: metres(6),
            retreatRange: metres(2.5),
            frenzyBelowHealth: 0,
            frenzyCooldownScale: 1,
            reactionSeconds: 0.1,
            parryChance: 0,
            evadeChance: 0.3,
        },
        attacks: [
            attack("bolt", WRAITH_MOVE_IDS.bolt, WRAITH_CAST_RANGE, 3, 1.6, {
                chain: [WRAITH_MOVE_IDS.followUpBolt],
                continueChance: 0.4,
            }),
            attack("blast", WRAITH_MOVE_IDS.blast, WRAITH_CAST_RANGE, 0.5, 6),
            attack("scratch", WRAITH_MOVE_IDS.scratch, [0, metres(1)], 2, 1.2),
        ],
        moveSet: WRAITH_MOVES,
        riposteMove: WRAITH_MOVE_IDS.scratch,
        ...gaitSpeeds(ENEMY.wraithHeight, 1),
        wanderRadius: metres(3),
        counterKillable: true,
        alwaysAware: false,
    },
};

export const BOSS_ARCHETYPE: IEnemyArchetype = {
    label: "Boss",
    weapon: WEAPONS.axe,
    modelPath: CREATURE.impModelPath,
    height: BOSS.height,
    radius: BOSS.radius,
    victimRig: "humanoid",
    vitals: vitals(400, 260),
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
    riposteMove: GOLEM_MOVE_IDS.backhand,
    ...gaitSpeeds(BOSS.height, 1),
    wanderRadius: 0,
    counterKillable: false,
    alwaysAware: true,
};

export function archetypeFor(archetype: EnemyArchetype): IEnemyArchetype {
    return ENEMY_ARCHETYPES[archetype];
}
