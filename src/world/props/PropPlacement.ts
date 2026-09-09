import type { Vector3Tuple } from "three";
import { PropLayer, type IThemeProp } from "@/types/theme";
import {
    createGridSample,
    type IGridSample,
    type TerrainSampleGrid,
} from "@/world/terrain/TerrainGeneration";
import type { PropOccupancy, PropCollector } from "@/world/props/PropFieldState";
import { PROP_FIELD } from "@/constants/placement";
import { WATER_CHANNEL, WORLD_EDGE } from "@/constants/world";
import { clamp, lerp, scaleBetween, smoothstep, FULL_TURN } from "@/lib/helpers";

const SOFT_EDGED_LAYERS = new Set([PropLayer.Understory, PropLayer.Groundcover]);

export enum PlacementOutcome {
    Placed = "placed",
    Blocked = "blocked",
    Thinned = "thinned",
}

export const collidesWithPlayer = (layer: PropLayer): boolean =>
    layer === PropLayer.Canopy || layer === PropLayer.Rock;

export function pickSpecies(species: IThemeProp[], nextRandom: () => number): IThemeProp | null {
    if (species.length === 0) return null;
    if (species.length === 1) return species[0] ?? null;

    return species[Math.floor(nextRandom() * species.length)] ?? null;
}

export function placeProp(
    prop: IThemeProp,
    localX: number,
    localZ: number,
    rules: IPlacementRules,
    field: IFieldContext
): PlacementOutcome {
    const collides = collidesWithPlayer(prop.layer);
    if (collides && field.remainingColliderBudget <= 0) return PlacementOutcome.Blocked;

    const scale =
        scaleBetween(prop.scaleRange, field.nextRandom()) *
        lerp(rules.scaleBoost[0], rules.scaleBoost[1], field.nextRandom());
    const footprintRadius = prop.footprintRadius * scale;

    const sample = passesHardLimits(localX, localZ, footprintRadius, collides, rules, field);
    if (!sample) return PlacementOutcome.Blocked;

    if (SOFT_EDGED_LAYERS.has(prop.layer) && field.nextRandom() >= edgeDensityAt(sample, rules))
        return PlacementOutcome.Thinned;

    commitProp(prop, localX, localZ, sample.elevation - PROP_FIELD.groundBite, scale, field);

    return PlacementOutcome.Placed;
}

function passesHardLimits(
    localX: number,
    localZ: number,
    footprintRadius: number,
    collides: boolean,
    rules: IPlacementRules,
    field: IFieldContext
): IGridSample | undefined {
    if (!field.occupancy.isClear(localX, localZ, footprintRadius + rules.spacingGap))
        return undefined;

    const sample = field.heightMap.sampleAt(localX, localZ, field.heightSample);
    if (sample.footprintDistance > WORLD_EDGE.groundApron) return undefined;
    if (sample.waterDepth > -WATER_CHANNEL.propBankMargin) return undefined;
    if (sample.steepness > rules.slopeLimit) return undefined;
    if (sample.trailDistance < PROP_FIELD.softEdges.trailClearance) return undefined;
    if (collides && !hasLevelRim(localX, localZ, footprintRadius, rules.slopeLimit, field))
        return undefined;

    return sample;
}

export function forceProp(
    prop: IThemeProp,
    localX: number,
    localZ: number,
    scale: number,
    sink: number,
    field: IFieldContext,
    embedClutter = false
): void {
    const sample = field.heightMap.sampleAt(localX, localZ, field.heightSample);

    commitProp(prop, localX, localZ, sample.elevation - sink, scale, field, embedClutter);
}

function commitProp(
    prop: IThemeProp,
    localX: number,
    localZ: number,
    elevation: number,
    scale: number,
    field: IFieldContext,
    embedClutter = true
): void {
    const collides = collidesWithPlayer(prop.layer);
    const footprintRadius = prop.footprintRadius * scale;

    if (collides && embedClutter) embedClutterAroundHost(localX, localZ, footprintRadius, field);

    field.occupancy.reserve(localX, localZ, footprintRadius);
    if (collides) field.remainingColliderBudget -= 1;

    field.collector.add(
        prop,
        collides,
        field.center[0] + localX,
        elevation,
        field.center[2] + localZ,
        field.nextRandom() * FULL_TURN,
        scale
    );
}

function embedClutterAroundHost(
    hostX: number,
    hostZ: number,
    hostFootprintRadius: number,
    field: IFieldContext
): void {
    if (field.clutterSpecies.length === 0) return;

    const settings = PROP_FIELD.embedding;
    const count = clamp(
        Math.round(hostFootprintRadius * settings.countPerFootprintMetre),
        settings.minimumCount,
        settings.maximumCount
    );
    const innerRadius = hostFootprintRadius * settings.innerRadiusRatio;
    const outerRadius = hostFootprintRadius * settings.outerRadiusRatio;

    for (let index = 0; index < count; index += 1) {
        const prop = pickSpecies(field.clutterSpecies, field.nextRandom);
        if (!prop) continue;

        for (let attempt = 0; attempt < settings.placementAttempts; attempt += 1) {
            const angle = field.nextRandom() * FULL_TURN;
            const distance = lerp(
                innerRadius,
                outerRadius,
                Math.pow(field.nextRandom(), settings.rules.centreBias)
            );
            const localX = hostX + Math.cos(angle) * distance;
            const localZ = hostZ + Math.sin(angle) * distance;

            const scale =
                scaleBetween(prop.scaleRange, field.nextRandom()) *
                lerp(
                    settings.rules.scaleBoost[0],
                    settings.rules.scaleBoost[1],
                    field.nextRandom()
                );
            const footprintRadius = prop.footprintRadius * scale;

            const sample = passesHardLimits(
                localX,
                localZ,
                footprintRadius,
                false,
                settings.rules,
                field
            );
            if (!sample) continue;

            commitProp(
                prop,
                localX,
                localZ,
                sample.elevation - PROP_FIELD.groundBite,
                scale,
                field,
                false
            );
            break;
        }
    }
}

function edgeDensityAt(sample: IGridSample, rules: IPlacementRules): number {
    const { trailClearance, trailFadeWidth, slopeFadeRatio, apronFadeWidth } = PROP_FIELD.softEdges;

    const offTrail = smoothstep(
        trailClearance,
        trailClearance + trailFadeWidth,
        sample.trailDistance
    );
    const offSteepGround =
        1 - smoothstep(rules.slopeLimit * slopeFadeRatio, rules.slopeLimit, sample.steepness);
    const insideApron =
        1 -
        smoothstep(
            WORLD_EDGE.groundApron - apronFadeWidth,
            WORLD_EDGE.groundApron,
            sample.footprintDistance
        );

    return offTrail * offSteepGround * insideApron;
}

const rimSample = createGridSample();
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
        if (rimSample.waterDepth > -WATER_CHANNEL.propBankMargin) return false;
        if (rimSample.footprintDistance > WORLD_EDGE.groundApron) return false;
        if (rimSample.trailDistance < PROP_FIELD.softEdges.trailClearance) return false;
    }

    return true;
}

export interface IFieldContext {
    heightMap: TerrainSampleGrid;
    center: Vector3Tuple;
    occupancy: PropOccupancy;
    collector: PropCollector;
    heightSample: IGridSample;
    remainingColliderBudget: number;
    nextRandom: () => number;
    clutterSpecies: IThemeProp[];
}

export interface IPlacementRules {
    density: number;
    slopeLimit: number;
    scaleBoost: [number, number];
    centreBias: number;
    spacingGap: number;
}
