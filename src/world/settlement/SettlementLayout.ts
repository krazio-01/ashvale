import type {
    ISettlementKeepOutDisc,
    ISettlementLayoutResult,
    ISettlementPlacement,
} from "@/types/settlement";
import type { ICorridorLane, IRegionSite } from "@/world/props/PropField";
import { createGridSample, type TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { generateBuilding } from "@/world/settlement/SettlementBuilding";
import { SETTLEMENT_TEMPLATES } from "@/world/settlement/SettlementTemplates";
import { CELL_SIZE, ROOF_OVERHANG } from "@/world/settlement/SettlementKit";
import { clamp, createSeededRandom, FULL_TURN, metres } from "@/lib/helpers";

const MAX_BUILDINGS = 8;
const AREA_PER_BUILDING = metres(15) * metres(15);
const SITE_MARGIN = metres(2.5);
const BUILDING_GAP = metres(1.5);
const ANGLE_ATTEMPTS = 8;
const RADIUS_ATTEMPTS = 6;
const GOLDEN_ANGLE = FULL_TURN * 0.618034;
const RING_RADIUS_RATIO = 0.7;
const ANGLE_JITTER = 0.3;
const DOOR_LANE_HALF_WIDTH = metres(1.2);
const TRAIL_AVOIDANCE_CLEARANCE = metres(3);

interface ISettlementLayoutInput {
    site: IRegionSite;
    lanes: ICorridorLane[];
    heightMap: TerrainSampleGrid;
    seed: number;
}

export function buildSettlementLayout(input: ISettlementLayoutInput): ISettlementLayoutResult {
    const { site, lanes, heightMap, seed } = input;
    const nextRandom = createSeededRandom(seed);
    const gridSample = createGridSample();

    const placements: ISettlementPlacement[] = [];
    const colliders: ISettlementLayoutResult["colliders"] = [];
    const keepOutDiscs: ISettlementKeepOutDisc[] = [];
    const keepOutLanes: ISettlementLayoutResult["keepOutLanes"] = [];

    const usableWidth = Math.max(0, 2 * (site.halfWidth - SITE_MARGIN));
    const usableDepth = Math.max(0, 2 * (site.halfDepth - SITE_MARGIN));
    const buildingCount = clamp(
        Math.floor((usableWidth * usableDepth) / AREA_PER_BUILDING),
        1,
        MAX_BUILDINGS
    );
    const ringRadius =
        Math.max(1, Math.min(site.halfWidth, site.halfDepth) - SITE_MARGIN) * RING_RADIUS_RATIO;

    for (let index = 0; index < buildingCount; index += 1) {
        const template = SETTLEMENT_TEMPLATES[index % SETTLEMENT_TEMPLATES.length];
        if (!template) continue;

        const halfWidth = (template.widthCells * CELL_SIZE) / 2;
        const halfDepth = (template.depthCells * CELL_SIZE) / 2;
        const circumRadius = Math.hypot(halfWidth, halfDepth) + ROOF_OVERHANG;
        const baseAngle = (index / buildingCount) * FULL_TURN + nextRandom() * ANGLE_JITTER;

        for (let angleStep = 0; angleStep < ANGLE_ATTEMPTS; angleStep += 1) {
            const angle = baseAngle + angleStep * GOLDEN_ANGLE;
            const cosAngle = Math.cos(angle);
            const sinAngle = Math.sin(angle);
            let settled = false;

            for (let radiusStep = 0; radiusStep < RADIUS_ATTEMPTS; radiusStep += 1) {
                const radius = ringRadius * (1 - radiusStep / (RADIUS_ATTEMPTS - 1));
                const centerX = site.centerX + cosAngle * radius;
                const centerZ = site.centerZ + sinAngle * radius;

                const withinBounds =
                    Math.abs(centerX - site.centerX) + circumRadius <=
                        site.halfWidth - SITE_MARGIN &&
                    Math.abs(centerZ - site.centerZ) + circumRadius <= site.halfDepth - SITE_MARGIN;
                if (!withinBounds) continue;

                if (overlapsPlaced(keepOutDiscs, centerX, centerZ, circumRadius)) continue;
                if (blocksLane(lanes, centerX, centerZ, circumRadius)) continue;
                heightMap.sampleAt(centerX, centerZ, gridSample);
                if (gridSample.trailDistance < TRAIL_AVOIDANCE_CLEARANCE) continue;
                if (gridSample.steepness > 0.12) continue;

                const yaw = Math.atan2(site.centerX - centerX, site.centerZ - centerZ);
                const cosYaw = Math.cos(yaw);
                const sinYaw = Math.sin(yaw);

                const originLocalX = centerX - halfWidth * cosYaw - halfDepth * sinYaw;
                const originLocalZ = centerZ + halfWidth * sinYaw - halfDepth * cosYaw;

                const corner1Elevation = heightMap.surfaceElevationAt(originLocalX, originLocalZ);
                const corner2Elevation = heightMap.surfaceElevationAt(
                    originLocalX + template.widthCells * CELL_SIZE * cosYaw,
                    originLocalZ - template.widthCells * CELL_SIZE * sinYaw
                );
                const corner3Elevation = heightMap.surfaceElevationAt(
                    originLocalX + template.depthCells * CELL_SIZE * sinYaw,
                    originLocalZ + template.depthCells * CELL_SIZE * cosYaw
                );
                const corner4Elevation = heightMap.surfaceElevationAt(
                    originLocalX +
                        template.widthCells * CELL_SIZE * cosYaw +
                        template.depthCells * CELL_SIZE * sinYaw,
                    originLocalZ -
                        template.widthCells * CELL_SIZE * sinYaw +
                        template.depthCells * CELL_SIZE * cosYaw
                );

                const elevationSpread =
                    Math.max(
                        corner1Elevation,
                        corner2Elevation,
                        corner3Elevation,
                        corner4Elevation,
                        gridSample.elevation
                    ) -
                    Math.min(
                        corner1Elevation,
                        corner2Elevation,
                        corner3Elevation,
                        corner4Elevation,
                        gridSample.elevation
                    );
                if (elevationSpread > 0.35) continue;

                const building = generateBuilding({
                    template,
                    originLocalX,
                    originLocalZ,
                    yaw,
                    heightMap,
                    nextRandom,
                    floorElevation: site.floorElevation,
                });

                placements.push(...building.placements);
                colliders.push(...building.colliders);
                keepOutDiscs.push({
                    localX: centerX,
                    localZ: centerZ,
                    radius: building.footprintRadius + BUILDING_GAP,
                });
                keepOutLanes.push({
                    fromX: site.centerX,
                    fromZ: site.centerZ,
                    toX: building.doorLocalX,
                    toZ: building.doorLocalZ,
                    halfWidth: DOOR_LANE_HALF_WIDTH,
                });

                settled = true;
                break;
            }

            if (settled) break;
        }
    }

    if (placements.length === 0)
        console.warn(
            `[settlement] no buildings fit region at (${site.centerX.toFixed(1)}, ${site.centerZ.toFixed(1)}) - half extents ${site.halfWidth.toFixed(1)} x ${site.halfDepth.toFixed(1)}`
        );

    return { placements, colliders, keepOutDiscs, keepOutLanes };
}

function blocksLane(
    lanes: ICorridorLane[],
    centerX: number,
    centerZ: number,
    radius: number
): boolean {
    for (const lane of lanes) {
        const spanX = lane.toX - lane.fromX;
        const spanZ = lane.toZ - lane.fromZ;
        const spanLengthSquared = spanX * spanX + spanZ * spanZ;
        const toCenterX = centerX - lane.fromX;
        const toCenterZ = centerZ - lane.fromZ;

        const along =
            spanLengthSquared > 0
                ? Math.min(
                      1,
                      Math.max(0, (toCenterX * spanX + toCenterZ * spanZ) / spanLengthSquared)
                  )
                : 0;

        const nearestX = lane.fromX + spanX * along;
        const nearestZ = lane.fromZ + spanZ * along;
        const gapX = centerX - nearestX;
        const gapZ = centerZ - nearestZ;
        const reach = radius + lane.halfWidth;

        if (gapX * gapX + gapZ * gapZ < reach * reach) return true;
    }

    return false;
}

function overlapsPlaced(
    discs: ISettlementKeepOutDisc[],
    centerX: number,
    centerZ: number,
    radius: number
): boolean {
    for (const disc of discs) {
        const reach = disc.radius + radius;
        const dx = disc.localX - centerX;
        const dz = disc.localZ - centerZ;
        if (dx * dx + dz * dz < reach * reach) return true;
    }

    return false;
}
