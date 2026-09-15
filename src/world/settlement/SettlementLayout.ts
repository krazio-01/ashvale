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
/* Buildings are ~11-14 world units across, so how many fit is a property of the region, not a
   number to pick at random: a fixed 3-8 left small regions empty and large ones sparse. */
const AREA_PER_BUILDING = metres(15) * metres(15);
const SITE_MARGIN = metres(2.5);
const BUILDING_GAP = metres(1.5);
/* Corridor lanes converge on the region centre, so the centre is usually unavailable. Searching
   angle as well as radius lets a building find the gaps between corridors instead of giving up
   on its one assigned ray. */
const ANGLE_ATTEMPTS = 8;
const RADIUS_ATTEMPTS = 6;
const GOLDEN_ANGLE = FULL_TURN * 0.618034;
const RING_RADIUS_RATIO = 0.7;
const ANGLE_JITTER = 0.3;
const DOOR_LANE_HALF_WIDTH = metres(1.2);
/* Beyond corridor lanes (which only exist between region centres), the region floor can carry a
   decorative walking trail with no relation to those lanes - buildSettlementLayout never checked
   it, so a building's whole silhouette could land squarely on the path.

   This must be a FIXED clearance, not one that scales with the building's circumRadius: sampled
   trailDistance is capped at TRAIL.distanceLimit (~14 world units - the point past which the
   terrain system stops tracking real distance and just reports "far enough"), so a threshold of
   circumRadius + margin exceeded that cap for every building size and rejected every candidate
   unconditionally, silently zeroing out every settlement in the chapter. */
const TRAIL_AVOIDANCE_CLEARANCE = metres(3);

export interface ISettlementLayoutInput {
    site: IRegionSite;
    /* Corridor lanes crossing this region. Buildings carry hard colliders and are placed
       unconditionally, so one landing on a lane would wall off the route between regions -
       scattered props avoid lanes via the occupancy reservation, but these never go through it. */
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
        /* Circumradius including the roof overhang, not the wall half-extent: the building is
           rotated to face the plaza, so its diagonal - and the roof that oversails it - is what
           has to clear the site edge, its neighbours and the corridors. */
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

                /* Placed discs already carry BUILDING_GAP, so the candidate contributes its bare
                   circumradius. */
                if (overlapsPlaced(keepOutDiscs, centerX, centerZ, circumRadius)) continue;
                if (blocksLane(lanes, centerX, centerZ, circumRadius)) continue;
                heightMap.sampleAt(centerX, centerZ, gridSample);
                if (gridSample.trailDistance < TRAIL_AVOIDANCE_CLEARANCE) continue;

                /* Templates put the door on the last row, i.e. the +Z edge, so yaw turns +Z
                   toward the site centre. */
                const yaw = Math.atan2(site.centerX - centerX, site.centerZ - centerZ);
                const cosYaw = Math.cos(yaw);
                const sinYaw = Math.sin(yaw);

                const building = generateBuilding({
                    template,
                    /* generateBuilding rotates cells about the template's (0,0) corner, so place
                       that corner where it lands once the building is rotated about its centre. */
                    originLocalX: centerX - halfWidth * cosYaw - halfDepth * sinYaw,
                    originLocalZ: centerZ + halfWidth * sinYaw - halfDepth * cosYaw,
                    yaw,
                    heightMap,
                    nextRandom,
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
