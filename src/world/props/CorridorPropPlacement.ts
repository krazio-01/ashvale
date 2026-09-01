import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import {
    createHeightMapSample,
    type IHeightMapSample,
    type TerrainHeightMap,
} from "@/world/terrain/TerrainHeightMap";
import type { Vector3Tuple } from "three";
import { PropGroupCollector } from "@/world/props/PropGroups";
import { pickWeightedSpecies, hasClearFootprint } from "@/world/props/PropPlacementUtils";
import {
    clamp,
    createSeededRandom,
    pickRandomSubset,
    scaleBetween,
    FULL_TURN,
} from "@/lib/helpers";
import { CORRIDOR_PROPS, VEGETATION } from "@/constants/placement";

export function placeCorridorProps(
    manifest: IThemeManifest,
    heightMap: TerrainHeightMap,
    corridors: ICorridorSpan[],
    regionFootprints: IRegionFootprint[],
    center: Vector3Tuple,
    seed: number
): IPropGroup[] {
    const nextRandom = createSeededRandom(seed);
    const heightSample = createHeightMapSample();

    const species = pickRandomSubset(
        manifest.props.filter(
            (prop) => prop.role === PropRole.Landmark || prop.role === PropRole.Structure
        ),
        CORRIDOR_PROPS.speciesPerRealm,
        nextRandom
    );

    if (species.length === 0) return [];

    const collector = new PropGroupCollector(false);

    const expandedRegions: IExpandedRegionFootprint[] = regionFootprints.map((region) => ({
        centerX: region.centerX,
        centerZ: region.centerZ,
        halfWidth: region.halfWidth + CORRIDOR_PROPS.regionKeepOut,
        halfDepth: region.halfDepth + CORRIDOR_PROPS.regionKeepOut,
    }));

    const options: IClusterOptions = {
        species,
        heightMap,
        expandedRegions,
        center,
        nextRandom,
        collector,
        heightSample,
    };

    for (let i = 0, len = corridors.length; i < len; i++) {
        const corridor = corridors[i];
        const anchors = spreadAnchorsAlong(corridor, nextRandom);
        for (let j = 0, alen = anchors.length; j < alen; j++) {
            placeClusterAt(anchors[j], options);
        }
    }

    return collector.toGroups();
}

function spreadAnchorsAlong(corridor: ICorridorSpan, nextRandom: () => number): IAnchorSpot[] {
    const spanX = corridor.toX - corridor.fromX;
    const spanZ = corridor.toZ - corridor.fromZ;

    const spanLength = Math.hypot(spanX, spanZ);

    if (spanLength === 0) return [];

    const anchorCount = clamp(
        Math.round(spanLength * CORRIDOR_PROPS.anchorsPerUnitLength),
        CORRIDOR_PROPS.minimumAnchorsPerCorridor,
        CORRIDOR_PROPS.maximumAnchorsPerCorridor
    );

    const alongX = spanX / spanLength;
    const alongZ = spanZ / spanLength;
    const sidewaysX = -alongZ;
    const sidewaysZ = alongX;
    const spineJitterScale = CORRIDOR_PROPS.spineJitter / anchorCount;
    const lateralMarginBase = corridor.halfWidth * (1 + CORRIDOR_PROPS.lateralMarginRatio);
    const spread = CORRIDOR_PROPS.lateralSpread;

    const anchors = new Array<IAnchorSpot>(anchorCount);

    for (let index = 0; index < anchorCount; index += 1) {
        const evenSpacing = (index + 0.5) / anchorCount;
        const jitter = (nextRandom() * 2 - 1) * spineJitterScale;
        const alongRatio = clamp(evenSpacing + jitter, 0.05, 0.95);

        const spineX = corridor.fromX + spanX * alongRatio;
        const spineZ = corridor.fromZ + spanZ * alongRatio;

        const side = nextRandom() < 0.5 ? -1 : 1;
        const lateralDistance = lateralMarginBase + nextRandom() * spread;

        anchors[index] = {
            localX: spineX + sidewaysX * side * lateralDistance,
            localZ: spineZ + sidewaysZ * side * lateralDistance,
        };
    }

    return anchors;
}

function placeClusterAt(anchor: IAnchorSpot, options: IClusterOptions): void {
    const { nextRandom } = options;

    const min = CORRIDOR_PROPS.propsPerAnchor[0];
    const max = CORRIDOR_PROPS.propsPerAnchor[1];
    const propCount = Math.round(min + (max - min) * nextRandom());

    for (let index = 0; index < propCount; index += 1) {
        placeSingleProp(anchor, options);
    }
}

function placeSingleProp(anchor: IAnchorSpot, options: IClusterOptions): void {
    const { species, heightMap, expandedRegions, center, nextRandom, collector, heightSample } =
        options;

    const prop = pickWeightedSpecies(species, nextRandom);
    if (!prop) return;

    const clearanceRadius = prop.footprintRadius * prop.scaleRange[1];
    const spot = findOpenSpot(
        anchor,
        heightMap,
        expandedRegions,
        nextRandom,
        heightSample,
        clearanceRadius
    );
    if (!spot) return;

    const scaleBase = CORRIDOR_PROPS.scaleBoost[0];
    const scaleDiff = CORRIDOR_PROPS.scaleBoost[1] - scaleBase;

    const scale =
        scaleBetween(prop.scaleRange, nextRandom()) * (scaleBase + scaleDiff * nextRandom());

    collector.add(prop, {
        position: [
            center[0] + spot.localX,
            heightSample.elevation - VEGETATION.groundBite,
            center[2] + spot.localZ,
        ],
        rotationY: nextRandom() * FULL_TURN,
        scale,
    });
}

const rimSample = createHeightMapSample();

/* rim points use a separate scratch sample so this doesn't clobber heightSample, which
   still needs to hold the final accepted spot's own reading for placement */
function findOpenSpot(
    anchor: IAnchorSpot,
    heightMap: TerrainHeightMap,
    expandedRegions: IExpandedRegionFootprint[],
    nextRandom: () => number,
    heightSample: IHeightMapSample,
    clearanceRadius: number
): IAnchorSpot | null {
    const { placementAttempts, clusterRadius, carveRejectThreshold, slopeLimit } = CORRIDOR_PROPS;

    for (let attempt = 0; attempt < placementAttempts; attempt += 1) {
        const angle = nextRandom() * FULL_TURN;
        const distance = Math.sqrt(nextRandom()) * clusterRadius;

        const localX = anchor.localX + Math.cos(angle) * distance;
        const localZ = anchor.localZ + Math.sin(angle) * distance;

        if (isInsideAnyRegion(localX, localZ, expandedRegions)) continue;

        heightMap.sampleAt(localX, localZ, heightSample);
        if (heightSample.carveStrength > carveRejectThreshold) continue;

        const steepnessAt = (x: number, z: number): number => {
            heightMap.sampleAt(x, z, rimSample);
            return rimSample.steepness;
        };

        if (!hasClearFootprint(localX, localZ, clearanceRadius, steepnessAt, slopeLimit)) continue;

        return { localX, localZ };
    }

    return null;
}

function isInsideAnyRegion(
    localX: number,
    localZ: number,
    regions: IExpandedRegionFootprint[]
): boolean {
    for (let i = 0, len = regions.length; i < len; i++) {
        const region = regions[i];

        if (Math.abs(localX - region.centerX) < region.halfWidth) {
            if (Math.abs(localZ - region.centerZ) < region.halfDepth) return true;
        }
    }

    return false;
}

export interface ICorridorSpan {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
}

export interface IRegionFootprint {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
}

interface IExpandedRegionFootprint {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
}

interface IAnchorSpot {
    localX: number;
    localZ: number;
}

interface IClusterOptions {
    species: IThemeProp[];
    heightMap: TerrainHeightMap;
    expandedRegions: IExpandedRegionFootprint[];
    center: Vector3Tuple;
    nextRandom: () => number;
    collector: PropGroupCollector;
    heightSample: IHeightMapSample;
}
