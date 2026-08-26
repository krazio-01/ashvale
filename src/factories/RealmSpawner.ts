import type { Camera, Vector3Tuple } from "three";
import { RegionProps } from "@/entities/environment/RegionProps";
import { TerrainSurround } from "@/entities/environment/TerrainSurround";
import { GrassField } from "@/entities/environment/GrassField";
import { Player } from "@/entities/characters/Player";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { bossModel } from "@/entities/characters/BossModel";
import { spawnEnemyBody } from "@/factories/EnemySpawner";
import { placeRegionProps, type IRegionEntrance } from "@/factories/PropPlacer";
import { placeSurroundVegetation } from "@/factories/SurroundPlacer";
import {
    placeCorridorAnchors,
    type ICorridorSpan,
    type IRegionFootprint,
} from "@/factories/CorridorAnchorPlacer";
import { resolveThemeManifest } from "@/themes/ThemeManifests";
import { TerrainHeightField } from "@/world/TerrainHeightField";
import type { IRegionFloor, ICorridorPath } from "@/world/TerrainHeightField";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import type { IChapterRegion } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { SPAWNING, TERRAIN } from "@/constants/game";
import { hashString } from "@/lib/helpers";

export function spawnChapter(world: World, camera: Camera, chapter: ChapterResponse): void {
    const manifest = resolveThemeManifest(chapter.theme, chapter.season);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    for (const region of chapter.regions)
        positionsByRegionId.set(region.regionId, region.worldPosition);

    const entrancesByRegionId = mapEntrancesToRegions(chapter, positionsByRegionId);
    const terrain = spawnTerrain(world, camera, chapter, manifest, positionsByRegionId);

    for (const region of chapter.regions) {
        world.addEntity(
            new RegionProps(
                region.regionId,
                world.context,
                placeRegionProps(
                    region,
                    manifest,
                    terrain.groundHeightAt,
                    entrancesByRegionId.get(region.regionId) ?? []
                )
            )
        );

        if (region.regionId !== chapter.bossRegionId)
            spawnRegionEnemies(world, region, terrain.groundHeightAt);
    }

    const spawnPosition = positionsByRegionId.get(chapter.spawnRegionId);
    if (spawnPosition) {
        world.addEntity(
            new Player("player", world.context, camera, [
                spawnPosition[0],
                terrain.groundHeightAt(spawnPosition[0], spawnPosition[2]) +
                    SPAWNING.playerSpawnHeight,
                spawnPosition[2],
            ])
        );
    }

    const bossPosition = positionsByRegionId.get(chapter.bossRegionId);
    if (chapter.boss && bossPosition) {
        world.addEntity(
            new CharacterBody(bossModel(), world.context, [
                bossPosition[0],
                terrain.groundHeightAt(bossPosition[0], bossPosition[2]) + SPAWNING.bossSpawnHeight,
                bossPosition[2],
            ])
        );
    }
}

function mapEntrancesToRegions(
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>
): Map<string, IRegionEntrance[]> {
    const entrancesByRegionId = new Map<string, IRegionEntrance[]>();

    const append = (regionId: string, entrance: IRegionEntrance) => {
        const existing = entrancesByRegionId.get(regionId);

        if (existing) existing.push(entrance);
        else entrancesByRegionId.set(regionId, [entrance]);
    };

    for (const pathway of chapter.pathways) {
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;

        const spanX = toPosition[0] - fromPosition[0];
        const spanZ = toPosition[2] - fromPosition[2];
        const spanLength = Math.hypot(spanX, spanZ);

        if (spanLength === 0) continue;

        append(pathway.fromRegionId, {
            directionX: spanX / spanLength,
            directionZ: spanZ / spanLength,
            corridorWidth: pathway.corridorWidth,
        });

        append(pathway.toRegionId, {
            directionX: -spanX / spanLength,
            directionZ: -spanZ / spanLength,
            corridorWidth: pathway.corridorWidth,
        });
    }

    return entrancesByRegionId;
}

function spawnRegionEnemies(
    world: World,
    region: IChapterRegion,
    groundHeightAt: GroundHeightLookup
): void {
    const enemyCount = Math.min(
        Math.max(Math.floor(region.fileCount / SPAWNING.filesPerEnemy), 1),
        SPAWNING.maximumEnemiesPerRegion
    );

    for (let index = 0; index < enemyCount; index += 1)
        world.addEntity(
            spawnEnemyBody(
                region,
                world.context,
                enemyPosition(region, index, enemyCount, groundHeightAt)
            )
        );
}

function enemyPosition(
    region: IChapterRegion,
    index: number,
    count: number,
    groundHeightAt: GroundHeightLookup
): Vector3Tuple {
    const [width, depth] = region.floorSize;
    const [x, , z] = region.worldPosition;
    const radius = Math.min(width, depth) * SPAWNING.enemyRingRadiusFactor;
    const angle = (index / count) * Math.PI * 2;

    const enemyX = x + Math.cos(angle) * radius;
    const enemyZ = z + Math.sin(angle) * radius;

    return [enemyX, groundHeightAt(enemyX, enemyZ) + SPAWNING.enemySpawnHeight, enemyZ];
}

function spawnTerrain(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    manifest: IThemeManifest,
    positionsByRegionId: Map<string, Vector3Tuple>
): ITerrainContext {
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
    const regionFloors: IRegionFloor[] = [];
    const regionFootprints: IRegionFootprint[] = [];

    for (const region of regions) {
        const [x, y, z] = region.worldPosition;
        const [width, depth] = region.floorSize;

        const footprint = {
            centerX: x - centerX,
            centerZ: z - centerZ,
            halfWidth: width / 2,
            halfDepth: depth / 2,
        };

        regionFootprints.push(footprint);
        regionFloors.push({
            ...footprint,
            floorElevation: y,
            floorColorIndex: region.nestingDepth,
        });

        const distance = Math.hypot(x - centerX, z - centerZ) + Math.max(width, depth) / 2;
        if (distance > furthestDistance) furthestDistance = distance;
    }

    const corridorPaths: ICorridorPath[] = [];
    const corridorSpans: ICorridorSpan[] = [];

    for (const pathway of chapter.pathways) {
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;

        const span = {
            fromX: fromPosition[0] - centerX,
            fromZ: fromPosition[2] - centerZ,
            toX: toPosition[0] - centerX,
            toZ: toPosition[2] - centerZ,
            halfWidth: pathway.corridorWidth / 2,
        };

        corridorSpans.push(span);
        corridorPaths.push({
            ...span,
            floorElevation: (fromPosition[1] + toPosition[1]) / 2,
        });
    }

    const playRadius = furthestDistance + TERRAIN.playMargin;
    const center: Vector3Tuple = [centerX, 0, centerZ];
    const seed = hashString(`${chapter.title}-${chapter.chapterIndex}`);

    const heightField = new TerrainHeightField(
        manifest.environment.terrain,
        playRadius,
        regionFloors,
        corridorPaths,
        seed
    );

    world.addEntity(new TerrainSurround(world.context, center, playRadius, heightField, seed));
    world.addEntity(new GrassField(world.context, camera, center, heightField, seed + 5));

    placeSurroundVegetation(manifest, heightField, playRadius, center, seed + 3).forEach(
        (groups, bucketIndex) =>
            world.addEntity(new RegionProps(`wild-${bucketIndex}`, world.context, groups))
    );

    const corridorGroups = placeCorridorAnchors(
        manifest,
        heightField,
        corridorSpans,
        regionFootprints,
        center,
        seed + 7
    );

    if (corridorGroups.length > 0)
        world.addEntity(new RegionProps("corridor-anchors", world.context, corridorGroups));

    return {
        groundHeightAt: (worldX, worldZ) =>
            heightField.elevationAt(worldX - centerX, worldZ - centerZ),
    };
}

interface ITerrainContext {
    groundHeightAt: GroundHeightLookup;
}

type GroundHeightLookup = (worldX: number, worldZ: number) => number;
