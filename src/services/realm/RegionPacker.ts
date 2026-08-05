import "server-only";
import { CHAPTER_DESIGN, CORRIDOR_DESIGN, REGION_DESIGN, ROOT_REGION } from "@/constants/realm";
import { IChapterRegion, IRegionPathway } from "@/types/realm";

const DEFAULT_SIZE_RATIO = 0.5;

export function packChapterRegions(
    directoryPaths: string[],
    filePaths: string[],
    chapterSeed: number
): IChapterGeometry {
    const candidates = selectRegionCandidates(directoryPaths, filePaths);
    const sizeRatioByPath = resolveSizeRatioByPath(candidates);
    const nextRandom = createSeededRandom(chapterSeed);

    const regions = candidates.map((candidate) =>
        buildRegion(
            candidate,
            sizeRatioByPath.get(candidate.path) ?? DEFAULT_SIZE_RATIO,
            nextRandom
        )
    );

    const [spawnRegion, ...regionsToPlace] = regions;
    if (!spawnRegion) throw new Error("tree produced no directories containing files");

    positionRegionsInRings(spawnRegion, regionsToPlace, nextRandom);

    const pathways = connectEachRegionToNearestNeighbour(regions);
    assignClearanceTiers(regions, pathways, spawnRegion);
    addLoopPathways(regions, pathways);

    return {
        regions,
        pathways,
        spawnRegionId: spawnRegion.regionId,
        objectiveRegionId: resolveObjectiveRegionId(regions, spawnRegion),
    };
}

function selectRegionCandidates(directoryPaths: string[], filePaths: string[]): IRegionCandidate[] {
    const candidateByPath = mapCandidatesByPath(directoryPaths);
    countFilesIntoAncestors(filePaths, candidateByPath);

    return selectDisjointCandidates(candidateByPath, mapChildPathsByParent(directoryPaths));
}

function mapCandidatesByPath(directoryPaths: string[]): Map<string, IRegionCandidate> {
    const candidateByPath = new Map<string, IRegionCandidate>([
        [
            ROOT_REGION.id,
            {
                path: ROOT_REGION.id,
                displayName: ROOT_REGION.displayName,
                nestingDepth: 0,
                fileCount: 0,
            },
        ],
    ]);

    for (const directoryPath of directoryPaths) {
        candidateByPath.set(directoryPath, {
            path: directoryPath,
            displayName: extractBaseName(directoryPath),
            nestingDepth: directoryPath.split("/").length,
            fileCount: 0,
        });
    }

    return candidateByPath;
}

function countFilesIntoAncestors(
    filePaths: string[],
    candidateByPath: Map<string, IRegionCandidate>
): void {
    const rootCandidate = candidateByPath.get(ROOT_REGION.id);
    if (rootCandidate) rootCandidate.fileCount = filePaths.length;

    for (const filePath of filePaths) {
        let separatorIndex = filePath.indexOf("/");

        while (separatorIndex !== -1) {
            const ancestor = candidateByPath.get(filePath.slice(0, separatorIndex));
            if (ancestor) ancestor.fileCount++;

            separatorIndex = filePath.indexOf("/", separatorIndex + 1);
        }
    }
}

function mapChildPathsByParent(directoryPaths: string[]): Map<string, string[]> {
    const childPathsByParent = new Map<string, string[]>();

    for (const directoryPath of directoryPaths) {
        const separatorIndex = directoryPath.lastIndexOf("/");
        const parentPath =
            separatorIndex === -1 ? ROOT_REGION.id : directoryPath.slice(0, separatorIndex);

        const siblings = childPathsByParent.get(parentPath);

        if (siblings) siblings.push(directoryPath);
        else childPathsByParent.set(parentPath, [directoryPath]);
    }

    return childPathsByParent;
}

function selectDisjointCandidates(
    candidateByPath: Map<string, IRegionCandidate>,
    childPathsByParent: Map<string, string[]>
): IRegionCandidate[] {
    const rootCandidate = candidateByPath.get(ROOT_REGION.id);
    if (!rootCandidate) return [];

    const resolveChildrenHoldingFiles = (parentPath: string): IRegionCandidate[] =>
        sortByFileCount(
            (childPathsByParent.get(parentPath) ?? [])
                .map((childPath) => candidateByPath.get(childPath))
                .filter(
                    (child): child is IRegionCandidate => child !== undefined && child.fileCount > 0
                )
        );

    const budgetBesideRoot = CHAPTER_DESIGN.regionsPerChapter - 1;

    let selected = resolveChildrenHoldingFiles(ROOT_REGION.id).slice(0, budgetBesideRoot);

    while (selected.length < budgetBesideRoot) {
        const slotsForChildren = budgetBesideRoot - selected.length + 1;

        const candidateToSplit = sortByFileCount(selected).find(
            (candidate) => resolveChildrenHoldingFiles(candidate.path).length > 1
        );

        if (!candidateToSplit) break;

        selected = selected
            .filter((candidate) => candidate !== candidateToSplit)
            .concat(resolveChildrenHoldingFiles(candidateToSplit.path).slice(0, slotsForChildren));
    }

    return [rootCandidate, ...sortByFileCount(selected)];
}

function sortByFileCount(candidates: IRegionCandidate[]): IRegionCandidate[] {
    return [...candidates].sort((first, second) =>
        first.fileCount === second.fileCount
            ? first.path.localeCompare(second.path)
            : second.fileCount - first.fileCount
    );
}

function resolveSizeRatioByPath(candidates: IRegionCandidate[]): Map<string, number> {
    const logScaled = candidates
        .filter((candidate) => candidate.path !== ROOT_REGION.id)
        .map((candidate) => ({
            path: candidate.path,
            logFileCount: Math.log(candidate.fileCount + 1),
        }));

    const logFileCounts = logScaled.map((entry) => entry.logFileCount);
    const smallestLog = Math.min(...logFileCounts);
    const logRange = Math.max(...logFileCounts) - smallestLog;

    return new Map([
        [ROOT_REGION.id, 1],
        ...logScaled.map(({ path, logFileCount }): [string, number] => [
            path,
            logRange === 0 ? 1 : (logFileCount - smallestLog) / logRange,
        ]),
    ]);
}

function buildRegion(
    candidate: IRegionCandidate,
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
        regionId: candidate.path,
        displayName: candidate.displayName,
        worldPosition: [0, 0, 0],
        floorSize: [footprint * aspectRatio, footprint / aspectRatio],
        wallHeight: scaleBetween(
            REGION_DESIGN.minWallHeight,
            REGION_DESIGN.maxWallHeight,
            sizeRatio
        ),
        nestingDepth: candidate.nestingDepth,
        clearanceTier: 0,
        fileCount: candidate.fileCount,
    };
}

function positionRegionsInRings(
    spawnRegion: IChapterRegion,
    regionsToPlace: IChapterRegion[],
    nextRandom: () => number
): void {
    if (regionsToPlace.length === 0) return;

    shuffleInPlace(regionsToPlace, nextRandom);

    const largestHalfExtent = Math.max(...regionsToPlace.map(resolveHalfExtent));
    const minimumSpacing = largestHalfExtent * 2 + REGION_DESIGN.ringGap;
    const radiusJitter = REGION_DESIGN.ringGap * REGION_DESIGN.ringJitterRatio;

    let ringRadius = resolveHalfExtent(spawnRegion) + REGION_DESIGN.ringGap + largestHalfExtent;
    let unplacedRegions = regionsToPlace;

    while (unplacedRegions.length > 0) {
        const minimumAngularStep = 2 * Math.asin(Math.min(1, minimumSpacing / (2 * ringRadius)));
        const ringCapacity = Math.max(1, Math.floor((Math.PI * 2) / minimumAngularStep));

        let countOnRing = Math.min(ringCapacity, unplacedRegions.length);
        if (unplacedRegions.length - countOnRing === 1 && countOnRing > 1) countOnRing--;

        const angularStep = (Math.PI * 2) / countOnRing;
        const angularSlack = Math.max(0, angularStep - minimumAngularStep);
        const ringRotation = nextRandom() * Math.PI * 2;

        unplacedRegions.slice(0, countOnRing).forEach((region, indexOnRing) => {
            const angle =
                ringRotation + indexOnRing * angularStep + (nextRandom() - 0.5) * angularSlack;
            const radius = ringRadius + (nextRandom() - 0.5) * radiusJitter * 2;

            region.worldPosition = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
        });

        unplacedRegions = unplacedRegions.slice(countOnRing);
        ringRadius += minimumSpacing;
    }
}

function connectEachRegionToNearestNeighbour(regions: IChapterRegion[]): IRegionPathway[] {
    const pathways: IRegionPathway[] = [];
    const placedRegions: IChapterRegion[] = [];

    for (const region of regions) {
        const nearestRegion =
            resolveNearestRegion(region, placedRegions, (neighbour) =>
                isCorridorClear(region, neighbour, regions)
            ) ?? resolveNearestRegion(region, placedRegions, () => true);

        if (nearestRegion) pathways.push(buildPathway(nearestRegion, region));

        placedRegions.push(region);
    }

    return pathways;
}

function assignClearanceTiers(
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

    for (let tier = 0; currentTierRegions.length > 0; tier++) {
        const nextTierRegions: IChapterRegion[] = [];

        for (const region of currentTierRegions) {
            region.clearanceTier = tier;

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

function addLoopPathways(regions: IChapterRegion[], pathways: IRegionPathway[]): void {
    const connectedPairKeys = new Set(
        pathways.map((pathway) => buildPairKey(pathway.fromRegionId, pathway.toRegionId))
    );

    const unconnectedPairs: IRegionPair[] = [];

    for (const [firstIndex, first] of regions.entries()) {
        for (const second of regions.slice(firstIndex + 1)) {
            if (connectedPairKeys.has(buildPairKey(first.regionId, second.regionId))) continue;
            if (Math.abs(first.clearanceTier - second.clearanceTier) > 1) continue;

            unconnectedPairs.push({
                first,
                second,
                distance: horizontalDistanceBetween(first, second),
            });
        }
    }

    unconnectedPairs.sort((firstPair, secondPair) =>
        firstPair.distance === secondPair.distance
            ? firstPair.first.regionId.localeCompare(secondPair.first.regionId)
            : firstPair.distance - secondPair.distance
    );

    let loopsAdded = 0;

    for (const pair of unconnectedPairs) {
        if (loopsAdded === CORRIDOR_DESIGN.loopPathwayCount) break;
        if (!isCorridorClear(pair.first, pair.second, regions)) continue;

        pathways.push(buildPathway(pair.first, pair.second));
        loopsAdded++;
    }
}

function resolveNearestRegion(
    region: IChapterRegion,
    neighbours: IChapterRegion[],
    isAcceptable: (neighbour: IChapterRegion) => boolean
): IChapterRegion | null {
    let nearestRegion: IChapterRegion | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const neighbour of neighbours) {
        const distance = horizontalDistanceBetween(region, neighbour);

        if (distance >= nearestDistance) continue;
        if (!isAcceptable(neighbour)) continue;

        nearestDistance = distance;
        nearestRegion = neighbour;
    }

    return nearestRegion;
}

function isCorridorClear(
    from: IChapterRegion,
    to: IChapterRegion,
    regions: IChapterRegion[]
): boolean {
    for (const region of regions) {
        if (region === from || region === to) continue;

        const clearance = resolveHalfExtent(region) + CORRIDOR_DESIGN.maxWidth / 2;

        if (distanceFromRegionToCorridor(region, from, to) < clearance) return false;
    }

    return true;
}

function distanceFromRegionToCorridor(
    region: IChapterRegion,
    from: IChapterRegion,
    to: IChapterRegion
): number {
    const [regionX, , regionZ] = region.worldPosition;
    const [fromX, , fromZ] = from.worldPosition;
    const [toX, , toZ] = to.worldPosition;

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

function buildPathway(from: IChapterRegion, to: IChapterRegion): IRegionPathway {
    return {
        fromRegionId: from.regionId,
        toRegionId: to.regionId,
        corridorWidth: clamp(
            Math.min(from.floorSize[0], to.floorSize[0]) * CORRIDOR_DESIGN.widthRatio,
            CORRIDOR_DESIGN.minWidth,
            CORRIDOR_DESIGN.maxWidth
        ),
    };
}

function buildPairKey(firstRegionId: string, secondRegionId: string): string {
    return firstRegionId < secondRegionId
        ? `${firstRegionId}|${secondRegionId}`
        : `${secondRegionId}|${firstRegionId}`;
}

function resolveObjectiveRegionId(regions: IChapterRegion[], spawnRegion: IChapterRegion): string {
    const contenders = regions.filter((region) => region !== spawnRegion);
    if (contenders.length === 0) return spawnRegion.regionId;

    const minimumFootprint = scaleBetween(
        REGION_DESIGN.minFootprint,
        REGION_DESIGN.maxFootprint,
        REGION_DESIGN.objectiveFootprintRatio
    );

    const spacious = contenders.filter(
        (region) => resolveHalfExtent(region) * 2 >= minimumFootprint
    );

    const eligible = spacious.length > 0 ? spacious : contenders;
    const deepestTier = Math.max(...eligible.map((region) => region.clearanceTier));

    let objectiveRegion = spawnRegion;
    let farthestDistance = -1;

    for (const region of eligible) {
        if (region.clearanceTier !== deepestTier) continue;
        const distance = horizontalDistanceBetween(region, spawnRegion);
        if (distance <= farthestDistance) continue;
        farthestDistance = distance;
        objectiveRegion = region;
    }

    return objectiveRegion.regionId;
}

function horizontalDistanceBetween(first: IChapterRegion, second: IChapterRegion): number {
    const deltaX = first.worldPosition[0] - second.worldPosition[0];
    const deltaZ = first.worldPosition[2] - second.worldPosition[2];

    return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
}

function resolveHalfExtent(region: IChapterRegion): number {
    return Math.max(region.floorSize[0], region.floorSize[1]) / 2;
}

function extractBaseName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

function scaleBetween(minimum: number, maximum: number, ratio: number): number {
    return minimum + ratio * (maximum - minimum);
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function shuffleInPlace<T>(items: T[], nextRandom: () => number): void {
    for (let index = items.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(nextRandom() * (index + 1));

        const current = items[index];
        const target = items[swapIndex];
        if (current === undefined || target === undefined) continue;

        items[index] = target;
        items[swapIndex] = current;
    }
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
    objectiveRegionId: string;
}

interface IRegionCandidate {
    path: string;
    displayName: string;
    nestingDepth: number;
    fileCount: number;
}

interface IRegionPair {
    first: IChapterRegion;
    second: IChapterRegion;
    distance: number;
}
