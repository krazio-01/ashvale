import type { Vector3Tuple } from "three";
import { Golem } from "@/entities/characters/enemies/Golem";
import { Gremlin } from "@/entities/characters/enemies/Gremlin";
import { Sentinel } from "@/entities/characters/enemies/Sentinel";
import { Wraith } from "@/entities/characters/enemies/Wraith";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { specFor } from "@/entities/characters/enemies/EnemyModels";
import { EnemyArchetype } from "@/constants/characters";
import { IChapterRegion } from "@/types/realm";
import type { IWorldContext } from "@/types/world";

const TEST_DIRECTORY_PATTERN = /^(__tests__|tests?|specs?|e2e)$/i;
const BUILD_OUTPUT_DIRECTORY_PATTERN = /^(dist|build|out|\.next|target|bin)$/i;
const TOOLING_DIRECTORY_PATTERN = /^(\.github|\.vscode|\.circleci|scripts|ci)$/i;

export function spawnEnemyBody(
    archetype: EnemyArchetype,
    context: IWorldContext,
    spawnPosition: Vector3Tuple,
    facingYaw: number
): CharacterBody {
    return new CharacterBody(specFor(archetype), context, spawnPosition, facingYaw);
}

export function spawnEnemyPresence(
    archetype: EnemyArchetype,
    id: string,
    context: IWorldContext,
    spawnPosition: Vector3Tuple,
    facingYaw: number
): { enemy: Enemy; body: CharacterBody } {
    return {
        enemy: spawnEnemy(archetype, id),
        body: spawnEnemyBody(archetype, context, spawnPosition, facingYaw),
    };
}

export function spawnEnemy(archetype: EnemyArchetype, id: string): Enemy {
    switch (archetype) {
        case EnemyArchetype.Wraith:
            return new Wraith(id);
        case EnemyArchetype.Golem:
            return new Golem(id);
        case EnemyArchetype.Gremlin:
            return new Gremlin(id);
        case EnemyArchetype.Sentinel:
            return new Sentinel(id);
    }
}

export function dominantArchetypeFor(region: IChapterRegion): EnemyArchetype {
    if (TEST_DIRECTORY_PATTERN.test(region.displayName)) return EnemyArchetype.Wraith;
    if (BUILD_OUTPUT_DIRECTORY_PATTERN.test(region.displayName)) return EnemyArchetype.Golem;
    if (TOOLING_DIRECTORY_PATTERN.test(region.displayName)) return EnemyArchetype.Gremlin;

    return EnemyArchetype.Sentinel;
}
