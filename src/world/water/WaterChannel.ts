import type { IWaterCourse } from "@/types/world";
import { WATER_COURSE, WATER_CHANNEL } from "@/constants/world";
import { lerp, smoothstep, clamp } from "@/lib/helpers";
import { CellIndex } from "@/lib/spatialGrid";

interface IChannelReading {
    bankBlend: number;
    bedProfile: number;
    waterlineElevation: number;
}

export class WaterChannel {
    private static readonly bedProfileAt = (widthRatio: number): number =>
        1 - smoothstep(WATER_CHANNEL.flatBedRatio, 1, Math.abs(widthRatio));

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

    private readonly segmentCells: CellIndex;

    static from(courses: IWaterCourse[]): WaterChannel | null {
        const validCourses = courses.filter((course) => course.points.length > 1);
        return validCourses.length > 0 ? new WaterChannel(validCourses) : null;
    }

    private constructor(courses: IWaterCourse[]) {
        let segmentCount = 0;
        for (const course of courses) {
            segmentCount += Math.max(0, course.points.length - 1);
        }

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

        let cursor = 0;
        for (const course of courses) {
            const courseSegments = course.points.length - 1;
            for (let segment = 0; segment < courseSegments; segment += 1) {
                const from = course.points[segment];
                const to = course.points[segment + 1];
                if (!from || !to) continue;

                const reachX = to.x - from.x;
                const reachZ = to.z - from.z;
                const lengthSquared = reachX * reachX + reachZ * reachZ;

                this.fromX[cursor] = from.x;
                this.fromZ[cursor] = from.z;
                this.spanX[cursor] = reachX;
                this.spanZ[cursor] = reachZ;
                this.inverseSpanLengthSquared[cursor] = lengthSquared > 0 ? 1 / lengthSquared : 0;
                this.fromWaterline[cursor] = from.waterlineElevation;
                this.toWaterline[cursor] = to.waterlineElevation;
                this.fromHalfWidth[cursor] = from.halfWidth;
                this.toHalfWidth[cursor] = to.halfWidth;
                this.fromBedRatio[cursor] = from.bedRatio;
                this.toBedRatio[cursor] = to.bedRatio;

                smallestX = Math.min(smallestX, from.x, to.x);
                smallestZ = Math.min(smallestZ, from.z, to.z);
                largestX = Math.max(largestX, from.x, to.x);
                largestZ = Math.max(largestZ, from.z, to.z);

                cursor += 1;
            }
        }

        this.segmentCells = new CellIndex(
            WATER_COURSE.halfWidthWide + WATER_CHANNEL.bankWidth,
            { minX: smallestX, minZ: smallestZ, maxX: largestX, maxZ: largestZ },
            segmentCount,
            (segment, box) => {
                const startX = this.fromX[segment];
                const startZ = this.fromZ[segment];
                const endX = startX + this.spanX[segment];
                const endZ = startZ + this.spanZ[segment];
                const reach =
                    Math.max(this.fromHalfWidth[segment], this.toHalfWidth[segment]) +
                    WATER_CHANNEL.bankWidth;
                box.minX = Math.min(startX, endX) - reach;
                box.maxX = Math.max(startX, endX) + reach;
                box.minZ = Math.min(startZ, endZ) - reach;
                box.maxZ = Math.max(startZ, endZ) + reach;
            }
        );
    }

    readInto(localX: number, localZ: number, reading: IChannelReading): IChannelReading {
        reading.bankBlend = 0;
        reading.bedProfile = 0;
        reading.waterlineElevation = 0;

        const cells = this.segmentCells;
        const cell = cells.cellAt(localX, localZ);
        if (cell < 0) return reading;

        const cellEnd = cells.endOf(cell);

        let nearestDistance = Infinity;
        let nearestSegment = -1;
        let nearestTravelRatio = 0;

        for (let cursor = cells.startOf(cell); cursor < cellEnd; cursor += 1) {
            const segment = cells.itemAt(cursor);
            const startX = this.fromX[segment];
            const startZ = this.fromZ[segment];
            const reachX = this.spanX[segment];
            const reachZ = this.spanZ[segment];

            const travelRatio = clamp(
                ((localX - startX) * reachX + (localZ - startZ) * reachZ) *
                    this.inverseSpanLengthSquared[segment],
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
            this.fromHalfWidth[nearestSegment],
            this.toHalfWidth[nearestSegment],
            nearestTravelRatio
        );
        if (halfWidth <= 0) return reading;

        reading.bankBlend =
            1 - smoothstep(halfWidth, halfWidth + WATER_CHANNEL.bankWidth, nearestDistance);
        if (reading.bankBlend <= 0) return reading;

        const bedRatio = lerp(
            this.fromBedRatio[nearestSegment],
            this.toBedRatio[nearestSegment],
            nearestTravelRatio
        );

        reading.bedProfile = WaterChannel.bedProfileAt(nearestDistance / halfWidth) * bedRatio;
        reading.waterlineElevation = lerp(
            this.fromWaterline[nearestSegment],
            this.toWaterline[nearestSegment],
            nearestTravelRatio
        );

        return reading;
    }
}

export const shoreAllowanceAt = (distance: number, halfWidth: number): number =>
    WATER_CHANNEL.bedDepth *
    (1 - smoothstep(halfWidth, halfWidth + WATER_CHANNEL.shoreReach, distance));

export function createChannelReading(): IChannelReading {
    return { bankBlend: 0, bedProfile: 0, waterlineElevation: 0 };
}
