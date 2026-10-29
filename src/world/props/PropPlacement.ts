import { PROP_TRANSFORM_STRIDE, PropLayer } from "@/types/world";
import type { IPropGroup, IThemeProp } from "@/types/world";
import { TERRAIN, WATER_CHANNEL, WORLD_EDGE } from "@/constants/world";
import { clamp, lerp, scaleBetween, smoothstep, FULL_TURN } from "@/lib/helpers";
import type { Vector3Tuple } from "three";
import { createGridSample } from "@/world/terrain/TerrainGeneration";
import type { IGridSample, TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { PROP_FIELD } from "@/constants/placement";

const SOFT_EDGED_LAYERS = new Set([PropLayer.Understory, PropLayer.Groundcover]);

const rimSample = createGridSample();

const RIM_PROBE_COUNT = 6;

interface IGroupBuilder {
    prop: IThemeProp;
    hasCollider: boolean;
    transformValues: number[];
}

export enum PlacementOutcome {
    Placed = "placed",
    Blocked = "blocked",
    Thinned = "thinned",
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

export class PropOccupancy {
    private static readonly EMPTY_CELL = -1;

    private static readonly INITIAL_CAPACITY = 512;

    private static growFloats(values: Float32Array, capacity: number): Float32Array {
        const grown = new Float32Array(capacity);
        grown.set(values);

        return grown;
    }

    private static growIntegers(values: Int32Array, capacity: number): Int32Array {
        const grown = new Int32Array(capacity);
        grown.set(values);

        return grown;
    }

    private readonly cellSize: number;
    private readonly cellsPerSide: number;
    private readonly halfSpan: number;
    private readonly cellHead: Int32Array;

    private discCenterX: Float32Array = new Float32Array(PropOccupancy.INITIAL_CAPACITY);
    private discCenterZ: Float32Array = new Float32Array(PropOccupancy.INITIAL_CAPACITY);
    private discRadius: Float32Array = new Float32Array(PropOccupancy.INITIAL_CAPACITY);
    private discVisitedInQuery: Int32Array = new Int32Array(PropOccupancy.INITIAL_CAPACITY);
    private discCount = 0;

    private entryDisc: Int32Array = new Int32Array(PropOccupancy.INITIAL_CAPACITY);
    private entryNextInCell: Int32Array = new Int32Array(PropOccupancy.INITIAL_CAPACITY);
    private entryCount = 0;

    private queryStamp = 0;

    constructor(halfSpan: number, cellSize: number) {
        this.halfSpan = halfSpan;
        this.cellSize = cellSize;
        this.cellsPerSide = Math.max(1, Math.ceil((halfSpan * 2) / cellSize));
        this.cellHead = new Int32Array(this.cellsPerSide * this.cellsPerSide).fill(
            PropOccupancy.EMPTY_CELL
        );
    }

    reserve(centerX: number, centerZ: number, radius: number): void {
        const disc = this.discCount;
        this.growDiscsIfFull();

        this.discCenterX[disc] = centerX;
        this.discCenterZ[disc] = centerZ;
        this.discRadius[disc] = radius;
        this.discCount += 1;

        const firstColumn = this.cellIndexFor(centerX - radius);
        const lastColumn = this.cellIndexFor(centerX + radius);
        const firstRow = this.cellIndexFor(centerZ - radius);
        const lastRow = this.cellIndexFor(centerZ + radius);

        for (let row = firstRow; row <= lastRow; row += 1) {
            for (let column = firstColumn; column <= lastColumn; column += 1) {
                this.linkIntoCell(disc, row * this.cellsPerSide + column);
            }
        }
    }

    reserveLane(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): void {
        const spanX = toX - fromX;
        const spanZ = toZ - fromZ;
        const spanLength = Math.hypot(spanX, spanZ);
        const discCount = Math.max(1, Math.ceil(spanLength / radius));

        for (let step = 0; step <= discCount; step += 1) {
            const alongRatio = step / discCount;
            this.reserve(fromX + spanX * alongRatio, fromZ + spanZ * alongRatio, radius);
        }
    }

    isClear(centerX: number, centerZ: number, radius: number): boolean {
        this.queryStamp += 1;

        const firstColumn = this.cellIndexFor(centerX - radius);
        const lastColumn = this.cellIndexFor(centerX + radius);
        const firstRow = this.cellIndexFor(centerZ - radius);
        const lastRow = this.cellIndexFor(centerZ + radius);

        for (let row = firstRow; row <= lastRow; row += 1) {
            for (let column = firstColumn; column <= lastColumn; column += 1) {
                let entry =
                    this.cellHead[row * this.cellsPerSide + column] ?? PropOccupancy.EMPTY_CELL;

                while (entry !== PropOccupancy.EMPTY_CELL) {
                    const disc = this.entryDisc[entry] ?? 0;
                    entry = this.entryNextInCell[entry] ?? PropOccupancy.EMPTY_CELL;

                    if (this.discVisitedInQuery[disc] === this.queryStamp) continue;
                    this.discVisitedInQuery[disc] = this.queryStamp;

                    const gapX = centerX - (this.discCenterX[disc] ?? 0);
                    const gapZ = centerZ - (this.discCenterZ[disc] ?? 0);
                    const contactDistance = radius + (this.discRadius[disc] ?? 0);

                    if (gapX * gapX + gapZ * gapZ < contactDistance * contactDistance) return false;
                }
            }
        }

        return true;
    }

    private cellIndexFor(coordinate: number): number {
        return clamp(
            Math.floor((coordinate + this.halfSpan) / this.cellSize),
            0,
            this.cellsPerSide - 1
        );
    }

    private linkIntoCell(disc: number, cell: number): void {
        const entry = this.entryCount;
        this.growEntriesIfFull();

        this.entryDisc[entry] = disc;
        this.entryNextInCell[entry] = this.cellHead[cell] ?? PropOccupancy.EMPTY_CELL;
        this.cellHead[cell] = entry;
        this.entryCount += 1;
    }

    private growDiscsIfFull(): void {
        if (this.discCount < this.discCenterX.length) return;

        const capacity = this.discCenterX.length * 2;
        this.discCenterX = PropOccupancy.growFloats(this.discCenterX, capacity);
        this.discCenterZ = PropOccupancy.growFloats(this.discCenterZ, capacity);
        this.discRadius = PropOccupancy.growFloats(this.discRadius, capacity);
        this.discVisitedInQuery = PropOccupancy.growIntegers(this.discVisitedInQuery, capacity);
    }

    private growEntriesIfFull(): void {
        if (this.entryCount < this.entryDisc.length) return;

        const capacity = this.entryDisc.length * 2;
        this.entryDisc = PropOccupancy.growIntegers(this.entryDisc, capacity);
        this.entryNextInCell = PropOccupancy.growIntegers(this.entryNextInCell, capacity);
    }
}

export class PropCollector {
    private static readonly BUCKET_KEY_OFFSET = 1 << 20;

    private static bucketKeyFor(worldX: number, worldZ: number): number {
        const bucketX = Math.floor(worldX / TERRAIN.bucketSize) + PropCollector.BUCKET_KEY_OFFSET;
        const bucketZ = Math.floor(worldZ / TERRAIN.bucketSize) + PropCollector.BUCKET_KEY_OFFSET;

        return bucketX * (PropCollector.BUCKET_KEY_OFFSET * 2) + bucketZ;
    }

    private readonly buildersByBucket = new Map<number, Map<string, IGroupBuilder>>();

    private static groupKeyFor(
        modelPath: string,
        hasCollider: boolean,
        colliderShape?: "cylinder" | "cuboid"
    ): string {
        return `${modelPath}:${hasCollider ? 1 : 0}:${colliderShape ?? "cylinder"}`;
    }

    add(
        prop: IThemeProp,
        hasCollider: boolean,
        worldX: number,
        worldY: number,
        worldZ: number,
        rotationY: number,
        scale: number
    ): void {
        const builder = this.builderFor(prop, hasCollider, worldX, worldZ);
        builder.transformValues.push(worldX, worldY, worldZ, rotationY, scale);
    }

    toBuckets(): IPropGroup[][] {
        const buckets: IPropGroup[][] = [];

        for (const buildersByModelPath of this.buildersByBucket.values()) {
            const groups: IPropGroup[] = [];

            for (const builder of buildersByModelPath.values())
                groups.push({
                    modelPath: builder.prop.modelPath,
                    layer: builder.prop.layer,
                    hasCollider: builder.hasCollider,
                    colliderShape: builder.prop.colliderShape,
                    footprintRadius: builder.prop.footprintRadius,
                    instanceCount: builder.transformValues.length / PROP_TRANSFORM_STRIDE,
                    transforms: new Float32Array(builder.transformValues),
                });

            if (groups.length > 0) buckets.push(groups);
        }

        return buckets;
    }

    private builderFor(
        prop: IThemeProp,
        hasCollider: boolean,
        worldX: number,
        worldZ: number
    ): IGroupBuilder {
        const bucketKey = PropCollector.bucketKeyFor(worldX, worldZ);

        let buildersByModelPath = this.buildersByBucket.get(bucketKey);
        if (!buildersByModelPath) {
            buildersByModelPath = new Map<string, IGroupBuilder>();
            this.buildersByBucket.set(bucketKey, buildersByModelPath);
        }

        const groupKey = PropCollector.groupKeyFor(prop.modelPath, hasCollider, prop.colliderShape);
        const existing = buildersByModelPath.get(groupKey);
        if (existing) return existing;

        const builder: IGroupBuilder = { prop, hasCollider, transformValues: [] };
        buildersByModelPath.set(groupKey, builder);

        return builder;
    }
}

export const collidesWithPlayer = (prop: IThemeProp): boolean =>
    prop.collides ?? (prop.layer === PropLayer.Canopy || prop.layer === PropLayer.Rock);

export function pickSpecies(species: IThemeProp[], nextRandom: () => number): IThemeProp | null {
    if (species.length === 0) return null;
    if (species.length === 1) return species[0] ?? null;

    return species[Math.floor(nextRandom() * species.length)] ?? null;
}

function randomRotationFor(prop: IThemeProp, nextRandom: () => number): number {
    if (!prop.rotationSteps || prop.rotationSteps <= 1) return nextRandom() * FULL_TURN;

    const stepIndex = Math.floor(nextRandom() * prop.rotationSteps);

    return (stepIndex / prop.rotationSteps) * FULL_TURN;
}

export function placeProp(
    prop: IThemeProp,
    localX: number,
    localZ: number,
    rules: IPlacementRules,
    field: IFieldContext
): PlacementOutcome {
    const collides = collidesWithPlayer(prop);
    if (collides && field.remainingColliderBudget <= 0) return PlacementOutcome.Blocked;

    const scale =
        scaleBetween(prop.scaleRange, field.nextRandom()) *
        lerp(rules.scaleBoost[0], rules.scaleBoost[1], field.nextRandom());
    const footprintRadius = prop.footprintRadius * scale;

    const sample = passesHardLimits(prop, localX, localZ, footprintRadius, collides, rules, field);
    if (!sample) return PlacementOutcome.Blocked;

    if (SOFT_EDGED_LAYERS.has(prop.layer) && field.nextRandom() >= edgeDensityAt(sample, rules))
        return PlacementOutcome.Thinned;

    commitProp(prop, localX, localZ, sample.elevation - PROP_FIELD.groundBite, scale, field);

    return PlacementOutcome.Placed;
}

function passesHardLimits(
    prop: IThemeProp,
    localX: number,
    localZ: number,
    footprintRadius: number,
    collides: boolean,
    rules: IPlacementRules,
    field: IFieldContext
): IGridSample | undefined {
    if (!field.occupancy.isClear(localX, localZ, footprintRadius + rules.spacingGap))
        return undefined;

    const slopeLimit = prop.slopeLimit ?? rules.slopeLimit;
    const sample = field.heightMap.sampleAt(localX, localZ, field.heightSample);
    if (sample.footprintDistance > WORLD_EDGE.groundApron) return undefined;
    if (sample.waterDepth > -WATER_CHANNEL.propBankMargin) return undefined;
    if (sample.steepness > slopeLimit) return undefined;
    if (sample.trailDistance < PROP_FIELD.softEdges.trailClearance + footprintRadius)
        return undefined;
    if (
        collides &&
        !hasLevelRim(localX, localZ, footprintRadius, slopeLimit, field, sample.elevation)
    )
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
    const collides = collidesWithPlayer(prop);
    const footprintRadius = prop.footprintRadius * scale;

    if (collides && embedClutter && prop.pack !== "architecture" && prop.layer !== PropLayer.Debris)
        embedClutterAroundHost(localX, localZ, footprintRadius, field);

    field.occupancy.reserve(localX, localZ, footprintRadius);
    if (collides) field.remainingColliderBudget -= 1;

    field.collector.add(
        prop,
        collides,
        field.center[0] + localX,
        elevation + (prop.groundOffset ?? 0) * scale,
        field.center[2] + localZ,
        randomRotationFor(prop, field.nextRandom),
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
                prop,
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

function hasLevelRim(
    localX: number,
    localZ: number,
    clearanceRadius: number,
    slopeLimit: number,
    field: IFieldContext,
    centerElevation: number
): boolean {
    const elevationDeltaLimit = Math.max(0.4, clearanceRadius * 0.4);

    for (let probe = 0; probe < RIM_PROBE_COUNT; probe += 1) {
        const angle = (probe / RIM_PROBE_COUNT) * FULL_TURN;

        field.heightMap.sampleAt(
            localX + Math.cos(angle) * clearanceRadius,
            localZ + Math.sin(angle) * clearanceRadius,
            rimSample
        );

        if (rimSample.steepness > slopeLimit) return false;
        if (Math.abs(rimSample.elevation - centerElevation) > elevationDeltaLimit) return false;
        if (rimSample.waterDepth > -WATER_CHANNEL.propBankMargin) return false;
        if (rimSample.footprintDistance > WORLD_EDGE.groundApron) return false;
        if (rimSample.trailDistance < PROP_FIELD.softEdges.trailClearance) return false;
    }

    return true;
}
