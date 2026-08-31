import {
    ClampToEdgeWrapping,
    DataTexture,
    DataUtils,
    HalfFloatType,
    LinearFilter,
    RGBAFormat,
} from "three";
import { TERRAIN, TERRAIN_DETAIL } from "@/constants/world";
import { clamp, lerp } from "@/lib/helpers";
import { createTerrainSample, type TerrainHeightField } from "@/world/terrain/TerrainHeightField";

export class TerrainHeightMap {
    readonly span: number;
    readonly originX: number;
    readonly originZ: number;
    readonly cellSize: number;
    readonly pointsPerSide: number;
    readonly cellsPerSide: number;

    private readonly elevations: Float32Array;
    private readonly steepnesses: Float32Array;
    private readonly carveStrengths: Float32Array;
    private readonly corridorCarves: Float32Array;
    private readonly floorColorIndices: Uint8Array;
    private readonly footprintDistances: Float32Array;

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
        this.elevations = new Float32Array(pointCount);
        this.steepnesses = new Float32Array(pointCount);
        this.carveStrengths = new Float32Array(pointCount);
        this.corridorCarves = new Float32Array(pointCount);
        this.floorColorIndices = new Uint8Array(pointCount);
        this.footprintDistances = new Float32Array(pointCount);

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
                this.corridorCarves[index] = sample.isCorridor ? sample.carveStrength : 0;
                this.floorColorIndices[index] = Math.min(sample.floorColorIndex, 255);
                this.footprintDistances[index] = sample.footprintDistance;

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

    elevationAt(localX: number, localZ: number): number {
        return this.interpolate(this.elevations, localX, localZ);
    }

    carveStrengthAt(localX: number, localZ: number): number {
        return this.interpolate(this.carveStrengths, localX, localZ);
    }

    corridorCarveAt(localX: number, localZ: number): number {
        return this.interpolate(this.corridorCarves, localX, localZ);
    }

    steepnessAt(localX: number, localZ: number): number {
        return this.interpolate(this.steepnesses, localX, localZ);
    }

    sampleAt(localX: number, localZ: number, sample: IHeightMapSample): IHeightMapSample {
        const weights = this.computeInterpolationWeights(localX, localZ);

        sample.elevation = this.interpolateWithWeights(this.elevations, weights);
        sample.carveStrength = this.interpolateWithWeights(this.carveStrengths, weights);
        sample.corridorCarve = this.interpolateWithWeights(this.corridorCarves, weights);
        sample.steepness = this.interpolateWithWeights(this.steepnesses, weights);
        sample.footprintDistance = this.interpolateWithWeights(this.footprintDistances, weights);

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

    isCorridorAtPoint(pointIndex: number): boolean {
        return (this.corridorCarves[pointIndex] ?? 0) > 0;
    }

    floorColorIndexAtPoint(pointIndex: number): number {
        return this.floorColorIndices[pointIndex] ?? 0;
    }

    footprintDistanceAtPoint(pointIndex: number): number {
        return this.footprintDistances[pointIndex] ?? Infinity;
    }

    createShaderTexture(): DataTexture {
        const channels = new Uint16Array(this.elevations.length * 4);

        for (let index = 0; index < this.elevations.length; index += 1) {
            const channelStart = index * 4;

            channels[channelStart] = DataUtils.toHalfFloat(this.elevations[index] ?? 0);
            channels[channelStart + 1] = DataUtils.toHalfFloat(this.corridorCarves[index] ?? 0);
            channels[channelStart + 2] = DataUtils.toHalfFloat(this.steepnesses[index] ?? 0);
            channels[channelStart + 3] = DataUtils.toHalfFloat(this.footprintDistances[index] ?? 0);
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
        const topRow = row * this.pointsPerSide + column;

        return {
            acrossRatio: clamp(columnPosition - column, 0, 1),
            downRatio: clamp(rowPosition - row, 0, 1),
            topRow,
            bottomRow: topRow + this.pointsPerSide,
        };
    }

    private interpolateWithWeights(values: Float32Array, weights: IInterpolationWeights): number {
        return lerp(
            lerp(values[weights.topRow] ?? 0, values[weights.topRow + 1] ?? 0, weights.acrossRatio),
            lerp(
                values[weights.bottomRow] ?? 0,
                values[weights.bottomRow + 1] ?? 0,
                weights.acrossRatio
            ),
            weights.downRatio
        );
    }

    private clampCellIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 2);
    }

    private clampPointIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 1);
    }
}

interface IInterpolationWeights {
    acrossRatio: number;
    downRatio: number;
    topRow: number;
    bottomRow: number;
}

export interface IHeightMapSample {
    elevation: number;
    carveStrength: number;
    corridorCarve: number;
    steepness: number;
    footprintDistance: number;
}

export function createHeightMapSample(): IHeightMapSample {
    return { elevation: 0, carveStrength: 0, corridorCarve: 0, steepness: 0, footprintDistance: 0 };
}
