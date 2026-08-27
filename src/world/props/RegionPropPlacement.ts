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
} from "@/lib/helpers";
import { PropGroupCollector } from "@/world/props/PropGroups";

export function placeRegionProps(
    region: IChapterRegion,
    manifest: IThemeManifest,
    groundHeightAt: GroundHeightLookup,
    entrances: IRegionEntrance[]
): IPropGroup[] {
    const nextRandom = createSeededRandom(hashString(region.regionId));
    const bounds = resolvePlacementBounds(region, entrances);
    const furnishing = resolveFurnishingBudget(region, manifest);

    const anchorPoints = spreadAnchorPoints(bounds, furnishing.anchorCount, nextRandom);
    const placedProps: IPlacedProp[] = [];

    placeAnchoredSpecies(placedProps, {
        species: pickRandomSubset(
            manifest.props.filter((prop) => prop.role === PropRole.Landmark),
            PROP_PLACEMENT.landmarkSpeciesPerRegion,
            nextRandom
        ),
        count: furnishing.landmarkCount,
        bounds,
        anchorPoints,
        spreadRadius: bounds.clusterRadius,
        entranceClearanceFactor: 1,
        avoidsOtherProps: true,
        nextRandom,
    });

    placeAnchoredSpecies(placedProps, {
        species: pickRandomSubset(
            manifest.props.filter((prop) => prop.role === PropRole.Structure),
            PROP_PLACEMENT.structureSpeciesPerRegion,
            nextRandom
        ),
        count: furnishing.structureCount,
        bounds,
        anchorPoints,
        spreadRadius: bounds.clusterRadius,
        entranceClearanceFactor: 1,
        avoidsOtherProps: true,
        nextRandom,
    });

    placeGroundClutter(placedProps, {
        species: pickRandomSubset(
            manifest.props.filter((prop) => prop.role === PropRole.Scatter),
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
    entrances: IRegionEntrance[]
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

    return {
        offsetX: entrance.directionX * stepsToBoundary,
        offsetZ: entrance.directionZ * stepsToBoundary,
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
        const candidate = findOpenSpot(bounds, 0, 1, nextRandom, () => {
            const angle = nextRandom() * Math.PI * 2;
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
        const prop = species[Math.floor(nextRandom() * species.length)];
        const anchor = anchorPoints[Math.floor(nextRandom() * anchorPoints.length)];
        if (!prop || !anchor) continue;

        const scale = scaleBetween(prop.scaleRange, nextRandom());
        const footprintRadius = prop.footprintRadius * scale;

        const spot = findOpenSpot(
            bounds,
            footprintRadius,
            entranceClearanceFactor,
            nextRandom,
            () => scatterAround(anchor, spreadRadius, nextRandom)
        );

        if (!spot) continue;

        const placement = buildPlacement(bounds, spot, scale, nextRandom);

        if (avoidsOtherProps && !isClearOfStandingProps(placement, footprintRadius, placedProps))
            continue;

        placedProps.push({ prop, placement });
    }
}

function placeGroundClutter(placedProps: IPlacedProp[], options: IGroundClutterOptions): void {
    const { species, count, bounds, anchorPoints, nextRandom } = options;
    if (species.length === 0) return;

    const standingProps = placedProps.filter(({ prop }) => prop.role !== PropRole.Scatter);

    for (let index = 0; index < count; index += 1) {
        const prop = species[Math.floor(nextRandom() * species.length)];
        if (!prop) continue;

        const scale = scaleBetween(prop.scaleRange, nextRandom());
        const footprintRadius = prop.footprintRadius * scale;

        const huddlesAgainstProp =
            nextRandom() < PROP_PLACEMENT.clutterHuddledAgainstPropRatio &&
            standingProps.length > 0;

        const spot = huddlesAgainstProp
            ? findOpenSpot(
                  bounds,
                  footprintRadius,
                  PROP_PLACEMENT.clutterEntranceClearanceFactor,
                  nextRandom,
                  () => {
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
              )
            : findOpenSpot(
                  bounds,
                  footprintRadius,
                  PROP_PLACEMENT.clutterEntranceClearanceFactor,
                  nextRandom,
                  () => {
                      const anchor = anchorPoints[Math.floor(nextRandom() * anchorPoints.length)];
                      if (!anchor) return null;

                      return scatterAround(anchor, bounds.clusterRadius, nextRandom);
                  }
              );

        if (!spot) continue;

        placedProps.push({ prop, placement: buildPlacement(bounds, spot, scale, nextRandom) });
    }
}

function findOpenSpot(
    bounds: IPlacementBounds,
    footprintRadius: number,
    entranceClearanceFactor: number,
    nextRandom: () => number,
    proposeSpot: () => IAnchorPoint | null
): IAnchorPoint | null {
    for (const relaxation of PROP_PLACEMENT.clearanceRelaxationSteps) {
        for (let attempt = 0; attempt < PROP_PLACEMENT.placementAttempts; attempt += 1) {
            const candidate = proposeSpot();
            if (!candidate) continue;

            const clamped = clampInsideBounds(bounds, candidate, footprintRadius);

            if (isSpotOpen(bounds, clamped, footprintRadius, entranceClearanceFactor * relaxation))
                return clamped;
        }
    }

    return null;
}

function isSpotOpen(
    bounds: IPlacementBounds,
    spot: IAnchorPoint,
    footprintRadius: number,
    entranceClearanceFactor: number
): boolean {
    const distanceFromCentre = Math.hypot(spot.offsetX, spot.offsetZ);
    if (distanceFromCentre < bounds.combatArenaRadius + footprintRadius) return false;

    for (const mouth of bounds.entranceMouths) {
        const clearRadius = mouth.mouthClearRadius * entranceClearanceFactor + footprintRadius;
        if (Math.hypot(spot.offsetX - mouth.offsetX, spot.offsetZ - mouth.offsetZ) < clearRadius)
            return false;

        const laneHalfWidth = mouth.laneHalfWidth * entranceClearanceFactor + footprintRadius;
        if (distanceToLane(spot, mouth) < laneHalfWidth) return false;
    }

    return true;
}

function distanceToLane(spot: IAnchorPoint, mouth: IEntranceMouth): number {
    const laneLengthSquared = mouth.offsetX * mouth.offsetX + mouth.offsetZ * mouth.offsetZ;
    if (laneLengthSquared === 0) return Math.hypot(spot.offsetX, spot.offsetZ);

    const projection = clamp(
        (spot.offsetX * mouth.offsetX + spot.offsetZ * mouth.offsetZ) / laneLengthSquared,
        0,
        1
    );

    return Math.hypot(
        spot.offsetX - mouth.offsetX * projection,
        spot.offsetZ - mouth.offsetZ * projection
    );
}

function clampInsideBounds(
    bounds: IPlacementBounds,
    spot: IAnchorPoint,
    footprintRadius: number
): IAnchorPoint {
    const insetHalfWidth = Math.max(1, bounds.halfWidth - footprintRadius);
    const insetHalfDepth = Math.max(1, bounds.halfDepth - footprintRadius);

    return {
        offsetX: clamp(spot.offsetX, -insetHalfWidth, insetHalfWidth),
        offsetZ: clamp(spot.offsetZ, -insetHalfDepth, insetHalfDepth),
    };
}

function scatterAround(
    anchor: IAnchorPoint,
    spreadRadius: number,
    nextRandom: () => number
): IAnchorPoint {
    const angle = nextRandom() * Math.PI * 2;
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
        rotationY: nextRandom() * Math.PI * 2,
        scale,
    };
}

function isClearOfStandingProps(
    candidate: IPropPlacement,
    candidateRadius: number,
    placedProps: IPlacedProp[]
): boolean {
    for (const { prop, placement } of placedProps) {
        if (prop.role === PropRole.Scatter) continue;

        const distance = Math.hypot(
            candidate.position[0] - placement.position[0],
            candidate.position[2] - placement.position[2]
        );

        if (distance < candidateRadius + PROP_PLACEMENT.separationGap) return false;
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
    entranceMouths: IEntranceMouth[];
}

interface IEntranceMouth {
    offsetX: number;
    offsetZ: number;
    mouthClearRadius: number;
    laneHalfWidth: number;
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
