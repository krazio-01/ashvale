import type { Camera, Vector3Tuple } from "three";
import { PropBatch } from "@/world/props/PropBatch";
import { TerrainMesh } from "@/world/terrain/TerrainMesh";
import { GrassField } from "@/world/vegetation/GrassField";
import { Player } from "@/entities/characters/Player";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { bossModel } from "@/entities/characters/BossModel";
import { spawnEnemyBody } from "@/entities/characters/EnemySpawner";
import { placeRegionProps, type IRegionEntrance } from "@/world/props/RegionPropPlacement";
import { scatterVegetation } from "@/world/vegetation/VegetationScatter";
import {
    placeCorridorProps,
    type ICorridorSpan,
    type IRegionFootprint,
} from "@/world/props/CorridorPropPlacement";
import { resolveThemeManifest } from "@/themes/ThemeManifests";
import { TerrainHeightField } from "@/world/terrain/TerrainHeightField";
import { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import type { IRegionFloor, ICorridorPath } from "@/world/terrain/TerrainHeightField";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import type { IChapterRegion, IRegionPathway } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { SPAWNING } from "@/constants/characters";
import { TERRAIN } from "@/constants/world";
import { hashString, spanBetween } from "@/lib/helpers";

export function spawnChapterWorld(world: World, camera: Camera, chapter: ChapterResponse): void {
    const manifest = resolveThemeManifest(chapter.theme, chapter.season);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    for (const region of chapter.regions)
        positionsByRegionId.set(region.regionId, region.worldPosition);

    const entrancesByRegionId = mapEntrancesToRegions(chapter, positionsByRegionId);
    const terrain = spawnTerrain(world, camera, chapter, manifest, positionsByRegionId);

    spawnRegionEntities(world, chapter, manifest, terrain, entrancesByRegionId);
    spawnPlayer(world, camera, chapter, positionsByRegionId, terrain);
    spawnBoss(world, chapter, positionsByRegionId, terrain);
}

function spawnRegionEntities(
    world: World,
    chapter: ChapterResponse,
    manifest: IThemeManifest,
    terrain: ITerrainContext,
    entrancesByRegionId: Map<string, IRegionEntrance[]>
): void {
    for (const region of chapter.regions) {
        world.addEntity(
            new PropBatch(
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
}

function spawnPlayer(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>,
    terrain: ITerrainContext
): void {
    const spawnPosition = positionsByRegionId.get(chapter.spawnRegionId);
    if (!spawnPosition) return;

    world.addEntity(
        new Player("player", world.context, camera, [
            spawnPosition[0],
            terrain.groundHeightAt(spawnPosition[0], spawnPosition[2]) + SPAWNING.playerSpawnHeight,
            spawnPosition[2],
        ])
    );
}

function spawnBoss(
    world: World,
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>,
    terrain: ITerrainContext
): void {
    const bossPosition = positionsByRegionId.get(chapter.bossRegionId);
    if (!chapter.boss || !bossPosition) return;

    world.addEntity(
        new CharacterBody(bossModel(), world.context, [
            bossPosition[0],
            terrain.groundHeightAt(bossPosition[0], bossPosition[2]) + SPAWNING.bossSpawnHeight,
            bossPosition[2],
        ])
    );
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

        const { spanX, spanZ, length: spanLength } = spanBetween(
            fromPosition[0],
            fromPosition[2],
            toPosition[0],
            toPosition[2]
        );

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
    const [centerX, centerZ] = computeChapterCenter(chapter.regions);
    const { regionFloors, regionFootprints, furthestDistance } = buildRegionGeometry(
        chapter.regions,
        centerX,
        centerZ
    );
    const { corridorPaths, corridorSpans } = buildCorridorGeometry(
        chapter.pathways,
        positionsByRegionId,
        centerX,
        centerZ
    );

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

    const heightMap = new TerrainHeightMap(
        heightField,
        playRadius + TERRAIN.transition + TERRAIN.spread
    );

    world.addEntity(new TerrainMesh(world.context, center, heightMap, seed));
    world.addEntity(new GrassField(world.context, camera, center, heightMap));

    scatterVegetation(manifest, heightMap, playRadius, center, seed + 3).forEach(
        (groups, bucketIndex) =>
            world.addEntity(new PropBatch(`wild-${bucketIndex}`, world.context, groups))
    );

    const corridorGroups = placeCorridorProps(
        manifest,
        heightMap,
        corridorSpans,
        regionFootprints,
        center,
        seed + 7
    );

    if (corridorGroups.length > 0)
        world.addEntity(new PropBatch("corridor-anchors", world.context, corridorGroups));

    return {
        groundHeightAt: (worldX, worldZ) =>
            heightMap.elevationAt(worldX - centerX, worldZ - centerZ),
    };
}

function computeChapterCenter(regions: IChapterRegion[]): [number, number] {
    let centerX = 0;
    let centerZ = 0;

    for (const region of regions) {
        centerX += region.worldPosition[0];
        centerZ += region.worldPosition[2];
    }

    return [centerX / regions.length, centerZ / regions.length];
}

function buildRegionGeometry(
    regions: IChapterRegion[],
    centerX: number,
    centerZ: number
): IRegionGeometry {
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

    return { regionFloors, regionFootprints, furthestDistance };
}

function buildCorridorGeometry(
    pathways: IRegionPathway[],
    positionsByRegionId: Map<string, Vector3Tuple>,
    centerX: number,
    centerZ: number
): ICorridorGeometry {
    const corridorPaths: ICorridorPath[] = [];
    const corridorSpans: ICorridorSpan[] = [];

    for (const pathway of pathways) {
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

    return { corridorPaths, corridorSpans };
}

interface IRegionGeometry {
    regionFloors: IRegionFloor[];
    regionFootprints: IRegionFootprint[];
    furthestDistance: number;
}

interface ICorridorGeometry {
    corridorPaths: ICorridorPath[];
    corridorSpans: ICorridorSpan[];
}

interface ITerrainContext {
    groundHeightAt: GroundHeightLookup;
}

type GroundHeightLookup = (worldX: number, worldZ: number) => number;
