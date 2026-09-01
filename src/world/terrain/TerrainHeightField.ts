import { LANDFORM, TERRAIN, TERRAIN_DETAIL, WORLD_EDGE } from "@/constants/world";
import { clamp, lerp, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";

export const WALKABLE_REACH = WORLD_EDGE.groundApron + WORLD_EDGE.lipWidth;

export class TerrainHeightField {
    private readonly regionFloors: IRegionFloor[];
    private readonly preparedCorridors: IPreparedCorridor[];
    private readonly undulationNoise: FractalNoise;
    private readonly elevationRampDistance: number;
    private readonly scratchSample = createTerrainSample();
    private readonly scratchGround = createGroundAccumulator();

    constructor(regionFloors: IRegionFloor[], corridorPaths: ICorridorPath[], seed: number) {
        this.regionFloors = regionFloors;
        this.preparedCorridors = corridorPaths.map(prepareCorridor);
        this.undulationNoise = new FractalNoise(seed);
        this.elevationRampDistance =
            measureNeighbourSpacing(regionFloors) * LANDFORM.openGroundRampRatio;
    }

    sampleInto(localX: number, localZ: number, sample: ITerrainSample): ITerrainSample {
        const ground = resetGroundAccumulator(this.scratchGround);

        sample.floorColorIndex = 0;
        sample.isCorridor = false;

        for (const region of this.regionFloors) {
            const carveWeight = accumulateFeature(
                ground,
                region.floorElevation,
                distanceOutsideRegionFloor(localX, localZ, region),
                false
            );

            if (carveWeight > ground.dominantCarveWeight) {
                ground.dominantCarveWeight = carveWeight;
                sample.floorColorIndex = region.floorColorIndex;
                sample.isCorridor = false;
            }
        }

        for (const corridor of this.preparedCorridors) {
            const travelRatio = corridorTravelRatioAt(localX, localZ, corridor);
            const carveWeight = accumulateFeature(
                ground,
                corridorElevationAt(corridor, travelRatio) - TERRAIN.corridorDrop,
                distanceOutsideCorridorAt(localX, localZ, corridor, travelRatio),
                true
            );

            if (carveWeight > ground.dominantCarveWeight) {
                ground.dominantCarveWeight = carveWeight;
                sample.isCorridor = true;
            }
        }

        sample.carveStrength = ground.dominantCarveWeight;
        sample.footprintDistance = ground.nearestEdgeDistance;
        sample.elevation =
            this.resolveElevationAt(localX, localZ, ground) +
            edgeDropAt(ground.nearestEdgeDistance);

        return sample;
    }

    elevationAt(localX: number, localZ: number): number {
        return this.sampleInto(localX, localZ, this.scratchSample).elevation;
    }

    private resolveElevationAt(localX: number, localZ: number, ground: IGroundAccumulator): number {
        if (ground.totalCarveWeight <= 0) return this.openGroundElevationAt(localX, localZ, ground);

        const carvedFloorElevation =
            ground.weightedFloorElevation / ground.totalCarveWeight +
            this.floorUndulationAt(localX, localZ) * ground.dominantCarveWeight;

        if (ground.dominantCarveWeight >= 1) return carvedFloorElevation;

        return lerp(
            this.openGroundElevationAt(localX, localZ, ground),
            carvedFloorElevation,
            ground.dominantCarveWeight
        );
    }

    private floorUndulationAt(localX: number, localZ: number): number {
        const undulationSample = this.undulationNoise.sample(
            localX * LANDFORM.floorReliefScale,
            localZ * LANDFORM.floorReliefScale,
            2,
            0.5
        );

        return (undulationSample - 0.5) * 2 * LANDFORM.floorReliefHeight;
    }

    /* the boundary is only forced hard when a corridor is genuinely the nearest thing —
       that is the one obstacle worth protecting. Region-vs-region open ground, where
       nothing deliberate is happening, blends smoothly so no unintended cliff appears */
    private openGroundElevationAt(
        localX: number,
        localZ: number,
        ground: IGroundAccumulator
    ): number {
        const surroundingElevation = ground.nearestFeatureIsCorridor
            ? ground.nearestFloorElevation
            : ground.totalInfluenceWeight > 0
              ? ground.influenceWeightedElevation / ground.totalInfluenceWeight
              : ground.nearestFloorElevation;

        const elevationRampRatio = smoothstep(
            0,
            this.elevationRampDistance,
            ground.nearestEdgeDistance
        );

        const gentleRollSample = this.undulationNoise.sample(
            localX * LANDFORM.openGroundReliefScale,
            localZ * LANDFORM.openGroundReliefScale,
            3,
            0.5
        );
        const gentleRoll = (gentleRollSample - 0.5) * 2 * LANDFORM.openGroundReliefHeight;

        const fineDetailOffset =
            (this.undulationNoise.sample(
                localX * TERRAIN_DETAIL.grainNoiseScale,
                localZ * TERRAIN_DETAIL.grainNoiseScale,
                2,
                0.5
            ) -
                0.5) *
            TERRAIN_DETAIL.grainNoiseHeight;

        return surroundingElevation + gentleRoll * elevationRampRatio + fineDetailOffset;
    }
}

export function createTerrainSample(): ITerrainSample {
    return {
        elevation: 0,
        carveStrength: 0,
        floorColorIndex: 0,
        isCorridor: false,
        footprintDistance: 0,
    };
}

/* the last stretch of apron eases into a dive that fog swallows */
function edgeDropAt(footprintDistance: number): number {
    const rolloverRatio = smoothstep(WORLD_EDGE.groundApron, WALKABLE_REACH, footprintDistance);

    if (rolloverRatio <= 0) return 0;

    return -Math.pow(rolloverRatio, WORLD_EDGE.dropCurve) * WORLD_EDGE.dropDepth;
}

function createGroundAccumulator(): IGroundAccumulator {
    return {
        dominantCarveWeight: 0,
        weightedFloorElevation: 0,
        totalCarveWeight: 0,
        nearestEdgeDistance: Infinity,
        nearestFloorElevation: TERRAIN.pathLevel,
        nearestFeatureIsCorridor: false,
        influenceWeightedElevation: 0,
        totalInfluenceWeight: 0,
    };
}

function resetGroundAccumulator(ground: IGroundAccumulator): IGroundAccumulator {
    ground.dominantCarveWeight = 0;
    ground.weightedFloorElevation = 0;
    ground.totalCarveWeight = 0;
    ground.nearestEdgeDistance = Infinity;
    ground.nearestFloorElevation = TERRAIN.pathLevel;
    ground.nearestFeatureIsCorridor = false;
    ground.influenceWeightedElevation = 0;
    ground.totalInfluenceWeight = 0;

    return ground;
}

function accumulateFeature(
    ground: IGroundAccumulator,
    featureElevation: number,
    edgeDistance: number,
    isCorridor: boolean
): number {
    if (edgeDistance < ground.nearestEdgeDistance) {
        ground.nearestEdgeDistance = edgeDistance;
        ground.nearestFloorElevation = featureElevation;
        ground.nearestFeatureIsCorridor = isCorridor;
    }

    const influenceWeight = 1 - smoothstep(0, WALKABLE_REACH, edgeDistance);
    ground.influenceWeightedElevation += featureElevation * influenceWeight;
    ground.totalInfluenceWeight += influenceWeight;

    const carveWeight = 1 - smoothstep(0, TERRAIN.bankWidth, edgeDistance);
    if (carveWeight <= 0) return 0;

    ground.weightedFloorElevation += featureElevation * carveWeight;
    ground.totalCarveWeight += carveWeight;

    return carveWeight;
}

function measureNeighbourSpacing(regionFloors: IRegionFloor[]): number {
    let smallestRegionSpan = Infinity;

    for (const region of regionFloors)
        smallestRegionSpan = Math.min(
            smallestRegionSpan,
            region.halfWidth * 2,
            region.halfDepth * 2
        );

    if (!Number.isFinite(smallestRegionSpan)) return TERRAIN.bankWidth;

    const gapsToNearestNeighbour: number[] = [];

    for (const region of regionFloors) {
        let nearestGap = Infinity;

        for (const other of regionFloors) {
            if (other === region) continue;

            const centreGapX = Math.abs(other.centerX - region.centerX);
            const centreGapZ = Math.abs(other.centerZ - region.centerZ);
            const edgeGapX = Math.max(centreGapX - region.halfWidth - other.halfWidth, 0);
            const edgeGapZ = Math.max(centreGapZ - region.halfDepth - other.halfDepth, 0);

            nearestGap = Math.min(nearestGap, Math.sqrt(edgeGapX * edgeGapX + edgeGapZ * edgeGapZ));
        }

        if (Number.isFinite(nearestGap)) gapsToNearestNeighbour.push(nearestGap);
    }

    if (gapsToNearestNeighbour.length === 0)
        return smallestRegionSpan * LANDFORM.minimumOpennessRatio;

    gapsToNearestNeighbour.sort((first, second) => first - second);

    const medianGap = gapsToNearestNeighbour[Math.floor(gapsToNearestNeighbour.length / 2)] ?? 0;

    return Math.max(medianGap, smallestRegionSpan * LANDFORM.minimumOpennessRatio);
}

function prepareCorridor(path: ICorridorPath): IPreparedCorridor {
    const spanX = path.toX - path.fromX;
    const spanZ = path.toZ - path.fromZ;
    const spanLengthSquared = spanX * spanX + spanZ * spanZ;

    return {
        fromX: path.fromX,
        fromZ: path.fromZ,
        spanX,
        spanZ,
        spanLengthSquared,
        spanLength: Math.sqrt(spanLengthSquared),
        halfWidth: path.halfWidth,
        fromElevation: path.fromElevation,
        toElevation: path.toElevation,
        climbStyle: path.climbStyle,
    };
}

/* both terrace levels stay flat and the whole rise happens across one short face,
   which is too steep to walk and therefore has to be climbed */
export function corridorStepDistanceOf(spanLength: number): number {
    return spanLength * TERRAIN.corridorStepRatio;
}

function corridorElevationAt(corridor: IPreparedCorridor, travelRatio: number): number {
    if (corridor.fromElevation === corridor.toElevation) return corridor.fromElevation;

    if (corridor.climbStyle === CorridorClimbStyle.Ramp)
        return lerp(corridor.fromElevation, corridor.toElevation, travelRatio);

    const stepDistance = corridorStepDistanceOf(corridor.spanLength);
    const halfFace = TERRAIN.corridorStepFaceWidth / 2;

    return lerp(
        corridor.fromElevation,
        corridor.toElevation,
        smoothstep(
            stepDistance - halfFace,
            stepDistance + halfFace,
            travelRatio * corridor.spanLength
        )
    );
}

function distanceOutsideRegionFloor(x: number, z: number, region: IRegionFloor): number {
    const outsideX = Math.max(Math.abs(x - region.centerX) - region.halfWidth, 0);
    const outsideZ = Math.max(Math.abs(z - region.centerZ) - region.halfDepth, 0);

    return Math.sqrt(outsideX * outsideX + outsideZ * outsideZ);
}

/* how far along the corridor the closest point lies, which is also how far the
   ramp between its two end elevations has climbed */
function corridorTravelRatioAt(x: number, z: number, corridor: IPreparedCorridor): number {
    if (corridor.spanLengthSquared === 0) return 0;

    return clamp(
        ((x - corridor.fromX) * corridor.spanX + (z - corridor.fromZ) * corridor.spanZ) /
            corridor.spanLengthSquared,
        0,
        1
    );
}

function distanceOutsideCorridorAt(
    x: number,
    z: number,
    corridor: IPreparedCorridor,
    travelRatio: number
): number {
    const gapX = x - corridor.fromX - corridor.spanX * travelRatio;
    const gapZ = z - corridor.fromZ - corridor.spanZ * travelRatio;

    return Math.max(Math.sqrt(gapX * gapX + gapZ * gapZ) - corridor.halfWidth, 0);
}

export interface IRegionFloor {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
    floorElevation: number;
    floorColorIndex: number;
}

/* decided once per corridor and shared by both the terrain carve and the staircase
   prop placement, so the two never disagree about which corridors get an obstacle */
export enum CorridorClimbStyle {
    Ramp = "ramp",
    Straight = "straight",
    Zigzag = "zigzag",
    Hidden = "hidden",
}

export interface ICorridorPath {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
    fromElevation: number;
    toElevation: number;
    climbStyle: CorridorClimbStyle;
    lateralSeed: number;
}

export interface ITerrainSample {
    elevation: number;
    carveStrength: number;
    floorColorIndex: number;
    isCorridor: boolean;
    footprintDistance: number;
}

interface IPreparedCorridor {
    fromX: number;
    fromZ: number;
    spanX: number;
    spanZ: number;
    spanLengthSquared: number;
    spanLength: number;
    halfWidth: number;
    fromElevation: number;
    toElevation: number;
    climbStyle: CorridorClimbStyle;
}

interface IGroundAccumulator {
    dominantCarveWeight: number;
    weightedFloorElevation: number;
    totalCarveWeight: number;
    nearestEdgeDistance: number;
    nearestFloorElevation: number;
    nearestFeatureIsCorridor: boolean;
    influenceWeightedElevation: number;
    totalInfluenceWeight: number;
}
