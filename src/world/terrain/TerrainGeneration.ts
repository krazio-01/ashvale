import type { IRegionFloor, ICorridorPath, IWaterCourse } from "@/types/world";
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
import { createChannelReading, WaterChannel, isCliffCorridor } from "@/world/water/WaterCourse";
import { CorridorClimbStyle } from "@/types/world";

export const WALKABLE_REACH = WORLD_EDGE.flatBorderWidth + WORLD_EDGE.lipWidth;

interface ITerrainSample {
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

type TerrainField = keyof ITerrainFields;

interface ITerrainFields {
    elevation: Float32Array;
    steepness: Float32Array;
    carveStrength: Float32Array;
    trailDistance: Float32Array;
    corridorFlag: Uint8Array;
    nestingDepth: Uint8Array;
    footprintDistance: Float32Array;
    waterDepth: Float32Array;
}

interface IInterpolationWeights {
    acrossRatio: number;
    downRatio: number;
    nearLeftIndex: number;
    farLeftIndex: number;
}

export interface IGridSample {
    elevation: number;
    trailDistance: number;
    steepness: number;
    footprintDistance: number;
    waterDepth: number;
}

export class TerrainHeightField {
    private static readonly GROUND_ACCUMULATOR_DEFAULTS: Readonly<IGroundAccumulator> = {
        dominantCarveWeight: 0,
        weightedFloorElevation: 0,
        totalCarveWeight: 0,
        nearestEdgeDistance: Infinity,
        nearestFloorElevation: TERRAIN.pathLevel,
        nearestFeatureIsCorridor: false,
        influenceWeightedElevation: 0,
        totalInfluenceWeight: 0,
    };

    private static edgeDropAt(footprintDistance: number): number {
        const rolloverRatio = smoothstep(
            WORLD_EDGE.flatBorderWidth,
            WALKABLE_REACH,
            footprintDistance
        );

        if (rolloverRatio <= 0) return 0;

        return -Math.pow(rolloverRatio, WORLD_EDGE.dropCurve) * WORLD_EDGE.dropDepth;
    }

    private static createGroundAccumulator(): IGroundAccumulator {
        return { ...TerrainHeightField.GROUND_ACCUMULATOR_DEFAULTS };
    }

    private static resetGroundAccumulator(ground: IGroundAccumulator): IGroundAccumulator {
        return Object.assign(ground, TerrainHeightField.GROUND_ACCUMULATOR_DEFAULTS);
    }

    private static accumulateFeature(
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

    private static measureNeighbourSpacing(regionFloors: IRegionFloor[]): number {
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

                nearestGap = Math.min(
                    nearestGap,
                    Math.sqrt(edgeGapX * edgeGapX + edgeGapZ * edgeGapZ)
                );
            }

            if (Number.isFinite(nearestGap)) gapsToNearestNeighbour.push(nearestGap);
        }

        if (gapsToNearestNeighbour.length === 0)
            return smallestRegionSpan * LANDFORM.minimumOpennessRatio;

        gapsToNearestNeighbour.sort((first, second) => first - second);

        const medianGap = gapsToNearestNeighbour[Math.floor(gapsToNearestNeighbour.length / 2)];

        return Math.max(medianGap, smallestRegionSpan * LANDFORM.minimumOpennessRatio);
    }

    private static prepareCorridor(path: ICorridorPath): IPreparedCorridor {
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

    private static corridorElevationAt(corridor: IPreparedCorridor, travelRatio: number): number {
        if (corridor.fromElevation === corridor.toElevation) return corridor.fromElevation;

        if (corridor.climbStyle === CorridorClimbStyle.Ramp)
            return lerp(corridor.fromElevation, corridor.toElevation, travelRatio);

        const stepDistance = corridorStepFaceDistance(corridor.spanLength);
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

    private static distanceOutsideRegionFloor(x: number, z: number, region: IRegionFloor): number {
        return distanceOutsideBox(
            x,
            z,
            region.centerX,
            region.centerZ,
            region.halfWidth,
            region.halfDepth
        );
    }

    private static corridorTravelRatioAt(
        x: number,
        z: number,
        corridor: IPreparedCorridor
    ): number {
        if (corridor.spanLengthSquared === 0) return 0;

        return clamp(
            ((x - corridor.fromX) * corridor.spanX + (z - corridor.fromZ) * corridor.spanZ) /
                corridor.spanLengthSquared,
            0,
            1
        );
    }

    private static distanceToCorridorCentreAt(
        x: number,
        z: number,
        corridor: IPreparedCorridor,
        travelRatio: number
    ): number {
        const gapX = x - corridor.fromX - corridor.spanX * travelRatio;
        const gapZ = z - corridor.fromZ - corridor.spanZ * travelRatio;

        return Math.sqrt(gapX * gapX + gapZ * gapZ);
    }

    private readonly regionFloors: IRegionFloor[];
    private readonly preparedCorridors: IPreparedCorridor[];
    private readonly cliffCorridors: IPreparedCorridor[];
    private readonly waterChannel: WaterChannel | null;
    private readonly undulationNoise: FractalNoise;
    private readonly trailEdgeNoise: FractalNoise;
    private readonly elevationRampDistance: number;
    private readonly scratchSample = createTerrainSample();
    private readonly scratchGround = TerrainHeightField.createGroundAccumulator();
    private readonly scratchChannelReading = createChannelReading();

    constructor(
        regionFloors: IRegionFloor[],
        corridorPaths: ICorridorPath[],
        waterCourses: IWaterCourse[] | null,
        seed: number
    ) {
        this.regionFloors = regionFloors;
        this.preparedCorridors = corridorPaths.map(TerrainHeightField.prepareCorridor);
        this.cliffCorridors = this.preparedCorridors.filter(isCliffCorridor);
        this.waterChannel = waterCourses ? WaterChannel.from(waterCourses) : null;
        this.undulationNoise = new FractalNoise(seed);
        this.trailEdgeNoise = new FractalNoise(seed + 11);
        this.elevationRampDistance =
            TerrainHeightField.measureNeighbourSpacing(regionFloors) * LANDFORM.openGroundRampRatio;
    }

    sampleInto(localX: number, localZ: number, sample: ITerrainSample): ITerrainSample {
        const nearestTrailCentreDistance = this.accumulateFeatures(localX, localZ, sample);
        sample.trailDistance = clamp(
            nearestTrailCentreDistance + this.trailEdgeWobbleAt(localX, localZ),
            0,
            TRAIL.distanceLimit
        );
        this.applyGroundElevationTo(sample, localX, localZ);

        return sample;
    }

    elevationAt(localX: number, localZ: number): number {
        const sample = this.scratchSample;
        this.accumulateFeatures(localX, localZ, sample);
        this.applyGroundElevationTo(sample, localX, localZ);
        return sample.elevation;
    }

    footprintDistanceAt(localX: number, localZ: number): number {
        this.accumulateFeatures(localX, localZ, this.scratchSample);
        return this.scratchSample.footprintDistance;
    }

    private accumulateFeatures(localX: number, localZ: number, sample: ITerrainSample): number {
        const ground = TerrainHeightField.resetGroundAccumulator(this.scratchGround);

        sample.nestingDepth = 0;
        sample.isCorridor = false;

        let nearestTrailCentreDistance = Infinity;

        for (const region of this.regionFloors) {
            const carveWeight = TerrainHeightField.accumulateFeature(
                ground,
                region.floorElevation,
                TerrainHeightField.distanceOutsideRegionFloor(localX, localZ, region),
                false
            );

            if (carveWeight > ground.dominantCarveWeight) {
                ground.dominantCarveWeight = carveWeight;
                sample.nestingDepth = region.nestingDepth;
                sample.isCorridor = false;
            }
        }

        for (const corridor of this.preparedCorridors) {
            const travelRatio = TerrainHeightField.corridorTravelRatioAt(localX, localZ, corridor);
            const centreDistance = TerrainHeightField.distanceToCorridorCentreAt(
                localX,
                localZ,
                corridor,
                travelRatio
            );

            if (centreDistance < nearestTrailCentreDistance)
                nearestTrailCentreDistance = centreDistance;

            const carveWeight = TerrainHeightField.accumulateFeature(
                ground,
                TerrainHeightField.corridorElevationAt(corridor, travelRatio) -
                    TERRAIN.corridorDrop,
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
        return nearestTrailCentreDistance;
    }

    private applyGroundElevationTo(sample: ITerrainSample, localX: number, localZ: number): void {
        const ground = this.scratchGround;
        this.applyWaterChannelTo(
            sample,
            localX,
            localZ,
            this.resolveElevationAt(localX, localZ, ground) +
                TerrainHeightField.edgeDropAt(ground.nearestEdgeDistance)
        );
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

        const reading = channel.readInto(localX, localZ, this.scratchChannelReading);
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
        for (const corridor of this.cliffCorridors) {
            const travelRatio = TerrainHeightField.corridorTravelRatioAt(localX, localZ, corridor);
            if (
                TerrainHeightField.distanceToCorridorCentreAt(
                    localX,
                    localZ,
                    corridor,
                    travelRatio
                ) <
                corridor.halfWidth + TERRAIN.waterCliffClearance
            )
                return true;
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

export class TerrainSampleGrid {
    private static growthStopDistanceOf(footprintDistance: number, waterDepth: number): number {
        const fadeStart = WORLD_EDGE.flatBorderWidth - GROUND_COVER.worldEdgeFadeWidth;
        const waterlineApproach = smoothstep(-WATER_CHANNEL.shoreGrassBand, 0, waterDepth);

        return Math.max(
            footprintDistance,
            fadeStart + GROUND_COVER.worldEdgeFadeWidth * waterlineApproach
        );
    }

    readonly span: number;
    readonly originX: number;
    readonly originZ: number;
    readonly cellSize: number;
    readonly pointsPerSide: number;
    readonly cellsPerSide: number;

    private readonly fields: ITerrainFields;
    private readonly interpolationWeights: IInterpolationWeights = {
        acrossRatio: 0,
        downRatio: 0,
        nearLeftIndex: 0,
        farLeftIndex: 0,
    };

    constructor(heightField: TerrainHeightField, outerRadius: number) {
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
        this.fields = {
            elevation: new Float32Array(pointCount),
            steepness: new Float32Array(pointCount),
            carveStrength: new Float32Array(pointCount),
            trailDistance: new Float32Array(pointCount),
            corridorFlag: new Uint8Array(pointCount),
            nestingDepth: new Uint8Array(pointCount),
            footprintDistance: new Float32Array(pointCount),
            waterDepth: new Float32Array(pointCount),
        };

        const sample = createTerrainSample();
        const slopeReach = TERRAIN.macroSlopeGrainWavelengths / TERRAIN_DETAIL.grainNoiseScale / 2;

        for (let row = 0; row < this.pointsPerSide; row += 1) {
            const localZ = this.originZ + row * this.cellSize;

            for (let column = 0; column < this.pointsPerSide; column += 1) {
                const index = row * this.pointsPerSide + column;
                const localX = this.originX + column * this.cellSize;
                heightField.sampleInto(localX, localZ, sample);

                this.fields.elevation[index] = sample.elevation;
                this.fields.carveStrength[index] = sample.carveStrength;
                this.fields.trailDistance[index] = sample.trailDistance;
                this.fields.corridorFlag[index] = sample.isCorridor ? 1 : 0;
                this.fields.nestingDepth[index] = Math.min(sample.nestingDepth, 255);
                this.fields.footprintDistance[index] = sample.footprintDistance;
                this.fields.waterDepth[index] = sample.waterDepth;

                const riseAcross =
                    heightField.elevationAt(localX + slopeReach, localZ) -
                    heightField.elevationAt(localX - slopeReach, localZ);
                const riseAlong =
                    heightField.elevationAt(localX, localZ + slopeReach) -
                    heightField.elevationAt(localX, localZ - slopeReach);

                this.fields.steepness[index] =
                    Math.sqrt(riseAcross * riseAcross + riseAlong * riseAlong) / (2 * slopeReach);
            }
        }
    }

    surfaceElevationAt(localX: number, localZ: number): number {
        return this.sampleTriangleSurface(this.computeInterpolationWeights(localX, localZ));
    }

    steepnessAt(localX: number, localZ: number): number {
        return this.interpolate(this.fields.steepness, localX, localZ);
    }

    sampleAt(localX: number, localZ: number, sample: IGridSample): IGridSample {
        const weights = this.computeInterpolationWeights(localX, localZ);

        sample.elevation = this.sampleTriangleSurface(weights);
        sample.trailDistance = this.interpolateWithWeights(this.fields.trailDistance, weights);
        sample.steepness = this.interpolateWithWeights(this.fields.steepness, weights);
        sample.footprintDistance = this.interpolateWithWeights(
            this.fields.footprintDistance,
            weights
        );
        sample.waterDepth = this.interpolateWithWeights(this.fields.waterDepth, weights);

        return sample;
    }

    valueAtPoint(field: TerrainField, pointIndex: number): number {
        return this.fields[field][pointIndex];
    }

    hasGroundAtPoint(pointIndex: number): boolean {
        return (
            this.valueAtPoint("footprintDistance", pointIndex) <= WALKABLE_REACH &&
            Number.isFinite(this.valueAtPoint("elevation", pointIndex))
        );
    }

    createShaderTexture(): DataTexture {
        const channels = new Uint16Array(this.fields.elevation.length * 4);

        for (let index = 0; index < this.fields.elevation.length; index += 1) {
            const channelStart = index * 4;

            channels[channelStart] = DataUtils.toHalfFloat(this.fields.elevation[index]);
            channels[channelStart + 1] = DataUtils.toHalfFloat(this.fields.trailDistance[index]);
            channels[channelStart + 2] = DataUtils.toHalfFloat(this.fields.steepness[index]);
            channels[channelStart + 3] = DataUtils.toHalfFloat(
                TerrainSampleGrid.growthStopDistanceOf(
                    this.fields.footprintDistance[index],
                    this.fields.waterDepth[index]
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
        const weights = this.interpolationWeights;

        weights.acrossRatio = clamp(columnPosition - column, 0, 1);
        weights.downRatio = clamp(rowPosition - row, 0, 1);
        weights.nearLeftIndex = nearLeftIndex;
        weights.farLeftIndex = nearLeftIndex + this.pointsPerSide;
        return weights;
    }

    private interpolateWithWeights(values: Float32Array, weights: IInterpolationWeights): number {
        const { nearLeftIndex, farLeftIndex, acrossRatio, downRatio } = weights;

        return lerp(
            lerp(values[nearLeftIndex], values[nearLeftIndex + 1], acrossRatio),
            lerp(values[farLeftIndex], values[farLeftIndex + 1], acrossRatio),
            downRatio
        );
    }

    private sampleTriangleSurface(weights: IInterpolationWeights): number {
        const { nearLeftIndex, farLeftIndex, acrossRatio, downRatio } = weights;

        const nearLeft = this.fields.elevation[nearLeftIndex];
        const nearRight = this.fields.elevation[nearLeftIndex + 1];
        const farLeft = this.fields.elevation[farLeftIndex];

        if (acrossRatio + downRatio <= 1)
            return (
                nearLeft + (nearRight - nearLeft) * acrossRatio + (farLeft - nearLeft) * downRatio
            );

        const farRight = this.fields.elevation[farLeftIndex + 1];

        return (
            farRight +
            (farLeft - farRight) * (1 - acrossRatio) +
            (nearRight - farRight) * (1 - downRatio)
        );
    }

    private clampCellIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 2);
    }
}

function createTerrainSample(): ITerrainSample {
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

export function corridorStepFaceDistance(spanLength: number): number {
    return spanLength * TERRAIN.corridorStepRatio;
}

export function createGridSample(): IGridSample {
    return {
        elevation: 0,
        trailDistance: TRAIL.distanceLimit,
        steepness: 0,
        footprintDistance: 0,
        waterDepth: WATER_CHANNEL.dryDepth,
    };
}
