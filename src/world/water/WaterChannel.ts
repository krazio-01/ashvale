import { WATER_CHANNEL, WATER_COURSE } from "@/constants/world";
import { clamp, lerp, smoothstep } from "@/lib/helpers";
import type { IWaterCourse } from "@/world/water/WaterCourse";

export class WaterChannel {
    private readonly fromX: Float32Array;
    private readonly fromZ: Float32Array;
    private readonly spanX: Float32Array;
    private readonly spanZ: Float32Array;
    private readonly inverseSpanLengthSquared: Float32Array;
    private readonly fromWaterline: Float32Array;
    private readonly toWaterline: Float32Array;
    private readonly fromHalfWidth: Float32Array;
    private readonly toHalfWidth: Float32Array;
    private readonly fromBedRatio: Float32Array;
    private readonly toBedRatio: Float32Array;

    private readonly originX: number;
    private readonly originZ: number;
    private readonly cellSize: number;
    private readonly cellsAcross: number;
    private readonly cellsDown: number;
    private readonly cellStarts: Int32Array;
    private readonly cellSegments: Int32Array;

    static from(course: IWaterCourse): WaterChannel | null {
        return course.points.length > 1 ? new WaterChannel(course) : null;
    }

    private constructor(course: IWaterCourse) {
        const segmentCount = course.points.length - 1;

        this.fromX = new Float32Array(segmentCount);
        this.fromZ = new Float32Array(segmentCount);
        this.spanX = new Float32Array(segmentCount);
        this.spanZ = new Float32Array(segmentCount);
        this.inverseSpanLengthSquared = new Float32Array(segmentCount);
        this.fromWaterline = new Float32Array(segmentCount);
        this.toWaterline = new Float32Array(segmentCount);
        this.fromHalfWidth = new Float32Array(segmentCount);
        this.toHalfWidth = new Float32Array(segmentCount);
        this.fromBedRatio = new Float32Array(segmentCount);
        this.toBedRatio = new Float32Array(segmentCount);

        let smallestX = Infinity;
        let smallestZ = Infinity;
        let largestX = -Infinity;
        let largestZ = -Infinity;

        for (let segment = 0; segment < segmentCount; segment += 1) {
            const from = course.points[segment];
            const to = course.points[segment + 1];
            if (!from || !to) continue;

            const reachX = to.x - from.x;
            const reachZ = to.z - from.z;
            const lengthSquared = reachX * reachX + reachZ * reachZ;

            this.fromX[segment] = from.x;
            this.fromZ[segment] = from.z;
            this.spanX[segment] = reachX;
            this.spanZ[segment] = reachZ;
            this.inverseSpanLengthSquared[segment] = lengthSquared > 0 ? 1 / lengthSquared : 0;
            this.fromWaterline[segment] = from.waterlineElevation;
            this.toWaterline[segment] = to.waterlineElevation;
            this.fromHalfWidth[segment] = from.halfWidth;
            this.toHalfWidth[segment] = to.halfWidth;
            this.fromBedRatio[segment] = from.bedRatio;
            this.toBedRatio[segment] = to.bedRatio;

            smallestX = Math.min(smallestX, from.x, to.x);
            smallestZ = Math.min(smallestZ, from.z, to.z);
            largestX = Math.max(largestX, from.x, to.x);
            largestZ = Math.max(largestZ, from.z, to.z);
        }

        this.cellSize = WATER_COURSE.halfWidthWide + WATER_CHANNEL.bankWidth;
        this.originX = smallestX - this.cellSize;
        this.originZ = smallestZ - this.cellSize;
        this.cellsAcross =
            Math.floor((largestX + this.cellSize - this.originX) / this.cellSize) + 1;
        this.cellsDown = Math.floor((largestZ + this.cellSize - this.originZ) / this.cellSize) + 1;

        const cellStarts = new Int32Array(this.cellsAcross * this.cellsDown + 1);

        for (let segment = 0; segment < segmentCount; segment += 1)
            this.forEachTouchedCell(segment, (cell) => {
                cellStarts[cell + 1] = (cellStarts[cell + 1] ?? 0) + 1;
            });

        for (let cell = 0; cell < cellStarts.length - 1; cell += 1)
            cellStarts[cell + 1] = (cellStarts[cell + 1] ?? 0) + (cellStarts[cell] ?? 0);

        const cellSegments = new Int32Array(cellStarts[cellStarts.length - 1] ?? 0);
        const fillCursor = Int32Array.from(cellStarts.subarray(0, cellStarts.length - 1));

        for (let segment = 0; segment < segmentCount; segment += 1)
            this.forEachTouchedCell(segment, (cell) => {
                const cursor = fillCursor[cell] ?? 0;
                cellSegments[cursor] = segment;
                fillCursor[cell] = cursor + 1;
            });

        this.cellStarts = cellStarts;
        this.cellSegments = cellSegments;
    }

    readInto(localX: number, localZ: number, reading: IChannelReading): IChannelReading {
        reading.bankBlend = 0;
        reading.bedProfile = 0;
        reading.waterlineElevation = 0;

        const column = Math.floor((localX - this.originX) / this.cellSize);
        const row = Math.floor((localZ - this.originZ) / this.cellSize);

        if (column < 0 || row < 0 || column >= this.cellsAcross || row >= this.cellsDown)
            return reading;

        const cell = row * this.cellsAcross + column;
        const cellEnd = this.cellStarts[cell + 1] ?? 0;

        let nearestDistance = Infinity;
        let nearestSegment = -1;
        let nearestTravelRatio = 0;

        for (let cursor = this.cellStarts[cell] ?? 0; cursor < cellEnd; cursor += 1) {
            const segment = this.cellSegments[cursor] ?? 0;
            const startX = this.fromX[segment] ?? 0;
            const startZ = this.fromZ[segment] ?? 0;
            const reachX = this.spanX[segment] ?? 0;
            const reachZ = this.spanZ[segment] ?? 0;

            const travelRatio = clamp(
                ((localX - startX) * reachX + (localZ - startZ) * reachZ) *
                    (this.inverseSpanLengthSquared[segment] ?? 0),
                0,
                1
            );
            const distance = Math.hypot(
                localX - startX - reachX * travelRatio,
                localZ - startZ - reachZ * travelRatio
            );

            if (distance >= nearestDistance) continue;

            nearestDistance = distance;
            nearestSegment = segment;
            nearestTravelRatio = travelRatio;
        }

        if (nearestSegment < 0) return reading;

        const halfWidth = lerp(
            this.fromHalfWidth[nearestSegment] ?? 0,
            this.toHalfWidth[nearestSegment] ?? 0,
            nearestTravelRatio
        );
        if (halfWidth <= 0) return reading;

        reading.bankBlend =
            1 - smoothstep(halfWidth, halfWidth + WATER_CHANNEL.bankWidth, nearestDistance);
        if (reading.bankBlend <= 0) return reading;

        const bedRatio = lerp(
            this.fromBedRatio[nearestSegment] ?? 1,
            this.toBedRatio[nearestSegment] ?? 1,
            nearestTravelRatio
        );

        reading.bedProfile = bedProfileAt(nearestDistance / halfWidth) * bedRatio;
        reading.waterlineElevation = lerp(
            this.fromWaterline[nearestSegment] ?? 0,
            this.toWaterline[nearestSegment] ?? 0,
            nearestTravelRatio
        );

        return reading;
    }

    private forEachTouchedCell(segment: number, visit: (cell: number) => void): void {
        const startX = this.fromX[segment] ?? 0;
        const startZ = this.fromZ[segment] ?? 0;
        const endX = startX + (this.spanX[segment] ?? 0);
        const endZ = startZ + (this.spanZ[segment] ?? 0);
        const reach =
            Math.max(this.fromHalfWidth[segment] ?? 0, this.toHalfWidth[segment] ?? 0) +
            WATER_CHANNEL.bankWidth;

        const firstColumn = Math.floor(
            (Math.min(startX, endX) - reach - this.originX) / this.cellSize
        );
        const lastColumn = Math.floor(
            (Math.max(startX, endX) + reach - this.originX) / this.cellSize
        );
        const firstRow = Math.floor(
            (Math.min(startZ, endZ) - reach - this.originZ) / this.cellSize
        );
        const lastRow = Math.floor((Math.max(startZ, endZ) + reach - this.originZ) / this.cellSize);

        for (
            let row = Math.max(firstRow, 0);
            row <= Math.min(lastRow, this.cellsDown - 1);
            row += 1
        )
            for (
                let column = Math.max(firstColumn, 0);
                column <= Math.min(lastColumn, this.cellsAcross - 1);
                column += 1
            )
                visit(row * this.cellsAcross + column);
    }
}

const bedProfileAt = (widthRatio: number): number =>
    1 - smoothstep(WATER_CHANNEL.flatBedRatio, 1, Math.abs(widthRatio));

export const shoreAllowanceAt = (distance: number, halfWidth: number): number =>
    WATER_CHANNEL.bedDepth *
    (1 - smoothstep(halfWidth, halfWidth + WATER_CHANNEL.shoreReach, distance));

export function createChannelReading(): IChannelReading {
    return { bankBlend: 0, bedProfile: 0, waterlineElevation: 0 };
}

export interface IChannelReading {
    bankBlend: number;
    bedProfile: number;
    waterlineElevation: number;
}
