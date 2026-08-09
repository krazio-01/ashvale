import { Golem } from "@/entities/characters/enemies/Golem";
import { Gremlin } from "@/entities/characters/enemies/Gremlin";
import { Sentinel } from "@/entities/characters/enemies/Sentinel";
import { Wraith } from "@/entities/characters/enemies/Wraith";
import { Enemy } from "@/entities/characters/Enemy";
import { EnemyArchetype } from "@/constants/game";
import { IChapterRegion } from "@/types/realm";

const TEST_DIRECTORY_PATTERN = /^(__tests__|tests?|specs?|e2e)$/i;
const BUILD_OUTPUT_DIRECTORY_PATTERN = /^(dist|build|out|\.next|target|bin)$/i;
const TOOLING_DIRECTORY_PATTERN = /^(\.github|\.vscode|\.circleci|scripts|ci)$/i;

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
