import type {
    ISettlementKeepOutDisc,
    ISettlementLayoutResult,
    ISettlementPlacement,
    ICorridorLane,
    IRegionFloor,
} from "@/types/world";
import { createGridSample, type TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { generateBuilding, footprintCornerElevations } from "@/world/settlement/SettlementBuilding";
import { SETTLEMENT_TEMPLATES } from "@/world/settlement/SettlementTemplates";
import { CELL_SIZE, ROOF_OVERHANG } from "@/world/settlement/SettlementKit";
import {
    clamp,
    createSeededRandom,
    FULL_TURN,
    metresToUnits,
    yawFromDirection,
    distanceToSegmentSquared,
} from "@/lib/helpers";
import { LOG_MESSAGES } from "@/constants/strings";

const MAX_BUILDINGS = 8;
const AREA_PER_BUILDING = metresToUnits(15) * metresToUnits(15);
const SITE_MARGIN = metresToUnits(2.5);
const BUILDING_GAP = metresToUnits(1.5);
const ANGLE_ATTEMPTS = 8;
const RADIUS_ATTEMPTS = 6;
const GOLDEN_ANGLE = FULL_TURN * 0.618034;
const RING_RADIUS_RATIO = 0.7;
const ANGLE_JITTER = 0.3;
const DOOR_LANE_HALF_WIDTH = metresToUnits(1.2);
const TRAIL_AVOIDANCE_CLEARANCE = metresToUnits(3);

interface ISettlementLayoutInput {
    site: IRegionFloor;
    lanes: ICorridorLane[];
    sampleGrid: TerrainSampleGrid;
    seed: number;
}

export function buildSettlementLayout(input: ISettlementLayoutInput): ISettlementLayoutResult {
    const { site, lanes, sampleGrid, seed } = input;
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
                sampleGrid.sampleAt(centerX, centerZ, gridSample);
                if (gridSample.trailDistance < TRAIL_AVOIDANCE_CLEARANCE) continue;
                if (gridSample.steepness > 0.12) continue;

                const yaw = yawFromDirection(site.centerX - centerX, site.centerZ - centerZ);
                const cosYaw = Math.cos(yaw);
                const sinYaw = Math.sin(yaw);

                const originLocalX = centerX - halfWidth * cosYaw - halfDepth * sinYaw;
                const originLocalZ = centerZ + halfWidth * sinYaw - halfDepth * cosYaw;

                const cornerElevations = footprintCornerElevations(
                    sampleGrid,
                    originLocalX,
                    originLocalZ,
                    yaw,
                    template.widthCells * CELL_SIZE,
                    template.depthCells * CELL_SIZE
                );
                const elevationSpread =
                    Math.max(...cornerElevations, gridSample.elevation) -
                    Math.min(...cornerElevations, gridSample.elevation);
                if (elevationSpread > 0.35) continue;

                const building = generateBuilding({
                    template,
                    originLocalX,
                    originLocalZ,
                    yaw,
                    sampleGrid,
                    nextRandom,
                    floorElevation: site.floorElevation,
                    cornerElevations,
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
            LOG_MESSAGES.settlementDidNotFit(
                site.centerX.toFixed(1),
                site.centerZ.toFixed(1),
                site.halfWidth.toFixed(1),
                site.halfDepth.toFixed(1)
            )
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
        const reach = radius + lane.halfWidth;
        const gapSquared = distanceToSegmentSquared(
            centerX,
            centerZ,
            lane.fromX,
            lane.fromZ,
            lane.toX,
            lane.toZ
        );

        if (gapSquared < reach * reach) return true;
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
