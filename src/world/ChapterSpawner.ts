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
import {
    CorridorClimbStyle,
    TerrainHeightField,
    WALKABLE_REACH,
} from "@/world/terrain/TerrainHeightField";
import { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import type { IRegionFloor, ICorridorPath } from "@/world/terrain/TerrainHeightField";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import type { IChapterRegion, IRegionPathway } from "@/types/realm";
import type { IThemeManifest } from "@/types/theme";
import { SPAWNING } from "@/constants/characters";
import { TERRAIN } from "@/constants/world";
import { FULL_TURN, createSeededRandom, hashString } from "@/lib/helpers";
import { WalkableEdgeBarrier } from "./terrain/WalkableEdgeBarrier";
import { LedgePlatforms } from "./terrain/LedgePlatforms";
import {
    buildGroundDetailTexture,
    buildGroundSplatTexture,
    deriveGroundMaterials,
} from "./terrain/GroundMaterials";

const EMPTY_ENTRANCES: IRegionEntrance[] = [];

export function spawnChapterWorld(world: World, camera: Camera, chapter: ChapterResponse): void {
    const manifest = resolveThemeManifest(chapter.theme, chapter.season);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    const regions = chapter.regions;
    for (let i = 0, len = regions.length; i < len; i++) {
        const region = regions[i];
        positionsByRegionId.set(region.regionId, region.worldPosition);
    }

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
    const regions = chapter.regions;

    for (let i = 0, len = regions.length; i < len; i++) {
        const region = regions[i];
        const entrances = entrancesByRegionId.get(region.regionId) || EMPTY_ENTRANCES;

        world.addEntity(
            new PropBatch(
                region.regionId,
                world.context,
                placeRegionProps(
                    region,
                    manifest,
                    terrain.groundHeightAt,
                    terrain.groundSteepnessAt,
                    entrances
                )
            )
        );

        if (region.regionId !== chapter.bossRegionId) {
            spawnRegionEnemies(world, region, terrain.groundHeightAt);
        }
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
    const pathways = chapter.pathways;

    for (let i = 0, len = pathways.length; i < len; i++) {
        const pathway = pathways[i];
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;

        const spanX = toPosition[0] - fromPosition[0];
        const spanZ = toPosition[2] - fromPosition[2];
        const spanLength = Math.sqrt(spanX * spanX + spanZ * spanZ);

        if (spanLength === 0) continue;

        const dirX = spanX / spanLength;
        const dirZ = spanZ / spanLength;
        const corridorWidth = pathway.corridorWidth;

        let fromEntrances = entrancesByRegionId.get(pathway.fromRegionId);
        if (!fromEntrances) {
            fromEntrances = [];
            entrancesByRegionId.set(pathway.fromRegionId, fromEntrances);
        }
        fromEntrances.push({ directionX: dirX, directionZ: dirZ, corridorWidth });

        let toEntrances = entrancesByRegionId.get(pathway.toRegionId);
        if (!toEntrances) {
            toEntrances = [];
            entrancesByRegionId.set(pathway.toRegionId, toEntrances);
        }
        toEntrances.push({ directionX: -dirX, directionZ: -dirZ, corridorWidth });
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

    const [width, depth] = region.floorSize;
    const [x, , z] = region.worldPosition;

    const radius = Math.min(width, depth) * SPAWNING.enemyRingRadiusFactor;
    const angleStep = FULL_TURN / enemyCount;

    for (let i = 0; i < enemyCount; i++) {
        const angle = i * angleStep;
        const enemyX = x + Math.cos(angle) * radius;
        const enemyZ = z + Math.sin(angle) * radius;
        const enemyY = groundHeightAt(enemyX, enemyZ) + SPAWNING.enemySpawnHeight;

        world.addEntity(spawnEnemyBody(region, world.context, [enemyX, enemyY, enemyZ]));
    }
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
    const seed = hashString(`${chapter.title}-${chapter.chapterIndex}`);
    const { corridorPaths, corridorSpans } = buildCorridorGeometry(
        chapter.pathways,
        positionsByRegionId,
        centerX,
        centerZ,
        createSeededRandom(seed + 17)
    );

    const mappedRadius = furthestDistance + WALKABLE_REACH;
    const center: Vector3Tuple = [centerX, 0, centerZ];

    const heightField = new TerrainHeightField(regionFloors, corridorPaths, seed);
    const heightMap = new TerrainHeightMap(heightField, mappedRadius);
    const groundMaterials = deriveGroundMaterials(world.context.environment.terrain);
    const groundSplat = buildGroundSplatTexture(seed);
    const groundDetail = buildGroundDetailTexture(seed);

    world.addEntity(
        new TerrainMesh(
            world.context,
            center,
            heightMap,
            groundSplat,
            groundDetail,
            groundMaterials
        )
    );
    world.addEntity(new WalkableEdgeBarrier(world.context, center, heightMap));
    world.addEntity(new LedgePlatforms(world.context, center, corridorPaths));
    world.addEntity(
        new GrassField(
            world.context,
            camera,
            center,
            heightMap,
            groundSplat,
            groundDetail,
            groundMaterials
        )
    );

    const vegetationBuckets = scatterVegetation(
        manifest,
        heightMap,
        mappedRadius,
        center,
        seed + 3
    );

    for (let i = 0, len = vegetationBuckets.length; i < len; i++)
        world.addEntity(new PropBatch(`wild-${i}`, world.context, vegetationBuckets[i]));

    const corridorGroups = placeCorridorProps(
        manifest,
        heightMap,
        corridorSpans,
        regionFootprints,
        center,
        seed + 7
    );

    if (corridorGroups.length > 0) {
        world.addEntity(new PropBatch("corridor-anchors", world.context, corridorGroups));
    }

    return {
        groundHeightAt: (worldX, worldZ) =>
            heightMap.elevationAt(worldX - centerX, worldZ - centerZ),
        groundSteepnessAt: (worldX, worldZ) =>
            heightMap.steepnessAt(worldX - centerX, worldZ - centerZ),
    };
}

function computeChapterCenter(regions: IChapterRegion[]): [number, number] {
    let centerX = 0;
    let centerZ = 0;
    const len = regions.length;

    if (len === 0) return [0, 0];

    for (let i = 0; i < len; i++) {
        const pos = regions[i].worldPosition;
        centerX += pos[0];
        centerZ += pos[2];
    }

    return [centerX / len, centerZ / len];
}

function buildRegionGeometry(
    regions: IChapterRegion[],
    centerX: number,
    centerZ: number
): IRegionGeometry {
    const len = regions.length;
    let furthestDistance = 0;

    const regionFloors = new Array<IRegionFloor>(len);
    const regionFootprints = new Array<IRegionFootprint>(len);

    for (let i = 0; i < len; i++) {
        const region = regions[i];
        const [x, y, z] = region.worldPosition;
        const [width, depth] = region.floorSize;

        const localX = x - centerX;
        const localZ = z - centerZ;
        const halfWidth = width / 2;
        const halfDepth = depth / 2;

        regionFootprints[i] = {
            centerX: localX,
            centerZ: localZ,
            halfWidth,
            halfDepth,
        };

        regionFloors[i] = {
            centerX: localX,
            centerZ: localZ,
            halfWidth,
            halfDepth,
            floorElevation: y,
            nestingDepth: region.nestingDepth,
        };

        const distance = Math.sqrt(localX * localX + localZ * localZ) + Math.max(width, depth) / 2;
        if (distance > furthestDistance) furthestDistance = distance;
    }

    return { regionFloors, regionFootprints, furthestDistance };
}

function buildCorridorGeometry(
    pathways: IRegionPathway[],
    positionsByRegionId: Map<string, Vector3Tuple>,
    centerX: number,
    centerZ: number,
    nextRandom: () => number
): ICorridorGeometry {
    const corridorPaths: ICorridorPath[] = [];
    const corridorSpans: ICorridorSpan[] = [];

    for (let i = 0, len = pathways.length; i < len; i++) {
        const pathway = pathways[i];
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;

        const fromX = fromPosition[0] - centerX;
        const fromZ = fromPosition[2] - centerZ;
        const toX = toPosition[0] - centerX;
        const toZ = toPosition[2] - centerZ;
        const halfWidth = pathway.corridorWidth / 2;

        corridorSpans.push({ fromX, fromZ, toX, toZ, halfWidth });

        corridorPaths.push({
            fromX,
            fromZ,
            toX,
            toZ,
            halfWidth,
            fromElevation: fromPosition[1],
            toElevation: toPosition[1],
            climbStyle: pickClimbStyle(nextRandom),
            lateralSeed: nextRandom(),
        });
    }

    return { corridorPaths, corridorSpans };
}

function pickClimbStyle(nextRandom: () => number): CorridorClimbStyle {
    const styles = [
        CorridorClimbStyle.Ramp,
        CorridorClimbStyle.Straight,
        CorridorClimbStyle.Zigzag,
        CorridorClimbStyle.Hidden,
    ];

    let remaining = nextRandom();

    for (let i = 0; i < styles.length; i++) {
        const weight = TERRAIN.climbStyleWeights[i] ?? 0;
        if (remaining < weight) return styles[i] ?? CorridorClimbStyle.Ramp;
        remaining -= weight;
    }

    return CorridorClimbStyle.Ramp;
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
    groundSteepnessAt: GroundHeightLookup;
}

type GroundHeightLookup = (worldX: number, worldZ: number) => number;
