import { Golem } from "@/entities/characters/enemies/Golem";
import { Gremlin } from "@/entities/characters/enemies/Gremlin";
import { Sentinel } from "@/entities/characters/enemies/Sentinel";
import { Wraith } from "@/entities/characters/enemies/Wraith";
import { Enemy } from "@/entities/characters/Enemy";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { modelFor } from "@/entities/characters/enemies/EnemyModels";
import { EnemyArchetype } from "@/constants/characters";
import { IChapterRegion } from "@/types/realm";
import type { IWorldContext } from "@/types/world";

const TEST_DIRECTORY_PATTERN = /^(__tests__|tests?|specs?|e2e)$/i;
const BUILD_OUTPUT_DIRECTORY_PATTERN = /^(dist|build|out|\.next|target|bin)$/i;
const TOOLING_DIRECTORY_PATTERN = /^(\.github|\.vscode|\.circleci|scripts|ci)$/i;

export function spawnEnemyBody(
    region: IChapterRegion,
    context: IWorldContext,
    spawnPosition: [number, number, number]
): CharacterBody {
    const archetype = resolveArchetype(region);

    return new CharacterBody(modelFor(archetype), context, spawnPosition);
}

export function spawnEnemyPresence(
    region: IChapterRegion,
    id: string,
    context: IWorldContext,
    spawnPosition: [number, number, number]
): { enemy: Enemy; body: CharacterBody } {
    const archetype = resolveArchetype(region);
    const enemy = spawnEnemy(archetype, id);
    const body = new CharacterBody(modelFor(archetype), context, spawnPosition);

    return { enemy, body };
}

export function spawnEnemyForRegion(region: IChapterRegion, id: string): Enemy {
    return spawnEnemy(resolveArchetype(region), id);
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

function resolveArchetype(region: IChapterRegion): EnemyArchetype {
    if (TEST_DIRECTORY_PATTERN.test(region.displayName)) return EnemyArchetype.Wraith;
    if (BUILD_OUTPUT_DIRECTORY_PATTERN.test(region.displayName)) return EnemyArchetype.Golem;
    if (TOOLING_DIRECTORY_PATTERN.test(region.displayName)) return EnemyArchetype.Gremlin;

    return EnemyArchetype.Sentinel;
}
