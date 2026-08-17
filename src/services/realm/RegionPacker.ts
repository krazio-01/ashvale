import "server-only";
import {
    CHAPTER_DESIGN,
    CORRIDOR_DESIGN,
    PATH_DESIGN,
    REGION_DESIGN,
    ROOT_REGION,
} from "@/constants/realm";
import { IChapterRegion, IRegionPathway } from "@/types/realm";

const DEFAULT_SIZE_RATIO = 0.5;
const RIGHT_ANGLE = Math.PI / 2;

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

    const pathways = layoutRegionsAlongSpine(spawnRegion, regionsToPlace, nextRandom);
    assignSpawnDistances(regions, pathways, spawnRegion);

    return {
        regions,
        pathways,
        spawnRegionId: spawnRegion.regionId,
        bossRegionId: resolveBossRegionId(regions, spawnRegion),
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
        spawnDistance: 0,
        fileCount: candidate.fileCount,
    };
}

function layoutRegionsAlongSpine(
    spawnRegion: IChapterRegion,
    regionsToPlace: IChapterRegion[],
    nextRandom: () => number
): IRegionPathway[] {
    if (regionsToPlace.length === 0) return [];

    const ascendingBySize = [...regionsToPlace].sort((first, second) =>
        first.fileCount === second.fileCount
            ? first.regionId.localeCompare(second.regionId)
            : first.fileCount - second.fileCount
    );

    const sideRoomCount = Math.min(
        PATH_DESIGN.sideRoomCount,
        Math.max(0, ascendingBySize.length - PATH_DESIGN.minimumSpineRegions)
    );

    const sideRooms = ascendingBySize.slice(0, sideRoomCount);
    const spine = [spawnRegion, ...ascendingBySize.slice(sideRoomCount)];

    placeSpineRegions(spine, nextRandom);

    return [...buildSpinePathways(spine), ...placeSideRooms(sideRooms, spine, nextRandom)];
}

function placeSpineRegions(spine: IChapterRegion[], nextRandom: () => number): void {
    let heading = nextRandom() * Math.PI * 2;

    for (let index = 1; index < spine.length; index++) {
        const previous = spine[index - 1];
        const current = spine[index];
        if (!previous || !current) continue;

        heading = placeAlongHeading(
            current,
            previous,
            heading,
            spine.slice(0, index - 1),
            nextRandom
        );
    }
}

function placeAlongHeading(
    region: IChapterRegion,
    anchor: IChapterRegion,
    heading: number,
    obstacles: IChapterRegion[],
    nextRandom: () => number
): number {
    const spacing = resolveHalfExtent(anchor) + REGION_DESIGN.regionGap + resolveHalfExtent(region);

    for (let attempt = 0; attempt < PATH_DESIGN.placementAttempts; attempt++) {
        const candidateHeading = heading + (nextRandom() - 0.5) * 2 * PATH_DESIGN.maxTurnAngle;

        region.worldPosition = offsetPosition(anchor, candidateHeading, spacing);
        if (isClearOfRegions(region, obstacles)) return candidateHeading;
    }

    region.worldPosition = offsetPosition(anchor, heading, spacing);

    return heading;
}

function buildSpinePathways(spine: IChapterRegion[]): IRegionPathway[] {
    const pathways: IRegionPathway[] = [];

    for (let index = 1; index < spine.length; index++) {
        const previous = spine[index - 1];
        const current = spine[index];

        if (previous && current) pathways.push(buildPathway(previous, current));
    }

    return pathways;
}

function placeSideRooms(
    sideRooms: IChapterRegion[],
    spine: IChapterRegion[],
    nextRandom: () => number
): IRegionPathway[] {
    const pathways: IRegionPathway[] = [];
    const placedRegions = [...spine];
    const hosts = spine.slice(1, -2);

    for (const sideRoom of sideRooms) {
        const host = hosts[Math.floor(nextRandom() * hosts.length)];
        if (!host) continue;

        placeBesideHost(
            sideRoom,
            host,
            resolveSpineHeadingAt(host, spine),
            placedRegions,
            nextRandom
        );

        placedRegions.push(sideRoom);
        pathways.push(buildPathway(host, sideRoom));
    }

    return pathways;
}

function placeBesideHost(
    sideRoom: IChapterRegion,
    host: IChapterRegion,
    spineHeading: number,
    placedRegions: IChapterRegion[],
    nextRandom: () => number
): void {
    const baseSpacing =
        resolveHalfExtent(host) + REGION_DESIGN.regionGap + resolveHalfExtent(sideRoom);
    const obstacles = placedRegions.filter((region) => region !== host);

    for (let attempt = 0; attempt < PATH_DESIGN.placementAttempts; attempt++) {
        const side = nextRandom() < 0.5 ? 1 : -1;
        const heading =
            spineHeading + side * RIGHT_ANGLE + (nextRandom() - 0.5) * PATH_DESIGN.maxTurnAngle;
        const spacing = baseSpacing * (1 + attempt * PATH_DESIGN.spacingGrowthPerAttempt);

        sideRoom.worldPosition = offsetPosition(host, heading, spacing);
        if (isClearOfRegions(sideRoom, obstacles)) return;
    }
}

function resolveSpineHeadingAt(host: IChapterRegion, spine: IChapterRegion[]): number {
    const hostIndex = spine.indexOf(host);
    const previous = spine[hostIndex - 1] ?? host;
    const next = spine[hostIndex + 1] ?? host;

    return Math.atan2(
        next.worldPosition[2] - previous.worldPosition[2],
        next.worldPosition[0] - previous.worldPosition[0]
    );
}

function isClearOfRegions(region: IChapterRegion, obstacles: IChapterRegion[]): boolean {
    for (const obstacle of obstacles) {
        const requiredSeparation =
            resolveHalfExtent(region) + resolveHalfExtent(obstacle) + REGION_DESIGN.regionGap;

        if (horizontalDistanceBetween(region, obstacle) < requiredSeparation) return false;
    }

    return true;
}

function offsetPosition(
    origin: IChapterRegion,
    heading: number,
    distance: number
): [number, number, number] {
    return [
        origin.worldPosition[0] + Math.cos(heading) * distance,
        0,
        origin.worldPosition[2] + Math.sin(heading) * distance,
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

function resolveBossRegionId(regions: IChapterRegion[], spawnRegion: IChapterRegion): string {
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
    const deepestDistance = Math.max(...eligible.map((region) => region.spawnDistance));

    let bossRegion = spawnRegion;
    let farthestDistance = -1;

    for (const region of eligible) {
        if (region.spawnDistance !== deepestDistance) continue;
        const distance = horizontalDistanceBetween(region, spawnRegion);
        if (distance <= farthestDistance) continue;
        farthestDistance = distance;
        bossRegion = region;
    }

    return bossRegion.regionId;
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

interface IRegionCandidate {
    path: string;
    displayName: string;
    nestingDepth: number;
    fileCount: number;
}
