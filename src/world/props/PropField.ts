import type { Vector3Tuple } from "three";
import { PropLayer, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import { createGridSample, type TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { PropOccupancy, PropCollector } from "@/world/props/PropFieldState";
import {
    fillClump,
    scatterDebris,
    scatterDistantTreeline,
    scatterGroundcoverPatches,
    seedClumps,
} from "@/world/props/PropScatter";
import { decorateWaterCourse } from "@/world/props/WaterEdgeDecor";
import type { IFieldContext } from "@/world/props/PropPlacement";
import type { IWaterCourse } from "@/world/water/WaterCourse";
import { PROP_FIELD } from "@/constants/placement";
import { SPAWNING } from "@/constants/characters";
import { createSeededRandom } from "@/lib/helpers";

export function buildPropField(input: IPropFieldInput): IPropGroup[][] {
    const nextRandom = createSeededRandom(input.seed);
    const speciesByLayer = groupSpeciesByLayer(input.manifest.props);

    const field: IFieldContext = {
        heightMap: input.heightMap,
        center: input.center,
        occupancy: new PropOccupancy(input.fieldRadius, PROP_FIELD.occupancyCellSize),
        collector: new PropCollector(),
        heightSample: createGridSample(),
        remainingColliderBudget: PROP_FIELD.collidingPropBudget,
        nextRandom,
        clutterSpecies: speciesByLayer.groundcover,
    };

    reserveGameplayZones(field, input);

    for (const course of input.waterCourses ?? [])
        decorateWaterCourse(course, speciesByLayer, field);

    for (const clump of seedClumps(input, speciesByLayer, nextRandom)) fillClump(clump, field);

    scatterGroundcoverPatches(input, speciesByLayer.groundcover, field);
    scatterDebris(input, speciesByLayer.debris, field);
    scatterDistantTreeline(input, speciesByLayer.canopy, field);

    return field.collector.toBuckets();
}

function reserveGameplayZones(field: IFieldContext, input: IPropFieldInput): void {
    const { combatArenaRatio, enemySpawnClearance, laneClearanceRatio, chapterSpawnClearance } =
        PROP_FIELD.keepOut;

    for (const site of input.sites) {
        const shortestSpan = Math.min(site.halfWidth, site.halfDepth) * 2;
        const enemyRingReach = shortestSpan * SPAWNING.enemyRingRadiusFactor + enemySpawnClearance;

        field.occupancy.reserve(
            site.centerX,
            site.centerZ,
            Math.max(shortestSpan * combatArenaRatio, enemyRingReach)
        );
    }

    for (const lane of input.lanes)
        field.occupancy.reserveLane(
            lane.fromX,
            lane.fromZ,
            lane.toX,
            lane.toZ,
            lane.halfWidth * laneClearanceRatio
        );

    for (const point of input.chapterSpawnPoints)
        field.occupancy.reserve(point[0], point[1], chapterSpawnClearance);
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
        if (prop.layer === PropLayer.Canopy) speciesByLayer.canopy.push(prop);
        else if (prop.layer === PropLayer.Rock) speciesByLayer.rock.push(prop);
        else if (prop.layer === PropLayer.Understory) speciesByLayer.understory.push(prop);
        else if (prop.layer === PropLayer.Groundcover) speciesByLayer.groundcover.push(prop);
        else speciesByLayer.debris.push(prop);
    }

    return speciesByLayer;
}

export interface IPropFieldInput {
    manifest: IThemeManifest;
    heightMap: TerrainSampleGrid;
    sites: IRegionSite[];
    lanes: ICorridorLane[];
    chapterSpawnPoints: [number, number][];
    center: Vector3Tuple;
    fieldRadius: number;
    seed: number;
    waterCourses?: IWaterCourse[] | null;
}

export interface IRegionSite {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
    fileCount: number;
}

export interface ICorridorLane {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
}

export interface ISpeciesByLayer {
    canopy: IThemeProp[];
    rock: IThemeProp[];
    understory: IThemeProp[];
    groundcover: IThemeProp[];
    debris: IThemeProp[];
}
