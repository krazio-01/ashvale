import type { Camera, Vector3Tuple } from "three";
import { PropChunk } from "@/world/props/PropChunk";
import { TerrainSurface } from "@/world/terrain/TerrainSurface";
import { GROUND_COVER_KINDS, GroundCoverField } from "@/world/vegetation/GroundCoverField";
import type { IGroundCoverKind } from "@/world/vegetation/GroundCoverField";
import { Player } from "@/entities/characters/player/Player";
import { buildBossFromChapter } from "@/entities/characters/bosses/BossComposer";
import { CombatDiagnostics } from "@/systems/combat/CombatDiagnostics";
import { AlertMarkerTracker, DamageNumberTracker } from "@/world/HudTrackers";
import { CombatNoiseEmitter } from "@/systems/enemyBehaviour/perception/CombatNoiseEmitter";
import { Enemy } from "@/entities/characters/enemies/Enemy";
import {
    placeRegionEnemies,
    standingSpawnHeight,
} from "@/entities/characters/enemies/EnemySpawner";
import { buildPropField } from "@/world/props/PropField";
import {
    CorridorClimbStyle,
    type IRegionFloor,
    type ICorridorPath,
    type ICorridorLane,
    type IRegionLink,
} from "@/types/world";
import { resolveTheme } from "@/themes/Themes";
import {
    TerrainHeightField,
    TerrainSampleGrid,
    WALKABLE_REACH,
} from "@/world/terrain/TerrainGeneration";
import { plotWaterCourses } from "@/world/water/WaterCourse";
import { WaterSurface } from "@/world/water/WaterSurface";
import type { World } from "@/world/World";
import type { ChapterResponse } from "@/responses/realm/RealmResponse";
import { ChapterTheme, type IChapterRegion, type IRegionPathway } from "@/types/realm";
import type {
    ISettlementLayoutResult,
    SpawnProgressListener,
    IPropGroup,
    IThemeConfig,
    IWaterCourse,
    IGroundSurface,
} from "@/types/world";
import { buildSettlementLayout } from "@/world/settlement/SettlementLayout";
import { SettlementColliders } from "@/world/settlement/SettlementColliders";
import type { CombatCharacter } from "@/entities/characters/CombatCharacter";
import { ENEMY_PLACEMENT, SPAWNING, ARCHETYPES } from "@/constants/enemies";
import { PLAYER } from "@/constants/player";
import { TERRAIN, CHAPTER_SEED_OFFSETS } from "@/constants/world";
import { createSeededRandom, hashString, yawFromDirection } from "@/lib/helpers";
import { TerrainEdgeBarrier, TerrainLedges } from "./terrain/TerrainFeatures";
import {
    buildGroundDetailTexture,
    buildGroundSplatTexture,
    deriveGroundMaterials,
} from "./terrain/TerrainMaterials";
import { LOADING_TEXT } from "@/constants/strings";
import type { PropOccupancy } from "@/world/props/PropPlacement";

const SPAWN_TIME_SLICE_MS = 8;

const MAX_SETTLED_REGIONS = 4;

const WORLD_LAYERS: readonly IWorldLayer[] = [
    {
        stage: LOADING_TEXT.stages.ground,
        build: ({ world, center, surface, corridorPaths }) => {
            world.addEntity(new TerrainSurface(world.context, center, surface));
            world.addEntity(new TerrainEdgeBarrier(world.context, center, surface.sampleGrid));
            world.addEntity(new TerrainLedges(world.context, center, corridorPaths));
        },
    },
    {
        stage: LOADING_TEXT.stages.river,
        isPresent: (build) => build.waterCourses.length > 0,
        build: (build) => {
            build.waterSurface = new WaterSurface(
                build.world.context,
                build.center,
                build.waterCourses,
                build.surface.sampleGrid
            );
            build.world.addEntity(build.waterSurface);
        },
    },
    {
        stage: LOADING_TEXT.stages.grasslands,
        build: (build) => addGroundCover(build, GROUND_COVER_KINDS.grass),
    },
    {
        stage: LOADING_TEXT.stages.wildflowers,
        build: (build) => addGroundCover(build, GROUND_COVER_KINDS.flowers),
    },
    {
        build: (build) => {
            const { layout, settledRegionIds } = settleRegions(
                build.chapter,
                build.regionSites,
                build.corridorPaths,
                build.surface.sampleGrid,
                build.seed + CHAPTER_SEED_OFFSETS.settlement
            );
            build.settlement = layout;
            build.settledRegionIds = settledRegionIds;
        },
    },
    {
        stage: LOADING_TEXT.stages.woodland,
        build: async (build) => {
            const [centerX, , centerZ] = build.center;
            const { chunks, occupancy } = buildPropField({
                manifest: build.manifest,
                sampleGrid: build.surface.sampleGrid,
                sites: build.regionSites,
                lanes: build.corridorPaths,
                chapterSpawnPoints: spawnAndBossPoints(
                    build.chapter,
                    build.positionsByRegionId,
                    centerX,
                    centerZ
                ),
                center: build.center,
                fieldRadius: build.terrainRadius,
                seed: build.seed + CHAPTER_SEED_OFFSETS.props,
                waterCourses: build.waterCourses,
                settlement: build.settlement,
            });
            build.propOccupancy = occupancy;
            await addPropChunks(build.world, build.camera, chunks);
        },
    },
    {
        isPresent: (build) => (build.settlement?.colliders.length ?? 0) > 0,
        build: ({ world, center, settlement }) => {
            if (settlement)
                world.addEntity(
                    new SettlementColliders(world.context, center, settlement.colliders)
                );
        },
    },
];

interface IWorldBuild {
    readonly world: World;
    readonly camera: Camera;
    readonly chapter: ChapterResponse;
    readonly manifest: IThemeConfig;
    readonly seed: number;
    readonly center: Vector3Tuple;
    readonly terrainRadius: number;
    readonly positionsByRegionId: Map<string, Vector3Tuple>;
    readonly regionSites: IRegionFloor[];
    readonly corridorPaths: ICorridorPath[];
    readonly surface: IGroundSurface;
    readonly waterCourses: IWaterCourse[];
    waterSurface: WaterSurface | null;
    settlement: ISettlementLayoutResult | null;
    settledRegionIds: Set<string>;
    propOccupancy: PropOccupancy | null;
}

interface IWorldLayer {
    stage?: string;
    isPresent?(build: IWorldBuild): boolean;
    build(build: IWorldBuild): void | Promise<void>;
}

type StageReporter = (stageLabel: string) => Promise<void>;

interface IRegionGeometry {
    regionFloors: IRegionFloor[];
    furthestDistance: number;
}

interface ICorridorGeometry {
    corridorPaths: ICorridorPath[];
    regionLinks: IRegionLink[];
}

interface IChapterGround {
    waterSurface: WaterSurface | null;
    groundHeightAt: GroundSampler;
    groundSteepnessAt: GroundSampler;
    propIsClear: (worldX: number, worldZ: number, radius: number) => boolean;
    settledRegionIds: Set<string>;
}

type GroundSampler = (worldX: number, worldZ: number) => number;

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
    });
}

export async function spawnChapterWorld(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    reportProgress?: SpawnProgressListener
): Promise<void> {
    const reportStage = createStageReporter(reportProgress);
    const manifest = resolveTheme(chapter.theme, chapter.season);
    const positionsByRegionId = new Map<string, Vector3Tuple>();

    for (const region of chapter.regions)
        positionsByRegionId.set(region.regionId, region.worldPosition);

    const terrain = await spawnTerrain(
        world,
        camera,
        chapter,
        manifest,
        positionsByRegionId,
        reportStage
    );

    await reportStage(LOADING_TEXT.stages.inhabitants);

    const player = spawnPlayer(world, camera, chapter, positionsByRegionId, terrain);

    if (player) terrain.waterSurface?.follow(player.sceneObject, PLAYER.height / 2);
    world.addEntity(new CombatNoiseEmitter(world.context.events));
    world.addEntity(new DamageNumberTracker(world.context.events, camera));
    if (process.env.NODE_ENV !== "production")
        world.addEntity(new CombatDiagnostics(world.context, player));

    const alertMarkers = new AlertMarkerTracker(camera);
    world.addEntity(alertMarkers);
    spawnRegionEnemies(world, chapter, terrain, positionsByRegionId, player, alertMarkers);
    spawnBoss(world, chapter, positionsByRegionId, terrain, player);
}

function createStageReporter(reportProgress?: SpawnProgressListener): StageReporter {
    return async (stageLabel: string) => {
        reportProgress?.(stageLabel);
        await yieldToBrowser();
    };
}

function addGroundCover(build: IWorldBuild, kind: IGroundCoverKind): void {
    build.world.addEntity(
        new GroundCoverField(kind, build.world.context, build.camera, build.center, build.surface)
    );
}

async function spawnTerrain(
    world: World,
    camera: Camera,
    chapter: ChapterResponse,
    manifest: IThemeConfig,
    positionsByRegionId: Map<string, Vector3Tuple>,
    reportStage: StageReporter
): Promise<IChapterGround> {
    const [centerX, centerZ] = computeChapterCenter(chapter.regions);
    const { regionFloors, furthestDistance } = buildRegionGeometry(
        chapter.regions,
        centerX,
        centerZ,
        chapter.bossRegionId
    );
    const seed = hashString(`${chapter.title}-${chapter.chapterIndex}`);
    const { corridorPaths, regionLinks } = buildCorridorGeometry(
        chapter.pathways,
        chapter.regions,
        positionsByRegionId,
        centerX,
        centerZ,
        createSeededRandom(seed + CHAPTER_SEED_OFFSETS.corridors)
    );

    const terrainRadius = furthestDistance + WALKABLE_REACH;
    const center: Vector3Tuple = [centerX, 0, centerZ];

    await reportStage(LOADING_TEXT.stages.terrain);
    const dryHeightField = new TerrainHeightField(regionFloors, corridorPaths, null, seed);
    const waterCourses = plotWaterCourses(
        regionFloors,
        regionLinks,
        corridorPaths,
        dryHeightField,
        seed + CHAPTER_SEED_OFFSETS.waterCourses
    );
    const heightField =
        waterCourses.length > 0
            ? new TerrainHeightField(regionFloors, corridorPaths, waterCourses, seed)
            : dryHeightField;
    const sampleGrid = new TerrainSampleGrid(heightField, terrainRadius);
    const fieldTexture = sampleGrid.createShaderTexture();

    await reportStage(LOADING_TEXT.stages.soil);
    const materials = deriveGroundMaterials(world.context.environment.terrain);
    const groundSplat = buildGroundSplatTexture(seed);
    const groundDetail = buildGroundDetailTexture(seed);

    const build: IWorldBuild = {
        world,
        camera,
        chapter,
        manifest,
        seed,
        center,
        terrainRadius,
        positionsByRegionId,
        regionSites: regionFloors,
        corridorPaths,
        surface: { sampleGrid, fieldTexture, groundSplat, groundDetail, materials },
        waterCourses,
        waterSurface: null,
        settlement: null,
        settledRegionIds: new Set(),
        propOccupancy: null,
    };

    for (const layer of WORLD_LAYERS) {
        if (layer.isPresent && !layer.isPresent(build)) continue;
        if (layer.stage) await reportStage(layer.stage);
        await layer.build(build);
    }

    const propOccupancy = build.propOccupancy;
    return {
        waterSurface: build.waterSurface,
        groundHeightAt: (worldX, worldZ) =>
            sampleGrid.surfaceElevationAt(worldX - centerX, worldZ - centerZ),
        groundSteepnessAt: (worldX, worldZ) =>
            sampleGrid.steepnessAt(worldX - centerX, worldZ - centerZ),
        propIsClear: (worldX, worldZ, radius) =>
            propOccupancy?.isClear(worldX - centerX, worldZ - centerZ, radius) ?? true,
        settledRegionIds: build.settledRegionIds,
    };
}

function settleRegions(
    chapter: ChapterResponse,
    regionSites: IRegionFloor[],
    lanes: ICorridorLane[],
    sampleGrid: TerrainSampleGrid,
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

        const layout = buildSettlementLayout({
            site,
            lanes,
            sampleGrid,
            seed: seed + order * CHAPTER_SEED_OFFSETS.perSettledRegion,
        });
        if (layout.placements.length === 0) continue;

        merged.placements.push(...layout.placements);
        merged.colliders.push(...layout.colliders);
        merged.keepOutDiscs.push(...layout.keepOutDiscs);
        merged.keepOutLanes.push(...layout.keepOutLanes);
        settledRegionIds.add(region.regionId);
    }

    return { layout: merged.placements.length > 0 ? merged : null, settledRegionIds };
}

async function addPropChunks(
    world: World,
    camera: Camera,
    propChunks: IPropGroup[][]
): Promise<void> {
    let sliceStartedAt = performance.now();

    for (let index = 0; index < propChunks.length; index += 1) {
        const bucket = propChunks[index];

        world.addEntity(new PropChunk(world.context, camera, bucket));

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
    terrain: IChapterGround
): Player | null {
    const spawnPosition = positionsByRegionId.get(chapter.spawnRegionId);
    if (!spawnPosition) return null;

    const player = new Player(
        world.context,
        camera,
        [
            spawnPosition[0],
            terrain.groundHeightAt(spawnPosition[0], spawnPosition[2]) + SPAWNING.playerSpawnHeight,
            spawnPosition[2],
        ],
        spawnFacingYaw(chapter, spawnPosition, positionsByRegionId)
    );

    world.addEntity(player);

    return player;
}

function spawnFacingYaw(
    chapter: ChapterResponse,
    spawnPosition: Vector3Tuple,
    positionsByRegionId: Map<string, Vector3Tuple>
): number {
    for (const pathway of chapter.pathways) {
        const isOutgoing = pathway.fromRegionId === chapter.spawnRegionId;
        const isIncoming = pathway.toRegionId === chapter.spawnRegionId;
        if (!isOutgoing && !isIncoming) continue;

        const otherRegionId = isOutgoing ? pathway.toRegionId : pathway.fromRegionId;
        const otherPosition = positionsByRegionId.get(otherRegionId);
        if (!otherPosition) continue;

        const dx = otherPosition[0] - spawnPosition[0];
        const dz = otherPosition[2] - spawnPosition[2];
        if (dx === 0 && dz === 0) continue;

        return yawFromDirection(dx, dz);
    }

    return 0;
}

function spawnBoss(
    world: World,
    chapter: ChapterResponse,
    positionsByRegionId: Map<string, Vector3Tuple>,
    terrain: IChapterGround,
    player: CombatCharacter | null
): void {
    const bossPosition = positionsByRegionId.get(chapter.bossRegionId);
    if (!chapter.boss || !bossPosition) return;

    const boss = buildBossFromChapter(chapter.boss, chapter.chapterIndex);
    const archetype = boss.archetype;

    const spawnY = standingSpawnHeight(
        terrain.groundHeightAt(bossPosition[0], bossPosition[2]),
        archetype.height
    );

    world.addEntity(
        new Enemy({
            id: boss.id,
            archetype,
            context: world.context,
            spawnPosition: [bossPosition[0], spawnY, bossPosition[2]],
            spawnYaw: 0,
            player,
            passive: true,
        })
    );
}

function spawnRegionEnemies(
    world: World,
    chapter: ChapterResponse,
    terrain: IChapterGround,
    positionsByRegionId: Map<string, Vector3Tuple>,
    player: CombatCharacter | null,
    alertMarkers: AlertMarkerTracker
): void {
    const playerSpawn = positionsByRegionId.get(chapter.spawnRegionId);
    let enemyIndex = 0;

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

        for (const placement of placements) {
            enemyIndex += 1;
            const enemyId = `${region.regionId}-enemy-${enemyIndex}`;

            const enemy = new Enemy({
                id: enemyId,
                archetype: ARCHETYPES[placement.archetype],
                context: world.context,
                spawnPosition: placement.position,
                spawnYaw: placement.facingYaw,
                player,
                passive: false,
            });

            alertMarkers.track(enemy);
            world.addEntity(enemy);
        }
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
    bossRegionId?: string
): IRegionGeometry {
    const len = regions.length;
    let furthestDistance = 0;

    const regionFloors = new Array<IRegionFloor>(len);

    for (let i = 0; i < len; i++) {
        const region = regions[i];
        const [x, y, z] = region.worldPosition;
        const [width, depth] = region.floorSize;

        const localX = x - centerX;
        const localZ = z - centerZ;
        const halfWidth = width / 2;
        const halfDepth = depth / 2;

        regionFloors[i] = {
            centerX: localX,
            centerZ: localZ,
            halfWidth,
            halfDepth,
            floorElevation: y,
            nestingDepth: region.nestingDepth,
            fileCount: region.fileCount,
            isBossRegion: region.regionId === bossRegionId,
        };

        const distance = Math.hypot(localX, localZ) + Math.hypot(halfWidth, halfDepth);
        if (distance > furthestDistance) furthestDistance = distance;
    }

    return { regionFloors, furthestDistance };
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

    return { corridorPaths, regionLinks };
}

function spawnAndBossPoints(
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
