import type { ITerrainProfile } from "@/types/theme";
import { LANDFORM, TERRAIN, TERRAIN_DETAIL } from "@/constants/world";
import { clamp, lerp, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";

export class TerrainHeightField {
    private readonly profile: ITerrainProfile;
    private readonly regionFloors: IRegionFloor[];
    private readonly preparedCorridors: IPreparedCorridor[];
    private readonly mountainNoise: FractalNoise;
    private readonly undulationNoise: FractalNoise;
    private readonly elevationRampDistance: number;
    private readonly mountainRampStartDistance: number;
    private readonly mountainRampEndDistance: number;
    private readonly terraceStepHeight: number;
    private readonly boundaryWallStartRadius: number;
    private readonly boundaryWallEndRadius: number;
    private readonly boundaryWallHeight: number;
    private readonly inverseFeatureSize: number;
    private readonly scratchSample = createTerrainSample();

    constructor(
        profile: ITerrainProfile,
        playRadius: number,
        regionFloors: IRegionFloor[],
        corridorPaths: ICorridorPath[],
        seed: number
    ) {
        this.profile = profile;
        this.regionFloors = regionFloors;
        this.preparedCorridors = corridorPaths.map(prepareCorridor);
        this.mountainNoise = new FractalNoise(seed);
        this.undulationNoise = new FractalNoise(seed + 1);
        this.inverseFeatureSize = 1 / profile.featureSize;

        const neighbourSpacing = measureNeighbourSpacing(regionFloors);
        this.elevationRampDistance = neighbourSpacing * LANDFORM.wildRampRatio;
        this.mountainRampStartDistance = neighbourSpacing * LANDFORM.mountainRampStartRatio;
        this.mountainRampEndDistance = neighbourSpacing * LANDFORM.mountainRampEndRatio;
        this.terraceStepHeight = profile.mountainHeight / LANDFORM.terraceBandCount;

        const outerRadius = playRadius + TERRAIN.transition + TERRAIN.spread;
        this.boundaryWallStartRadius = outerRadius * LANDFORM.rampartStartRatio;
        this.boundaryWallEndRadius = outerRadius;
        this.boundaryWallHeight = profile.mountainHeight * LANDFORM.rampartHeightRatio;
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
        sample.elevation = this.resolveElevationAt(
            localX,
            localZ,
            distanceToCarvedGround,
            weightedFloorElevation,
            totalCarveWeight,
            dominantCarveWeight
        );

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
            return this.wildGroundElevationAt(localX, localZ, distanceToCarvedGround);

        const carvedFloorElevation =
            weightedFloorElevation / totalCarveWeight +
            this.floorUndulationAt(localX, localZ) * dominantCarveWeight;

        if (dominantCarveWeight >= 1) return carvedFloorElevation;

        return lerp(
            this.wildGroundElevationAt(localX, localZ, distanceToCarvedGround),
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

    private wildGroundElevationAt(
        localX: number,
        localZ: number,
        distanceToCarvedGround: number
    ): number {
        const baseGroundElevation = this.baseGroundElevationAt(
            localX,
            localZ,
            distanceToCarvedGround
        );
        const distanceFromCenter = Math.sqrt(localX * localX + localZ * localZ);
        const boundaryWallFloor = this.boundaryWallFloorAt(baseGroundElevation, distanceFromCenter);

        const mountainRampRatio = smoothstep(
            this.mountainRampStartDistance,
            this.mountainRampEndDistance,
            distanceToCarvedGround
        );

        if (mountainRampRatio <= 0) return Math.max(baseGroundElevation, boundaryWallFloor);

        const fadedMountainElevation = this.mountainElevationAt(
            localX,
            localZ,
            distanceFromCenter,
            baseGroundElevation,
            mountainRampRatio
        );

        const terracedElevation = this.terracedBlendOf(fadedMountainElevation, baseGroundElevation);

        return Math.max(terracedElevation, boundaryWallFloor);
    }

    private baseGroundElevationAt(
        localX: number,
        localZ: number,
        distanceToCarvedGround: number
    ): number {
        const elevationRampRatio = smoothstep(
            0,
            this.elevationRampDistance,
            distanceToCarvedGround
        );

        const groundUndulationSample = this.undulationNoise.sample(
            localX * TERRAIN.wildReliefScale,
            localZ * TERRAIN.wildReliefScale,
            3,
            0.5
        );

        const fineDetailOffset =
            (this.undulationNoise.sample(
                localX * TERRAIN_DETAIL.grainNoiseScale,
                localZ * TERRAIN_DETAIL.grainNoiseScale,
                2,
                0.5
            ) -
                0.5) *
            TERRAIN_DETAIL.grainNoiseHeight;

        return (
            TERRAIN.pathLevel +
            (this.profile.wildElevation + groundUndulationSample * this.profile.wildRelief) *
                elevationRampRatio +
            fineDetailOffset
        );
    }

    private boundaryWallFloorAt(baseGroundElevation: number, distanceFromCenter: number): number {
        return (
            baseGroundElevation +
            this.boundaryWallHeight *
                smoothstep(
                    this.boundaryWallStartRadius,
                    this.boundaryWallEndRadius,
                    distanceFromCenter
                )
        );
    }

    private mountainElevationAt(
        localX: number,
        localZ: number,
        distanceFromCenter: number,
        baseGroundElevation: number,
        mountainRampRatio: number
    ): number {
        const mountainNoiseX = localX * this.inverseFeatureSize;
        const mountainNoiseZ = localZ * this.inverseFeatureSize;
        const mountainShapeNoise = lerp(
            this.mountainNoise.sample(mountainNoiseX, mountainNoiseZ, 5, 0.5),
            this.mountainNoise.sampleRidged(mountainNoiseX, mountainNoiseZ, 4, 0.5),
            this.profile.ruggedness
        );

        const rawMountainElevation =
            baseGroundElevation +
            Math.pow(mountainShapeNoise, TERRAIN.peakShaping) *
                this.profile.mountainHeight *
                this.enclosureFactorAt(localX, localZ, distanceFromCenter);

        return lerp(
            baseGroundElevation,
            Math.max(rawMountainElevation, baseGroundElevation),
            mountainRampRatio
        );
    }

    private terracedBlendOf(fadedMountainElevation: number, baseGroundElevation: number): number {
        const terraceBlend = smoothstep(
            0,
            this.terraceStepHeight * LANDFORM.terraceOnsetRatio,
            fadedMountainElevation - baseGroundElevation
        );

        return lerp(
            fadedMountainElevation,
            this.terracedElevationOf(fadedMountainElevation),
            LANDFORM.terraceStrength * terraceBlend
        );
    }

    private terracedElevationOf(elevation: number): number {
        const stepLevel = (elevation - TERRAIN.pathLevel) / this.terraceStepHeight;
        const stepBand = Math.floor(stepLevel);
        const riserBlend = smoothstep(
            0.5 - LANDFORM.terraceRiserWidth,
            0.5 + LANDFORM.terraceRiserWidth,
            stepLevel - stepBand
        );

        return TERRAIN.pathLevel + (stepBand + riserBlend) * this.terraceStepHeight;
    }

    private enclosureFactorAt(localX: number, localZ: number, distanceFromCenter: number): number {
        if (distanceFromCenter <= 0) return 1;

        const bearingScale = LANDFORM.vistaGapScale / distanceFromCenter;
        const vistaGapSample = this.undulationNoise.sample(
            localX * bearingScale,
            localZ * bearingScale,
            2,
            0.5
        );

        const [gapOpensBelow, gapClosesAbove] = LANDFORM.vistaGapRange;

        return lerp(
            1 - LANDFORM.vistaGapDepth,
            1,
            smoothstep(gapOpensBelow, gapClosesAbove, vistaGapSample)
        );
    }
}

export function createTerrainSample(): ITerrainSample {
    return { elevation: 0, carveStrength: 0, floorColorIndex: 0, isCorridor: false };
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
