import type { Camera, Vector3Tuple } from "three";
import { Region } from "@/entities/environment/Region";
import { Corridor } from "@/entities/environment/Corridor";
import { RegionProps } from "@/entities/environment/RegionProps";
import { Player } from "@/entities/characters/Player";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { bossModel } from "@/entities/characters/BossModel";
import { spawnEnemyBody } from "@/factories/EnemySpawner";
import { placeRegionProps } from "@/factories/PropPlacer";
import { resolveThemeManifest } from "@/themes/themeManifests";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import type { IChapterRegion } from "@/types/realm";
import { SPAWNING } from "@/constants/game";

export function spawnChapter(world: World, camera: Camera, chapter: ChapterResponse): void {
    const manifest = resolveThemeManifest(chapter.theme);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    for (const region of chapter.regions) {
        world.addEntity(new Region(world.context, region));
        world.addEntity(
            new RegionProps(region.regionId, world.context, placeRegionProps(region, manifest))
        );

        positionsByRegionId.set(region.regionId, region.worldPosition);

        if (region.regionId !== chapter.bossRegionId) spawnRegionEnemies(world, region);
    }

    for (const pathway of chapter.pathways) {
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;

        world.addEntity(new Corridor(world.context, pathway, fromPosition, toPosition));
    }

    const spawnPosition = positionsByRegionId.get(chapter.spawnRegionId);
    if (spawnPosition) {
        world.addEntity(
            new Player("player", world.context, camera, [
                spawnPosition[0],
                spawnPosition[1] + SPAWNING.playerSpawnHeight,
                spawnPosition[2],
            ])
        );
    }

    const bossPosition = positionsByRegionId.get(chapter.bossRegionId);
    if (chapter.boss && bossPosition) {
        world.addEntity(
            new CharacterBody(bossModel(), world.context, [
                bossPosition[0],
                bossPosition[1] + SPAWNING.bossSpawnHeight,
                bossPosition[2],
            ])
        );
    }
}

function spawnRegionEnemies(world: World, region: IChapterRegion): void {
    const enemyCount = Math.min(
        Math.max(Math.floor(region.fileCount / SPAWNING.filesPerEnemy), 1),
        SPAWNING.maximumEnemiesPerRegion
    );

    for (let index = 0; index < enemyCount; index += 1)
        world.addEntity(
            spawnEnemyBody(region, world.context, enemyPosition(region, index, enemyCount))
        );
}

function enemyPosition(region: IChapterRegion, index: number, count: number): Vector3Tuple {
    const [width, depth] = region.floorSize;
    const [x, y, z] = region.worldPosition;
    const radius = Math.min(width, depth) * SPAWNING.enemyRingRadiusFactor;
    const angle = (index / count) * Math.PI * 2;

    return [
        x + Math.cos(angle) * radius,
        y + SPAWNING.enemySpawnHeight,
        z + Math.sin(angle) * radius,
    ];
}
