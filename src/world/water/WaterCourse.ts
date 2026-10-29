import { WATER_COURSE, WORLD_EDGE, WATER_CHANNEL } from "@/constants/world";
import { catmullRomAt, clamp, distanceOutsideBox, lerp, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";
import type { ICorridorPath, IRegionFloor } from "@/world/terrain/TerrainGeneration";

const SOLID_GROUND_LIMIT = WORLD_EDGE.groundApron - WATER_COURSE.rimSafetyMargin;

interface IGroundProbe {
    elevationAt(localX: number, localZ: number): number;
    footprintDistanceAt(localX: number, localZ: number): number;
}

export interface IRegionLink {
    fromIndex: number;
    toIndex: number;
}

export interface IWaterPoint {
    x: number;
    z: number;
    waterlineElevation: number;
    halfWidth: number;
    bedRatio: number;
}

export interface IWaterCourse {
    points: IWaterPoint[];
    isMudhole?: boolean;
}

interface IWaterAnchor {
    x: number;
    z: number;
}

interface IArenaCore {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
}

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

    private readonly originX: number;
    private readonly originZ: number;
    private readonly cellSize: number;
    private readonly cellsAcross: number;
    private readonly cellsDown: number;
    private readonly cellStarts: Int32Array;
    private readonly cellSegments: Int32Array;

    static from(input: IWaterCourse | IWaterCourse[]): WaterChannel | null {
        const courses = Array.isArray(input) ? input : [input];
        const validCourses = courses.filter((c) => c.points.length > 1);
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
            for (let seg = 0; seg < courseSegments; seg += 1) {
                const from = course.points[seg];
                const to = course.points[seg + 1];
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

        reading.bedProfile = WaterChannel.bedProfileAt(nearestDistance / halfWidth) * bedRatio;
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

export function plotWaterCourses(
    regionFloors: IRegionFloor[],
    regionLinks: IRegionLink[],
    corridorPaths: ICorridorPath[],
    ground: IGroundProbe,
    seed: number
): IWaterCourse[] {
    if (regionFloors.length === 0) return [];

    const courses: IWaterCourse[] = [];
    const riverResult = plotPrimaryRiver(regionFloors, regionLinks, corridorPaths, ground, seed);
    const occupiedRegions = new Set<number>();

    if (riverResult) {
        courses.push(riverResult.course);
        for (const reg of riverResult.regions) occupiedRegions.add(reg);
    }

    const eligibleMudholeRegions: number[] = [];
    for (let index = 0; index < regionFloors.length; index += 1) {
        if (!occupiedRegions.has(index)) {
            const floor = regionFloors[index];
            if (floor && floor.halfWidth >= 16 && floor.halfDepth >= 16) {
                eligibleMudholeRegions.push(index);
            }
        }
    }

    const count = Math.min(3, Math.max(1, eligibleMudholeRegions.length));
    for (let m = 0; m < count; m += 1) {
        if (eligibleMudholeRegions.length === 0) break;
        const pickSeed = seed + 300 + m * 47;
        const listIndex = (Math.abs(pickSeed) + m) % eligibleMudholeRegions.length;
        const regionIndex = eligibleMudholeRegions[listIndex];
        if (regionIndex === undefined) continue;

        const region = regionFloors[regionIndex];
        if (region) {
            const mudhole = generateMudholeCourse(region, pickSeed, ground);
            if (mudhole) courses.push(mudhole);
        }

        eligibleMudholeRegions.splice(listIndex, 1);
    }

    return courses;
}

function plotPrimaryRiver(
    regionFloors: IRegionFloor[],
    regionLinks: IRegionLink[],
    corridorPaths: ICorridorPath[],
    ground: IGroundProbe,
    seed: number
): { course: IWaterCourse; regions: number[] } | null {
    if (regionFloors.length === 0) return null;

    const courseRegions = findCourseRegions(regionFloors, regionLinks, seed);
    if (courseRegions.length < WATER_COURSE.minimumRegionsInCourse) return null;

    const noise = new FractalNoise(seed);
    const anchors = placeCourseAnchors(courseRegions, regionFloors, noise);
    if (anchors.length < 2) return null;

    const points = resampleAlongSpline(anchors);

    meanderCourse(points, noise);
    fitCourseBesideArenas(points, regionFloors, corridorPaths, noise);

    const solidPoints = trimToSolidGround(points, ground);
    if (solidPoints.length < WATER_COURSE.minimumPointCount) return null;

    taperCourseEnds(solidPoints);
    settleWaterline(solidPoints, ground);

    return { course: { points: solidPoints }, regions: courseRegions };
}

function generateMudholeCourse(
    region: IRegionFloor,
    localSeed: number,
    ground: IGroundProbe
): IWaterCourse | null {
    const noise = new FractalNoise(localSeed);
    const angleNoise = noise.sample(region.centerX * 0.05, region.centerZ * 0.05, 1, 0.5);
    const angle = angleNoise * Math.PI * 2;
    const offsetDistance = Math.min(region.halfWidth, region.halfDepth) * 0.42;

    const cx = region.centerX + Math.cos(angle) * offsetDistance;
    const cz = region.centerZ + Math.sin(angle) * offsetDistance;

    const radius = 5.0 + noise.sample(cx * 0.08, cz * 0.08, 1, 0.5) * 2.5;
    const dirAngle = noise.sample(cz * 0.08, cx * 0.08, 1, 0.5) * Math.PI * 2;
    const dx = Math.cos(dirAngle);
    const dz = Math.sin(dirAngle);

    const restingElevation = ground.elevationAt(cx, cz) - 1.0;

    const anchors: IWaterAnchor[] = [
        { x: cx - dx * (radius * 1.15), z: cz - dz * (radius * 1.15) },
        { x: cx - dx * (radius * 0.6), z: cz - dz * (radius * 0.6) },
        { x: cx, z: cz },
        { x: cx + dx * (radius * 0.6), z: cz + dz * (radius * 0.6) },
        { x: cx + dx * (radius * 1.15), z: cz + dz * (radius * 1.15) },
    ];

    const widths = [0.8, radius * 0.85, radius, radius * 0.85, 0.8];
    const bedRatios = [0.5, 0.8, 1.0, 0.8, 0.5];

    const points: IWaterPoint[] = [];
    for (let i = 0; i < anchors.length; i += 1) {
        const anchor = anchors[i]!;
        points.push({
            x: anchor.x,
            z: anchor.z,
            waterlineElevation: restingElevation,
            halfWidth: widths[i] ?? radius,
            bedRatio: bedRatios[i] ?? 1.0,
        });
    }

    const solidPoints = trimToSolidGround(points, ground);
    if (solidPoints.length < 3) return null;

    return { points: solidPoints, isMudhole: true };
}

function findCourseRegions(
    regionFloors: IRegionFloor[],
    regionLinks: IRegionLink[],
    seed: number
): number[] {
    const sameLevelPath = findLongestSameLevelPath(regionFloors, regionLinks);
    if (sameLevelPath.length >= 2) {
        const startsInBoss = regionFloors[sameLevelPath[0]!]?.isBossRegion;
        if (!startsInBoss) return sameLevelPath;

        const endsInBoss = regionFloors[sameLevelPath[sameLevelPath.length - 1]!]?.isBossRegion;
        if (!endsInBoss) return [...sameLevelPath].reverse();
    }

    const eligibleNonBoss: number[] = [];
    for (let index = 0; index < regionFloors.length; index += 1) {
        const floor = regionFloors[index];
        if (!floor) continue;
        if (!floor.isBossRegion && floor.halfWidth >= 22 && floor.halfDepth >= 22) {
            eligibleNonBoss.push(index);
        }
    }

    if (eligibleNonBoss.length > 0) {
        const picked = eligibleNonBoss[Math.abs(seed) % eligibleNonBoss.length]!;
        return [picked];
    }

    if (sameLevelPath.length >= 2) return sameLevelPath;

    let largestRegionIndex = 0;
    let largestArea = -1;

    for (let index = 0; index < regionFloors.length; index += 1) {
        const floor = regionFloors[index];
        if (!floor) continue;
        const area = floor.halfWidth * floor.halfDepth;
        if (area > largestArea) {
            largestArea = area;
            largestRegionIndex = index;
        }
    }

    return [largestRegionIndex];
}

function findLongestSameLevelPath(
    regionFloors: IRegionFloor[],
    regionLinks: IRegionLink[]
): number[] {
    const neighboursByRegion: number[][] = regionFloors.map(() => []);

    for (const link of regionLinks) {
        neighboursByRegion[link.fromIndex]?.push(link.toIndex);
        neighboursByRegion[link.toIndex]?.push(link.fromIndex);
    }

    const path: number[] = [];
    const visited = new Set<number>();

    let longestPath: number[] = [];
    let longestLength = -1;

    const extendFrom = (region: number, travelledLength: number): void => {
        if (travelledLength > longestLength) {
            longestLength = travelledLength;
            longestPath = [...path];
        }

        const current = regionFloors[region];
        if (!current) return;

        for (const neighbour of neighboursByRegion[region] ?? []) {
            if (visited.has(neighbour)) continue;

            const next = regionFloors[neighbour];
            if (!next || Math.abs(next.floorElevation - current.floorElevation) > 1.0) continue;

            visited.add(neighbour);
            path.push(neighbour);
            extendFrom(
                neighbour,
                travelledLength +
                    Math.hypot(next.centerX - current.centerX, next.centerZ - current.centerZ)
            );
            path.pop();
            visited.delete(neighbour);
        }
    };

    for (let region = 0; region < regionFloors.length; region += 1) {
        visited.add(region);
        path.push(region);
        extendFrom(region, 0);
        path.pop();
        visited.delete(region);
    }

    return longestPath;
}

function placeCourseAnchors(
    courseRegions: number[],
    regionFloors: IRegionFloor[],
    noise: FractalNoise
): IWaterAnchor[] {
    if (courseRegions.length === 0) return [];

    if (courseRegions.length === 1) {
        const regionIndex = courseRegions[0]!;
        const region = regionFloors[regionIndex];
        if (!region) return [];

        const noiseVal = noise.sample(
            region.centerX * WATER_COURSE.sideNoiseScale,
            region.centerZ * WATER_COURSE.sideNoiseScale,
            1,
            0.5
        );
        const rimSide = noiseVal < 0.5 ? -1 : 1;

        const isWiderAlongX = region.halfWidth >= region.halfDepth;
        const primaryHalf = isWiderAlongX ? region.halfWidth : region.halfDepth;
        const secondaryHalf = isWiderAlongX ? region.halfDepth : region.halfWidth;

        const reach = primaryHalf * 0.82;
        const lateralOffset = secondaryHalf * WATER_COURSE.rimOffsetRatio * 0.7 * rimSide;

        const dirX = isWiderAlongX ? 1 : 0;
        const dirZ = isWiderAlongX ? 0 : 1;
        const acrossX = -dirZ;
        const acrossZ = dirX;

        return [
            {
                x: region.centerX - dirX * reach + acrossX * (lateralOffset * 0.3),
                z: region.centerZ - dirZ * reach + acrossZ * (lateralOffset * 0.3),
            },
            {
                x: region.centerX - dirX * (reach * 0.4) + acrossX * lateralOffset,
                z: region.centerZ - dirZ * (reach * 0.4) + acrossZ * lateralOffset,
            },
            {
                x: region.centerX + dirX * (reach * 0.4) + acrossX * lateralOffset,
                z: region.centerZ + dirZ * (reach * 0.4) + acrossZ * lateralOffset,
            },
            {
                x: region.centerX + dirX * reach + acrossX * (lateralOffset * 0.3),
                z: region.centerZ + dirZ * reach + acrossZ * (lateralOffset * 0.3),
            },
        ];
    }

    const anchors: IWaterAnchor[] = [];

    for (let position = 0; position < courseRegions.length; position += 1) {
        const regionIndex = courseRegions[position];
        if (regionIndex === undefined) continue;

        const region = regionFloors[regionIndex];
        if (!region) continue;

        const before = regionFloors[courseRegions[position - 1] ?? regionIndex] ?? region;
        const after = regionFloors[courseRegions[position + 1] ?? regionIndex] ?? region;

        const travelX = after.centerX - before.centerX;
        const travelZ = after.centerZ - before.centerZ;
        const travelLength = Math.hypot(travelX, travelZ) || 1;

        const rimSide =
            noise.sample(
                region.centerX * WATER_COURSE.sideNoiseScale,
                region.centerZ * WATER_COURSE.sideNoiseScale,
                1,
                0.5
            ) < 0.5
                ? -1
                : 1;
        const rimOffset =
            Math.min(region.halfWidth, region.halfDepth) * WATER_COURSE.rimOffsetRatio * rimSide;

        const anchor = {
            x: region.centerX + (travelZ / travelLength) * rimOffset,
            z: region.centerZ - (travelX / travelLength) * rimOffset,
        };

        if (position === 0 && courseRegions.length > 1) {
            const headReach = Math.min(region.halfWidth, region.halfDepth) * 0.95;
            anchors.push({
                x: anchor.x - (travelX / travelLength) * headReach,
                z: anchor.z - (travelZ / travelLength) * headReach,
            });
        }

        const previous = anchors[anchors.length - 1];

        if (previous)
            anchors.push({ x: (previous.x + anchor.x) / 2, z: (previous.z + anchor.z) / 2 });

        anchors.push(anchor);
    }

    return anchors;
}

function resampleAlongSpline(anchors: IWaterAnchor[]): IWaterPoint[] {
    const points: IWaterPoint[] = [];

    for (let index = 0; index < anchors.length - 1; index += 1) {
        const start = anchors[index];
        const end = anchors[index + 1];
        if (!start || !end) continue;

        const before = anchors[index - 1] ?? start;
        const after = anchors[index + 2] ?? end;
        const steps = Math.max(
            Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / WATER_COURSE.pointSpacing),
            1
        );

        for (let step = 0; step < steps; step += 1)
            points.push(
                createWaterPoint(
                    catmullRomAt(before.x, start.x, end.x, after.x, step / steps),
                    catmullRomAt(before.z, start.z, end.z, after.z, step / steps)
                )
            );
    }

    const lastAnchor = anchors[anchors.length - 1];
    if (lastAnchor) points.push(createWaterPoint(lastAnchor.x, lastAnchor.z));

    return points;
}

const createWaterPoint = (x: number, z: number): IWaterPoint => ({
    x,
    z,
    waterlineElevation: 0,
    halfWidth: WATER_COURSE.halfWidthNarrow,
    bedRatio: 1,
});

function meanderCourse(points: IWaterPoint[], noise: FractalNoise): void {
    const displacements = new Float32Array(points.length * 2);
    let travelledLength = 0;

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) continue;

        const previous = points[index - 1] ?? point;
        const next = points[index + 1] ?? point;

        travelledLength += Math.hypot(point.x - previous.x, point.z - previous.z);

        const travelX = next.x - previous.x;
        const travelZ = next.z - previous.z;
        const travelLength = Math.hypot(travelX, travelZ) || 1;
        const sway =
            (noise.sample(travelledLength / WATER_COURSE.meanderWavelength, 2.1, 3, 0.5) - 0.5) *
            2 *
            WATER_COURSE.meanderAmplitude;

        displacements[index * 2] = (travelZ / travelLength) * sway;
        displacements[index * 2 + 1] = -(travelX / travelLength) * sway;
    }

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) continue;

        point.x += displacements[index * 2] ?? 0;
        point.z += displacements[index * 2 + 1] ?? 0;
    }
}

function fitCourseBesideArenas(
    points: IWaterPoint[],
    regionFloors: IRegionFloor[],
    corridorPaths: ICorridorPath[],
    noise: FractalNoise
): void {
    const arenaCores = regionFloors.map((region) => ({
        centerX: region.centerX,
        centerZ: region.centerZ,
        halfWidth: region.halfWidth * WATER_COURSE.arenaCoreRatio,
        halfDepth: region.halfDepth * WATER_COURSE.arenaCoreRatio,
    }));

    for (let pass = 0; pass < WATER_COURSE.clearancePasses; pass += 1) {
        shapeCourseWidth(points, corridorPaths, noise);
        clampWidthToArenaRoom(points, arenaCores, corridorPaths, true);
        relaxCourse(points);
    }

    shapeCourseWidth(points, corridorPaths, noise);
    clampWidthToArenaRoom(points, arenaCores, corridorPaths, false);
}

function clampWidthToArenaRoom(
    points: IWaterPoint[],
    arenaCores: IArenaCore[],
    corridorPaths: ICorridorPath[],
    mayPushOutwards: boolean
): void {
    for (const point of points) {
        const room = roomBesideCores(point, arenaCores);
        if (room < point.halfWidth) {
            if (mayPushOutwards && room < WATER_COURSE.halfWidthNarrow) {
                pushOutsideCores(point, arenaCores, WATER_COURSE.halfWidthNarrow);
                point.halfWidth = Math.min(point.halfWidth, roomBesideCores(point, arenaCores));
            } else {
                point.halfWidth = Math.max(room, 0);
            }
        }

        for (const corridor of corridorPaths) {
            if (Math.abs(corridor.toElevation - corridor.fromElevation) <= 1.5) continue;
            const dist = distanceToCorridorCentre(point, corridor);
            const minClearance = corridor.halfWidth + 8.0;
            if (dist < minClearance) {
                if (mayPushOutwards) {
                    pushOutsideCliffCorridor(point, corridor, minClearance);
                }
                const newDist = distanceToCorridorCentre(point, corridor);
                point.halfWidth = Math.min(
                    point.halfWidth,
                    Math.max(0, newDist - corridor.halfWidth - 3.0)
                );
            }
        }
    }
}

function pushOutsideCliffCorridor(
    point: IWaterPoint,
    corridor: ICorridorPath,
    minDistance: number
): void {
    const dist = distanceToCorridorCentre(point, corridor);
    if (dist >= minDistance) return;

    const spanX = corridor.toX - corridor.fromX;
    const spanZ = corridor.toZ - corridor.fromZ;
    const spanLen = Math.hypot(spanX, spanZ) || 1;
    const normAcrossX = -spanZ / spanLen;
    const normAcrossZ = spanX / spanLen;
    const toPointX = point.x - corridor.fromX;
    const toPointZ = point.z - corridor.fromZ;
    const side = toPointX * normAcrossX + toPointZ * normAcrossZ >= 0 ? 1 : -1;
    const push = minDistance - dist;

    point.x += normAcrossX * side * push;
    point.z += normAcrossZ * side * push;
}

function roomBesideCores(point: IWaterPoint, arenaCores: IArenaCore[]): number {
    let smallestRoom = Infinity;

    for (const core of arenaCores)
        smallestRoom = Math.min(
            smallestRoom,
            distanceOutsideBox(
                point.x,
                point.z,
                core.centerX,
                core.centerZ,
                core.halfWidth,
                core.halfDepth
            )
        );

    return smallestRoom;
}

function pushOutsideCores(point: IWaterPoint, arenaCores: IArenaCore[], clearance: number): void {
    for (const core of arenaCores) {
        const gapX = point.x - core.centerX;
        const gapZ = point.z - core.centerZ;
        const outsideX = Math.abs(gapX) - core.halfWidth;
        const outsideZ = Math.abs(gapZ) - core.halfDepth;

        if (Math.hypot(Math.max(outsideX, 0), Math.max(outsideZ, 0)) >= clearance) continue;

        if (outsideX >= outsideZ)
            point.x = core.centerX + Math.sign(gapX || 1) * (core.halfWidth + clearance);
        else point.z = core.centerZ + Math.sign(gapZ || 1) * (core.halfDepth + clearance);
    }
}

function relaxCourse(points: IWaterPoint[]): void {
    const relaxed = new Float32Array(points.length * 2);

    for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        const previous = points[index - 1];
        const next = points[index + 1];
        if (!point || !previous || !next) continue;

        relaxed[index * 2] = lerp(
            point.x,
            (previous.x + next.x) / 2,
            WATER_COURSE.smoothingStrength
        );
        relaxed[index * 2 + 1] = lerp(
            point.z,
            (previous.z + next.z) / 2,
            WATER_COURSE.smoothingStrength
        );
    }

    for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        if (!point) continue;

        point.x = relaxed[index * 2] ?? point.x;
        point.z = relaxed[index * 2 + 1] ?? point.z;
    }
}

function shapeCourseWidth(
    points: IWaterPoint[],
    corridorPaths: ICorridorPath[],
    noise: FractalNoise
): void {
    let travelledLength = 0;

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) continue;

        const previous = points[index - 1];
        if (previous) travelledLength += Math.hypot(point.x - previous.x, point.z - previous.z);

        const widthRatio = noise.sample(
            travelledLength / WATER_COURSE.widthWavelength,
            7.3,
            2,
            0.5
        );
        const openWidth = lerp(
            WATER_COURSE.halfWidthNarrow,
            WATER_COURSE.halfWidthWide,
            widthRatio
        );
        const isFord = crossesCorridor(point, corridorPaths);

        point.halfWidth = isFord ? openWidth * WATER_COURSE.fordHalfWidthRatio : openWidth;
        point.bedRatio = isFord ? WATER_COURSE.fordBedRatio : 1;
    }
}

const crossesCorridor = (point: IWaterPoint, corridorPaths: ICorridorPath[]): boolean =>
    corridorPaths.some(
        (corridor) => distanceToCorridorCentre(point, corridor) < corridor.halfWidth
    );

function distanceToCorridorCentre(point: IWaterPoint, corridor: ICorridorPath): number {
    const spanX = corridor.toX - corridor.fromX;
    const spanZ = corridor.toZ - corridor.fromZ;
    const spanLengthSquared = spanX * spanX + spanZ * spanZ;

    if (spanLengthSquared === 0)
        return Math.hypot(point.x - corridor.fromX, point.z - corridor.fromZ);

    const travelRatio = clamp(
        ((point.x - corridor.fromX) * spanX + (point.z - corridor.fromZ) * spanZ) /
            spanLengthSquared,
        0,
        1
    );

    return Math.hypot(
        point.x - corridor.fromX - spanX * travelRatio,
        point.z - corridor.fromZ - spanZ * travelRatio
    );
}

function trimToSolidGround(points: IWaterPoint[], ground: IGroundProbe): IWaterPoint[] {
    let longestStart = 0;
    let longestLength = 0;
    let runStart = 0;

    for (let index = 0; index <= points.length; index += 1) {
        if (index < points.length && restsOnSolidGround(points, index, ground)) continue;

        if (index - runStart > longestLength) {
            longestLength = index - runStart;
            longestStart = runStart;
        }

        runStart = index + 1;
    }

    return points.slice(longestStart, longestStart + longestLength);
}

function restsOnSolidGround(points: IWaterPoint[], index: number, ground: IGroundProbe): boolean {
    const point = points[index];
    if (!point) return false;

    const previous = points[index - 1] ?? point;
    const next = points[index + 1] ?? point;
    const travelX = next.x - previous.x;
    const travelZ = next.z - previous.z;
    const travelLength = Math.hypot(travelX, travelZ) || 1;
    const reach = point.halfWidth + WATER_COURSE.shoreProbeMargin;
    const acrossX = (travelZ / travelLength) * reach;
    const acrossZ = -(travelX / travelLength) * reach;

    return (
        standsClearOfRim(point.x, point.z, ground) &&
        standsClearOfRim(point.x + acrossX, point.z + acrossZ, ground) &&
        standsClearOfRim(point.x - acrossX, point.z - acrossZ, ground)
    );
}

const standsClearOfRim = (x: number, z: number, ground: IGroundProbe): boolean =>
    ground.footprintDistanceAt(x, z) <= SOLID_GROUND_LIMIT;

function taperCourseEnds(points: IWaterPoint[]): void {
    const lengthFromStart = new Float32Array(points.length);
    let travelledLength = 0;

    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        const previous = points[index - 1];
        if (!point || !previous) continue;

        travelledLength += Math.hypot(point.x - previous.x, point.z - previous.z);
        lengthFromStart[index] = travelledLength;
    }

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) continue;

        const fromStart = lengthFromStart[index] ?? 0;
        const fromEnd = travelledLength - fromStart;

        const sourceWidthRatio = lerp(
            0.85,
            1.0,
            smoothstep(0, WATER_COURSE.endTaperLength * 0.5, fromStart)
        );
        const endTaper = smoothstep(0, WATER_COURSE.endTaperLength, fromEnd);

        point.halfWidth *= sourceWidthRatio * endTaper;
    }
}

function settleWaterline(points: IWaterPoint[], ground: IGroundProbe): void {
    if (points.length === 0) return;

    const groundElevations = points.map((point) => ground.elevationAt(point.x, point.z));
    let highestAllowed = Infinity;

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index]!;
        const before = groundElevations[index - 1] ?? groundElevations[index]!;
        const current = groundElevations[index]!;
        const after = groundElevations[index + 1] ?? groundElevations[index]!;
        const smoothedGround = (before + current + after) / 3;

        const restingLevel = smoothedGround - WATER_COURSE.waterlineDropBelowGround;
        highestAllowed = Math.min(highestAllowed, restingLevel);
        point.waterlineElevation = highestAllowed;
    }
}

export const shoreAllowanceAt = (distance: number, halfWidth: number): number =>
    WATER_CHANNEL.bedDepth *
    (1 - smoothstep(halfWidth, halfWidth + WATER_CHANNEL.shoreReach, distance));

export function createChannelReading(): IChannelReading {
    return { bankBlend: 0, bedProfile: 0, waterlineElevation: 0 };
}
