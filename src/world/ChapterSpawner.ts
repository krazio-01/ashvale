import type { Camera, Vector3Tuple } from "three";
import { PropBatch } from "@/world/props/PropBatch";
import { TerrainSurface } from "@/world/terrain/TerrainSurface";
import { GrassField } from "@/world/vegetation/GrassField";
import { Player } from "@/entities/characters/player/Player";
import { CharacterBody } from "@/entities/characters/CharacterBody";
import { bossSpec } from "@/entities/characters/bosses/BossModel";
import { spawnEnemyBody } from "@/entities/characters/enemies/EnemySpawner";
import { placeRegionEnemies } from "@/world/EnemyPlacement";
import { buildPropField, type ICorridorLane, type IRegionSite } from "@/world/props/PropField";
import { resolveThemeManifest } from "@/themes/ThemeManifests";
import {
    CorridorClimbStyle,
    TerrainGenerator,
    TerrainSampleGrid,
    WALKABLE_REACH,
    type IRegionFloor,
    type ICorridorPath,
} from "@/world/terrain/TerrainGeneration";
import { plotWaterCourses, type IRegionLink } from "@/world/water/WaterCourse";
import { WaterSurface } from "@/world/water/WaterSurface";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import { ChapterTheme, type IChapterRegion, type IRegionPathway } from "@/types/realm";
import type { ISettlementLayoutResult } from "@/types/settlement";
import { buildSettlementLayout } from "@/world/settlement/SettlementLayout";
import { SettlementColliders } from "@/world/settlement/SettlementColliders";
import type { IPropGroup, IThemeManifest } from "@/types/theme";
import type { SpawnProgressListener } from "@/types/world";
import { ENEMY_PLACEMENT, PLAYER, SPAWNING } from "@/constants/characters";
import { TERRAIN } from "@/constants/world";
import { createSeededRandom, hashString, yieldToBrowser } from "@/lib/helpers";
import { TerrainEdgeBarrier, TerrainLedges } from "./terrain/TerrainFeatures";
import {
    buildGroundDetailTexture,
    buildGroundSplatTexture,
    deriveGroundMaterials,
} from "./terrain/TerrainMaterials";
import { BloomField } from "./vegetation/BloomField";

const SPAWN_TIME_SLICE_MS = 8;
const MAX_SETTLED_REGIONS = 4;

export async function spawnChapterWorld(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    reportProgress?: SpawnProgressListener
): Promise<void> {
    const beginStage = createStageRunner(reportProgress);
    const manifest = resolveThemeManifest(chapter.theme, chapter.season);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    for (const region of chapter.regions)
        positionsByRegionId.set(region.regionId, region.worldPosition);

    const terrain = await spawnTerrain(
        world,
        camera,
        chapter,
        manifest,
        positionsByRegionId,
        beginStage
    );

    await beginStage("Waking the inhabitants");
    spawnRegionEnemies(world, chapter, terrain, positionsByRegionId);

    const player = spawnPlayer(world, camera, chapter, positionsByRegionId, terrain);

    if (player) terrain.waterSurface?.follow(player.sceneObject, PLAYER.height / 2);

    spawnBoss(world, chapter, positionsByRegionId, terrain);
}

function createStageRunner(reportProgress?: SpawnProgressListener): StageRunner {
    return async (stageLabel: string) => {
        reportProgress?.(stageLabel);
        await yieldToBrowser();
    };
}

async function spawnTerrain(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    manifest: IThemeManifest,
    positionsByRegionId: Map<string, Vector3Tuple>,
    beginStage: StageRunner
): Promise<ITerrainContext> {
    const [centerX, centerZ] = computeChapterCenter(chapter.regions);
    const { regionFloors, regionSites, furthestDistance } = buildRegionGeometry(
        chapter.regions,
        centerX,
        centerZ,
        chapter.bossRegionId,
        chapter.spawnRegionId
    );
    const seed = hashString(`${chapter.title}-${chapter.chapterIndex}`);
    const { corridorPaths, corridorLanes, regionLinks } = buildCorridorGeometry(
        chapter.pathways,
        chapter.regions,
        positionsByRegionId,
        centerX,
        centerZ,
        createSeededRandom(seed + 17)
    );

    const mappedRadius = furthestDistance + WALKABLE_REACH;
    const center: Vector3Tuple = [centerX, 0, centerZ];

    await beginStage("Sculpting the terrain");
    const dryHeightField = new TerrainGenerator(regionFloors, corridorPaths, null, seed);
    const waterCourses = plotWaterCourses(
        regionFloors,
        regionLinks,
        corridorPaths,
        dryHeightField,
        seed + 29
    );
    const heightField =
        waterCourses.length > 0
            ? new TerrainGenerator(regionFloors, corridorPaths, waterCourses, seed)
            : dryHeightField;
    const heightMap = new TerrainSampleGrid(heightField, mappedRadius);
    const terrainFieldTexture = heightMap.createShaderTexture();

    await beginStage("Weathering the soil");
    const groundMaterials = deriveGroundMaterials(world.context.environment.terrain);
    const groundSplat = buildGroundSplatTexture(seed);
    const groundDetail = buildGroundDetailTexture(seed);

    await beginStage("Laying the ground");
    world.addEntity(
        new TerrainSurface(
            world.context,
            center,
            heightMap,
            terrainFieldTexture,
            groundSplat,
            groundDetail,
            groundMaterials
        )
    );
    world.addEntity(new TerrainEdgeBarrier(world.context, center, heightMap));
    world.addEntity(new TerrainLedges(world.context, center, corridorPaths));

    let waterSurface: WaterSurface | null = null;

    if (waterCourses.length > 0) {
        await beginStage("Letting the river in");
        waterSurface = new WaterSurface(world.context, center, waterCourses, heightMap);
        world.addEntity(waterSurface);
    }

    await beginStage("Sowing the grasslands");
    world.addEntity(
        new GrassField(
            world.context,
            camera,
            center,
            heightMap,
            terrainFieldTexture,
            groundSplat,
            groundDetail,
            groundMaterials
        )
    );

    await beginStage("Scattering wildflowers");
    world.addEntity(
        new BloomField(
            world.context,
            camera,
            center,
            heightMap,
            terrainFieldTexture,
            groundSplat,
            groundDetail,
            groundMaterials
        )
    );

    const { layout: settlementLayout, settledRegionIds } = buildSettlementLayouts(
        chapter,
        regionSites,
        corridorLanes,
        heightMap,
        seed + 4
    );

    await beginStage("Planting the woodland");
    const { buckets: propBuckets, occupancy: propOccupancy } = buildPropField({
        manifest,
        heightMap,
        sites: regionSites,
        lanes: corridorLanes,
        chapterSpawnPoints: chapterSpawnPointsIn(chapter, positionsByRegionId, centerX, centerZ),
        center,
        fieldRadius: mappedRadius,
        seed: seed + 3,
        waterCourses,
        extraReservations: settlementLayout
            ? { discs: settlementLayout.keepOutDiscs, lanes: settlementLayout.keepOutLanes }
            : undefined,
        extraPlacements: settlementLayout?.placements.map((placement) => ({
            prop: placement.prop,
            hasCollider: placement.hasCollider,
            localX: placement.localX,
            localZ: placement.localZ,
            elevation: placement.elevation,
            rotationY: placement.rotationY,
            scale: placement.scale,
        })),
    });

    await addPropBuckets(world, camera, propBuckets);

    if (settlementLayout && settlementLayout.colliders.length > 0)
        world.addEntity(
            new SettlementColliders("settlement", world.context, center, settlementLayout.colliders)
        );

    return {
        waterSurface,
        groundHeightAt: (worldX, worldZ) =>
            heightMap.surfaceElevationAt(worldX - centerX, worldZ - centerZ),
        groundSteepnessAt: (worldX, worldZ) =>
            heightMap.steepnessAt(worldX - centerX, worldZ - centerZ),
        propIsClear: (worldX, worldZ, radius) =>
            propOccupancy.isClear(worldX - centerX, worldZ - centerZ, radius),
        settledRegionIds,
    };
}

function buildSettlementLayouts(
    chapter: ChapterResponse,
    regionSites: IRegionSite[],
    lanes: ICorridorLane[],
    heightMap: TerrainSampleGrid,
    seed: number
): { layout: ISettlementLayoutResult | null; settledRegionIds: Set<string> } {
    const settledRegionIds = new Set<string>();
    if (chapter.theme !== ChapterTheme.Settlement) return { layout: null, settledRegionIds };

    const candidates: { index: number; extent: number }[] = [];

    for (let index = 0; index < chapter.regions.length; index += 1) {
        const region = chapter.regions[index];
        const site = regionSites[index];
        if (!region || !site) continue;
        if (region.regionId === chapter.spawnRegionId) continue;
        if (region.regionId === chapter.bossRegionId) continue;

        candidates.push({ index, extent: Math.min(site.halfWidth, site.halfDepth) });
    }

    candidates.sort((first, second) => second.extent - first.extent);

    const merged: ISettlementLayoutResult = {
        placements: [],
        colliders: [],
        keepOutDiscs: [],
        keepOutLanes: [],
    };

    for (const [order, candidate] of candidates.slice(0, MAX_SETTLED_REGIONS).entries()) {
        const site = regionSites[candidate.index];
        const region = chapter.regions[candidate.index];
        if (!site || !region) continue;

        const layout = buildSettlementLayout({ site, lanes, heightMap, seed: seed + order * 101 });
        if (layout.placements.length === 0) continue;

        merged.placements.push(...layout.placements);
        merged.colliders.push(...layout.colliders);
        merged.keepOutDiscs.push(...layout.keepOutDiscs);
        merged.keepOutLanes.push(...layout.keepOutLanes);
        settledRegionIds.add(region.regionId);
    }

    return { layout: merged.placements.length > 0 ? merged : null, settledRegionIds };
}

async function addPropBuckets(
    world: World,
    camera: Camera,
    propBuckets: IPropGroup[][]
): Promise<void> {
    let sliceStartedAt = performance.now();

    for (let index = 0; index < propBuckets.length; index += 1) {
        const bucket = propBuckets[index];
        if (!bucket) continue;

        world.addEntity(new PropBatch(`props-${index}`, world.context, camera, bucket));

        if (performance.now() - sliceStartedAt < SPAWN_TIME_SLICE_MS) continue;

        await yieldToBrowser();
        sliceStartedAt = performance.now();
    }
}

function spawnPlayer(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>,
    terrain: ITerrainContext
): Player | null {
    const spawnPosition = positionsByRegionId.get(chapter.spawnRegionId);
    if (!spawnPosition) return null;

    const player = new Player(
        "player",
        world.context,
        camera,
        [
            spawnPosition[0],
            terrain.groundHeightAt(spawnPosition[0], spawnPosition[2]) + SPAWNING.playerSpawnHeight,
            spawnPosition[2],
        ],
        spawnFacingYaw(chapter, chapter.spawnRegionId, spawnPosition, positionsByRegionId)
    );

    world.addEntity(player);

    return player;
}

function spawnFacingYaw(
    chapter: ChapterResponse,
    spawnRegionId: string,
    spawnPosition: Vector3Tuple,
    positionsByRegionId: Map<string, Vector3Tuple>
): number {
    for (const pathway of chapter.pathways) {
        const isOutgoing = pathway.fromRegionId === spawnRegionId;
        const isIncoming = pathway.toRegionId === spawnRegionId;
        if (!isOutgoing && !isIncoming) continue;

        const otherRegionId = isOutgoing ? pathway.toRegionId : pathway.fromRegionId;
        const otherPosition = positionsByRegionId.get(otherRegionId);
        if (!otherPosition) continue;

        const dx = otherPosition[0] - spawnPosition[0];
        const dz = otherPosition[2] - spawnPosition[2];
        if (dx === 0 && dz === 0) continue;

        return Math.atan2(dx, dz);
    }

    return 0;
}

function spawnBoss(
    world: World,
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>,
    terrain: ITerrainContext
): void {
    const bossPosition = positionsByRegionId.get(chapter.bossRegionId);
    if (!chapter.boss || !bossPosition) return;

    const spec = bossSpec();

    world.addEntity(
        new CharacterBody(spec, world.context, [
            bossPosition[0],
            terrain.groundHeightAt(bossPosition[0], bossPosition[2]) +
                spec.height / 2 +
                SPAWNING.spawnClearanceBuffer,
            bossPosition[2],
        ])
    );
}

function spawnRegionEnemies(
    world: World,
    chapter: ChapterResponse,
    terrain: ITerrainContext,
    positionsByRegionId: Map<string, Vector3Tuple>
): void {
    const playerSpawn = positionsByRegionId.get(chapter.spawnRegionId);

    for (const region of chapter.regions) {
        if (region.regionId === chapter.bossRegionId) continue;
        if (terrain.settledRegionIds.has(region.regionId)) continue;

        const placements = placeRegionEnemies(region, {
            groundHeightAt: terrain.groundHeightAt,
            groundSteepnessAt: terrain.groundSteepnessAt,
            propIsClear: terrain.propIsClear,
            clearance:
                region.regionId === chapter.spawnRegionId && playerSpawn
                    ? {
                          x: playerSpawn[0],
                          z: playerSpawn[2],
                          radius: ENEMY_PLACEMENT.playerSpawnClearance,
                      }
                    : null,
        });

        for (const placement of placements)
            world.addEntity(
                spawnEnemyBody(
                    placement.archetype,
                    world.context,
                    placement.position,
                    placement.facingYaw
                )
            );
    }
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
    centerZ: number,
    bossRegionId?: string,
    spawnRegionId?: string
): IRegionGeometry {
    const len = regions.length;
    let furthestDistance = 0;

    const regionFloors = new Array<IRegionFloor>(len);
    const regionSites = new Array<IRegionSite>(len);

    for (let i = 0; i < len; i++) {
        const region = regions[i];
        const [x, y, z] = region.worldPosition;
        const [width, depth] = region.floorSize;

        const localX = x - centerX;
        const localZ = z - centerZ;
        const halfWidth = width / 2;
        const halfDepth = depth / 2;

        regionSites[i] = {
            centerX: localX,
            centerZ: localZ,
            halfWidth,
            halfDepth,
            fileCount: region.fileCount,
            floorElevation: y,
        };

        regionFloors[i] = {
            centerX: localX,
            centerZ: localZ,
            halfWidth,
            halfDepth,
            floorElevation: y,
            nestingDepth: region.nestingDepth,
            isBossRegion: region.regionId === bossRegionId,
            isSpawnRegion: region.regionId === spawnRegionId,
        };

        const distance = Math.hypot(localX, localZ) + Math.hypot(halfWidth, halfDepth);
        if (distance > furthestDistance) furthestDistance = distance;
    }

    return { regionFloors, regionSites, furthestDistance };
}

function buildCorridorGeometry(
    pathways: IRegionPathway[],
    regions: IChapterRegion[],
    positionsByRegionId: Map<string, Vector3Tuple>,
    centerX: number,
    centerZ: number,
    nextRandom: () => number
): ICorridorGeometry {
    const corridorPaths: ICorridorPath[] = [];
    const corridorLanes: ICorridorLane[] = [];
    const regionLinks: IRegionLink[] = [];
    const indexByRegionId = new Map<string, number>();

    for (let i = 0, len = regions.length; i < len; i++) indexByRegionId.set(regions[i].regionId, i);

    for (let i = 0, len = pathways.length; i < len; i++) {
        const pathway = pathways[i];
        const fromPosition = positionsByRegionId.get(pathway.fromRegionId);
        const toPosition = positionsByRegionId.get(pathway.toRegionId);
        const fromIndex = indexByRegionId.get(pathway.fromRegionId);
        const toIndex = indexByRegionId.get(pathway.toRegionId);

        if (!fromPosition || !toPosition) continue;
        if (fromIndex !== undefined && toIndex !== undefined)
            regionLinks.push({ fromIndex, toIndex });

        const fromX = fromPosition[0] - centerX;
        const fromZ = fromPosition[2] - centerZ;
        const toX = toPosition[0] - centerX;
        const toZ = toPosition[2] - centerZ;
        const halfWidth = pathway.corridorWidth / 2;

        corridorLanes.push({ fromX, fromZ, toX, toZ, halfWidth });

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

    return { corridorPaths, corridorLanes, regionLinks };
}

function chapterSpawnPointsIn(
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>,
    centerX: number,
    centerZ: number
): [number, number][] {
    const points: [number, number][] = [];

    for (const regionId of [chapter.spawnRegionId, chapter.bossRegionId]) {
        const position = positionsByRegionId.get(regionId);
        if (position) points.push([position[0] - centerX, position[2] - centerZ]);
    }

    return points;
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

type StageRunner = (stageLabel: string) => Promise<void>;

interface IRegionGeometry {
    regionFloors: IRegionFloor[];
    regionSites: IRegionSite[];
    furthestDistance: number;
}

interface ICorridorGeometry {
    corridorPaths: ICorridorPath[];
    corridorLanes: ICorridorLane[];
    regionLinks: IRegionLink[];
}

interface ITerrainContext {
    waterSurface: WaterSurface | null;
    groundHeightAt: GroundHeightLookup;
    groundSteepnessAt: GroundHeightLookup;
    propIsClear: (worldX: number, worldZ: number, radius: number) => boolean;
    settledRegionIds: Set<string>;
}

type GroundHeightLookup = (worldX: number, worldZ: number) => number;
