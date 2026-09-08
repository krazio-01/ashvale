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
import { WATER_CHANNEL, WORLD_EDGE } from "@/constants/world";
import { FractalNoise } from "@/lib/noise";
import {
    clamp,
    createSeededRandom,
    lerp,
    pickRandomSubset,
    scaleBetween,
    FULL_TURN,
} from "@/lib/helpers";
import type { IWaterCourse } from "@/world/water/WaterCourse";

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

    const courses = input.waterCourses ?? (input.waterCourse ? [input.waterCourse] : []);
    for (const course of courses) {
        decorateRiverCourse(course, speciesByLayer, field);
    }

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
    if (sample.waterDepth > -WATER_CHANNEL.propBankMargin) return false;
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

function decorateRiverCourse(
    waterCourse: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    field: IFieldContext
): void {
    const points = waterCourse.points;
    if (points.length < 2) return;

    if (waterCourse.isMudhole) {
        decorateMudhole(waterCourse, speciesByLayer, field);
        return;
    }

    const sourcePoint = points[0]!;
    const nextPoint = points[1]!;
    const thirdPoint = points[2] ?? nextPoint;

    const travelX = thirdPoint.x - sourcePoint.x;
    const travelZ = thirdPoint.z - sourcePoint.z;
    const travelLen = Math.hypot(travelX, travelZ) || 1;
    const downX = travelX / travelLen;
    const downZ = travelZ / travelLen;
    const upX = -downX;
    const upZ = -downZ;
    const acrossX = -downZ;
    const acrossZ = downX;

    const sourceRadius = Math.max(sourcePoint.halfWidth, 4.0);

    const boulders = speciesByLayer.rock;

    if (boulders.length > 0) {
        const springRimSpots = [
            { cross: 0.0, back: 0.1, scale: 2.8 },
            { cross: -0.35, back: 0.0, scale: 2.6 },
            { cross: 0.35, back: 0.0, scale: 2.6 },
            { cross: -0.7, back: -0.12, scale: 2.5 },
            { cross: 0.7, back: -0.12, scale: 2.5 },
            { cross: -1.05, back: -0.3, scale: 2.3 },
            { cross: 1.05, back: -0.3, scale: 2.3 },
            { cross: -1.35, back: -0.5, scale: 2.2 },
            { cross: 1.35, back: -0.5, scale: 2.2 },
        ];

        for (const spot of springRimSpots) {
            const boulder = boulders[Math.floor(field.nextRandom() * boulders.length)]!;
            const rockX =
                sourcePoint.x +
                acrossX * (sourceRadius * spot.cross) +
                upX * (sourceRadius * spot.back);
            const rockZ =
                sourcePoint.z +
                acrossZ * (sourceRadius * spot.cross) +
                upZ * (sourceRadius * spot.back);
            const sample = field.heightMap.sampleAt(rockX, rockZ, field.heightSample);

            const scale = spot.scale * (0.95 + field.nextRandom() * 0.15);
            const footprint = boulder.footprintRadius * scale;

            field.collector.add(
                boulder,
                true,
                field.center[0] + rockX,
                sample.elevation - 0.3,
                field.center[2] + rockZ,
                field.nextRandom() * FULL_TURN,
                scale
            );
            field.occupancy.reserve(rockX, rockZ, footprint);
        }

        const backwallSpots = [
            { cross: 0.0, back: 0.8, scale: 3.6 },
            { cross: -0.4, back: 0.75, scale: 3.4 },
            { cross: 0.4, back: 0.75, scale: 3.4 },
            { cross: -0.85, back: 0.6, scale: 3.2 },
            { cross: 0.85, back: 0.6, scale: 3.2 },
            { cross: -0.2, back: 1.25, scale: 3.8 },
            { cross: 0.2, back: 1.25, scale: 3.8 },
            { cross: -0.6, back: 1.15, scale: 3.5 },
            { cross: 0.6, back: 1.15, scale: 3.5 },
            { cross: 0.0, back: 1.6, scale: 4.0 },
        ];

        for (const spot of backwallSpots) {
            const boulder = boulders[Math.floor(field.nextRandom() * boulders.length)]!;
            const rockX =
                sourcePoint.x +
                acrossX * (sourceRadius * spot.cross) +
                upX * (sourceRadius * spot.back);
            const rockZ =
                sourcePoint.z +
                acrossZ * (sourceRadius * spot.cross) +
                upZ * (sourceRadius * spot.back);
            const sample = field.heightMap.sampleAt(rockX, rockZ, field.heightSample);

            const scale = spot.scale * (0.95 + field.nextRandom() * 0.15);
            const footprint = boulder.footprintRadius * scale;

            field.collector.add(
                boulder,
                true,
                field.center[0] + rockX,
                sample.elevation - 0.3,
                field.center[2] + rockZ,
                field.nextRandom() * FULL_TURN,
                scale
            );
            field.occupancy.reserve(rockX, rockZ, footprint);
        }
    }

    const foliage = speciesByLayer.groundcover.concat(
        speciesByLayer.understory.filter((p) => !p.modelPath.includes("Flower") && !p.modelPath.includes("Flowers"))
    );
    if (foliage.length > 0) {
        for (let i = 0; i < 10; i += 1) {
            const plant = foliage[Math.floor(field.nextRandom() * foliage.length)]!;
            const crossOffset = (field.nextRandom() - 0.5) * 1.8;
            const backOffset = 0.2 + field.nextRandom() * 0.9;
            const plantX =
                sourcePoint.x +
                acrossX * (sourceRadius * crossOffset) +
                upX * (sourceRadius * backOffset);
            const plantZ =
                sourcePoint.z +
                acrossZ * (sourceRadius * crossOffset) +
                upZ * (sourceRadius * backOffset);
            const sample = field.heightMap.sampleAt(plantX, plantZ, field.heightSample);

            field.collector.add(
                plant,
                false,
                field.center[0] + plantX,
                sample.elevation,
                field.center[2] + plantZ,
                field.nextRandom() * FULL_TURN,
                0.9 + field.nextRandom() * 0.4
            );
        }
    }

    const endPoint = points[points.length - 1]!;
    const prevEnd = points[points.length - 2] ?? endPoint;
    const endTravelX = endPoint.x - prevEnd.x;
    const endTravelZ = endPoint.z - prevEnd.z;
    const endTravelLen = Math.hypot(endTravelX, endTravelZ) || 1;
    const endAcrossX = -endTravelZ / endTravelLen;
    const endAcrossZ = endTravelX / endTravelLen;

    if (boulders.length > 0) {
        for (const side of [-1, 1]) {
            const boulder = boulders[Math.floor(field.nextRandom() * boulders.length)]!;
            const rockX = endPoint.x + endAcrossX * (endPoint.halfWidth + 2.0) * side;
            const rockZ = endPoint.z + endAcrossZ * (endPoint.halfWidth + 2.0) * side;
            const sample = field.heightMap.sampleAt(rockX, rockZ, field.heightSample);

            field.collector.add(
                boulder,
                true,
                field.center[0] + rockX,
                sample.elevation - 0.3,
                field.center[2] + rockZ,
                field.nextRandom() * FULL_TURN,
                1.3 + field.nextRandom() * 0.5
            );
        }
    }
}

function decorateMudhole(
    waterCourse: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    field: IFieldContext
): void {
    const points = waterCourse.points;
    const centerPoint = points[Math.floor(points.length / 2)]!;
    const poolRadius = centerPoint.halfWidth;
    const boulders = speciesByLayer.rock;
    const foliage = speciesByLayer.groundcover.concat(speciesByLayer.understory);

    if (boulders.length > 0) {
        const stoneCount = 6;
        for (let i = 0; i < stoneCount; i += 1) {
            const boulder = boulders[Math.floor(field.nextRandom() * boulders.length)]!;
            const angle = (i / stoneCount) * FULL_TURN + (field.nextRandom() - 0.5) * 0.4;
            const dist = poolRadius + 0.3 + field.nextRandom() * 1.4;
            const rockX = centerPoint.x + Math.cos(angle) * dist;
            const rockZ = centerPoint.z + Math.sin(angle) * dist;
            const sample = field.heightMap.sampleAt(rockX, rockZ, field.heightSample);

            const scale = 0.8 + field.nextRandom() * 0.5;
            const footprint = boulder.footprintRadius * scale;

            field.collector.add(
                boulder,
                true,
                field.center[0] + rockX,
                sample.elevation - 0.2,
                field.center[2] + rockZ,
                field.nextRandom() * FULL_TURN,
                scale
            );
            field.occupancy.reserve(rockX, rockZ, footprint);
        }
    }

    if (foliage.length > 0) {
        const plantCount = 14;
        for (let i = 0; i < plantCount; i += 1) {
            const plant = foliage[Math.floor(field.nextRandom() * foliage.length)]!;
            const angle = field.nextRandom() * FULL_TURN;
            const dist = poolRadius + 0.2 + field.nextRandom() * 1.8;
            const plantX = centerPoint.x + Math.cos(angle) * dist;
            const plantZ = centerPoint.z + Math.sin(angle) * dist;
            const sample = field.heightMap.sampleAt(plantX, plantZ, field.heightSample);

            field.collector.add(
                plant,
                false,
                field.center[0] + plantX,
                sample.elevation,
                field.center[2] + plantZ,
                field.nextRandom() * FULL_TURN,
                0.85 + field.nextRandom() * 0.4
            );
        }
    }

    if (speciesByLayer.canopy.length > 0 && poolRadius >= 4.0) {
        const tree = speciesByLayer.canopy[Math.floor(field.nextRandom() * speciesByLayer.canopy.length)]!;
        const angle = field.nextRandom() * FULL_TURN;
        const dist = poolRadius + 3.0 + field.nextRandom() * 2.0;
        const treeX = centerPoint.x + Math.cos(angle) * dist;
        const treeZ = centerPoint.z + Math.sin(angle) * dist;
        const sample = field.heightMap.sampleAt(treeX, treeZ, field.heightSample);
        const scale = 0.9 + field.nextRandom() * 0.3;
        const footprint = tree.footprintRadius * scale;

        field.collector.add(
            tree,
            true,
            field.center[0] + treeX,
            sample.elevation,
            field.center[2] + treeZ,
            field.nextRandom() * FULL_TURN,
            scale
        );
        field.occupancy.reserve(treeX, treeZ, footprint);
    }
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
    waterCourse?: IWaterCourse | null;
    waterCourses?: IWaterCourse[] | null;
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
