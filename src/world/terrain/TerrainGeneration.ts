import {
    ClampToEdgeWrapping,
    DataTexture,
    DataUtils,
    HalfFloatType,
    LinearFilter,
    RGBAFormat,
} from "three";
import {
    LANDFORM,
    TERRAIN,
    TERRAIN_DETAIL,
    TRAIL,
    WATER_CHANNEL,
    WORLD_EDGE,
} from "@/constants/world";
import { GROUND_COVER } from "@/constants/placement";
import { clamp, distanceOutsideBox, lerp, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";
import { createChannelReading, WaterChannel } from "@/world/water/WaterChannel";
import type { IWaterCourse } from "@/world/water/WaterCourse";

export const WALKABLE_REACH = WORLD_EDGE.groundApron + WORLD_EDGE.lipWidth;

export class TerrainGenerator {
    private readonly regionFloors: IRegionFloor[];
    private readonly preparedCorridors: IPreparedCorridor[];
    private readonly waterChannel: WaterChannel | null;
    private readonly undulationNoise: FractalNoise;
    private readonly trailEdgeNoise: FractalNoise;
    private readonly elevationRampDistance: number;
    private readonly scratchSample = createTerrainSample();
    private readonly scratchGround = createGroundAccumulator();
    private readonly scratchChannel = createChannelReading();

    constructor(
        regionFloors: IRegionFloor[],
        corridorPaths: ICorridorPath[],
        waterCourses: IWaterCourse[] | IWaterCourse | null,
        seed: number
    ) {
        this.regionFloors = regionFloors;
        this.preparedCorridors = corridorPaths.map(prepareCorridor);
        this.waterChannel = waterCourses ? WaterChannel.from(waterCourses) : null;
        this.undulationNoise = new FractalNoise(seed);
        this.trailEdgeNoise = new FractalNoise(seed + 11);
        this.elevationRampDistance =
            measureNeighbourSpacing(regionFloors) * LANDFORM.openGroundRampRatio;
    }

    sampleInto(localX: number, localZ: number, sample: ITerrainSample): ITerrainSample {
        const ground = resetGroundAccumulator(this.scratchGround);

        sample.nestingDepth = 0;
        sample.isCorridor = false;

        let nearestTrailCentreDistance = Infinity;

        for (const region of this.regionFloors) {
            const carveWeight = accumulateFeature(
                ground,
                region.floorElevation,
                distanceOutsideRegionFloor(localX, localZ, region),
                false
            );

            if (carveWeight > ground.dominantCarveWeight) {
                ground.dominantCarveWeight = carveWeight;
                sample.nestingDepth = region.nestingDepth;
                sample.isCorridor = false;
            }
        }

        for (const corridor of this.preparedCorridors) {
            const travelRatio = corridorTravelRatioAt(localX, localZ, corridor);
            const centreDistance = distanceToCorridorCentreAt(
                localX,
                localZ,
                corridor,
                travelRatio
            );

            if (centreDistance < nearestTrailCentreDistance)
                nearestTrailCentreDistance = centreDistance;

            const carveWeight = accumulateFeature(
                ground,
                corridorElevationAt(corridor, travelRatio) - TERRAIN.corridorDrop,
                Math.max(centreDistance - corridor.halfWidth, 0),
                true
            );

            if (carveWeight > ground.dominantCarveWeight) {
                ground.dominantCarveWeight = carveWeight;
                sample.isCorridor = true;
            }
        }

        sample.carveStrength = ground.dominantCarveWeight;
        sample.footprintDistance = ground.nearestEdgeDistance;
        sample.trailDistance = clamp(
            nearestTrailCentreDistance + this.trailEdgeWobbleAt(localX, localZ),
            0,
            TRAIL.distanceLimit
        );
        this.applyWaterChannelTo(
            sample,
            localX,
            localZ,
            this.resolveElevationAt(localX, localZ, ground) + edgeDropAt(ground.nearestEdgeDistance)
        );

        return sample;
    }

    elevationAt(localX: number, localZ: number): number {
        return this.sampleInto(localX, localZ, this.scratchSample).elevation;
    }

    footprintDistanceAt(localX: number, localZ: number): number {
        return this.sampleInto(localX, localZ, this.scratchSample).footprintDistance;
    }

    private applyWaterChannelTo(
        sample: ITerrainSample,
        localX: number,
        localZ: number,
        groundElevation: number
    ): void {
        sample.elevation = groundElevation;
        sample.waterDepth = WATER_CHANNEL.dryDepth;

        const channel = this.waterChannel;
        if (!channel) return;

        const reading = channel.readInto(localX, localZ, this.scratchChannel);
        if (reading.bankBlend <= 0 || this.isCliffCorridorAt(localX, localZ)) return;

        const bedElevation =
            reading.waterlineElevation - WATER_CHANNEL.bedDepth * reading.bedProfile;

        sample.elevation = lerp(groundElevation, bedElevation, reading.bankBlend);
        sample.waterDepth = Math.max(
            reading.waterlineElevation - sample.elevation,
            WATER_CHANNEL.dryDepth
        );
    }

    private isCliffCorridorAt(localX: number, localZ: number): boolean {
        for (const corridor of this.preparedCorridors) {
            if (Math.abs(corridor.toElevation - corridor.fromElevation) <= 1.5) continue;
            const travelRatio = corridorTravelRatioAt(localX, localZ, corridor);
            const spanX = corridor.spanX;
            const spanZ = corridor.spanZ;
            const dist = Math.hypot(
                localX - corridor.fromX - spanX * travelRatio,
                localZ - corridor.fromZ - spanZ * travelRatio
            );
            if (dist < corridor.halfWidth + 5.0) return true;
        }
        return false;
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

    private trailEdgeWobbleAt(localX: number, localZ: number): number {
        const wobbleSample = this.trailEdgeNoise.sample(
            localX * TRAIL.edgeWobbleScale,
            localZ * TRAIL.edgeWobbleScale,
            2,
            0.5
        );

        return (wobbleSample - 0.5) * 2 * TRAIL.edgeWobbleAmplitude;
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
        trailDistance: TRAIL.distanceLimit,
        nestingDepth: 0,
        isCorridor: false,
        footprintDistance: 0,
        waterDepth: WATER_CHANNEL.dryDepth,
    };
}

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
    return distanceOutsideBox(
        x,
        z,
        region.centerX,
        region.centerZ,
        region.halfWidth,
        region.halfDepth
    );
}

function corridorTravelRatioAt(x: number, z: number, corridor: IPreparedCorridor): number {
    if (corridor.spanLengthSquared === 0) return 0;

    return clamp(
        ((x - corridor.fromX) * corridor.spanX + (z - corridor.fromZ) * corridor.spanZ) /
            corridor.spanLengthSquared,
        0,
        1
    );
}

function distanceToCorridorCentreAt(
    x: number,
    z: number,
    corridor: IPreparedCorridor,
    travelRatio: number
): number {
    const gapX = x - corridor.fromX - corridor.spanX * travelRatio;
    const gapZ = z - corridor.fromZ - corridor.spanZ * travelRatio;

    return Math.sqrt(gapX * gapX + gapZ * gapZ);
}

export interface IRegionFloor {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
    floorElevation: number;
    nestingDepth: number;
    isBossRegion?: boolean;
    isSpawnRegion?: boolean;
}

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
    trailDistance: number;
    nestingDepth: number;
    isCorridor: boolean;
    footprintDistance: number;
    waterDepth: number;
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
export class TerrainSampleGrid {
    readonly span: number;
    readonly originX: number;
    readonly originZ: number;
    readonly cellSize: number;
    readonly pointsPerSide: number;
    readonly cellsPerSide: number;

    private readonly elevations: Float32Array;
    private readonly steepnesses: Float32Array;
    private readonly carveStrengths: Float32Array;
    private readonly trailDistances: Float32Array;
    private readonly corridorDominates: Uint8Array;
    private readonly nestingDepths: Uint8Array;
    private readonly footprintDistances: Float32Array;
    private readonly waterDepths: Float32Array;

    constructor(heightField: TerrainGenerator, outerRadius: number) {
        this.span = outerRadius * 2;
        this.originX = -outerRadius;
        this.originZ = -outerRadius;
        this.cellsPerSide = clamp(
            Math.round(this.span / TERRAIN.targetCellSize),
            TERRAIN.minimumResolution,
            TERRAIN.maximumResolution
        );
        this.cellSize = this.span / this.cellsPerSide;
        this.pointsPerSide = this.cellsPerSide + 1;

        const pointCount = this.pointsPerSide * this.pointsPerSide;
        this.elevations = new Float32Array(pointCount);
        this.steepnesses = new Float32Array(pointCount);
        this.carveStrengths = new Float32Array(pointCount);
        this.trailDistances = new Float32Array(pointCount);
        this.corridorDominates = new Uint8Array(pointCount);
        this.nestingDepths = new Uint8Array(pointCount);
        this.footprintDistances = new Float32Array(pointCount);
        this.waterDepths = new Float32Array(pointCount);

        const sample = createTerrainSample();
        const slopeReach = TERRAIN.macroSlopeGrainWavelengths / TERRAIN_DETAIL.grainNoiseScale / 2;

        for (let row = 0; row < this.pointsPerSide; row += 1) {
            const localZ = this.originZ + row * this.cellSize;

            for (let column = 0; column < this.pointsPerSide; column += 1) {
                const index = row * this.pointsPerSide + column;
                const localX = this.originX + column * this.cellSize;
                heightField.sampleInto(localX, localZ, sample);

                this.elevations[index] = sample.elevation;
                this.carveStrengths[index] = sample.carveStrength;
                this.trailDistances[index] = sample.trailDistance;
                this.corridorDominates[index] = sample.isCorridor ? 1 : 0;
                this.nestingDepths[index] = Math.min(sample.nestingDepth, 255);
                this.footprintDistances[index] = sample.footprintDistance;
                this.waterDepths[index] = sample.waterDepth;

                const riseAcross =
                    heightField.elevationAt(localX + slopeReach, localZ) -
                    heightField.elevationAt(localX - slopeReach, localZ);
                const riseAlong =
                    heightField.elevationAt(localX, localZ + slopeReach) -
                    heightField.elevationAt(localX, localZ - slopeReach);

                this.steepnesses[index] =
                    Math.sqrt(riseAcross * riseAcross + riseAlong * riseAlong) / (2 * slopeReach);
            }
        }
    }

    surfaceElevationAt(localX: number, localZ: number): number {
        return this.sampleTriangleSurface(this.computeInterpolationWeights(localX, localZ));
    }

    carveStrengthAt(localX: number, localZ: number): number {
        return this.interpolate(this.carveStrengths, localX, localZ);
    }

    steepnessAt(localX: number, localZ: number): number {
        return this.interpolate(this.steepnesses, localX, localZ);
    }

    sampleAt(localX: number, localZ: number, sample: IGridSample): IGridSample {
        const weights = this.computeInterpolationWeights(localX, localZ);

        sample.elevation = this.sampleTriangleSurface(weights);
        sample.carveStrength = this.interpolateWithWeights(this.carveStrengths, weights);
        sample.trailDistance = this.interpolateWithWeights(this.trailDistances, weights);
        sample.steepness = this.interpolateWithWeights(this.steepnesses, weights);
        sample.footprintDistance = this.interpolateWithWeights(this.footprintDistances, weights);
        sample.waterDepth = this.interpolateWithWeights(this.waterDepths, weights);

        return sample;
    }

    nearestPointIndex(localX: number, localZ: number): number {
        const column = this.clampPointIndex(Math.round((localX - this.originX) / this.cellSize));
        const row = this.clampPointIndex(Math.round((localZ - this.originZ) / this.cellSize));

        return row * this.pointsPerSide + column;
    }

    elevationAtPoint(pointIndex: number): number {
        return this.elevations[pointIndex] ?? 0;
    }

    carveStrengthAtPoint(pointIndex: number): number {
        return this.carveStrengths[pointIndex] ?? 0;
    }

    trailDistanceAtPoint(pointIndex: number): number {
        return this.trailDistances[pointIndex] ?? TRAIL.distanceLimit;
    }

    steepnessAtPoint(pointIndex: number): number {
        return this.steepnesses[pointIndex] ?? 0;
    }

    isCorridorAtPoint(pointIndex: number): boolean {
        return (this.corridorDominates[pointIndex] ?? 0) === 1;
    }

    nestingDepthAtPoint(pointIndex: number): number {
        return this.nestingDepths[pointIndex] ?? 0;
    }

    footprintDistanceAtPoint(pointIndex: number): number {
        return this.footprintDistances[pointIndex] ?? Infinity;
    }

    waterDepthAtPoint(pointIndex: number): number {
        return this.waterDepths[pointIndex] ?? WATER_CHANNEL.dryDepth;
    }

    hasGroundAtPoint(pointIndex: number): boolean {
        return (
            this.footprintDistanceAtPoint(pointIndex) <= WALKABLE_REACH &&
            Number.isFinite(this.elevationAtPoint(pointIndex))
        );
    }

    createShaderTexture(): DataTexture {
        const channels = new Uint16Array(this.elevations.length * 4);

        for (let index = 0; index < this.elevations.length; index += 1) {
            const channelStart = index * 4;

            channels[channelStart] = DataUtils.toHalfFloat(this.elevations[index] ?? 0);
            channels[channelStart + 1] = DataUtils.toHalfFloat(
                this.trailDistances[index] ?? TRAIL.distanceLimit
            );
            channels[channelStart + 2] = DataUtils.toHalfFloat(this.steepnesses[index] ?? 0);
            channels[channelStart + 3] = DataUtils.toHalfFloat(
                growthStopDistanceOf(
                    this.footprintDistances[index] ?? 0,
                    this.waterDepths[index] ?? WATER_CHANNEL.dryDepth
                )
            );
        }

        const texture = new DataTexture(
            channels,
            this.pointsPerSide,
            this.pointsPerSide,
            RGBAFormat,
            HalfFloatType
        );

        texture.magFilter = LinearFilter;
        texture.minFilter = LinearFilter;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        return texture;
    }

    private interpolate(values: Float32Array, localX: number, localZ: number): number {
        return this.interpolateWithWeights(
            values,
            this.computeInterpolationWeights(localX, localZ)
        );
    }

    private computeInterpolationWeights(localX: number, localZ: number): IInterpolationWeights {
        const columnPosition = (localX - this.originX) / this.cellSize;
        const rowPosition = (localZ - this.originZ) / this.cellSize;

        const column = this.clampCellIndex(Math.floor(columnPosition));
        const row = this.clampCellIndex(Math.floor(rowPosition));
        const nearLeftIndex = row * this.pointsPerSide + column;

        return {
            acrossRatio: clamp(columnPosition - column, 0, 1),
            downRatio: clamp(rowPosition - row, 0, 1),
            nearLeftIndex,
            farLeftIndex: nearLeftIndex + this.pointsPerSide,
        };
    }

    private interpolateWithWeights(values: Float32Array, weights: IInterpolationWeights): number {
        const { nearLeftIndex, farLeftIndex, acrossRatio, downRatio } = weights;

        return lerp(
            lerp(values[nearLeftIndex] ?? 0, values[nearLeftIndex + 1] ?? 0, acrossRatio),
            lerp(values[farLeftIndex] ?? 0, values[farLeftIndex + 1] ?? 0, acrossRatio),
            downRatio
        );
    }

    private sampleTriangleSurface(weights: IInterpolationWeights): number {
        const { nearLeftIndex, farLeftIndex, acrossRatio, downRatio } = weights;

        const nearLeft = this.elevations[nearLeftIndex] ?? 0;
        const nearRight = this.elevations[nearLeftIndex + 1] ?? 0;
        const farLeft = this.elevations[farLeftIndex] ?? 0;

        if (acrossRatio + downRatio <= 1)
            return (
                nearLeft + (nearRight - nearLeft) * acrossRatio + (farLeft - nearLeft) * downRatio
            );

        const farRight = this.elevations[farLeftIndex + 1] ?? 0;

        return (
            farRight +
            (farLeft - farRight) * (1 - acrossRatio) +
            (nearRight - farRight) * (1 - downRatio)
        );
    }

    private clampCellIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 2);
    }

    private clampPointIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 1);
    }
}

function growthStopDistanceOf(footprintDistance: number, waterDepth: number): number {
    const fadeStart = WORLD_EDGE.groundApron - GROUND_COVER.worldEdgeFadeWidth;
    const waterlineApproach = smoothstep(-WATER_CHANNEL.shoreGrassBand, 0, waterDepth);

    return Math.max(
        footprintDistance,
        fadeStart + GROUND_COVER.worldEdgeFadeWidth * waterlineApproach
    );
}

interface IInterpolationWeights {
    acrossRatio: number;
    downRatio: number;
    nearLeftIndex: number;
    farLeftIndex: number;
}

export interface IGridSample {
    elevation: number;
    carveStrength: number;
    trailDistance: number;
    steepness: number;
    footprintDistance: number;
    waterDepth: number;
}

export function createGridSample(): IGridSample {
    return {
        elevation: 0,
        carveStrength: 0,
        trailDistance: TRAIL.distanceLimit,
        steepness: 0,
        footprintDistance: 0,
        waterDepth: WATER_CHANNEL.dryDepth,
    };
}
