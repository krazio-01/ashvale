import { CREATURE, ENEMY, EnemyArchetype } from "@/constants/characters";
import type { ICharacterSpec } from "@/types/world";

const specs: Record<EnemyArchetype, ICharacterSpec> = {
    [EnemyArchetype.Sentinel]: {
        modelPath: CREATURE.puglinModelPath,
        height: ENEMY.sentinelHeight,
        radius: ENEMY.sentinelRadius,
    },
    [EnemyArchetype.Golem]: {
        modelPath: CREATURE.puglinModelPath,
        height: ENEMY.golemHeight,
        radius: ENEMY.golemRadius,
    },
    [EnemyArchetype.Gremlin]: {
        modelPath: CREATURE.impModelPath,
        height: ENEMY.gremlinHeight,
        radius: ENEMY.gremlinRadius,
    },
    [EnemyArchetype.Wraith]: {
        modelPath: CREATURE.impModelPath,
        height: ENEMY.wraithHeight,
        radius: ENEMY.wraithRadius,
    },
};

export function specFor(archetype: EnemyArchetype): ICharacterSpec {
    return specs[archetype];
}
