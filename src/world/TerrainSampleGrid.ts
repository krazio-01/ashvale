import { lerp } from "@/lib/helpers";
import type { ITerrainSample, TerrainHeightField } from "@/world/TerrainHeightField";

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
                    heightField.sampleAt(originX + column * spacing, originZ + row * spacing)
                );
    }

    sampleAt(localX: number, localZ: number): ITerrainSample {
        const columnPosition = (localX - this.originX) / this.spacing;
        const rowPosition = (localZ - this.originZ) / this.spacing;

        const column = this.clampBaseIndex(Math.floor(columnPosition));
        const row = this.clampBaseIndex(Math.floor(rowPosition));
        const acrossRatio = columnPosition - column;
        const downRatio = rowPosition - row;

        const topLeft = this.cornerAt(column, row);
        const topRight = this.cornerAt(column + 1, row);
        const bottomLeft = this.cornerAt(column, row + 1);
        const bottomRight = this.cornerAt(column + 1, row + 1);

        const nearest = this.cornerAt(
            column + (acrossRatio < 0.5 ? 0 : 1),
            row + (downRatio < 0.5 ? 0 : 1)
        );

        return {
            height: lerp(
                lerp(topLeft.height, topRight.height, acrossRatio),
                lerp(bottomLeft.height, bottomRight.height, acrossRatio),
                downRatio
            ),
            flatWeight: lerp(
                lerp(topLeft.flatWeight, topRight.flatWeight, acrossRatio),
                lerp(bottomLeft.flatWeight, bottomRight.flatWeight, acrossRatio),
                downRatio
            ),
            floorColorIndex: nearest.floorColorIndex,
            isCorridor: nearest.isCorridor,
        };
    }

    private cornerAt(column: number, row: number): ITerrainSample {
        return this.samples[row * this.pointsPerSide + column]!;
    }

    private clampBaseIndex(value: number): number {
        return Math.min(Math.max(value, 0), this.pointsPerSide - 2);
    }
}
