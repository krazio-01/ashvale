import "server-only";
import {
    CHAPTER_DESIGN,
    CORRIDOR_DESIGN,
    REGION_DESIGN,
    ROOT_REGION,
    ROUTE_DESIGN,
} from "@/constants/realm";
import { IChapterRegion, IRegionPathway } from "@/types/realm";
import { FULL_TURN, QUARTER_TURN } from "@/lib/helpers";

const DEFAULT_SIZE_RATIO = 0.5;

export function packChapterRegions(
    directoryPaths: string[],
    filePaths: string[],
    chapterSeed: number
): IChapterGeometry {
    const selectedDirectories = selectRegionDirectories(
        buildDirectoryTree(directoryPaths, filePaths)
    );
    const sizeRatioByPath = resolveSizeRatioByPath(selectedDirectories);
    const nextRandom = createSeededRandom(chapterSeed);

    const regions = selectedDirectories.map((directory) =>
        buildRegion(
            directory,
            sizeRatioByPath.get(directory.path) ?? DEFAULT_SIZE_RATIO,
            nextRandom
        )
    );

    const [spawnRegion, ...regionsToPlace] = regions;
    if (!spawnRegion) throw new Error("tree produced no directories containing files");

    const pathways = layoutRegionsAlongRoute(spawnRegion, regionsToPlace, nextRandom);
    assignSpawnDistances(regions, pathways, spawnRegion);

    return {
        regions,
        pathways,
        spawnRegionId: spawnRegion.regionId,
        bossRegionId: resolveBossRegionId(regions, spawnRegion),
    };
}

function buildDirectoryTree(directoryPaths: string[], filePaths: string[]): IDirectoryNode {
    const rootDirectory: IDirectoryNode = {
        path: ROOT_REGION.id,
        displayName: ROOT_REGION.displayName,
        nestingDepth: 0,
        fileCount: filePaths.length,
        children: new Map(),
    };

    for (const directoryPath of directoryPaths) insertDirectory(rootDirectory, directoryPath);
    for (const filePath of filePaths) countFileIntoAncestors(rootDirectory, filePath);

    return rootDirectory;
}

function insertDirectory(rootDirectory: IDirectoryNode, directoryPath: string): void {
    let directory = rootDirectory;
    let segmentStart = 0;

    for (;;) {
        const separatorIndex = directoryPath.indexOf("/", segmentStart);
        const segmentEnd = separatorIndex === -1 ? directoryPath.length : separatorIndex;
        const segment = directoryPath.slice(segmentStart, segmentEnd);

        let child = directory.children.get(segment);

        if (!child) {
            child = {
                path: directoryPath.slice(0, segmentEnd),
                displayName: segment,
                nestingDepth: directory.nestingDepth + 1,
                fileCount: 0,
                children: new Map(),
            };

            directory.children.set(segment, child);
        }

        directory = child;

        if (separatorIndex === -1) return;
        segmentStart = separatorIndex + 1;
    }
}

function countFileIntoAncestors(rootDirectory: IDirectoryNode, filePath: string): void {
    let directory = rootDirectory;
    let segmentStart = 0;

    for (;;) {
        const separatorIndex = filePath.indexOf("/", segmentStart);
        if (separatorIndex === -1) return;

        const child = directory.children.get(filePath.slice(segmentStart, separatorIndex));
        if (!child) return;

        child.fileCount++;
        directory = child;
        segmentStart = separatorIndex + 1;
    }
}

function selectRegionDirectories(rootDirectory: IDirectoryNode): IDirectoryNode[] {
    const budgetBesideRoot = CHAPTER_DESIGN.regionsPerChapter - 1;
    const directoriesWithNoSplit = new Set<IDirectoryNode>();

    let selected = childrenHoldingFiles(rootDirectory).slice(0, budgetBesideRoot);

    while (selected.length < budgetBesideRoot) {
        const slotsForChildren = budgetBesideRoot - selected.length + 1;

        const directoryToSplit = sortByFileCountDescending(selected).find((directory) => {
            if (directoriesWithNoSplit.has(directory)) return false;
            if (childrenHoldingFiles(directory).length > 1) return true;

            directoriesWithNoSplit.add(directory);
            return false;
        });

        if (!directoryToSplit) break;

        selected = selected
            .filter((directory) => directory !== directoryToSplit)
            .concat(childrenHoldingFiles(directoryToSplit).slice(0, slotsForChildren));
    }

    return [rootDirectory, ...sortByFileCountDescending(selected)];
}

function childrenHoldingFiles(directory: IDirectoryNode): IDirectoryNode[] {
    return sortByFileCountDescending(
        [...directory.children.values()].filter((child) => child.fileCount > 0)
    );
}

function sortByFileCountDescending(directories: IDirectoryNode[]): IDirectoryNode[] {
    return [...directories].sort((first, second) =>
        first.fileCount === second.fileCount
            ? first.path.localeCompare(second.path)
            : second.fileCount - first.fileCount
    );
}

function resolveSizeRatioByPath(directories: IDirectoryNode[]): Map<string, number> {
    const logFileCounts = directories
        .filter((directory) => directory.path !== ROOT_REGION.id)
        .map((directory) => ({
            path: directory.path,
            logFileCount: Math.log(directory.fileCount + 1),
        }));

    const values = logFileCounts.map((entry) => entry.logFileCount);
    const smallestLog = Math.min(...values);
    const logRange = Math.max(...values) - smallestLog;

    return new Map([
        [ROOT_REGION.id, REGION_DESIGN.spawnSizeRatio],
        ...logFileCounts.map(({ path, logFileCount }): [string, number] => [
            path,
            logRange === 0 ? 1 : (logFileCount - smallestLog) / logRange,
        ]),
    ]);
}

function buildRegion(
    directory: IDirectoryNode,
    sizeRatio: number,
    nextRandom: () => number
): IChapterRegion {
    const footprint = scaleBetween(
        REGION_DESIGN.minFootprint,
        REGION_DESIGN.maxFootprint,
        sizeRatio
    );

    const aspectRatio = 1 + (nextRandom() - 0.5) * REGION_DESIGN.aspectJitter;

    return {
        regionId: directory.path,
        displayName: directory.displayName,
        worldPosition: [0, 0, 0],
        floorSize: [footprint * aspectRatio, footprint / aspectRatio],
        wallHeight: scaleBetween(
            REGION_DESIGN.minWallHeight,
            REGION_DESIGN.maxWallHeight,
            sizeRatio
        ),
        nestingDepth: directory.nestingDepth,
        spawnDistance: 0,
        fileCount: directory.fileCount,
    };
}

function layoutRegionsAlongRoute(
    spawnRegion: IChapterRegion,
    regionsToPlace: IChapterRegion[],
    nextRandom: () => number
): IRegionPathway[] {
    if (regionsToPlace.length === 0) return [];

    const regionsAscendingByFileCount = [...regionsToPlace].sort((first, second) =>
        first.fileCount === second.fileCount
            ? first.regionId.localeCompare(second.regionId)
            : first.fileCount - second.fileCount
    );

    const sideRoomCount = Math.min(
        ROUTE_DESIGN.sideRoomCount,
        Math.max(0, regionsAscendingByFileCount.length - ROUTE_DESIGN.minimumRouteRegions)
    );

    const sideRooms = regionsAscendingByFileCount.slice(0, sideRoomCount);
    const route = [spawnRegion, ...regionsAscendingByFileCount.slice(sideRoomCount)];

    placeRouteRegions(route, nextRandom);
    assignRouteElevations(route, nextRandom);

    return [...connectRouteRegions(route), ...placeSideRooms(sideRooms, route, nextRandom)];
}

function placeRouteRegions(route: IChapterRegion[], nextRandom: () => number): void {
    let heading = nextRandom() * FULL_TURN;
    let turnDirection = nextRandom() < 0.5 ? 1 : -1;

    for (let index = 1; index < route.length; index++) {
        const previousRegion = route[index - 1];
        const currentRegion = route[index];
        if (!previousRegion || !currentRegion) continue;

        heading = placeNextRouteRegion(
            currentRegion,
            previousRegion,
            heading,
            turnDirection,
            route.slice(0, index - 1),
            nextRandom
        );

        turnDirection = -turnDirection;
    }
}

function placeNextRouteRegion(
    region: IChapterRegion,
    anchorRegion: IChapterRegion,
    heading: number,
    turnDirection: number,
    regionsToAvoid: IChapterRegion[],
    nextRandom: () => number
): number {
    const spacing =
        resolveFootprintRadius(anchorRegion) +
        REGION_DESIGN.regionGap +
        resolveFootprintRadius(region);

    for (let attempt = 0; attempt < ROUTE_DESIGN.placementAttempts; attempt++) {
        const candidateHeading =
            heading +
            turnDirection *
                scaleBetween(ROUTE_DESIGN.minTurnAngle, ROUTE_DESIGN.maxTurnAngle, nextRandom());

        region.worldPosition = resolveOffsetPosition(anchorRegion, candidateHeading, spacing);

        if (
            isClearOfRegions(region, regionsToAvoid) &&
            isCorridorClear(anchorRegion, region, regionsToAvoid)
        )
            return candidateHeading;
    }

    const fallbackHeading = heading + turnDirection * ROUTE_DESIGN.minTurnAngle;
    region.worldPosition = resolveOffsetPosition(anchorRegion, fallbackHeading, spacing);

    return fallbackHeading;
}

function assignRouteElevations(route: IChapterRegion[], nextRandom: () => number): void {
    const [lowestLevel, highestLevel] = ROUTE_DESIGN.terraceLevelRange;
    const levelSteps = ROUTE_DESIGN.terraceLevelSteps;
    let level = 0;

    for (let index = 1; index < route.length; index++) {
        const region = route[index];
        if (!region) continue;

        const step = levelSteps[Math.floor(nextRandom() * levelSteps.length)] ?? 1;
        const steppedLevel = level + step;

        level =
            steppedLevel > (highestLevel ?? 0) || steppedLevel < (lowestLevel ?? 0)
                ? level - step
                : steppedLevel;

        region.worldPosition[1] = level * ROUTE_DESIGN.terraceStepHeight;
    }
}

function connectRouteRegions(route: IChapterRegion[]): IRegionPathway[] {
    const pathways: IRegionPathway[] = [];

    for (let index = 1; index < route.length; index++) {
        const previousRegion = route[index - 1];
        const currentRegion = route[index];

        if (previousRegion && currentRegion)
            pathways.push(buildPathway(previousRegion, currentRegion));
    }

    return pathways;
}

function placeSideRooms(
    sideRooms: IChapterRegion[],
    route: IChapterRegion[],
    nextRandom: () => number
): IRegionPathway[] {
    const pathways: IRegionPathway[] = [];
    const placedRegions = [...route];
    const hostRegions = route.slice(1, -2);

    for (const sideRoom of sideRooms) {
        const hostRegion = hostRegions[Math.floor(nextRandom() * hostRegions.length)];
        if (!hostRegion) continue;

        placeBesideHost(
            sideRoom,
            hostRegion,
            resolveRouteHeadingAt(hostRegion, route),
            placedRegions,
            nextRandom
        );

        sideRoom.worldPosition[1] =
            hostRegion.worldPosition[1] -
            ROUTE_DESIGN.sideRoomLevelDrop * ROUTE_DESIGN.terraceStepHeight;

        placedRegions.push(sideRoom);
        pathways.push(buildPathway(hostRegion, sideRoom));
    }

    return pathways;
}

function placeBesideHost(
    sideRoom: IChapterRegion,
    hostRegion: IChapterRegion,
    routeHeading: number,
    placedRegions: IChapterRegion[],
    nextRandom: () => number
): void {
    const baseSpacing =
        resolveFootprintRadius(hostRegion) +
        REGION_DESIGN.regionGap +
        resolveFootprintRadius(sideRoom);
    const regionsToAvoid = placedRegions.filter((region) => region !== hostRegion);

    for (let attempt = 0; attempt < ROUTE_DESIGN.placementAttempts; attempt++) {
        const turnDirection = nextRandom() < 0.5 ? 1 : -1;
        const heading =
            routeHeading +
            turnDirection * QUARTER_TURN +
            (nextRandom() - 0.5) * ROUTE_DESIGN.maxTurnAngle;
        const spacing = baseSpacing * (1 + attempt * ROUTE_DESIGN.spacingGrowthPerAttempt);

        sideRoom.worldPosition = resolveOffsetPosition(hostRegion, heading, spacing);

        if (
            isClearOfRegions(sideRoom, regionsToAvoid) &&
            isCorridorClear(hostRegion, sideRoom, regionsToAvoid)
        )
            return;
    }
}

function resolveRouteHeadingAt(hostRegion: IChapterRegion, route: IChapterRegion[]): number {
    const hostIndex = route.indexOf(hostRegion);
    const previousRegion = route[hostIndex - 1] ?? hostRegion;
    const nextRegion = route[hostIndex + 1] ?? hostRegion;

    return Math.atan2(
        nextRegion.worldPosition[2] - previousRegion.worldPosition[2],
        nextRegion.worldPosition[0] - previousRegion.worldPosition[0]
    );
}

function isClearOfRegions(region: IChapterRegion, regionsToAvoid: IChapterRegion[]): boolean {
    for (const other of regionsToAvoid) {
        const requiredSeparation =
            resolveFootprintRadius(region) +
            resolveFootprintRadius(other) +
            REGION_DESIGN.regionGap;

        if (horizontalDistanceBetween(region, other) < requiredSeparation) return false;
    }

    return true;
}

function isCorridorClear(
    fromRegion: IChapterRegion,
    toRegion: IChapterRegion,
    regionsToAvoid: IChapterRegion[]
): boolean {
    for (const region of regionsToAvoid) {
        if (region === fromRegion || region === toRegion) continue;

        const requiredSeparation =
            resolveFootprintRadius(region) +
            CORRIDOR_DESIGN.maxWidth / 2 +
            ROUTE_DESIGN.corridorClearance;

        if (distanceFromRegionToCorridor(region, fromRegion, toRegion) < requiredSeparation)
            return false;
    }

    return true;
}

function distanceFromRegionToCorridor(
    region: IChapterRegion,
    fromRegion: IChapterRegion,
    toRegion: IChapterRegion
): number {
    const [regionX, , regionZ] = region.worldPosition;
    const [fromX, , fromZ] = fromRegion.worldPosition;
    const [toX, , toZ] = toRegion.worldPosition;

    const spanX = toX - fromX;
    const spanZ = toZ - fromZ;
    const spanLengthSquared = spanX * spanX + spanZ * spanZ;

    if (spanLengthSquared === 0) return Math.hypot(regionX - fromX, regionZ - fromZ);

    const projection = clamp(
        ((regionX - fromX) * spanX + (regionZ - fromZ) * spanZ) / spanLengthSquared,
        0,
        1
    );

    return Math.hypot(
        regionX - (fromX + projection * spanX),
        regionZ - (fromZ + projection * spanZ)
    );
}

function resolveOffsetPosition(
    originRegion: IChapterRegion,
    heading: number,
    distance: number
): [number, number, number] {
    return [
        originRegion.worldPosition[0] + Math.cos(heading) * distance,
        0,
        originRegion.worldPosition[2] + Math.sin(heading) * distance,
    ];
}

function assignSpawnDistances(
    regions: IChapterRegion[],
    pathways: IRegionPathway[],
    spawnRegion: IChapterRegion
): void {
    const regionById = new Map(regions.map((region) => [region.regionId, region]));
    const neighbourIdsById = new Map<string, string[]>(
        regions.map((region) => [region.regionId, []])
    );

    for (const { fromRegionId, toRegionId } of pathways) {
        neighbourIdsById.get(fromRegionId)?.push(toRegionId);
        neighbourIdsById.get(toRegionId)?.push(fromRegionId);
    }

    const visitedIds = new Set([spawnRegion.regionId]);
    let currentTierRegions = [spawnRegion];

    for (let distance = 0; currentTierRegions.length > 0; distance++) {
        const nextTierRegions: IChapterRegion[] = [];

        for (const region of currentTierRegions) {
            region.spawnDistance = distance;

            for (const neighbourId of neighbourIdsById.get(region.regionId) ?? []) {
                if (visitedIds.has(neighbourId)) continue;

                const neighbour = regionById.get(neighbourId);
                if (!neighbour) continue;

                visitedIds.add(neighbourId);
                nextTierRegions.push(neighbour);
            }
        }

        currentTierRegions = nextTierRegions;
    }
}

function buildPathway(fromRegion: IChapterRegion, toRegion: IChapterRegion): IRegionPathway {
    return {
        fromRegionId: fromRegion.regionId,
        toRegionId: toRegion.regionId,
        corridorWidth: clamp(
            Math.min(fromRegion.floorSize[0], toRegion.floorSize[0]) * CORRIDOR_DESIGN.widthRatio,
            CORRIDOR_DESIGN.minWidth,
            CORRIDOR_DESIGN.maxWidth
        ),
    };
}

function resolveBossRegionId(regions: IChapterRegion[], spawnRegion: IChapterRegion): string {
    const candidateRegions = regions.filter((region) => region !== spawnRegion);
    if (candidateRegions.length === 0) return spawnRegion.regionId;

    const minimumFootprint = scaleBetween(
        REGION_DESIGN.minFootprint,
        REGION_DESIGN.maxFootprint,
        REGION_DESIGN.objectiveFootprintRatio
    );

    const regionsLargeEnoughForBoss = candidateRegions.filter(
        (region) => resolveFootprintRadius(region) * 2 >= minimumFootprint
    );

    const eligibleRegions =
        regionsLargeEnoughForBoss.length > 0 ? regionsLargeEnoughForBoss : candidateRegions;
    const farthestSpawnDistance = Math.max(
        ...eligibleRegions.map((region) => region.spawnDistance)
    );

    let bossRegion = spawnRegion;
    let farthestWorldDistance = -1;

    for (const region of eligibleRegions) {
        if (region.spawnDistance !== farthestSpawnDistance) continue;

        const worldDistance = horizontalDistanceBetween(region, spawnRegion);
        if (worldDistance <= farthestWorldDistance) continue;

        farthestWorldDistance = worldDistance;
        bossRegion = region;
    }

    return bossRegion.regionId;
}

function horizontalDistanceBetween(first: IChapterRegion, second: IChapterRegion): number {
    const deltaX = first.worldPosition[0] - second.worldPosition[0];
    const deltaZ = first.worldPosition[2] - second.worldPosition[2];

    return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
}

function resolveFootprintRadius(region: IChapterRegion): number {
    return Math.max(region.floorSize[0], region.floorSize[1]) / 2;
}

function scaleBetween(minimum: number, maximum: number, ratio: number): number {
    return minimum + ratio * (maximum - minimum);
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export interface IChapterGeometry {
    regions: IChapterRegion[];
    pathways: IRegionPathway[];
    spawnRegionId: string;
    bossRegionId: string;
}

interface IDirectoryNode {
    path: string;
    displayName: string;
    nestingDepth: number;
    fileCount: number;
    children: Map<string, IDirectoryNode>;
}
