import type { Camera, Vector3Tuple } from "three";
import { RegionProps } from "@/entities/environment/RegionProps";
import { TerrainSurround } from "@/entities/environment/TerrainSurround";
import { GrassField } from "@/entities/environment/GrassField";
import { Player } from "@/entities/characters/Player";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { bossModel } from "@/entities/characters/BossModel";
import { spawnEnemyBody } from "@/factories/EnemySpawner";
import { placeRegionProps } from "@/factories/PropPlacer";
import { placeSurroundVegetation } from "@/factories/SurroundPlacer";
import { resolveThemeManifest } from "@/themes/ThemeManifests";
import { TerrainHeightField } from "@/world/TerrainHeightField";
import type { IFlatArea, IFlatPath } from "@/world/TerrainHeightField";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import type { IChapterRegion } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { SPAWNING, TERRAIN } from "@/constants/game";
import { hashString } from "@/lib/helpers";

export function spawnChapter(world: World, camera: Camera, chapter: ChapterResponse): void {
    const manifest = resolveThemeManifest(chapter.theme);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    for (const region of chapter.regions)
        positionsByRegionId.set(region.regionId, region.worldPosition);

    spawnTerrain(world, camera, chapter, manifest, positionsByRegionId);

    for (const region of chapter.regions) {
        world.addEntity(
            new RegionProps(region.regionId, world.context, placeRegionProps(region, manifest))
        );

        if (region.regionId !== chapter.bossRegionId) spawnRegionEnemies(world, region);
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

function spawnTerrain(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    manifest: IThemeManifest,
    positionsByRegionId: Map<string, Vector3Tuple>
): void {
    const regions = chapter.regions;
    let centerX = 0;
    let centerZ = 0;

    for (const region of regions) {
        centerX += region.worldPosition[0];
        centerZ += region.worldPosition[2];
    }

    centerX /= regions.length;
    centerZ /= regions.length;

    let furthestDistance = 0;
    const flatAreas: IFlatArea[] = [];

    for (const region of regions) {
        const [x, y, z] = region.worldPosition;
        const [width, depth] = region.floorSize;

        flatAreas.push({
            centerX: x - centerX,
            centerZ: z - centerZ,
            halfWidth: width / 2,
            halfDepth: depth / 2,
            height: y,
            floorColorIndex: region.nestingDepth,
        });

        const distance = Math.hypot(x - centerX, z - centerZ) + Math.max(width, depth) / 2;
        if (distance > furthestDistance) furthestDistance = distance;
    }

    const flatPaths: IFlatPath[] = [];

    for (const pathway of chapter.pathways) {
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;

        flatPaths.push({
            fromX: fromPosition[0] - centerX,
            fromZ: fromPosition[2] - centerZ,
            toX: toPosition[0] - centerX,
            toZ: toPosition[2] - centerZ,
            halfWidth: pathway.corridorWidth / 2,
            height: (fromPosition[1] + toPosition[1]) / 2,
        });
    }

    const playRadius = furthestDistance + TERRAIN.playMargin;
    const center: Vector3Tuple = [centerX, 0, centerZ];
    const seed = hashString(`${chapter.title}-${chapter.chapterIndex}`);

    const heightField = new TerrainHeightField(
        manifest.environment.terrain,
        playRadius,
        flatAreas,
        flatPaths,
        seed
    );

    world.addEntity(new TerrainSurround(world.context, center, playRadius, heightField, seed));
    world.addEntity(new GrassField(world.context, camera, center, heightField, seed + 5));

    placeSurroundVegetation(manifest, heightField, playRadius, center, seed + 3).forEach(
        (groups, bucketIndex) =>
            world.addEntity(new RegionProps(`wild-${bucketIndex}`, world.context, groups))
    );
}
