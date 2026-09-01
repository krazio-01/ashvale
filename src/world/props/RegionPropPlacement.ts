import {
    PropRole,
    type IPropGroup,
    type IPropPlacement,
    type IThemeManifest,
    type IThemeProp,
} from "@/types/theme";
import type { IChapterRegion } from "@/types/realm";
import { PROP_PLACEMENT } from "@/constants/placement";
import {
    clamp,
    createSeededRandom,
    hashString,
    pickRandomSubset,
    scaleBetween,
    FULL_TURN,
} from "@/lib/helpers";
import { PropGroupCollector } from "@/world/props/PropGroups";
import { hasClearFootprint, pickWeightedSpecies } from "@/world/props/PropPlacementUtils";

export function placeRegionProps(
    region: IChapterRegion,
    manifest: IThemeManifest,
    groundHeightAt: GroundHeightLookup,
    groundSteepnessAt: GroundHeightLookup,
    entrances: IRegionEntrance[]
): IPropGroup[] {
    const nextRandom = createSeededRandom(hashString(region.regionId));
    const bounds = resolvePlacementBounds(region, entrances, groundSteepnessAt);
    const furnishing = resolveFurnishingBudget(region, manifest);

    const landmarkSpecies: IThemeProp[] = [];
    const structureSpecies: IThemeProp[] = [];
    const scatterSpecies: IThemeProp[] = [];

    for (const prop of manifest.props) {
        if (prop.role === PropRole.Landmark) landmarkSpecies.push(prop);
        else if (prop.role === PropRole.Structure) structureSpecies.push(prop);
        else if (prop.role === PropRole.Scatter) scatterSpecies.push(prop);
    }

    const anchorPoints = spreadAnchorPoints(bounds, furnishing.anchorCount, nextRandom);
    const placedProps: IPlacedProp[] = [];

    placeAnchoredSpecies(placedProps, {
        species: pickRandomSubset(
            landmarkSpecies,
            PROP_PLACEMENT.landmarkSpeciesPerRegion,
            nextRandom
        ),
        count: furnishing.landmarkCount,
        bounds,
        anchorPoints,
        spreadRadius: bounds.clusterRadius,
        entranceClearanceFactor: PROP_PLACEMENT.standingEntranceClearanceFactor,
        avoidsOtherProps: true,
        nextRandom,
    });

    placeAnchoredSpecies(placedProps, {
        species: pickRandomSubset(
            structureSpecies,
            PROP_PLACEMENT.structureSpeciesPerRegion,
            nextRandom
        ),
        count: furnishing.structureCount,
        bounds,
        anchorPoints,
        spreadRadius: bounds.clusterRadius,
        entranceClearanceFactor: PROP_PLACEMENT.standingEntranceClearanceFactor,
        avoidsOtherProps: true,
        nextRandom,
    });

    placeGroundClutter(placedProps, {
        species: pickRandomSubset(
            scatterSpecies,
            PROP_PLACEMENT.clutterSpeciesPerRegion,
            nextRandom
        ),
        count: furnishing.clutterCount,
        bounds,
        anchorPoints,
        nextRandom,
    });

    settleOntoTerrain(placedProps, groundHeightAt);

    const collector = new PropGroupCollector(true);
    for (const { prop, placement } of placedProps) collector.add(prop, placement);

    return collector.toGroups();
}

function resolvePlacementBounds(
    region: IChapterRegion,
    entrances: IRegionEntrance[],
    groundSteepnessAt: GroundHeightLookup
): IPlacementBounds {
    const [width, depth] = region.floorSize;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const shortestSpan = Math.min(width, depth);

    return {
        originX: region.worldPosition[0],
        originZ: region.worldPosition[2],
        halfWidth,
        halfDepth,
        combatArenaRadius: shortestSpan * PROP_PLACEMENT.combatArenaRatio,
        clusterRadius: shortestSpan * PROP_PLACEMENT.clusterRadiusRatio,
        groundSteepnessAt,
        entranceMouths: entrances.map((entrance) =>
            resolveEntranceMouth(entrance, halfWidth, halfDepth)
        ),
    };
}

function resolveEntranceMouth(
    entrance: IRegionEntrance,
    halfWidth: number,
    halfDepth: number
): IEntranceMouth {
    const stepsToVerticalEdge =
        entrance.directionX === 0 ? Infinity : halfWidth / Math.abs(entrance.directionX);
    const stepsToHorizontalEdge =
        entrance.directionZ === 0 ? Infinity : halfDepth / Math.abs(entrance.directionZ);
    const stepsToBoundary = Math.min(stepsToVerticalEdge, stepsToHorizontalEdge);

    const corridorHalfWidth = entrance.corridorWidth / 2;
    const offsetX = entrance.directionX * stepsToBoundary;
    const offsetZ = entrance.directionZ * stepsToBoundary;

    return {
        offsetX,
        offsetZ,
        laneLengthSquared: offsetX * offsetX + offsetZ * offsetZ,
        mouthClearRadius: corridorHalfWidth * PROP_PLACEMENT.entranceMouthClearanceRatio,
        laneHalfWidth: corridorHalfWidth * PROP_PLACEMENT.entranceLaneWidthRatio,
    };
}

function resolveFurnishingBudget(
    region: IChapterRegion,
    manifest: IThemeManifest
): IFurnishingBudget {
    const [width, depth] = region.floorSize;
    const area = width * depth;

    const richness = clamp(
        region.fileCount / PROP_PLACEMENT.typicalFileCount,
        PROP_PLACEMENT.minimumRichness,
        PROP_PLACEMENT.maximumRichness
    );

    const clutterRichness =
        richness * (manifest.scatterPropsPerFile / PROP_PLACEMENT.referenceScatterPropsPerFile);

    return {
        landmarkCount: countForArea(area, richness, PROP_PLACEMENT.landmarkDensity, 1, 6),
        structureCount: countForArea(area, richness, PROP_PLACEMENT.structureDensity, 3, 26),
        clutterCount: countForArea(area, clutterRichness, PROP_PLACEMENT.clutterDensity, 15, 320),
        anchorCount: countForArea(area, richness, PROP_PLACEMENT.anchorDensity, 2, 9),
    };
}

function countForArea(
    area: number,
    richness: number,
    density: number,
    minimum: number,
    maximum: number
): number {
    return clamp(Math.round(area * density * richness), minimum, maximum);
}

function spreadAnchorPoints(
    bounds: IPlacementBounds,
    count: number,
    nextRandom: () => number
): IAnchorPoint[] {
    const anchorPoints: IAnchorPoint[] = [];

    for (let index = 0; index < count; index += 1) {
        const candidate = findOpenSpot(bounds, 0, 1, () => {
            const angle = nextRandom() * FULL_TURN;
            const edgeBias = Math.pow(nextRandom(), PROP_PLACEMENT.edgeBiasExponent);

            return {
                offsetX: Math.cos(angle) * edgeBias * bounds.halfWidth,
                offsetZ: Math.sin(angle) * edgeBias * bounds.halfDepth,
            };
        });

        if (candidate) anchorPoints.push(candidate);
    }

    return anchorPoints;
}

function placeAnchoredSpecies(placedProps: IPlacedProp[], options: IAnchoredSpeciesOptions): void {
    const {
        species,
        count,
        bounds,
        anchorPoints,
        spreadRadius,
        entranceClearanceFactor,
        avoidsOtherProps,
        nextRandom,
    } = options;

    if (species.length === 0 || anchorPoints.length === 0) return;

    for (let index = 0; index < count; index += 1) {
        const prop = pickWeightedSpecies(species, nextRandom);
        const anchor = anchorPoints[Math.floor(nextRandom() * anchorPoints.length)];
        if (!prop || !anchor) continue;

        const scale = scaleBetween(prop.scaleRange, nextRandom());
        const footprintRadius = prop.footprintRadius * scale;

        const spot = findOpenSpot(
            bounds,
            footprintRadius,
            entranceClearanceFactor,
            () => scatterAround(anchor, spreadRadius, nextRandom),
            avoidsOtherProps
                ? (candidate) =>
                      isClearOfStandingProps(
                          bounds.originX + candidate.offsetX,
                          bounds.originZ + candidate.offsetZ,
                          footprintRadius,
                          placedProps
                      )
                : undefined
        );

        if (!spot) continue;

        placedProps.push({ prop, placement: buildPlacement(bounds, spot, scale, nextRandom) });
    }
}

function placeGroundClutter(placedProps: IPlacedProp[], options: IGroundClutterOptions): void {
    const { species, count, bounds, anchorPoints, nextRandom } = options;
    if (species.length === 0) return;

    const standingProps = placedProps.filter(({ prop }) => prop.role !== PropRole.Scatter);

    for (let index = 0; index < count; index += 1) {
        const prop = pickWeightedSpecies(species, nextRandom);
        if (!prop) continue;

        const scale = scaleBetween(prop.scaleRange, nextRandom());
        const footprintRadius = prop.footprintRadius * scale;

        const huddlesAgainstProp =
            nextRandom() < PROP_PLACEMENT.clutterHuddledAgainstPropRatio &&
            standingProps.length > 0;

        const spot = findOpenSpot(
            bounds,
            footprintRadius,
            PROP_PLACEMENT.clutterEntranceClearanceFactor,
            huddlesAgainstProp
                ? () => proposeSpotBesideStandingProp(bounds, standingProps, nextRandom)
                : () => proposeSpotAroundAnchor(bounds, anchorPoints, nextRandom)
        );

        if (!spot) continue;

        placedProps.push({ prop, placement: buildPlacement(bounds, spot, scale, nextRandom) });
    }
}

function proposeSpotBesideStandingProp(
    bounds: IPlacementBounds,
    standingProps: IPlacedProp[],
    nextRandom: () => number
): IAnchorPoint | null {
    const host = standingProps[Math.floor(nextRandom() * standingProps.length)];
    if (!host) return null;

    return scatterAround(
        {
            offsetX: host.placement.position[0] - bounds.originX,
            offsetZ: host.placement.position[2] - bounds.originZ,
        },
        PROP_PLACEMENT.clutterHuddleRadius,
        nextRandom
    );
}

function proposeSpotAroundAnchor(
    bounds: IPlacementBounds,
    anchorPoints: IAnchorPoint[],
    nextRandom: () => number
): IAnchorPoint | null {
    const anchor = anchorPoints[Math.floor(nextRandom() * anchorPoints.length)];
    if (!anchor) return null;

    return scatterAround(anchor, bounds.clusterRadius, nextRandom);
}

function findOpenSpot(
    bounds: IPlacementBounds,
    footprintRadius: number,
    entranceClearanceFactor: number,
    proposeSpot: () => IAnchorPoint | null,
    isSpotAcceptable?: (spot: IAnchorPoint) => boolean
): IAnchorPoint | null {
    const insetHalfWidth = Math.max(1, bounds.halfWidth - footprintRadius);
    const insetHalfDepth = Math.max(1, bounds.halfDepth - footprintRadius);
    const arenaClearanceSquared = (bounds.combatArenaRadius + footprintRadius) ** 2;

    for (const relaxation of PROP_PLACEMENT.clearanceRelaxationSteps) {
        const mouthClearances = resolveMouthClearances(
            bounds.entranceMouths,
            footprintRadius,
            entranceClearanceFactor * relaxation
        );

        for (let attempt = 0; attempt < PROP_PLACEMENT.placementAttempts; attempt += 1) {
            const candidate = proposeSpot();
            if (!candidate) continue;

            candidate.offsetX = clamp(candidate.offsetX, -insetHalfWidth, insetHalfWidth);
            candidate.offsetZ = clamp(candidate.offsetZ, -insetHalfDepth, insetHalfDepth);

            if (!isSpotOpen(candidate, arenaClearanceSquared, mouthClearances)) continue;
            if (isSpotAcceptable && !isSpotAcceptable(candidate)) continue;

            if (!isSpotOpen(candidate, arenaClearanceSquared, mouthClearances)) continue;
            if (isSpotAcceptable && !isSpotAcceptable(candidate)) continue;

            if (
                !hasClearFootprint(
                    bounds.originX + candidate.offsetX,
                    bounds.originZ + candidate.offsetZ,
                    footprintRadius,
                    bounds.groundSteepnessAt,
                    PROP_PLACEMENT.slopeLimit
                )
            )
                continue;

            return candidate;
        }
    }

    return null;
}

function resolveMouthClearances(
    entranceMouths: IEntranceMouth[],
    footprintRadius: number,
    entranceClearanceFactor: number
): IMouthClearance[] {
    return entranceMouths.map((mouth) => ({
        offsetX: mouth.offsetX,
        offsetZ: mouth.offsetZ,
        laneLengthSquared: mouth.laneLengthSquared,
        clearRadiusSquared:
            (mouth.mouthClearRadius * entranceClearanceFactor + footprintRadius) ** 2,
        laneHalfWidthSquared:
            (mouth.laneHalfWidth * entranceClearanceFactor + footprintRadius) ** 2,
    }));
}

function isSpotOpen(
    spot: IAnchorPoint,
    arenaClearanceSquared: number,
    mouthClearances: IMouthClearance[]
): boolean {
    const distanceFromCentreSquared = spot.offsetX * spot.offsetX + spot.offsetZ * spot.offsetZ;
    if (distanceFromCentreSquared < arenaClearanceSquared) return false;

    for (const mouth of mouthClearances) {
        const gapToMouthX = spot.offsetX - mouth.offsetX;
        const gapToMouthZ = spot.offsetZ - mouth.offsetZ;
        if (gapToMouthX * gapToMouthX + gapToMouthZ * gapToMouthZ < mouth.clearRadiusSquared)
            return false;

        if (squaredDistanceToLane(spot, mouth) < mouth.laneHalfWidthSquared) return false;
    }

    return true;
}

function squaredDistanceToLane(spot: IAnchorPoint, mouth: IMouthClearance): number {
    if (mouth.laneLengthSquared === 0)
        return spot.offsetX * spot.offsetX + spot.offsetZ * spot.offsetZ;

    const projection = clamp(
        (spot.offsetX * mouth.offsetX + spot.offsetZ * mouth.offsetZ) / mouth.laneLengthSquared,
        0,
        1
    );

    const gapX = spot.offsetX - mouth.offsetX * projection;
    const gapZ = spot.offsetZ - mouth.offsetZ * projection;

    return gapX * gapX + gapZ * gapZ;
}

function scatterAround(
    anchor: IAnchorPoint,
    spreadRadius: number,
    nextRandom: () => number
): IAnchorPoint {
    const angle = nextRandom() * FULL_TURN;
    const distance = Math.sqrt(nextRandom()) * spreadRadius;

    return {
        offsetX: anchor.offsetX + Math.cos(angle) * distance,
        offsetZ: anchor.offsetZ + Math.sin(angle) * distance,
    };
}

function buildPlacement(
    bounds: IPlacementBounds,
    spot: IAnchorPoint,
    scale: number,
    nextRandom: () => number
): IPropPlacement {
    return {
        position: [bounds.originX + spot.offsetX, 0, bounds.originZ + spot.offsetZ],
        rotationY: nextRandom() * FULL_TURN,
        scale,
    };
}

function isClearOfStandingProps(
    candidateWorldX: number,
    candidateWorldZ: number,
    candidateRadius: number,
    placedProps: IPlacedProp[]
): boolean {
    const minimumDistanceSquared = (candidateRadius + PROP_PLACEMENT.separationGap) ** 2;

    for (const { prop, placement } of placedProps) {
        if (prop.role === PropRole.Scatter) continue;

        const gapX = candidateWorldX - placement.position[0];
        const gapZ = candidateWorldZ - placement.position[2];

        if (gapX * gapX + gapZ * gapZ < minimumDistanceSquared) return false;
    }

    return true;
}

function settleOntoTerrain(placedProps: IPlacedProp[], groundHeightAt: GroundHeightLookup): void {
    for (const { placement } of placedProps)
        placement.position[1] = groundHeightAt(placement.position[0], placement.position[2]);
}

export interface IRegionEntrance {
    directionX: number;
    directionZ: number;
    corridorWidth: number;
}

interface IPlacementBounds {
    originX: number;
    originZ: number;
    halfWidth: number;
    halfDepth: number;
    combatArenaRadius: number;
    clusterRadius: number;
    groundSteepnessAt: GroundHeightLookup;
    entranceMouths: IEntranceMouth[];
}

interface IEntranceMouth {
    offsetX: number;
    offsetZ: number;
    laneLengthSquared: number;
    mouthClearRadius: number;
    laneHalfWidth: number;
}

interface IMouthClearance {
    offsetX: number;
    offsetZ: number;
    laneLengthSquared: number;
    clearRadiusSquared: number;
    laneHalfWidthSquared: number;
}

interface IFurnishingBudget {
    landmarkCount: number;
    structureCount: number;
    clutterCount: number;
    anchorCount: number;
}

interface IAnchorPoint {
    offsetX: number;
    offsetZ: number;
}

interface IPlacedProp {
    prop: IThemeProp;
    placement: IPropPlacement;
}

interface IAnchoredSpeciesOptions {
    species: IThemeProp[];
    count: number;
    bounds: IPlacementBounds;
    anchorPoints: IAnchorPoint[];
    spreadRadius: number;
    entranceClearanceFactor: number;
    avoidsOtherProps: boolean;
    nextRandom: () => number;
}

interface IGroundClutterOptions {
    species: IThemeProp[];
    count: number;
    bounds: IPlacementBounds;
    anchorPoints: IAnchorPoint[];
    nextRandom: () => number;
}

type GroundHeightLookup = (worldX: number, worldZ: number) => number;
