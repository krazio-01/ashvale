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

    constructor(regionFloors: IRegionFloor[], corridorPaths: ICorridorPath[], seed: number) {
        this.regionFloors = regionFloors;
        this.preparedCorridors = corridorPaths.map(prepareCorridor);
        this.undulationNoise = new FractalNoise(seed);
        this.elevationRampDistance =
            measureNeighbourSpacing(regionFloors) * LANDFORM.openGroundRampRatio;
    }

    sampleInto(localX: number, localZ: number, sample: ITerrainSample): ITerrainSample {
        const bankWidth = TERRAIN.bankWidth;

        let dominantCarveWeight = 0;
        let weightedFloorElevation = 0;
        let totalCarveWeight = 0;
        let distanceToCarvedGround = Infinity;

        sample.floorColorIndex = 0;
        sample.isCorridor = false;

        for (const region of this.regionFloors) {
            const edgeDistance = distanceOutsideRegionFloor(localX, localZ, region);
            if (edgeDistance < distanceToCarvedGround) distanceToCarvedGround = edgeDistance;
            if (edgeDistance >= bankWidth) continue;

            const carveWeight = 1 - smoothstep(0, bankWidth, edgeDistance);
            if (carveWeight <= 0) continue;

            weightedFloorElevation += region.floorElevation * carveWeight;
            totalCarveWeight += carveWeight;

            if (carveWeight > dominantCarveWeight) {
                dominantCarveWeight = carveWeight;
                sample.floorColorIndex = region.floorColorIndex;
            }
        }

        for (const corridor of this.preparedCorridors) {
            const edgeDistance = distanceOutsideCorridor(localX, localZ, corridor);
            if (edgeDistance < distanceToCarvedGround) distanceToCarvedGround = edgeDistance;
            if (edgeDistance >= bankWidth) continue;

            const carveWeight = 1 - smoothstep(0, bankWidth, edgeDistance);
            if (carveWeight <= 0) continue;

            weightedFloorElevation +=
                (corridor.floorElevation - TERRAIN.corridorDrop) * carveWeight;
            totalCarveWeight += carveWeight;

            if (carveWeight > dominantCarveWeight) {
                dominantCarveWeight = carveWeight;
                sample.isCorridor = true;
            }
        }

        sample.carveStrength = dominantCarveWeight;
        sample.footprintDistance = distanceToCarvedGround;
        sample.elevation =
            this.resolveElevationAt(
                localX,
                localZ,
                distanceToCarvedGround,
                weightedFloorElevation,
                totalCarveWeight,
                dominantCarveWeight
            ) + edgeDropAt(distanceToCarvedGround);

        return sample;
    }

    elevationAt(localX: number, localZ: number): number {
        return this.sampleInto(localX, localZ, this.scratchSample).elevation;
    }

    private resolveElevationAt(
        localX: number,
        localZ: number,
        distanceToCarvedGround: number,
        weightedFloorElevation: number,
        totalCarveWeight: number,
        dominantCarveWeight: number
    ): number {
        if (totalCarveWeight <= 0)
            return this.openGroundElevationAt(localX, localZ, distanceToCarvedGround);

        const carvedFloorElevation =
            weightedFloorElevation / totalCarveWeight +
            this.floorUndulationAt(localX, localZ) * dominantCarveWeight;

        if (dominantCarveWeight >= 1) return carvedFloorElevation;

        return lerp(
            this.openGroundElevationAt(localX, localZ, distanceToCarvedGround),
            carvedFloorElevation,
            dominantCarveWeight
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

    private openGroundElevationAt(
        localX: number,
        localZ: number,
        distanceToCarvedGround: number
    ): number {
        const elevationRampRatio = smoothstep(
            0,
            this.elevationRampDistance,
            distanceToCarvedGround
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

        return TERRAIN.pathLevel + gentleRoll * elevationRampRatio + fineDetailOffset;
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

    return {
        fromX: path.fromX,
        fromZ: path.fromZ,
        spanX,
        spanZ,
        spanLengthSquared: spanX * spanX + spanZ * spanZ,
        halfWidth: path.halfWidth,
        floorElevation: path.floorElevation,
    };
}

function distanceOutsideRegionFloor(x: number, z: number, region: IRegionFloor): number {
    const outsideX = Math.max(Math.abs(x - region.centerX) - region.halfWidth, 0);
    const outsideZ = Math.max(Math.abs(z - region.centerZ) - region.halfDepth, 0);

    return Math.sqrt(outsideX * outsideX + outsideZ * outsideZ);
}

function distanceOutsideCorridor(x: number, z: number, corridor: IPreparedCorridor): number {
    const offsetX = x - corridor.fromX;
    const offsetZ = z - corridor.fromZ;

    const projection =
        corridor.spanLengthSquared === 0
            ? 0
            : clamp(
                  (offsetX * corridor.spanX + offsetZ * corridor.spanZ) /
                      corridor.spanLengthSquared,
                  0,
                  1
              );

    const gapX = offsetX - corridor.spanX * projection;
    const gapZ = offsetZ - corridor.spanZ * projection;

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

export interface ICorridorPath {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
    floorElevation: number;
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
    halfWidth: number;
    floorElevation: number;
}
