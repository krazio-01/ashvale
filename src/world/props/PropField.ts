import type { ISpeciesByLayer, IPropFieldInput } from "@/types/world";
import { type IPropGroup, type IThemeProp } from "@/types/world";
import { createGridSample } from "@/world/terrain/TerrainGeneration";
import { PropOccupancy, PropCollector } from "@/world/props/PropPlacement";
import {
    fillClump,
    scatterDebris,
    scatterDistantTreeline,
    scatterGroundcoverPatches,
    seedClumps,
} from "@/world/props/PropScatter";
import { decorateWaterCourse } from "@/world/props/WaterEdgeDecor";
import type { IPropScatterContext } from "@/world/props/PropPlacement";
import { PROP_SCATTER } from "@/constants/placement";
import { createSeededRandom } from "@/lib/helpers";

interface IPropFieldResult {
    chunks: IPropGroup[][];
    occupancy: PropOccupancy;
}

export function buildPropField(input: IPropFieldInput): IPropFieldResult {
    const nextRandom = createSeededRandom(input.seed);
    const speciesByLayer = groupSpeciesByLayer(input.manifest.props);

    const scatter: IPropScatterContext = {
        sampleGrid: input.sampleGrid,
        center: input.center,
        occupancy: new PropOccupancy(input.fieldRadius, PROP_SCATTER.occupancyCellSize),
        collector: new PropCollector(),
        scratchSample: createGridSample(),
        remainingColliderBudget: PROP_SCATTER.collidingPropBudget,
        nextRandom,
        clutterSpecies: speciesByLayer.groundcover,
    };

    reserveGameplayZones(scatter, input);
    reserveSettlementZones(scatter, input);

    for (const course of input.waterCourses ?? [])
        decorateWaterCourse(course, speciesByLayer, scatter);

    for (const clump of seedClumps(input, speciesByLayer, nextRandom)) fillClump(clump, scatter);

    scatterGroundcoverPatches(input, speciesByLayer.groundcover, scatter);
    scatterDebris(input, speciesByLayer.debris, scatter);
    scatterDistantTreeline(input, speciesByLayer.canopy, scatter);

    const [fieldCenterX, , fieldCenterZ] = scatter.center;

    for (const placement of input.settlement?.placements ?? [])
        scatter.collector.add(
            placement.prop,
            placement.hasCollider,
            fieldCenterX + placement.localX,
            placement.elevation,
            fieldCenterZ + placement.localZ,
            placement.rotationY,
            placement.scale
        );

    return { chunks: scatter.collector.toChunks(), occupancy: scatter.occupancy };
}

function reserveSettlementZones(scatter: IPropScatterContext, input: IPropFieldInput): void {
    const settlement = input.settlement;
    if (!settlement) return;

    for (const disc of settlement.keepOutDiscs)
        scatter.occupancy.reserve(disc.localX, disc.localZ, disc.radius);

    for (const lane of settlement.keepOutLanes)
        scatter.occupancy.reserveLane(lane.fromX, lane.fromZ, lane.toX, lane.toZ, lane.halfWidth);
}

function reserveGameplayZones(scatter: IPropScatterContext, input: IPropFieldInput): void {
    const { combatArenaRatio, laneClearanceRatio, chapterSpawnClearance } = PROP_SCATTER.keepOut;

    for (const site of input.sites) {
        const shortestSpan = Math.min(site.halfWidth, site.halfDepth) * 2;

        scatter.occupancy.reserve(site.centerX, site.centerZ, shortestSpan * combatArenaRatio);
    }

    for (const lane of input.lanes)
        scatter.occupancy.reserveLane(
            lane.fromX,
            lane.fromZ,
            lane.toX,
            lane.toZ,
            lane.halfWidth * laneClearanceRatio
        );

    for (const point of input.chapterSpawnPoints)
        scatter.occupancy.reserve(point[0], point[1], chapterSpawnClearance);
}

function groupSpeciesByLayer(props: IThemeProp[]): ISpeciesByLayer {
    const speciesByLayer: ISpeciesByLayer = {
        canopy: [],
        rock: [],
        understory: [],
        groundcover: [],
        debris: [],
    };

    for (const prop of props) {
        speciesByLayer[prop.layer].push(prop);
    }

    return speciesByLayer;
}
