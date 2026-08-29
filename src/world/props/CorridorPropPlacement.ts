import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import {
    createHeightMapSample,
    type IHeightMapSample,
    type TerrainHeightMap,
} from "@/world/terrain/TerrainHeightMap";
import type { Vector3Tuple } from "three";
import { PropGroupCollector } from "@/world/props/PropGroups";
import { attemptPlacement, pickWeightedSpecies } from "@/world/props/PropPlacementUtils";
import {
    clamp,
    createSeededRandom,
    lerp,
    pickRandomSubset,
    scaleBetween,
    spanBetween,
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

    for (const corridor of corridors)
        for (const anchor of spreadAnchorsAlong(corridor, nextRandom))
            placeClusterAt(anchor, {
                species,
                heightMap,
                regionFootprints,
                center,
                nextRandom,
                collector,
                heightSample,
            });

    return collector.toGroups();
}

function spreadAnchorsAlong(corridor: ICorridorSpan, nextRandom: () => number): IAnchorSpot[] {
    const { spanX, spanZ, length: spanLength } = spanBetween(
        corridor.fromX,
        corridor.fromZ,
        corridor.toX,
        corridor.toZ
    );

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

    const anchors: IAnchorSpot[] = [];

    for (let index = 0; index < anchorCount; index += 1) {
        const evenSpacing = (index + 0.5) / anchorCount;
        const jitter = (nextRandom() * 2 - 1) * (CORRIDOR_PROPS.spineJitter / anchorCount);
        const alongRatio = clamp(evenSpacing + jitter, 0.05, 0.95);

        const spineX = corridor.fromX + spanX * alongRatio;
        const spineZ = corridor.fromZ + spanZ * alongRatio;

        const side = nextRandom() < 0.5 ? -1 : 1;
        const lateralDistance =
            corridor.halfWidth * (1 + CORRIDOR_PROPS.lateralMarginRatio) +
            nextRandom() * CORRIDOR_PROPS.lateralSpread;

        anchors.push({
            localX: spineX + sidewaysX * side * lateralDistance,
            localZ: spineZ + sidewaysZ * side * lateralDistance,
        });
    }

    return anchors;
}

function placeClusterAt(anchor: IAnchorSpot, options: IClusterOptions): void {
    const { nextRandom } = options;

    const propCount = Math.round(
        lerp(CORRIDOR_PROPS.propsPerAnchor[0], CORRIDOR_PROPS.propsPerAnchor[1], nextRandom())
    );

    for (let index = 0; index < propCount; index += 1) placeSingleProp(anchor, options);
}

function placeSingleProp(anchor: IAnchorSpot, options: IClusterOptions): void {
    const { species, heightMap, regionFootprints, center, nextRandom, collector, heightSample } =
        options;

    const prop = pickWeightedSpecies(species, nextRandom);
    if (!prop) return;

    const spot = findOpenSpot(anchor, heightMap, regionFootprints, nextRandom, heightSample);
    if (!spot) return;

    const scale =
        scaleBetween(prop.scaleRange, nextRandom()) *
        lerp(CORRIDOR_PROPS.scaleBoost[0], CORRIDOR_PROPS.scaleBoost[1], nextRandom());

    heightMap.sampleAt(spot.localX, spot.localZ, heightSample);

    collector.add(prop, {
        position: [
            center[0] + spot.localX,
            heightSample.elevation - VEGETATION.groundBite,
            center[2] + spot.localZ,
        ],
        rotationY: nextRandom() * Math.PI * 2,
        scale,
    });
}

function findOpenSpot(
    anchor: IAnchorSpot,
    heightMap: TerrainHeightMap,
    regionFootprints: IRegionFootprint[],
    nextRandom: () => number,
    heightSample: IHeightMapSample
): IAnchorSpot | null {
    return attemptPlacement(
        CORRIDOR_PROPS.placementAttempts,
        () => {
            const angle = nextRandom() * Math.PI * 2;
            const distance = Math.sqrt(nextRandom()) * CORRIDOR_PROPS.clusterRadius;

            return {
                localX: anchor.localX + Math.cos(angle) * distance,
                localZ: anchor.localZ + Math.sin(angle) * distance,
            };
        },
        (candidate) => {
            if (isInsideAnyRegion(candidate.localX, candidate.localZ, regionFootprints))
                return null;

            heightMap.sampleAt(candidate.localX, candidate.localZ, heightSample);
            if (heightSample.carveStrength > CORRIDOR_PROPS.carveRejectThreshold) return null;
            if (heightSample.steepness > CORRIDOR_PROPS.slopeLimit) return null;

            return candidate;
        }
    );
}

function isInsideAnyRegion(
    localX: number,
    localZ: number,
    regionFootprints: IRegionFootprint[]
): boolean {
    for (const region of regionFootprints) {
        const insideX =
            Math.abs(localX - region.centerX) < region.halfWidth + CORRIDOR_PROPS.regionKeepOut;
        const insideZ =
            Math.abs(localZ - region.centerZ) < region.halfDepth + CORRIDOR_PROPS.regionKeepOut;

        if (insideX && insideZ) return true;
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

interface IAnchorSpot {
    localX: number;
    localZ: number;
}

interface IClusterOptions {
    species: IThemeProp[];
    heightMap: TerrainHeightMap;
    regionFootprints: IRegionFootprint[];
    center: Vector3Tuple;
    nextRandom: () => number;
    collector: PropGroupCollector;
    heightSample: IHeightMapSample;
}
