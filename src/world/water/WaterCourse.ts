import type {
    IRegionLink,
    IWaterPoint,
    IWaterCourse,
    ISurfaceHeightProbe,
    ICorridorPath,
    IRegionFloor,
    IRegionBox,
} from "@/types/world";
import type { WaterCourseName } from "@/types/themes";
import { SPRING, TERRAIN, WATER_COURSE, WATER_CHANNEL } from "@/constants/world";
import { JUMP_CLIMB } from "@/constants/player";
import {
    lerp,
    smoothstep,
    resampleSmoothPath,
    pathDirectionAt,
    distanceToSegment,
    accumulatePathLengths,
    scaledBox,
    segmentFrame,
} from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";
import type { IPlanarPoint } from "@/lib/helpers";

interface ICoursePlotInput {
    regionFloors: IRegionFloor[];
    regionLinks: IRegionLink[];
    corridorPaths: ICorridorPath[];
    ground: ISurfaceHeightProbe;
    seed: number;
    occupiedRegions: Set<number>;
}

abstract class WaterCourseKind {
    protected static readonly scratchDirection: IPlanarPoint = { x: 0, z: 0 };

    protected static readonly createWaterPoint = (x: number, z: number): IWaterPoint => ({
        x,
        z,
        waterlineElevation: 0,
        halfWidth: WATER_COURSE.halfWidthNarrow,
        bedRatio: 1,
    });

    protected static resampleAlongSpline(anchors: IPlanarPoint[]): IWaterPoint[] {
        return resampleSmoothPath(
            anchors,
            WATER_COURSE.pointSpacing,
            (x, z) => WaterCourseKind.createWaterPoint(x, z),
            (last) => WaterCourseKind.createWaterPoint(last.x, last.z)
        );
    }

    protected static relaxCourse(points: IWaterPoint[]): void {
        if (points.length < 3) return;
        let previousX = points[0].x;
        let previousZ = points[0].z;
        for (let index = 1; index + 1 < points.length; index += 1) {
            const point = points[index];
            const next = points[index + 1];
            const { x, z } = point;
            point.x = Math.fround(
                lerp(x, (previousX + next.x) / 2, WATER_COURSE.smoothingStrength)
            );
            point.z = Math.fround(
                lerp(z, (previousZ + next.z) / 2, WATER_COURSE.smoothingStrength)
            );
            previousX = x;
            previousZ = z;
        }
    }

    protected static shapeCourseWidth(
        points: IWaterPoint[],
        corridorPaths: ICorridorPath[],
        noise: FractalNoise
    ): void {
        const travelledLengths = new Float64Array(points.length);
        accumulatePathLengths(points, travelledLengths);

        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];
            const travelledLength = travelledLengths[index];

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
            const isFord = WaterCourseKind.crossesCorridor(point, corridorPaths);

            point.halfWidth = isFord ? openWidth * WATER_COURSE.crossingHalfWidthRatio : openWidth;
            point.bedRatio = isFord ? WATER_COURSE.crossingDepthRatio : 1;
        }
    }

    protected static readonly crossesCorridor = (
        point: IWaterPoint,
        corridorPaths: ICorridorPath[]
    ): boolean =>
        corridorPaths.some(
            (corridor) =>
                WaterCourseKind.distanceToCorridorCentre(point, corridor) < corridor.halfWidth
        );

    protected static distanceToCorridorCentre(point: IWaterPoint, corridor: ICorridorPath): number {
        return distanceToSegment(
            point.x,
            point.z,
            corridor.fromX,
            corridor.fromZ,
            corridor.toX,
            corridor.toZ
        );
    }

    protected static trimToSolidGround(
        points: IWaterPoint[],
        ground: ISurfaceHeightProbe
    ): IWaterPoint[] {
        let longestStart = 0;
        let longestLength = 0;
        let runStart = 0;

        for (let index = 0; index <= points.length; index += 1) {
            if (index < points.length && WaterCourseKind.restsOnSolidGround(points, index, ground))
                continue;

            if (index - runStart > longestLength) {
                longestLength = index - runStart;
                longestStart = runStart;
            }

            runStart = index + 1;
        }

        return longestLength === points.length
            ? points
            : points.slice(longestStart, longestStart + longestLength);
    }

    protected static restsOnSolidGround(
        points: IWaterPoint[],
        index: number,
        ground: ISurfaceHeightProbe
    ): boolean {
        const point = points[index];
        if (!point) return false;

        const direction = pathDirectionAt(points, index, WaterCourseKind.scratchDirection);
        const reach = point.halfWidth + WATER_COURSE.shoreProbeMargin;
        const acrossX = direction.z * reach;
        const acrossZ = -direction.x * reach;

        return (
            WaterCourseKind.standsClearOfRim(point.x, point.z, ground) &&
            WaterCourseKind.standsClearOfRim(point.x + acrossX, point.z + acrossZ, ground) &&
            WaterCourseKind.standsClearOfRim(point.x - acrossX, point.z - acrossZ, ground)
        );
    }

    protected static readonly standsClearOfRim = (
        x: number,
        z: number,
        ground: ISurfaceHeightProbe
    ): boolean =>
        ground.footprintDistanceAt(x, z) <= ground.border.flatReach - WATER_COURSE.rimSafetyMargin;

    protected static taperCourseEnds(points: IWaterPoint[]): void {
        const lengthFromStart = new Float32Array(points.length);
        const travelledLength = accumulatePathLengths(points, lengthFromStart);

        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];

            const fromStart = lengthFromStart[index];
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

    protected static orientDownhill(
        anchors: IPlanarPoint[],
        ground: ISurfaceHeightProbe
    ): IPlanarPoint[] {
        const elevations = anchors.map(({ x, z }) => ground.elevationAt(x, z));
        let forwardLow = Infinity;
        let reverseLow = Infinity;
        let forwardCut = 0;
        let reverseCut = 0;
        for (let index = 0; index < elevations.length; index += 1) {
            const forward = elevations[index];
            const reverse = elevations[elevations.length - 1 - index];
            forwardLow = Math.min(forwardLow, forward);
            reverseLow = Math.min(reverseLow, reverse);
            forwardCut = forwardCut + forward - forwardLow;
            reverseCut = reverseCut + reverse - reverseLow;
        }
        return forwardCut <= reverseCut ? anchors : anchors.toReversed();
    }

    protected static settleWaterline(points: IWaterPoint[], ground: ISurfaceHeightProbe): void {
        if (points.length === 0) return;
        let current = ground.elevationAt(points[0].x, points[0].z);
        let previous = current;
        let waterline = Infinity;
        for (let index = 0; index < points.length; index += 1) {
            const nextPoint = points[index + 1];
            const next = nextPoint ? ground.elevationAt(nextPoint.x, nextPoint.z) : current;
            const resting = (previous + current + next) / 3 - WATER_COURSE.waterlineDropBelowGround;
            waterline = Math.min(waterline, resting);
            points[index].waterlineElevation = waterline;
            previous = current;
            current = next;
        }
    }

    protected static deepenTo(points: IWaterPoint[], depth: number): void {
        const depthRatio = depth / WATER_CHANNEL.bedDepth;
        for (const point of points) point.bedRatio *= depthRatio;
    }

    abstract readonly flows: boolean;

    abstract plot(input: ICoursePlotInput): IWaterPoint[][];
}

class RouteRiver extends WaterCourseKind {
    private static findCourseRegions(
        regionFloors: IRegionFloor[],
        regionLinks: IRegionLink[],
        seed: number
    ): number[] {
        const sameLevelPath = RouteRiver.findLongestSameLevelPath(regionFloors, regionLinks);
        if (sameLevelPath.length >= 2) {
            const startsInBoss = regionFloors[sameLevelPath[0]].isBossRegion;
            if (!startsInBoss) return sameLevelPath;

            const endsInBoss = regionFloors[sameLevelPath[sameLevelPath.length - 1]].isBossRegion;
            if (!endsInBoss) return [...sameLevelPath].reverse();
        }

        const eligibleNonBoss: number[] = [];
        for (let index = 0; index < regionFloors.length; index += 1) {
            const floor = regionFloors[index];
            if (!floor.isBossRegion && floor.halfWidth >= 22 && floor.halfDepth >= 22) {
                eligibleNonBoss.push(index);
            }
        }

        if (eligibleNonBoss.length > 0) {
            const picked = eligibleNonBoss[Math.abs(seed) % eligibleNonBoss.length];
            return [picked];
        }

        if (sameLevelPath.length >= 2) return sameLevelPath;

        let largestRegionIndex = 0;
        let largestArea = -1;

        for (let index = 0; index < regionFloors.length; index += 1) {
            const floor = regionFloors[index];
            const area = floor.halfWidth * floor.halfDepth;
            if (area > largestArea) {
                largestArea = area;
                largestRegionIndex = index;
            }
        }

        return [largestRegionIndex];
    }

    private static findLongestSameLevelPath(
        regionFloors: IRegionFloor[],
        regionLinks: IRegionLink[]
    ): number[] {
        const neighboursByRegion: { region: number; length: number }[][] = regionFloors.map(
            () => []
        );
        for (const { fromIndex, toIndex } of regionLinks) {
            const from = regionFloors[fromIndex];
            const to = regionFloors[toIndex];
            if (
                !from ||
                !to ||
                Math.abs(to.floorElevation - from.floorElevation) > JUMP_CLIMB.stepRise
            )
                continue;
            const length = Math.hypot(to.centerX - from.centerX, to.centerZ - from.centerZ);
            neighboursByRegion[fromIndex].push({ region: toIndex, length });
            neighboursByRegion[toIndex].push({ region: fromIndex, length });
        }

        const path: number[] = [];
        const visited = new Uint8Array(regionFloors.length);

        let longestPath: number[] = [];
        let longestLength = -1;

        const extendFrom = (region: number, travelledLength: number): void => {
            if (travelledLength > longestLength) {
                longestLength = travelledLength;
                longestPath = [...path];
            }

            for (const edge of neighboursByRegion[region]) {
                if (visited[edge.region]) continue;
                visited[edge.region] = 1;
                path.push(edge.region);
                extendFrom(edge.region, travelledLength + edge.length);
                path.pop();
                visited[edge.region] = 0;
            }
        };

        for (let region = 0; region < regionFloors.length; region += 1) {
            visited[region] = 1;
            path.push(region);
            extendFrom(region, 0);
            path.pop();
            visited[region] = 0;
        }

        return longestPath;
    }

    private static placeCourseAnchors(
        courseRegions: number[],
        regionFloors: IRegionFloor[],
        noise: FractalNoise
    ): IPlanarPoint[] {
        if (courseRegions.length === 1) {
            const regionIndex = courseRegions[0];
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

        const anchors: IPlanarPoint[] = [];

        for (let position = 0; position < courseRegions.length; position += 1) {
            const regionIndex = courseRegions[position];
            if (regionIndex === undefined) continue;

            const region = regionFloors[regionIndex];

            const before = regionFloors[courseRegions[position - 1] ?? regionIndex] ?? region;
            const after = regionFloors[courseRegions[position + 1] ?? regionIndex] ?? region;

            const { alongX, alongZ } = segmentFrame(
                before.centerX,
                before.centerZ,
                after.centerX,
                after.centerZ
            );

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
                Math.min(region.halfWidth, region.halfDepth) *
                WATER_COURSE.rimOffsetRatio *
                rimSide;

            const anchor = {
                x: region.centerX + alongZ * rimOffset,
                z: region.centerZ - alongX * rimOffset,
            };

            if (position === 0 && courseRegions.length > 1) {
                const headReach = Math.min(region.halfWidth, region.halfDepth) * 0.95;
                anchors.push({
                    x: anchor.x - alongX * headReach,
                    z: anchor.z - alongZ * headReach,
                });
            }

            const previous = anchors[anchors.length - 1];

            if (previous)
                anchors.push({ x: (previous.x + anchor.x) / 2, z: (previous.z + anchor.z) / 2 });

            anchors.push(anchor);
        }

        return anchors;
    }

    private static meanderCourse(points: IWaterPoint[], noise: FractalNoise): void {
        const displacements = new Float32Array(points.length * 2);
        const travelledLengths = new Float64Array(points.length);
        accumulatePathLengths(points, travelledLengths);

        for (let index = 0; index < points.length; index += 1) {
            const travelledLength = travelledLengths[index];
            const direction = pathDirectionAt(points, index, WaterCourseKind.scratchDirection);
            const sway =
                noise.sampleSigned(travelledLength / WATER_COURSE.meanderWavelength, 2.1, 3, 0.5) *
                WATER_COURSE.meanderAmplitude;

            displacements[index * 2] = direction.z * sway;
            displacements[index * 2 + 1] = -direction.x * sway;
        }

        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];

            point.x += displacements[index * 2];
            point.z += displacements[index * 2 + 1];
        }
    }

    private static fitCourseBesideArenas(
        points: IWaterPoint[],
        regionFloors: IRegionFloor[],
        corridorPaths: ICorridorPath[],
        noise: FractalNoise
    ): void {
        const arenaCores = regionFloors.map((floor) => scaledBox(floor, TERRAIN.arenaCoreRatio));

        const cliffCorridors = corridorPaths.filter(isCliffCorridor);
        for (let pass = 0; pass < WATER_COURSE.clearancePasses; pass += 1) {
            WaterCourseKind.shapeCourseWidth(points, corridorPaths, noise);
            RouteRiver.clampWidthToArenaRoom(points, arenaCores, cliffCorridors, true);
            WaterCourseKind.relaxCourse(points);
        }

        WaterCourseKind.shapeCourseWidth(points, corridorPaths, noise);
        RouteRiver.clampWidthToArenaRoom(points, arenaCores, cliffCorridors, false);
    }

    private static clampWidthToArenaRoom(
        points: IWaterPoint[],
        arenaCores: IRegionBox[],
        cliffCorridors: ICorridorPath[],
        mayPushOutwards: boolean
    ): void {
        for (const point of points) {
            const room = RouteRiver.roomBesideCores(point, arenaCores);
            if (room < point.halfWidth) {
                if (mayPushOutwards && room < WATER_COURSE.halfWidthNarrow) {
                    RouteRiver.pushOutsideCores(point, arenaCores, WATER_COURSE.halfWidthNarrow);
                    point.halfWidth = RouteRiver.roomBesideCores(point, arenaCores);
                } else {
                    point.halfWidth = Math.max(room, 0);
                }
            }

            for (const corridor of cliffCorridors) {
                const distance = WaterCourseKind.distanceToCorridorCentre(point, corridor);
                const minClearance = corridor.halfWidth + WATER_COURSE.cliffClearance;
                if (distance < minClearance) {
                    if (mayPushOutwards) {
                        RouteRiver.pushOutsideCliffCorridor(
                            point,
                            corridor,
                            minClearance,
                            distance
                        );
                    }
                    const newDistance = mayPushOutwards
                        ? WaterCourseKind.distanceToCorridorCentre(point, corridor)
                        : distance;
                    point.halfWidth = Math.min(
                        point.halfWidth,
                        Math.max(0, newDistance - corridor.halfWidth - WATER_COURSE.cliffBankGap)
                    );
                }
            }
        }
    }

    private static pushOutsideCliffCorridor(
        point: IWaterPoint,
        corridor: ICorridorPath,
        minDistance: number,
        distance: number
    ): void {
        const { acrossX, acrossZ } = segmentFrame(
            corridor.fromX,
            corridor.fromZ,
            corridor.toX,
            corridor.toZ
        );
        const toPointX = point.x - corridor.fromX;
        const toPointZ = point.z - corridor.fromZ;
        const side = toPointX * acrossX + toPointZ * acrossZ >= 0 ? 1 : -1;
        const push = minDistance - distance;

        point.x += acrossX * side * push;
        point.z += acrossZ * side * push;
    }

    private static roomBesideCores(point: IWaterPoint, arenaCores: IRegionBox[]): number {
        let room = point.halfWidth;
        for (const core of arenaCores) {
            const gapX = Math.max(0, Math.abs(point.x - core.centerX) - core.halfWidth);
            const gapZ = Math.max(0, Math.abs(point.z - core.centerZ) - core.halfDepth);
            if (gapX >= room || gapZ >= room) continue;
            room = Math.min(room, Math.hypot(gapX, gapZ));
            if (room === 0) break;
        }
        return room;
    }

    private static pushOutsideCores(
        point: IWaterPoint,
        arenaCores: IRegionBox[],
        clearance: number
    ): void {
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

    readonly flows = true;

    plot({
        regionFloors,
        regionLinks,
        corridorPaths,
        ground,
        seed,
        occupiedRegions,
    }: ICoursePlotInput): IWaterPoint[][] {
        const courseRegions = RouteRiver.findCourseRegions(regionFloors, regionLinks, seed);
        if (courseRegions.length < WATER_COURSE.minimumRegionsInCourse) return [];

        const noise = new FractalNoise(seed);
        const anchors = RouteRiver.placeCourseAnchors(courseRegions, regionFloors, noise);
        if (anchors.length < 2) return [];

        const points = WaterCourseKind.resampleAlongSpline(anchors);

        RouteRiver.meanderCourse(points, noise);
        RouteRiver.fitCourseBesideArenas(points, regionFloors, corridorPaths, noise);

        const solidPoints = WaterCourseKind.trimToSolidGround(points, ground);
        if (solidPoints.length < WATER_COURSE.minimumPointCount) return [];

        WaterCourseKind.taperCourseEnds(solidPoints);
        WaterCourseKind.settleWaterline(solidPoints, ground);
        WaterCourseKind.deepenTo(solidPoints, ground.border.waterDepth);
        for (const regionIndex of courseRegions) occupiedRegions.add(regionIndex);

        return [solidPoints];
    }
}

class BorderRiver extends WaterCourseKind {
    private static sideAngleOf(regionFloors: IRegionFloor[]): number {
        const bossFloor = regionFloors.find((floor) => floor.isBossRegion);
        return bossFloor ? Math.atan2(-bossFloor.centerZ, -bossFloor.centerX) : 0;
    }

    private static traceContour(
        regionFloors: IRegionFloor[],
        ground: ISurfaceHeightProbe,
        sideAngle: number
    ): IPlanarPoint[] {
        const reach = ground.border.riverReach;
        let outerRadius = 0;
        for (const floor of regionFloors)
            outerRadius = Math.max(
                outerRadius,
                Math.hypot(floor.centerX, floor.centerZ) +
                    Math.hypot(floor.halfWidth, floor.halfDepth)
            );
        outerRadius += reach + WATER_COURSE.contourStep;

        const arc = WATER_COURSE.borderArc;
        const stepCount = Math.ceil((outerRadius * arc) / WATER_COURSE.pointSpacing);
        const anchors: IPlanarPoint[] = [];

        for (let step = 0; step <= stepCount; step += 1) {
            const angle = sideAngle - arc / 2 + (arc * step) / stepCount;
            const directionX = Math.cos(angle);
            const directionZ = Math.sin(angle);

            for (let radius = outerRadius; radius > 0; radius -= WATER_COURSE.contourStep) {
                const x = directionX * radius;
                const z = directionZ * radius;
                if (ground.footprintDistanceAt(x, z) > reach) continue;

                anchors.push({ x, z });
                break;
            }
        }

        return anchors;
    }

    private static fallSourceAbove(
        anchor: IPlanarPoint,
        ground: ISurfaceHeightProbe
    ): IPlanarPoint | null {
        const { border } = ground;
        const anchorDistance = Math.hypot(anchor.x, anchor.z);
        if (border.profileHeight <= 0 || anchorDistance === 0) return null;

        const directionX = anchor.x / anchorDistance;
        const directionZ = anchor.z / anchorDistance;
        const sourceReach = border.flatReach + ground.profileWidth * WATER_COURSE.fallSourceRatio;
        const climbLimit = ground.profileWidth + border.crestWidth;

        for (let distance = 0; distance <= climbLimit; distance += WATER_COURSE.contourStep) {
            const x = anchor.x + directionX * distance;
            const z = anchor.z + directionZ * distance;
            if (ground.footprintDistanceAt(x, z) >= sourceReach) return { x, z };
        }

        return null;
    }

    readonly flows = true;

    plot({ regionFloors, corridorPaths, ground, seed }: ICoursePlotInput): IWaterPoint[][] {
        const anchors = WaterCourseKind.orientDownhill(
            BorderRiver.traceContour(regionFloors, ground, BorderRiver.sideAngleOf(regionFloors)),
            ground
        );
        if (anchors.length < 2) return [];

        const source = BorderRiver.fallSourceAbove(anchors[0], ground);
        const points = WaterCourseKind.resampleAlongSpline(source ? [source, ...anchors] : anchors);
        if (points.length < WATER_COURSE.minimumPointCount) return [];

        WaterCourseKind.relaxCourse(points);
        WaterCourseKind.shapeCourseWidth(
            points,
            corridorPaths,
            new FractalNoise(seed + WATER_COURSE.borderSeedOffset)
        );
        WaterCourseKind.taperCourseEnds(points);
        WaterCourseKind.settleWaterline(points, ground);
        WaterCourseKind.deepenTo(points, ground.border.waterDepth);

        return [points];
    }
}

class Spring extends WaterCourseKind {
    private static generate(
        region: IRegionFloor,
        localSeed: number,
        ground: ISurfaceHeightProbe
    ): IWaterPoint[] | null {
        const noise = new FractalNoise(localSeed);
        const angleNoise = noise.sample(
            region.centerX * SPRING.angleNoiseScale,
            region.centerZ * SPRING.angleNoiseScale,
            1,
            0.5
        );
        const angle = angleNoise * Math.PI * 2;
        const offsetDistance =
            Math.min(region.halfWidth, region.halfDepth) * SPRING.centreOffsetRatio;

        const cx = region.centerX + Math.cos(angle) * offsetDistance;
        const cz = region.centerZ + Math.sin(angle) * offsetDistance;

        const radius =
            SPRING.radiusBase +
            noise.sample(cx * SPRING.shapeNoiseScale, cz * SPRING.shapeNoiseScale, 1, 0.5) *
                SPRING.radiusRange;
        const dirAngle =
            noise.sample(cz * SPRING.shapeNoiseScale, cx * SPRING.shapeNoiseScale, 1, 0.5) *
            Math.PI *
            2;
        const dx = Math.cos(dirAngle);
        const dz = Math.sin(dirAngle);

        const restingElevation = ground.elevationAt(cx, cz) - SPRING.restingDrop;

        const points: IWaterPoint[] = SPRING.anchorReaches.map((reach, index) => ({
            x: cx + dx * (radius * reach),
            z: cz + dz * (radius * reach),
            waterlineElevation: restingElevation,
            halfWidth:
                SPRING.halfWidthRatios[index] > 0
                    ? radius * SPRING.halfWidthRatios[index]
                    : SPRING.rimHalfWidth,
            bedRatio: SPRING.bedRatios[index],
        }));

        const solidPoints = WaterCourseKind.trimToSolidGround(points, ground);
        return solidPoints.length < SPRING.minimumPointCount ? null : solidPoints;
    }

    readonly flows = false;

    plot({ regionFloors, ground, seed, occupiedRegions }: ICoursePlotInput): IWaterPoint[][] {
        const eligibleRegions: number[] = [];
        for (let index = 0; index < regionFloors.length; index += 1) {
            const floor = regionFloors[index];
            if (
                !occupiedRegions.has(index) &&
                floor.halfWidth >= SPRING.minimumRegionHalfSpan &&
                floor.halfDepth >= SPRING.minimumRegionHalfSpan
            )
                eligibleRegions.push(index);
        }

        const courses: IWaterPoint[][] = [];
        for (
            let springIndex = 0;
            springIndex < SPRING.maximumCount && eligibleRegions.length > 0;
            springIndex += 1
        ) {
            const pickSeed = seed + SPRING.seedOffset + springIndex * SPRING.seedStride;
            const listIndex = (Math.abs(pickSeed) + springIndex) % eligibleRegions.length;
            const points = Spring.generate(
                regionFloors[eligibleRegions[listIndex]],
                pickSeed,
                ground
            );
            if (points) courses.push(points);

            eligibleRegions.splice(listIndex, 1);
        }

        return courses;
    }
}

export function plotWaterCourses(
    regionFloors: IRegionFloor[],
    regionLinks: IRegionLink[],
    corridorPaths: ICorridorPath[],
    ground: ISurfaceHeightProbe,
    seed: number
): IWaterCourse[] {
    if (regionFloors.length === 0) return [];

    const input: ICoursePlotInput = {
        regionFloors,
        regionLinks,
        corridorPaths,
        ground,
        seed,
        occupiedRegions: new Set(),
    };

    const courses: IWaterCourse[] = [];
    for (const name of ground.border.waterCourses) {
        const kind = WATER_COURSE_KINDS[name];
        for (const points of kind.plot(input)) {
            const falls: number[] = [];
            for (let index = 0; index + 1 < points.length; index += 1)
                if (
                    points[index].waterlineElevation - points[index + 1].waterlineElevation >
                    JUMP_CLIMB.stepRise
                )
                    falls.push(index);
            courses.push({ points, flows: kind.flows, falls });
        }
    }
    return courses;
}

export function isCliffCorridor(corridor: {
    readonly fromElevation: number;
    readonly toElevation: number;
}): boolean {
    return !(Math.abs(corridor.toElevation - corridor.fromElevation) <= JUMP_CLIMB.stepRise);
}

const WATER_COURSE_KINDS: Record<WaterCourseName, WaterCourseKind> = {
    routeRiver: new RouteRiver(),
    borderRiver: new BorderRiver(),
    spring: new Spring(),
};
