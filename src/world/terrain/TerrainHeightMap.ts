import {
    ClampToEdgeWrapping,
    DataTexture,
    DataUtils,
    HalfFloatType,
    LinearFilter,
    RGFormat,
} from "three";
import { TERRAIN } from "@/constants/world";
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
    private readonly carveStrengths: Float32Array;
    private readonly corridorCarves: Float32Array;
    private readonly floorColorIndices: Uint8Array;

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
        this.carveStrengths = new Float32Array(pointCount);
        this.corridorCarves = new Float32Array(pointCount);
        this.floorColorIndices = new Uint8Array(pointCount);

        const sample = createTerrainSample();

        for (let row = 0; row < this.pointsPerSide; row += 1) {
            const localZ = this.originZ + row * this.cellSize;

            for (let column = 0; column < this.pointsPerSide; column += 1) {
                const index = row * this.pointsPerSide + column;
                heightField.sampleInto(this.originX + column * this.cellSize, localZ, sample);

                this.elevations[index] = sample.elevation;
                this.carveStrengths[index] = sample.carveStrength;
                this.corridorCarves[index] = sample.isCorridor ? sample.carveStrength : 0;
                this.floorColorIndices[index] = Math.min(sample.floorColorIndex, 255);
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
        const step = this.cellSize;
        const deltaX =
            this.elevationAt(localX + step, localZ) - this.elevationAt(localX - step, localZ);
        const deltaZ =
            this.elevationAt(localX, localZ + step) - this.elevationAt(localX, localZ - step);

        return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ) / (2 * step);
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

    createShaderTexture(): DataTexture {
        const channels = new Uint16Array(this.elevations.length * 2);

        for (let index = 0; index < this.elevations.length; index += 1) {
            channels[index * 2] = DataUtils.toHalfFloat(this.elevations[index] ?? 0);
            channels[index * 2 + 1] = DataUtils.toHalfFloat(this.corridorCarves[index] ?? 0);
        }

        const texture = new DataTexture(
            channels,
            this.pointsPerSide,
            this.pointsPerSide,
            RGFormat,
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
        const columnPosition = (localX - this.originX) / this.cellSize;
        const rowPosition = (localZ - this.originZ) / this.cellSize;

        const column = this.clampCellIndex(Math.floor(columnPosition));
        const row = this.clampCellIndex(Math.floor(rowPosition));
        const acrossRatio = clamp(columnPosition - column, 0, 1);
        const downRatio = clamp(rowPosition - row, 0, 1);

        const topRow = row * this.pointsPerSide + column;
        const bottomRow = topRow + this.pointsPerSide;

        return lerp(
            lerp(values[topRow] ?? 0, values[topRow + 1] ?? 0, acrossRatio),
            lerp(values[bottomRow] ?? 0, values[bottomRow + 1] ?? 0, acrossRatio),
            downRatio
        );
    }

    private clampCellIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 2);
    }

    private clampPointIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 1);
    }
}
