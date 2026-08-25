import { lerp } from "@/lib/helpers";
import type { ITerrainSample, TerrainHeightField } from "@/world/TerrainHeightField";

interface IGridCoordinate {
    column: number;
    row: number;
    acrossRatio: number;
    downRatio: number;
}

export class TerrainSampleGrid {
    private readonly samples: ITerrainSample[];
    private readonly originX: number;
    private readonly originZ: number;
    private readonly spacing: number;
    private readonly pointsPerSide: number;

    constructor(
        heightField: TerrainHeightField,
        originX: number,
        originZ: number,
        size: number,
        spacing: number
    ) {
        this.originX = originX;
        this.originZ = originZ;
        this.spacing = spacing;
        this.pointsPerSide = Math.max(Math.ceil(size / spacing) + 1, 2);
        this.samples = [];

        for (let row = 0; row < this.pointsPerSide; row += 1)
            for (let column = 0; column < this.pointsPerSide; column += 1)
                this.samples.push(
                    heightField.sampleTerrainAt(originX + column * spacing, originZ + row * spacing)
                );
    }

    sampleTerrainAt(localX: number, localZ: number): ITerrainSample {
        const { column, row, acrossRatio, downRatio } = this.coordinateAt(localX, localZ);

        const topLeft = this.cornerAt(column, row);
        const topRight = this.cornerAt(column + 1, row);
        const bottomLeft = this.cornerAt(column, row + 1);
        const bottomRight = this.cornerAt(column + 1, row + 1);

        const nearest = this.cornerAt(
            column + (acrossRatio < 0.5 ? 0 : 1),
            row + (downRatio < 0.5 ? 0 : 1)
        );

        return {
            elevation: lerp(
                lerp(topLeft.elevation, topRight.elevation, acrossRatio),
                lerp(bottomLeft.elevation, bottomRight.elevation, acrossRatio),
                downRatio
            ),
            carveStrength: lerp(
                lerp(topLeft.carveStrength, topRight.carveStrength, acrossRatio),
                lerp(bottomLeft.carveStrength, bottomRight.carveStrength, acrossRatio),
                downRatio
            ),
            floorColorIndex: nearest.floorColorIndex,
            isCorridor: nearest.isCorridor,
        };
    }

    elevationAt(localX: number, localZ: number): number {
        const { column, row, acrossRatio, downRatio } = this.coordinateAt(localX, localZ);

        return lerp(
            lerp(
                this.cornerAt(column, row).elevation,
                this.cornerAt(column + 1, row).elevation,
                acrossRatio
            ),
            lerp(
                this.cornerAt(column, row + 1).elevation,
                this.cornerAt(column + 1, row + 1).elevation,
                acrossRatio
            ),
            downRatio
        );
    }

    steepnessAt(localX: number, localZ: number): number {
        const step = this.spacing;
        const deltaX =
            this.elevationAt(localX + step, localZ) - this.elevationAt(localX - step, localZ);
        const deltaZ =
            this.elevationAt(localX, localZ + step) - this.elevationAt(localX, localZ - step);

        return Math.hypot(deltaX, deltaZ) / (2 * step);
    }

    private coordinateAt(localX: number, localZ: number): IGridCoordinate {
        const columnPosition = (localX - this.originX) / this.spacing;
        const rowPosition = (localZ - this.originZ) / this.spacing;

        const column = this.clampBaseIndex(Math.floor(columnPosition));
        const row = this.clampBaseIndex(Math.floor(rowPosition));

        return {
            column,
            row,
            acrossRatio: columnPosition - column,
            downRatio: rowPosition - row,
        };
    }

    private cornerAt(column: number, row: number): ITerrainSample {
        return this.samples[row * this.pointsPerSide + column]!;
    }

    private clampBaseIndex(value: number): number {
        return Math.min(Math.max(value, 0), this.pointsPerSide - 2);
    }
}
