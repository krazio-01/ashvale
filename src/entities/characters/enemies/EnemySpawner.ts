import type { Vector3Tuple } from "three";
import type { CombatCharacter } from "@/entities/characters/CombatCharacter";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import { archetypeFor } from "@/constants/enemies";
import type { EnemyArchetype } from "@/types/combat";
import type { IChapterRegion } from "@/types/realm";
import type { IWorldContext } from "@/types/world";

const TEST_DIRECTORY_PATTERN = /^(__tests__|tests?|specs?|e2e)$/i;
const BUILD_OUTPUT_DIRECTORY_PATTERN = /^(dist|build|out|\.next|target|bin)$/i;
const TOOLING_DIRECTORY_PATTERN = /^(\.github|\.vscode|\.circleci|scripts|ci)$/i;

export function spawnEnemy(
    archetype: EnemyArchetype,
    id: string,
    context: IWorldContext,
    spawnPosition: Vector3Tuple,
    spawnYaw: number,
    player: CombatCharacter | null
): Enemy {
    return new Enemy({
        id,
        archetype: archetypeFor(archetype),
        context,
        spawnPosition,
        spawnYaw,
        player,
        passive: false,
    });
}

export function dominantArchetypeFor(region: IChapterRegion): EnemyArchetype {
    if (TEST_DIRECTORY_PATTERN.test(region.displayName)) return "wraith";
    if (BUILD_OUTPUT_DIRECTORY_PATTERN.test(region.displayName)) return "golem";
    if (TOOLING_DIRECTORY_PATTERN.test(region.displayName)) return "gremlin";

    return "sentinel";
}
