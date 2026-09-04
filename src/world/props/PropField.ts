import type { Vector3Tuple } from "three";
import { PropLayer, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import {
    createHeightMapSample,
    type IHeightMapSample,
    type TerrainHeightMap,
} from "@/world/terrain/TerrainHeightMap";
import { PropOccupancy } from "@/world/props/PropOccupancy";
import { PropCollector } from "@/world/props/PropCollector";
import { trailWearAt } from "@/world/terrain/GroundMaterials";
import { PROP_FIELD } from "@/constants/placement";
import { SPAWNING } from "@/constants/characters";
import { WORLD_EDGE } from "@/constants/world";
import { FractalNoise } from "@/lib/noise";
import {
    clamp,
    createSeededRandom,
    lerp,
    pickRandomSubset,
    scaleBetween,
    FULL_TURN,
} from "@/lib/helpers";

export function buildPropField(input: IPropFieldInput): IPropGroup[][] {
    const nextRandom = createSeededRandom(input.seed);
    const speciesByLayer = groupSpeciesByLayer(input.manifest.props);

    const field: IFieldContext = {
        heightMap: input.heightMap,
        center: input.center,
        occupancy: new PropOccupancy(input.fieldRadius, PROP_FIELD.occupancyCellSize),
        collector: new PropCollector(),
        heightSample: createHeightMapSample(),
        remainingColliderBudget: PROP_FIELD.collidingPropBudget,
        nextRandom,
    };

    reserveGameplayZones(field.occupancy, input);

    const clumps = seedClumps(input, speciesByLayer, nextRandom);
    for (const clump of clumps) fillClump(clump, field);

    scatterOpenGroundcover(input, speciesByLayer.groundcover, field);
    scatterDebris(input, speciesByLayer.debris, field);

    return field.collector.toBuckets();
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

function reserveGameplayZones(occupancy: PropOccupancy, input: IPropFieldInput): void {
    const { combatArenaRatio, enemySpawnClearance, laneClearanceRatio, chapterSpawnClearance } =
        PROP_FIELD.keepOut;

    for (const site of input.sites) {
        const shortestSpan = Math.min(site.halfWidth, site.halfDepth) * 2;
        const enemyRingReach = shortestSpan * SPAWNING.enemyRingRadiusFactor + enemySpawnClearance;

        occupancy.reserve(
            site.centerX,
            site.centerZ,
            Math.max(shortestSpan * combatArenaRatio, enemyRingReach)
        );
    }

    for (const lane of input.lanes)
        occupancy.reserveLane(
            lane.fromX,
            lane.fromZ,
            lane.toX,
            lane.toZ,
            lane.halfWidth * laneClearanceRatio
        );

    for (const point of input.chapterSpawnPoints)
        occupancy.reserve(point[0], point[1], chapterSpawnClearance);
}

function seedClumps(
    input: IPropFieldInput,
    speciesByLayer: ISpeciesByLayer,
    nextRandom: () => number
): IPropClump[] {
    const settings = PROP_FIELD.clump;
    const mask = new FractalNoise(input.seed + 11);
    const clumps: IPropClump[] = [];

    const [minimumRadius, maximumRadius] = settings.radiusRange;
    const spacing = settings.candidateSpacing;
    const cellsFromCentre = Math.ceil(input.fieldRadius / spacing);

    for (let row = -cellsFromCentre; row <= cellsFromCentre; row += 1) {
        for (let column = -cellsFromCentre; column <= cellsFromCentre; column += 1) {
            const centerX = (column + nextRandom() - 0.5) * spacing;
            const centerZ = (row + nextRandom() - 0.5) * spacing;

            if (Math.hypot(centerX, centerZ) > input.fieldRadius) continue;

            const forestStrength = mask.sample(
                centerX / settings.maskWavelength,
                centerZ / settings.maskWavelength,
                settings.maskOctaves,
                settings.maskGain
            );

            if (forestStrength < settings.forestThreshold) continue;

            const groveStrength =
                (forestStrength - settings.forestThreshold) / (1 - settings.forestThreshold);
            const isOutcrop =
                forestStrength > settings.outcropThreshold && speciesByLayer.rock.length > 0;

            clumps.push({
                centerX,
                centerZ,
                radius: lerp(minimumRadius, maximumRadius, groveStrength),
                richness: richnessAt(centerX, centerZ, input.sites),
                standing: pickRandomSubset(
                    isOutcrop ? speciesByLayer.rock : speciesByLayer.canopy,
                    settings.canopySpeciesPerClump,
                    nextRandom
                ),
                standingRules: isOutcrop ? PROP_FIELD.rock : PROP_FIELD.canopy,
                understory: pickRandomSubset(
                    speciesByLayer.understory,
                    settings.understorySpeciesPerClump,
                    nextRandom
                ),
                groundcover: pickRandomSubset(
                    speciesByLayer.groundcover,
                    settings.groundcoverSpeciesPerClump,
                    nextRandom
                ),
            });
        }
    }

    return clumps;
}

function richnessAt(localX: number, localZ: number, sites: IRegionSite[]): number {
    const [minimumRichness, maximumRichness] = PROP_FIELD.richnessRange;

    for (const site of sites) {
        if (Math.abs(localX - site.centerX) > site.halfWidth) continue;
        if (Math.abs(localZ - site.centerZ) > site.halfDepth) continue;

        return clamp(
            site.fileCount / PROP_FIELD.typicalFileCount,
            minimumRichness,
            maximumRichness
        );
    }

    return 1;
}

function fillClump(clump: IPropClump, field: IFieldContext): void {
    const clumpArea = Math.PI * clump.radius * clump.radius;
    const standingRules = clump.standingRules;

    const standingPlaced = scatterAroundCentre(
        clump,
        clump.standing,
        Math.round(clumpArea * standingRules.density * clump.richness),
        standingRules,
        clump.radius,
        field
    );

    scatterAgainstNeighbours(
        clump,
        clump.understory,
        Math.round(clumpArea * PROP_FIELD.understory.density * clump.richness),
        standingPlaced,
        field
    );

    scatterAroundCentre(
        clump,
        clump.groundcover,
        Math.round(clumpArea * PROP_FIELD.groundcover.density * clump.richness),
        PROP_FIELD.groundcover,
        clump.radius,
        field
    );
}

const spot = { localX: 0, localZ: 0 };

function scatterAroundCentre(
    clump: IPropClump,
    species: IThemeProp[],
    count: number,
    rules: IPlacementRules,
    spreadRadius: number,
    field: IFieldContext
): IPlacedStanding[] {
    const placed: IPlacedStanding[] = [];
    if (species.length === 0) return placed;

    for (let index = 0; index < count; index += 1) {
        const prop = species[Math.floor(field.nextRandom() * species.length)];
        if (!prop) continue;

        for (let attempt = 0; attempt < PROP_FIELD.placementAttempts; attempt += 1) {
            const angle = field.nextRandom() * FULL_TURN;
            const distance = Math.pow(field.nextRandom(), rules.centreBias) * spreadRadius;

            spot.localX = clump.centerX + Math.cos(angle) * distance;
            spot.localZ = clump.centerZ + Math.sin(angle) * distance;

            if (!placeProp(prop, spot.localX, spot.localZ, rules, field)) continue;

            if (prop.layer === PropLayer.Canopy || prop.layer === PropLayer.Rock)
                placed.push({ localX: spot.localX, localZ: spot.localZ });

            break;
        }
    }

    return placed;
}

function scatterAgainstNeighbours(
    clump: IPropClump,
    species: IThemeProp[],
    count: number,
    neighbours: IPlacedStanding[],
    field: IFieldContext
): void {
    if (species.length === 0) return;

    const { huddleRatio, huddleRadius } = PROP_FIELD.understory;

    for (let index = 0; index < count; index += 1) {
        const prop = species[Math.floor(field.nextRandom() * species.length)];
        if (!prop) continue;

        const huddles = neighbours.length > 0 && field.nextRandom() < huddleRatio;
        const host = huddles
            ? neighbours[Math.floor(field.nextRandom() * neighbours.length)]
            : undefined;

        for (let attempt = 0; attempt < PROP_FIELD.placementAttempts; attempt += 1) {
            const angle = field.nextRandom() * FULL_TURN;
            const spreadRadius = host ? huddleRadius : clump.radius;
            const distance = Math.sqrt(field.nextRandom()) * spreadRadius;

            spot.localX = (host ? host.localX : clump.centerX) + Math.cos(angle) * distance;
            spot.localZ = (host ? host.localZ : clump.centerZ) + Math.sin(angle) * distance;

            if (placeProp(prop, spot.localX, spot.localZ, PROP_FIELD.understory, field)) break;
        }
    }
}

function scatterOpenGroundcover(
    input: IPropFieldInput,
    species: IThemeProp[],
    field: IFieldContext
): void {
    if (species.length === 0) return;

    const settings = PROP_FIELD.groundcover;
    const patches = new FractalNoise(input.seed + 23);

    const fieldArea = Math.PI * input.fieldRadius * input.fieldRadius;
    const count = Math.round(fieldArea * settings.openDensity);

    for (let index = 0; index < count; index += 1) {
        const prop = species[Math.floor(field.nextRandom() * species.length)];
        if (!prop) continue;

        const angle = field.nextRandom() * FULL_TURN;
        const distance = Math.sqrt(field.nextRandom()) * input.fieldRadius;
        const localX = Math.cos(angle) * distance;
        const localZ = Math.sin(angle) * distance;

        const patchStrength = patches.sample(
            localX / settings.meadowPatchWavelength,
            localZ / settings.meadowPatchWavelength,
            PROP_FIELD.clump.maskOctaves,
            PROP_FIELD.clump.maskGain
        );

        if (patchStrength < settings.openPatchThreshold) continue;

        placeProp(prop, localX, localZ, settings, field);
    }
}

function scatterDebris(input: IPropFieldInput, species: IThemeProp[], field: IFieldContext): void {
    if (species.length === 0 || input.lanes.length === 0) return;

    const settings = PROP_FIELD.debris;
    const fieldArea = Math.PI * input.fieldRadius * input.fieldRadius;
    const count = Math.round(fieldArea * settings.density);

    for (let index = 0; index < count; index += 1) {
        const prop = species[Math.floor(field.nextRandom() * species.length)];
        if (!prop) continue;

        if (field.nextRandom() < settings.trailShoulderRatio) proposeTrailShoulder(input, field);
        else proposeOpenGround(input, field);

        placeProp(prop, spot.localX, spot.localZ, settings, field);
    }
}

function proposeTrailShoulder(input: IPropFieldInput, field: IFieldContext): void {
    const lane = input.lanes[Math.floor(field.nextRandom() * input.lanes.length)];
    if (!lane) {
        proposeOpenGround(input, field);
        return;
    }

    const spanX = lane.toX - lane.fromX;
    const spanZ = lane.toZ - lane.fromZ;
    const spanLength = Math.hypot(spanX, spanZ);
    if (spanLength === 0) {
        proposeOpenGround(input, field);
        return;
    }

    const alongRatio = field.nextRandom();
    const side = field.nextRandom() < 0.5 ? -1 : 1;
    const [nearShoulder, farShoulder] = PROP_FIELD.debris.shoulderOffsetRatio;
    const lateralDistance =
        lane.halfWidth * lerp(1 + nearShoulder, 1 + farShoulder, field.nextRandom());

    spot.localX = lane.fromX + spanX * alongRatio + (-spanZ / spanLength) * side * lateralDistance;
    spot.localZ = lane.fromZ + spanZ * alongRatio + (spanX / spanLength) * side * lateralDistance;
}

function proposeOpenGround(input: IPropFieldInput, field: IFieldContext): void {
    const angle = field.nextRandom() * FULL_TURN;
    const distance = Math.sqrt(field.nextRandom()) * input.fieldRadius;

    spot.localX = Math.cos(angle) * distance;
    spot.localZ = Math.sin(angle) * distance;
}

function placeProp(
    prop: IThemeProp,
    localX: number,
    localZ: number,
    rules: IPlacementRules,
    field: IFieldContext
): boolean {
    const collides = prop.layer === PropLayer.Canopy || prop.layer === PropLayer.Rock;
    if (collides && field.remainingColliderBudget <= 0) return false;

    const scale =
        scaleBetween(prop.scaleRange, field.nextRandom()) *
        lerp(rules.scaleBoost[0], rules.scaleBoost[1], field.nextRandom());
    const footprintRadius = prop.footprintRadius * scale;

    if (!field.occupancy.isClear(localX, localZ, footprintRadius + rules.spacingGap)) return false;

    const sample = field.heightMap.sampleAt(localX, localZ, field.heightSample);
    if (sample.footprintDistance > WORLD_EDGE.groundApron) return false;
    if (sample.steepness > rules.slopeLimit) return false;
    if (trailWearAt(sample.trailDistance) > PROP_FIELD.trailWearRejectThreshold) return false;
    if (collides && !hasLevelRim(localX, localZ, footprintRadius, rules.slopeLimit, field))
        return false;

    field.occupancy.reserve(localX, localZ, footprintRadius);
    if (collides) field.remainingColliderBudget -= 1;

    field.collector.add(
        prop,
        collides,
        field.center[0] + localX,
        sample.elevation - PROP_FIELD.groundBite,
        field.center[2] + localZ,
        field.nextRandom() * FULL_TURN,
        scale
    );

    return true;
}

const rimSample = createHeightMapSample();
const RIM_PROBE_COUNT = 6;

function hasLevelRim(
    localX: number,
    localZ: number,
    clearanceRadius: number,
    slopeLimit: number,
    field: IFieldContext
): boolean {
    for (let probe = 0; probe < RIM_PROBE_COUNT; probe += 1) {
        const angle = (probe / RIM_PROBE_COUNT) * FULL_TURN;

        field.heightMap.sampleAt(
            localX + Math.cos(angle) * clearanceRadius,
            localZ + Math.sin(angle) * clearanceRadius,
            rimSample
        );

        if (rimSample.steepness > slopeLimit) return false;
    }

    return true;
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

export interface IPropFieldInput {
    manifest: IThemeManifest;
    heightMap: TerrainHeightMap;
    sites: IRegionSite[];
    lanes: ICorridorLane[];
    chapterSpawnPoints: [number, number][];
    center: Vector3Tuple;
    fieldRadius: number;
    seed: number;
}

interface ISpeciesByLayer {
    canopy: IThemeProp[];
    rock: IThemeProp[];
    understory: IThemeProp[];
    groundcover: IThemeProp[];
    debris: IThemeProp[];
}

interface IPlacementRules {
    density: number;
    slopeLimit: number;
    scaleBoost: [number, number];
    centreBias: number;
    spacingGap: number;
}

interface IPropClump {
    centerX: number;
    centerZ: number;
    radius: number;
    richness: number;
    standing: IThemeProp[];
    standingRules: IPlacementRules;
    understory: IThemeProp[];
    groundcover: IThemeProp[];
}

interface IPlacedStanding {
    localX: number;
    localZ: number;
}

interface IFieldContext {
    heightMap: TerrainHeightMap;
    center: Vector3Tuple;
    occupancy: PropOccupancy;
    collector: PropCollector;
    heightSample: IHeightMapSample;
    remainingColliderBudget: number;
    nextRandom: () => number;
}
