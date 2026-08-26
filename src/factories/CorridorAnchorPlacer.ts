import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import type { TerrainHeightField } from "@/world/TerrainHeightField";
import type { Vector3Tuple } from "three";
import { CORRIDOR_ANCHOR } from "@/constants/game";
import { clamp, createSeededRandom, lerp, pickRandomSubset, scaleBetween } from "@/lib/helpers";

export function placeCorridorAnchors(
    manifest: IThemeManifest,
    heightField: TerrainHeightField,
    corridors: ICorridorSpan[],
    regionFootprints: IRegionFootprint[],
    center: Vector3Tuple,
    seed: number
): IPropGroup[] {
    const nextRandom = createSeededRandom(seed);

    const species = pickRandomSubset(
        manifest.props.filter(
            (prop) => prop.role === PropRole.Landmark || prop.role === PropRole.Structure
        ),
        CORRIDOR_ANCHOR.speciesPerRealm,
        nextRandom
    );

    if (species.length === 0) return [];

    const groupsByModelPath = new Map<string, IPropGroup>();

    for (const corridor of corridors)
        for (const anchor of spreadAnchorsAlong(corridor, nextRandom))
            placeClusterAt(anchor, {
                species,
                heightField,
                regionFootprints,
                center,
                nextRandom,
                groupsByModelPath,
            });

    return [...groupsByModelPath.values()];
}

function spreadAnchorsAlong(corridor: ICorridorSpan, nextRandom: () => number): IAnchorSpot[] {
    const spanX = corridor.toX - corridor.fromX;
    const spanZ = corridor.toZ - corridor.fromZ;
    const spanLength = Math.hypot(spanX, spanZ);

    if (spanLength === 0) return [];

    const anchorCount = clamp(
        Math.round(spanLength * CORRIDOR_ANCHOR.anchorsPerUnitLength),
        CORRIDOR_ANCHOR.minimumAnchorsPerCorridor,
        CORRIDOR_ANCHOR.maximumAnchorsPerCorridor
    );

    const alongX = spanX / spanLength;
    const alongZ = spanZ / spanLength;
    const sidewaysX = -alongZ;
    const sidewaysZ = alongX;

    const anchors: IAnchorSpot[] = [];

    for (let index = 0; index < anchorCount; index += 1) {
        const evenSpacing = (index + 0.5) / anchorCount;
        const jitter = (nextRandom() * 2 - 1) * (CORRIDOR_ANCHOR.spineJitter / anchorCount);
        const alongRatio = clamp(evenSpacing + jitter, 0.05, 0.95);

        const spineX = corridor.fromX + spanX * alongRatio;
        const spineZ = corridor.fromZ + spanZ * alongRatio;

        const side = nextRandom() < 0.5 ? -1 : 1;
        const lateralDistance =
            corridor.halfWidth * (1 + CORRIDOR_ANCHOR.lateralMarginRatio) +
            nextRandom() * CORRIDOR_ANCHOR.lateralSpread;

        anchors.push({
            localX: spineX + sidewaysX * side * lateralDistance,
            localZ: spineZ + sidewaysZ * side * lateralDistance,
        });
    }

    return anchors;
}

function placeClusterAt(anchor: IAnchorSpot, options: IClusterOptions): void {
    const { species, heightField, regionFootprints, center, nextRandom, groupsByModelPath } =
        options;

    const propCount = Math.round(
        lerp(CORRIDOR_ANCHOR.propsPerAnchor[0], CORRIDOR_ANCHOR.propsPerAnchor[1], nextRandom())
    );

    for (let index = 0; index < propCount; index += 1) {
        const prop = species[Math.floor(nextRandom() * species.length)];
        if (!prop) continue;

        const spot = findOpenSpot(anchor, heightField, regionFootprints, nextRandom);
        if (!spot) continue;

        const scale =
            scaleBetween(prop.scaleRange, nextRandom()) *
            lerp(CORRIDOR_ANCHOR.scaleBoost[0], CORRIDOR_ANCHOR.scaleBoost[1], nextRandom());

        appendPlacement(groupsByModelPath, prop, {
            position: [
                center[0] + spot.localX,
                heightField.elevationAt(spot.localX, spot.localZ) - 0.02,
                center[2] + spot.localZ,
            ],
            rotationY: nextRandom() * Math.PI * 2,
            scale,
        });
    }
}

function findOpenSpot(
    anchor: IAnchorSpot,
    heightField: TerrainHeightField,
    regionFootprints: IRegionFootprint[],
    nextRandom: () => number
): IAnchorSpot | null {
    for (let attempt = 0; attempt < CORRIDOR_ANCHOR.placementAttempts; attempt += 1) {
        const angle = nextRandom() * Math.PI * 2;
        const distance = Math.sqrt(nextRandom()) * CORRIDOR_ANCHOR.clusterRadius;

        const localX = anchor.localX + Math.cos(angle) * distance;
        const localZ = anchor.localZ + Math.sin(angle) * distance;

        if (isInsideAnyRegion(localX, localZ, regionFootprints)) continue;

        const sample = heightField.sampleTerrainAt(localX, localZ);
        if (sample.carveStrength > CORRIDOR_ANCHOR.carveRejectThreshold) continue;
        if (heightField.steepnessAt(localX, localZ) > CORRIDOR_ANCHOR.slopeLimit) continue;

        return { localX, localZ };
    }

    return null;
}

function isInsideAnyRegion(
    localX: number,
    localZ: number,
    regionFootprints: IRegionFootprint[]
): boolean {
    for (const region of regionFootprints) {
        const insideX =
            Math.abs(localX - region.centerX) < region.halfWidth + CORRIDOR_ANCHOR.regionKeepOut;
        const insideZ =
            Math.abs(localZ - region.centerZ) < region.halfDepth + CORRIDOR_ANCHOR.regionKeepOut;

        if (insideX && insideZ) return true;
    }

    return false;
}

function appendPlacement(
    groupsByModelPath: Map<string, IPropGroup>,
    prop: IThemeProp,
    placement: IPropGroup["placements"][number]
): void {
    const existingGroup = groupsByModelPath.get(prop.modelPath);

    if (existingGroup) {
        existingGroup.placements.push(placement);
        return;
    }

    groupsByModelPath.set(prop.modelPath, {
        modelPath: prop.modelPath,
        role: prop.role,
        hasCollider: false,
        footprintRadius: prop.footprintRadius,
        placements: [placement],
    });
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
    heightField: TerrainHeightField;
    regionFootprints: IRegionFootprint[];
    center: Vector3Tuple;
    nextRandom: () => number;
    groupsByModelPath: Map<string, IPropGroup>;
}
