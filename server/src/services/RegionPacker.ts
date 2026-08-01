import { IChapterRegion, IRegionPathway } from "../types/realm";

const FOOTPRINT_MIN = 14;
const FOOTPRINT_MAX = 46;
const FOOTPRINT_PER_FILE = 4;
const FOOTPRINT_ASPECT_JITTER = 0.3;
const WALL_HEIGHT_MIN = 5;
const WALL_HEIGHT_MAX = 16;
const WALL_HEIGHT_PER_FILE = 2.2;
const REGION_GAP = 14;
const RING_RADIUS_JITTER_RATIO = 0.25;
const CORRIDOR_WIDTH_MIN = 4;
const CORRIDOR_WIDTH_MAX = 11;
const CORRIDOR_WIDTH_RATIO = 0.4;
const ROOT_REGION_ID = ".";
const ROOT_REGION_NAME = "root";

const GENERATED_FILE_PATTERN =
    /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum|Podfile\.lock)$|\.(min\.js|min\.css|map|snap)$/;

const LANGUAGE_BY_FILE_EXTENSION = new Map([
    ["ts", "TypeScript"],
    ["tsx", "TypeScript"],
    ["js", "JavaScript"],
    ["jsx", "JavaScript"],
    ["mjs", "JavaScript"],
    ["cjs", "JavaScript"],
    ["py", "Python"],
    ["go", "Go"],
    ["rs", "Rust"],
    ["java", "Java"],
    ["kt", "Kotlin"],
    ["swift", "Swift"],
    ["c", "C"],
    ["h", "C"],
    ["cc", "C++"],
    ["cpp", "C++"],
    ["cs", "C#"],
    ["rb", "Ruby"],
    ["php", "PHP"],
    ["css", "CSS"],
    ["scss", "CSS"],
    ["html", "HTML"],
    ["ejs", "Templates"],
    ["hbs", "Templates"],
    ["pug", "Templates"],
    ["erb", "Templates"],
    ["twig", "Templates"],
    ["md", "Markdown"],
    ["json", "JSON"],
    ["yml", "YAML"],
    ["yaml", "YAML"],
    ["toml", "Config"],
    ["env", "Config"],
    ["sh", "Shell"],
    ["sql", "SQL"],
    ["svg", "Assets"],
    ["png", "Assets"],
    ["jpg", "Assets"],
    ["webp", "Assets"],
    ["glb", "Assets"],
    ["ico", "Assets"],
]);

export function packChapterRegions(
    directoryPaths: string[],
    filePaths: string[],
    changedLineCountByFilePath: Map<string, number>,
    regionBudget: number,
    seed: number
): IChapterGeometry {
    const candidates = collectRegionCandidates(
        directoryPaths,
        filePaths,
        changedLineCountByFilePath
    );

    candidates.sort((first, second) => {
        if (first.nestingDepth !== second.nestingDepth)
            return first.nestingDepth - second.nestingDepth;
        return second.changedLineCount - first.changedLineCount;
    });

    const nextRandom = createSeededRandom(seed);
    const regions = candidates
        .slice(0, regionBudget)
        .map((candidate) => buildRegionFromCandidate(candidate, nextRandom));

    const spawnRegion = regions[0];
    if (!spawnRegion) throw new Error("tree produced no directories containing files");

    positionRegionsInRings(spawnRegion, regions.slice(1), nextRandom);

    return {
        regions,
        pathways: connectRegionsToNearestNeighbour(regions),
        spawnRegionId: spawnRegion.regionId,
        objectiveRegionId: resolveFarthestRegionId(regions, spawnRegion),
    };
}

function collectRegionCandidates(
    directoryPaths: string[],
    filePaths: string[],
    changedLineCountByFilePath: Map<string, number>
): IRegionCandidate[] {
    const candidateByPath = new Map<string, IRegionCandidate>([
        [ROOT_REGION_ID, createCandidate(ROOT_REGION_ID, ROOT_REGION_NAME, 0)],
    ]);

    for (const directoryPath of directoryPaths) {
        const nestingDepth = countCharacter(directoryPath, "/") + 1;
        candidateByPath.set(
            directoryPath,
            createCandidate(directoryPath, extractBaseName(directoryPath), nestingDepth)
        );
    }

    for (const filePath of filePaths) {
        const separatorIndex = filePath.lastIndexOf("/");
        const parentPath =
            separatorIndex === -1 ? ROOT_REGION_ID : filePath.slice(0, separatorIndex);

        const candidate = candidateByPath.get(parentPath);
        if (!candidate) continue;

        candidate.fileCount++;

        const fileName = extractBaseName(filePath);
        if (!GENERATED_FILE_PATTERN.test(fileName))
            candidate.changedLineCount += changedLineCountByFilePath.get(filePath) ?? 0;

        const language = LANGUAGE_BY_FILE_EXTENSION.get(
            fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
        );
        if (language) {
            candidate.fileCountByLanguage.set(
                language,
                (candidate.fileCountByLanguage.get(language) ?? 0) + 1
            );
        }
    }

    return [...candidateByPath.values()].filter((candidate) => candidate.fileCount > 0);
}

function createCandidate(
    path: string,
    displayName: string,
    nestingDepth: number
): IRegionCandidate {
    return {
        path,
        displayName,
        nestingDepth,
        fileCount: 0,
        changedLineCount: 0,
        fileCountByLanguage: new Map(),
    };
}

function buildRegionFromCandidate(
    candidate: IRegionCandidate,
    nextRandom: () => number
): IChapterRegion {
    const fileCountScale = Math.sqrt(candidate.fileCount);
    const footprint = clamp(
        FOOTPRINT_MIN + fileCountScale * FOOTPRINT_PER_FILE,
        FOOTPRINT_MIN,
        FOOTPRINT_MAX
    );
    const aspectRatio = 1 + (nextRandom() - 0.5) * FOOTPRINT_ASPECT_JITTER;

    return {
        regionId: candidate.path,
        displayName: candidate.displayName,
        worldPosition: [0, 0, 0],
        floorSize: [footprint * aspectRatio, footprint / aspectRatio],
        wallHeight: clamp(
            WALL_HEIGHT_MIN + fileCountScale * WALL_HEIGHT_PER_FILE,
            WALL_HEIGHT_MIN,
            WALL_HEIGHT_MAX
        ),
        nestingDepth: candidate.nestingDepth,
        commitActivity: candidate.changedLineCount,
        fileCount: candidate.fileCount,
        primaryLanguage: resolveDominantLanguage(candidate.fileCountByLanguage),
    };
}

function positionRegionsInRings(
    spawnRegion: IChapterRegion,
    regionsToPlace: IChapterRegion[],
    nextRandom: () => number
): void {
    spawnRegion.worldPosition = [0, 0, 0];
    if (regionsToPlace.length === 0) return;

    let largestHalfExtent = 0;
    for (const region of regionsToPlace)
        largestHalfExtent = Math.max(largestHalfExtent, resolveHalfExtent(region));

    const minimumSpacing = largestHalfExtent * 2 + REGION_GAP;
    const radiusJitter = REGION_GAP * RING_RADIUS_JITTER_RATIO;

    let ringRadius = resolveHalfExtent(spawnRegion) + REGION_GAP + largestHalfExtent;
    let placementIndex = 0;

    while (placementIndex < regionsToPlace.length) {
        const remainingCount = regionsToPlace.length - placementIndex;
        const requiredAngularStep = resolveRequiredAngularStep(ringRadius, minimumSpacing);
        const ringCapacity = Math.max(1, Math.floor((Math.PI * 2) / requiredAngularStep));

        let countOnRing = Math.min(ringCapacity, remainingCount);
        if (remainingCount - countOnRing === 1 && countOnRing > 1) countOnRing--;

        const angularStep = (Math.PI * 2) / countOnRing;
        const angularSlack = Math.max(0, angularStep - requiredAngularStep);
        const ringRotation = nextRandom() * Math.PI * 2;

        for (let indexOnRing = 0; indexOnRing < countOnRing; indexOnRing++) {
            const region = regionsToPlace[placementIndex++];
            if (!region) continue;

            const angle =
                ringRotation + indexOnRing * angularStep + (nextRandom() - 0.5) * angularSlack;
            const radius = ringRadius + (nextRandom() - 0.5) * radiusJitter * 2;

            region.worldPosition = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
        }

        ringRadius += minimumSpacing;
    }
}

function resolveRequiredAngularStep(ringRadius: number, minimumSpacing: number): number {
    return 2 * Math.asin(Math.min(1, minimumSpacing / (2 * ringRadius)));
}

function connectRegionsToNearestNeighbour(regions: IChapterRegion[]): IRegionPathway[] {
    const pathways: IRegionPathway[] = [];

    for (let index = 1; index < regions.length; index++) {
        const region = regions[index];
        if (!region) continue;

        const nearestRegion = resolveNearestRegion(region, regions.slice(0, index));
        if (!nearestRegion) continue;

        pathways.push({
            fromRegionId: nearestRegion.regionId,
            toRegionId: region.regionId,
            corridorWidth: clamp(
                Math.min(nearestRegion.floorSize[0], region.floorSize[0]) * CORRIDOR_WIDTH_RATIO,
                CORRIDOR_WIDTH_MIN,
                CORRIDOR_WIDTH_MAX
            ),
        });
    }

    return pathways;
}

function resolveNearestRegion(
    target: IChapterRegion,
    placedRegions: IChapterRegion[]
): IChapterRegion | null {
    let nearestRegion: IChapterRegion | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const region of placedRegions) {
        const distance = horizontalDistanceBetween(target, region);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestRegion = region;
        }
    }

    return nearestRegion;
}

function resolveFarthestRegionId(regions: IChapterRegion[], spawnRegion: IChapterRegion): string {
    let farthestRegion = spawnRegion;
    let farthestDistance = -1;

    for (const region of regions) {
        const distance = horizontalDistanceBetween(region, spawnRegion);
        if (distance > farthestDistance) {
            farthestDistance = distance;
            farthestRegion = region;
        }
    }

    return farthestRegion.regionId;
}

function resolveDominantLanguage(fileCountByLanguage: Map<string, number>): string | null {
    let dominantLanguage: string | null = null;
    let highestFileCount = 0;

    for (const [language, fileCount] of fileCountByLanguage) {
        if (fileCount > highestFileCount) {
            highestFileCount = fileCount;
            dominantLanguage = language;
        }
    }

    return dominantLanguage;
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

function countCharacter(text: string, character: string): number {
    let count = 0;
    for (const current of text) {
        if (current === character) count++;
    }
    return count;
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
    objectiveRegionId: string;
}

interface IRegionCandidate {
    path: string;
    displayName: string;
    nestingDepth: number;
    fileCount: number;
    changedLineCount: number;
    fileCountByLanguage: Map<string, number>;
}
