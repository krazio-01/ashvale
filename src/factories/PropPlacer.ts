import { PropRole, type IPropPlacement, type IThemeManifest, type IThemeProp } from "@/types/theme";
import type { IChapterRegion } from "@/types/realm";
import { PROP_PLACEMENT } from "@/constants/game";

interface IClusterCenter {
    offsetX: number;
    offsetZ: number;
}

export function placeRegionProps(
    region: IChapterRegion,
    manifest: IThemeManifest
): IPropPlacement[] {
    const nextRandom = createSeededRandom(hashString(region.regionId));

    const landmarkSpecies = pickSpecies(
        manifest.props.filter((prop) => prop.role === PropRole.Landmark),
        PROP_PLACEMENT.landmarkSpeciesPerRegion,
        nextRandom
    );

    const structureSpecies = pickSpecies(
        manifest.props.filter((prop) => prop.role === PropRole.Structure),
        PROP_PLACEMENT.structureSpeciesPerRegion,
        nextRandom
    );

    const scatterSpecies = manifest.props.filter((prop) => prop.role === PropRole.Scatter);

    const clusterCenters = buildClusterCenters(region, nextRandom);
    const placements: IPropPlacement[] = [];

    placeClustered(
        placements,
        landmarkSpecies,
        PROP_PLACEMENT.landmarksPerRegion,
        region,
        clusterCenters,
        nextRandom,
        true
    );

    const structureCount = Math.min(
        PROP_PLACEMENT.maximumStructuresPerRegion,
        Math.max(
            PROP_PLACEMENT.minimumStructuresPerRegion,
            Math.floor(region.fileCount / PROP_PLACEMENT.filesPerStructure)
        )
    );

    placeClustered(
        placements,
        structureSpecies,
        structureCount,
        region,
        clusterCenters,
        nextRandom,
        true
    );

    const scatterCount = Math.min(
        PROP_PLACEMENT.maximumScatterPerRegion,
        Math.floor(region.fileCount * manifest.scatterPropsPerFile)
    );

    placeScatter(placements, scatterSpecies, scatterCount, region, clusterCenters, nextRandom);

    return placements;
}

function pickSpecies(props: IThemeProp[], count: number, nextRandom: () => number): IThemeProp[] {
    const shuffled = [...props];

    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(nextRandom() * (index + 1));
        const current = shuffled[index];
        const target = shuffled[swapIndex];

        if (current === undefined || target === undefined) continue;

        shuffled[index] = target;
        shuffled[swapIndex] = current;
    }

    return shuffled.slice(0, count);
}

function buildClusterCenters(region: IChapterRegion, nextRandom: () => number): IClusterCenter[] {
    const clusterCount = Math.min(
        PROP_PLACEMENT.maximumClustersPerRegion,
        Math.max(
            PROP_PLACEMENT.minimumClustersPerRegion,
            Math.floor(region.fileCount / PROP_PLACEMENT.filesPerCluster)
        )
    );

    const [width, depth] = region.floorSize;
    const clearRadius = Math.min(width, depth) * PROP_PLACEMENT.centerClearanceRatio;
    const centers: IClusterCenter[] = [];

    for (let index = 0; index < clusterCount; index++) {
        let offsetX = 0;
        let offsetZ = 0;

        for (let attempt = 0; attempt < PROP_PLACEMENT.placementAttempts; attempt++) {
            offsetX = (nextRandom() * 2 - 1) * (width / 2);
            offsetZ = (nextRandom() * 2 - 1) * (depth / 2);

            if (Math.hypot(offsetX, offsetZ) >= clearRadius) break;
        }

        centers.push({ offsetX, offsetZ });
    }

    return centers;
}

function placeClustered(
    placements: IPropPlacement[],
    species: IThemeProp[],
    count: number,
    region: IChapterRegion,
    clusterCenters: IClusterCenter[],
    nextRandom: () => number,
    requireSeparation: boolean
): void {
    if (species.length === 0 || clusterCenters.length === 0) return;

    const clusterRadius =
        Math.min(region.floorSize[0], region.floorSize[1]) * PROP_PLACEMENT.clusterRadiusRatio;

    for (let index = 0; index < count; index++) {
        const prop = species[Math.floor(nextRandom() * species.length)];
        const center = clusterCenters[Math.floor(nextRandom() * clusterCenters.length)];
        if (!prop || !center) continue;

        const scale = scaleBetween(prop.scaleRange, nextRandom());

        for (let attempt = 0; attempt < PROP_PLACEMENT.placementAttempts; attempt++) {
            const candidate = buildPlacementNear(
                prop,
                scale,
                region,
                center,
                clusterRadius,
                nextRandom
            );
            if (!candidate) continue;

            if (
                !requireSeparation ||
                isClearOfPlacements(candidate, prop.footprintRadius * scale, placements)
            ) {
                placements.push(candidate);
                break;
            }
        }
    }
}

function placeScatter(
    placements: IPropPlacement[],
    species: IThemeProp[],
    count: number,
    region: IChapterRegion,
    clusterCenters: IClusterCenter[],
    nextRandom: () => number
): void {
    if (species.length === 0) return;

    const clusterRadius =
        Math.min(region.floorSize[0], region.floorSize[1]) * PROP_PLACEMENT.clusterRadiusRatio;

    const structureAnchors = placements.filter((placement) => placement.hasCollider);

    for (let index = 0; index < count; index++) {
        const prop = species[Math.floor(nextRandom() * species.length)];
        if (!prop) continue;

        const scale = scaleBetween(prop.scaleRange, nextRandom());
        const roll = nextRandom();

        let candidate: IPropPlacement | null = null;

        if (roll < PROP_PLACEMENT.scatterAnchoredToStructureRatio && structureAnchors.length > 0) {
            const anchor = structureAnchors[Math.floor(nextRandom() * structureAnchors.length)];

            if (anchor) {
                candidate = buildPlacementNear(
                    prop,
                    scale,
                    region,
                    {
                        offsetX: anchor.position[0] - region.worldPosition[0],
                        offsetZ: anchor.position[2] - region.worldPosition[2],
                    },
                    PROP_PLACEMENT.structureAnchorRadius,
                    nextRandom
                );
            }
        } else if (clusterCenters.length > 0) {
            const center = clusterCenters[Math.floor(nextRandom() * clusterCenters.length)];

            if (center) {
                candidate = buildPlacementNear(
                    prop,
                    scale,
                    region,
                    center,
                    clusterRadius,
                    nextRandom
                );
            }
        }

        if (candidate) placements.push(candidate);
    }
}

function buildPlacementNear(
    prop: IThemeProp,
    scale: number,
    region: IChapterRegion,
    center: IClusterCenter,
    radius: number,
    nextRandom: () => number
): IPropPlacement | null {
    const [regionX, regionY, regionZ] = region.worldPosition;
    const [width, depth] = region.floorSize;

    const insetWidth = Math.max(1, width / 2 - prop.footprintRadius * scale);
    const insetDepth = Math.max(1, depth / 2 - prop.footprintRadius * scale);
    const clearRadius = Math.min(width, depth) * PROP_PLACEMENT.centerClearanceRatio;

    for (let attempt = 0; attempt < PROP_PLACEMENT.placementAttempts; attempt++) {
        const angle = nextRandom() * Math.PI * 2;
        const distance = Math.sqrt(nextRandom()) * radius;

        const offsetX = clamp(center.offsetX + Math.cos(angle) * distance, -insetWidth, insetWidth);
        const offsetZ = clamp(center.offsetZ + Math.sin(angle) * distance, -insetDepth, insetDepth);

        if (Math.hypot(offsetX, offsetZ) < clearRadius) continue;

        return {
            modelPath: prop.modelPath,
            position: [regionX + offsetX, regionY, regionZ + offsetZ],
            rotationY: nextRandom() * Math.PI * 2,
            scale,
            footprintRadius: prop.footprintRadius,
            hasCollider: prop.role !== PropRole.Scatter,
        };
    }

    return null;
}

function isClearOfPlacements(
    candidate: IPropPlacement,
    candidateRadius: number,
    placements: IPropPlacement[]
): boolean {
    for (const placed of placements) {
        if (!placed.hasCollider) continue;

        const distance = Math.hypot(
            candidate.position[0] - placed.position[0],
            candidate.position[2] - placed.position[2]
        );

        if (distance < candidateRadius + PROP_PLACEMENT.separationGap) return false;
    }

    return true;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function scaleBetween([minimum, maximum]: [number, number], ratio: number): number {
    return minimum + ratio * (maximum - minimum);
}

function hashString(value: string): number {
    let hash = 0;

    for (let index = 0; index < value.length; index++)
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;

    return hash;
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
