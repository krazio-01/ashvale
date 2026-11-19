import {
    ClampToEdgeWrapping,
    DataTexture,
    DataUtils,
    HalfFloatType,
    LinearFilter,
    RGBAFormat,
    UnsignedByteType,
} from "three";
import {
    SURFACE_KIND_NAMES,
    TERRAIN,
    TERRAIN_DETAIL,
    TRAIL,
    WATER_CHANNEL,
} from "@/constants/world";
import { GROUND_COVER, ROCK_EMBED, SCENE_LAYOUT, SURFACE_FIELD } from "@/constants/placement";
import { clamp, lerp, smoothstep, yawFromDirection } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";
import { createTerrainSample, type TerrainHeightField } from "@/world/terrain/TerrainGeneration";
import type { IRegionBox, SurfaceKind } from "@/types/world";
import type { CoverAffinity, CoverCue, IThemeBorder, IThemeZones, ZoneField } from "@/types/themes";
import { Occupancy } from "@/world/terrain/Occupancy";

const EMBED_READS = {
    indices: new Int32Array(0),
    targets: new Float64Array(0),
    nearest: new Float64Array(0),
    count: 0,
};

export type TerrainField = keyof ITerrainFields;

interface ITerrainFields {
    elevation: Float32Array;
    steepness: Float32Array;
    carveStrength: Float32Array;
    trailDistance: Float32Array;
    corridorFlag: Uint8Array;
    nestingDepth: Uint8Array;
    footprintDistance: Float32Array;
    waterDepth: Float32Array;
    cliffGradientX: Float32Array;
    cliffGradientZ: Float32Array;
    forest: Float32Array;
    clearing: Float32Array;
    wetness: Float32Array;
    familyBand: Float32Array;
    surface: Float32Array;
    surfaceKind: Uint8Array;
}

interface IInterpolationWeights {
    acrossRatio: number;
    downRatio: number;
    nearLeftIndex: number;
    farLeftIndex: number;
}

export interface IGridSample {
    elevation: number;
    trailDistance: number;
    steepness: number;
    footprintDistance: number;
    waterDepth: number;
}

export class LandMap {
    private static readonly FOREST_NOISE_OCTAVES = 3;

    private static readonly FOREST_NOISE_GAIN = 0.5;

    private static readonly COVER_CHANNELS: readonly CoverCue[] = ["forest", "clearing", "wetness"];

    private static readonly ROCK_SURFACE = SURFACE_KIND_NAMES.indexOf("rock");

    static cellSizeFor(outerRadius: number): number {
        const span = outerRadius * 2;
        return (
            span /
            clamp(
                Math.round(span / TERRAIN.targetCellSize),
                TERRAIN.minimumResolution,
                TERRAIN.maximumResolution
            )
        );
    }

    private static growthStopDistanceOf(
        footprintDistance: number,
        waterDepth: number,
        [fadeStart, growthReach]: readonly [number, number]
    ): number {
        const waterlineApproach = smoothstep(-WATER_CHANNEL.shoreGrassBand, 0, waterDepth);

        return Math.max(footprintDistance, lerp(fadeStart, growthReach, waterlineApproach));
    }

    private static createFieldTexture(
        channels: Uint16Array | Uint8Array,
        side: number,
        type: typeof HalfFloatType | typeof UnsignedByteType
    ): DataTexture {
        const texture = new DataTexture(channels, side, side, RGBAFormat, type);

        texture.magFilter = LinearFilter;
        texture.minFilter = LinearFilter;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        return texture;
    }

    readonly span: number;
    readonly originX: number;
    readonly originZ: number;
    readonly cellSize: number;
    readonly pointsPerSide: number;
    readonly cellsPerSide: number;
    readonly occupancy: Occupancy;
    readonly border: IThemeBorder;
    readonly fenceReach: number;
    readonly outerReach: number;
    readonly growthStopBand: readonly [number, number];

    private readonly undersideKeyStride: number;
    private readonly firstUndersideColumn: number;
    private readonly firstUndersideRow: number;
    private readonly fields: ITerrainFields;
    private readonly interpolationWeights: IInterpolationWeights = {
        acrossRatio: 0,
        downRatio: 0,
        nearLeftIndex: 0,
        farLeftIndex: 0,
    };
    private areCliffGradientsStale = false;

    constructor(heightField: TerrainHeightField, outerRadius: number) {
        this.border = heightField.border;
        this.fenceReach = heightField.fenceReach;
        this.outerReach = heightField.outerReach;
        this.growthStopBand = [
            heightField.growthReach - GROUND_COVER.worldEdgeFadeWidth,
            heightField.growthReach,
        ];
        this.occupancy = new Occupancy(outerRadius, TERRAIN.occupancyCellSize);
        this.span = outerRadius * 2;
        this.originX = -outerRadius;
        this.originZ = -outerRadius;
        this.cellSize = LandMap.cellSizeFor(outerRadius);
        this.cellsPerSide = Math.round(this.span / this.cellSize);
        this.pointsPerSide = this.cellsPerSide + 1;
        const undersideCellsAcross = this.cellsPerSide * ROCK_EMBED.undersideSubdivisions;
        this.undersideKeyStride = undersideCellsAcross * 3 + 1;
        this.firstUndersideColumn =
            Math.floor(this.originX / this.undersideCellSize) - undersideCellsAcross;
        this.firstUndersideRow =
            Math.floor(this.originZ / this.undersideCellSize) - undersideCellsAcross;

        const pointCount = this.pointsPerSide * this.pointsPerSide;
        this.fields = {
            elevation: new Float32Array(pointCount),
            steepness: new Float32Array(pointCount),
            carveStrength: new Float32Array(pointCount),
            trailDistance: new Float32Array(pointCount),
            corridorFlag: new Uint8Array(pointCount),
            nestingDepth: new Uint8Array(pointCount),
            footprintDistance: new Float32Array(pointCount),
            waterDepth: new Float32Array(pointCount),
            cliffGradientX: new Float32Array(pointCount),
            cliffGradientZ: new Float32Array(pointCount),
            forest: new Float32Array(pointCount),
            clearing: new Float32Array(pointCount),
            wetness: new Float32Array(pointCount),
            familyBand: new Float32Array(pointCount),
            surface: new Float32Array(pointCount),
            surfaceKind: new Uint8Array(pointCount),
        };

        const sample = createTerrainSample();
        const slopeReach = TERRAIN.macroSlopeGrainWavelengths / TERRAIN_DETAIL.grainNoiseScale / 2;

        for (let row = 0; row < this.pointsPerSide; row += 1) {
            const localZ = this.originZ + row * this.cellSize;

            for (let column = 0; column < this.pointsPerSide; column += 1) {
                const index = row * this.pointsPerSide + column;
                const localX = this.originX + column * this.cellSize;
                heightField.sampleInto(localX, localZ, sample);

                this.fields.elevation[index] = sample.elevation;
                this.fields.carveStrength[index] = sample.carveStrength;
                this.fields.trailDistance[index] = sample.trailDistance;
                this.fields.corridorFlag[index] = sample.isCorridor ? 1 : 0;
                this.fields.nestingDepth[index] = Math.min(sample.nestingDepth, 255);
                this.fields.footprintDistance[index] = sample.footprintDistance;
                this.fields.waterDepth[index] = sample.waterDepth;

                const riseAcross =
                    heightField.elevationAt(localX + slopeReach, localZ) -
                    heightField.elevationAt(localX - slopeReach, localZ);
                const riseAlong =
                    heightField.elevationAt(localX, localZ + slopeReach) -
                    heightField.elevationAt(localX, localZ - slopeReach);

                this.fields.steepness[index] =
                    Math.sqrt(riseAcross * riseAcross + riseAlong * riseAlong) / (2 * slopeReach);
            }
        }

        this.measureCliffGradients();
    }

    surfaceElevationAt(localX: number, localZ: number): number {
        return this.sampleTriangleSurface(this.computeInterpolationWeights(localX, localZ));
    }

    steepnessAt(localX: number, localZ: number): number {
        return this.interpolate(this.fields.steepness, localX, localZ);
    }

    waterDepthAt(localX: number, localZ: number): number {
        return this.interpolate(this.fields.waterDepth, localX, localZ);
    }

    cliffAt(localX: number, localZ: number): number {
        this.refreshCliffGradients();
        const weights = this.computeInterpolationWeights(localX, localZ);
        return Math.hypot(
            this.interpolateWithWeights(this.fields.cliffGradientX, weights),
            this.interpolateWithWeights(this.fields.cliffGradientZ, weights)
        );
    }

    cliffFacingAt(localX: number, localZ: number): number {
        this.refreshCliffGradients();
        const weights = this.computeInterpolationWeights(localX, localZ);
        return yawFromDirection(
            -this.interpolateWithWeights(this.fields.cliffGradientX, weights),
            -this.interpolateWithWeights(this.fields.cliffGradientZ, weights)
        );
    }

    sampleAt(localX: number, localZ: number, sample: IGridSample): IGridSample {
        const weights = this.computeInterpolationWeights(localX, localZ);

        sample.elevation = this.sampleTriangleSurface(weights);
        sample.trailDistance = this.interpolateWithWeights(this.fields.trailDistance, weights);
        sample.steepness = this.interpolateWithWeights(this.fields.steepness, weights);
        sample.footprintDistance = this.interpolateWithWeights(
            this.fields.footprintDistance,
            weights
        );
        sample.waterDepth = this.interpolateWithWeights(this.fields.waterDepth, weights);

        return sample;
    }

    describeZones(zones: IThemeZones, regionFloors: readonly IRegionBox[], seed: number): void {
        const { forest, clearing, wetness, familyBand, elevation, steepness, trailDistance } =
            this.fields;
        const side = this.pointsPerSide;
        const walkable = new Int32Array(elevation.length);
        let walkableCount = 0;
        for (let index = 0; index < elevation.length; index += 1)
            if (this.isWalkablePoint(index)) {
                walkable[walkableCount] = index;
                walkableCount += 1;
            }
        if (walkableCount === 0) return;

        this.measureWaterDistance(wetness);
        let lowest = Infinity;
        let highest = -Infinity;
        for (let slot = 0; slot < walkableCount; slot += 1) {
            lowest = Math.min(lowest, elevation[walkable[slot]]);
            highest = Math.max(highest, elevation[walkable[slot]]);
        }
        for (let index = 0; index < elevation.length; index += 1) {
            wetness[index] = 1 - smoothstep(0, zones.bankReach, wetness[index]);
            familyBand[index] =
                highest > lowest && Number.isFinite(elevation[index])
                    ? clamp((elevation[index] - lowest) / (highest - lowest), 0, 1)
                    : 0;
        }
        const noise = new FractalNoise(seed);
        const forestNoise = new Float32Array(elevation.length);
        for (let slot = 0; slot < walkableCount; slot += 1) {
            const index = walkable[slot];
            forestNoise[index] = noise.sample(
                (this.originX + (index % side) * this.cellSize) / zones.forestWavelength,
                (this.originZ + Math.floor(index / side) * this.cellSize) / zones.forestWavelength,
                LandMap.FOREST_NOISE_OCTAVES,
                LandMap.FOREST_NOISE_GAIN
            );
        }
        const ranked = walkable
            .subarray(0, walkableCount)
            .sort((first, second) => forestNoise[first] - forestNoise[second]);
        const forestStart = 1 - zones.forestShare;
        const [slopeFadeStart, slopeFadeEnd] = zones.slopeForestFade;
        const clearingBoxes = new Float64Array(regionFloors.length * 4);
        for (let floorIndex = 0; floorIndex < regionFloors.length; floorIndex += 1) {
            const floor = regionFloors[floorIndex];
            const box = floorIndex * 4;
            clearingBoxes[box] = floor.centerX;
            clearingBoxes[box + 1] = floor.centerZ;
            clearingBoxes[box + 2] = floor.halfWidth * zones.clearingRatio;
            clearingBoxes[box + 3] = floor.halfDepth * zones.clearingRatio;
        }

        for (let rank = 0; rank < walkableCount; rank += 1) {
            const index = ranked[rank];
            const localX = this.originX + (index % side) * this.cellSize;
            const localZ = this.originZ + Math.floor(index / side) * this.cellSize;
            let clearingStrength = 0;
            for (let box = 0; box < clearingBoxes.length; box += 4) {
                const outsideX = Math.max(
                    Math.abs(localX - clearingBoxes[box]) - clearingBoxes[box + 2],
                    0
                );
                const outsideZ = Math.max(
                    Math.abs(localZ - clearingBoxes[box + 1]) - clearingBoxes[box + 3],
                    0
                );
                const fade = zones.clearingFadeWidth;
                if (fade >= 0 && (outsideX >= fade || outsideZ >= fade)) continue;
                clearingStrength = Math.max(
                    clearingStrength,
                    1 - smoothstep(0, fade, Math.hypot(outsideX, outsideZ))
                );
                if (clearingStrength === 1) break;
            }
            const offTrail = smoothstep(
                TRAIL.halfWidth + zones.trailForestGap,
                TRAIL.distanceLimit,
                trailDistance[index]
            );
            const offSlope = 1 - smoothstep(slopeFadeStart, slopeFadeEnd, steepness[index]);
            const rankRatio = rank / walkableCount;

            clearing[index] = clearingStrength;
            forest[index] =
                smoothstep(
                    forestStart - zones.forestSoftness,
                    forestStart + zones.forestSoftness,
                    rankRatio
                ) *
                (1 - clearingStrength) *
                offTrail *
                offSlope;
        }
    }

    zoneAt(field: ZoneField, localX: number, localZ: number): number {
        return this.interpolate(this.fields[field], localX, localZ);
    }

    wearGround(localX: number, localZ: number, radius: number, edge: FractalNoise): void {
        const { edgeWavelength, edgeShare } = SCENE_LAYOUT.wear;
        const reach = radius * (1 + edgeShare) + TRAIL.distanceLimit;
        const { trailDistance } = this.fields;
        this.forEachPointIn(
            localX - reach,
            localX + reach,
            localZ - reach,
            localZ + reach,
            (index, pointX, pointZ) => {
                const distance =
                    Math.hypot(pointX - localX, pointZ - localZ) +
                    edge.sampleSigned(pointX / edgeWavelength, pointZ / edgeWavelength, 2, 0.5) *
                        radius *
                        edgeShare;
                trailDistance[index] = Math.min(
                    trailDistance[index],
                    Math.max(0, distance - radius + TRAIL.halfWidth)
                );
            }
        );
    }

    get undersideCellSize(): number {
        return this.cellSize / ROCK_EMBED.undersideSubdivisions;
    }

    undersideCellKey(column: number, row: number): number {
        return (
            (row - this.firstUndersideRow) * this.undersideKeyStride +
            column -
            this.firstUndersideColumn
        );
    }

    embedRock(undersides: Float32Array, height: number, skirtWidth: number): number | null {
        const { elevation, trailDistance } = this.fields;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let offset = 0; offset < undersides.length; offset += 3) {
            minX = Math.min(minX, undersides[offset]);
            maxX = Math.max(maxX, undersides[offset]);
            minZ = Math.min(minZ, undersides[offset + 2]);
            maxZ = Math.max(maxZ, undersides[offset + 2]);
        }

        const reach = skirtWidth + this.undersideCellSize;
        const halfCell = this.cellSize / 2;
        const { skirtSlope } = ROCK_EMBED;
        const reads = EMBED_READS;
        reads.count = 0;
        this.forEachPointIn(
            minX - reach,
            maxX + reach,
            minZ - reach,
            maxZ + reach,
            (index, pointX, pointZ) => {
                let target = -Infinity;
                let nearest = Infinity;
                for (let offset = 0; offset < undersides.length; offset += 3) {
                    const distance = Math.hypot(
                        undersides[offset] - pointX,
                        undersides[offset + 2] - pointZ
                    );
                    nearest = Math.min(nearest, distance);
                    target = Math.max(
                        target,
                        undersides[offset + 1] - skirtSlope * Math.max(0, distance - halfCell)
                    );
                }
                if (nearest > reach) return;
                if (reads.count === reads.indices.length) growEmbedReads();
                reads.indices[reads.count] = index;
                reads.targets[reads.count] = target;
                reads.nearest[reads.count] = nearest;
                reads.count += 1;
            }
        );

        let sink = height * ROCK_EMBED.sinkShare;
        let highestRise = 0;
        for (let read = 0; read < reads.count; read += 1) {
            if (reads.nearest[read] > halfCell) continue;
            const index = reads.indices[read];
            if (trailDistance[index] <= TRAIL.halfWidth + skirtWidth) return null;
            const rise = reads.targets[read] - sink + ROCK_EMBED.buryDepth - elevation[index];
            if (this.isWetPoint(index) && rise > ROCK_EMBED.blockedRiseLimit) return null;
            highestRise = Math.max(highestRise, rise);
        }
        sink += Math.max(0, highestRise - height * ROCK_EMBED.maxRiseShare);
        if (sink > height * ROCK_EMBED.maxSinkShare) return null;

        let raisedCount = 0;
        for (let read = 0; read < reads.count; read += 1) {
            const index = reads.indices[read];
            const nearest = reads.nearest[read];
            const top = reads.targets[read] - sink + ROCK_EMBED.buryDepth;
            if (top <= elevation[index] || this.isWetPoint(index)) continue;
            if (nearest > halfCell && trailDistance[index] <= TRAIL.halfWidth) continue;
            elevation[index] = top;
            this.paintPoint(
                index,
                LandMap.ROCK_SURFACE,
                1 - smoothstep(0, ROCK_EMBED.paintWidth, nearest)
            );
            reads.indices[raisedCount] = index;
            raisedCount += 1;
        }
        this.refreshSteepness(reads.indices, raisedCount);
        return sink;
    }

    paintSurface(
        kind: SurfaceKind,
        bounds: IRegionBox,
        distanceOutside: (localX: number, localZ: number) => number
    ): void {
        const reach = SURFACE_FIELD.paintWidth;
        const kindIndex = SURFACE_KIND_NAMES.indexOf(kind);
        this.forEachPointIn(
            bounds.centerX - bounds.halfWidth - reach,
            bounds.centerX + bounds.halfWidth + reach,
            bounds.centerZ - bounds.halfDepth - reach,
            bounds.centerZ + bounds.halfDepth + reach,
            (index, pointX, pointZ) => {
                if (this.fields.trailDistance[index] <= TRAIL.halfWidth) return;
                this.paintPoint(
                    index,
                    kindIndex,
                    1 - smoothstep(0, reach, distanceOutside(pointX, pointZ))
                );
            }
        );
    }

    tilesWhere(field: TerrainField, minimum: number, tileSize: number): IRegionBox[] {
        const values = this.fields[field];
        const tilesPerSide = Math.ceil(this.span / tileSize);
        const marked = new Uint8Array(tilesPerSide * tilesPerSide);
        for (let index = 0; index < values.length; index += 1) {
            if (values[index] < minimum || !this.hasGroundAtPoint(index)) continue;
            const pointX = this.originX + (index % this.pointsPerSide) * this.cellSize;
            const pointZ = this.originZ + Math.floor(index / this.pointsPerSide) * this.cellSize;
            const column = Math.min(
                Math.floor((pointX - this.originX) / tileSize),
                tilesPerSide - 1
            );
            const row = Math.min(Math.floor((pointZ - this.originZ) / tileSize), tilesPerSide - 1);
            marked[row * tilesPerSide + column] = 1;
        }
        const tiles: IRegionBox[] = [];
        marked.forEach((isMarked, tile) => {
            if (!isMarked) return;
            tiles.push({
                centerX: this.originX + ((tile % tilesPerSide) + 0.5) * tileSize,
                centerZ: this.originZ + (Math.floor(tile / tilesPerSide) + 0.5) * tileSize,
                halfWidth: tileSize / 2,
                halfDepth: tileSize / 2,
            });
        });
        return tiles;
    }

    surfaceKindAtPoint(pointIndex: number): SurfaceKind | null {
        return this.fields.surface[pointIndex] > 0
            ? SURFACE_KIND_NAMES[this.fields.surfaceKind[pointIndex]]
            : null;
    }

    valueAtPoint(field: TerrainField, pointIndex: number): number {
        return this.fields[field][pointIndex];
    }

    hasGroundAtPoint(pointIndex: number): boolean {
        return (
            this.valueAtPoint("footprintDistance", pointIndex) <= this.outerReach &&
            Number.isFinite(this.valueAtPoint("elevation", pointIndex))
        );
    }

    createShaderTexture(): DataTexture {
        const channels = new Uint16Array(this.fields.elevation.length * 4);

        for (let index = 0; index < this.fields.elevation.length; index += 1) {
            const channelStart = index * 4;

            channels[channelStart] = DataUtils.toHalfFloat(this.fields.elevation[index]);
            channels[channelStart + 1] = DataUtils.toHalfFloat(this.fields.trailDistance[index]);
            channels[channelStart + 2] = DataUtils.toHalfFloat(this.fields.steepness[index]);
            channels[channelStart + 3] = DataUtils.toHalfFloat(
                LandMap.growthStopDistanceOf(
                    this.fields.footprintDistance[index],
                    this.fields.waterDepth[index],
                    this.growthStopBand
                )
            );
        }

        return LandMap.createFieldTexture(channels, this.pointsPerSide, HalfFloatType);
    }

    get fieldSpan(): number {
        return (this.pointsPerSide - 1) * this.cellSize;
    }

    createCoverTexture(): DataTexture {
        const step = this.cellSize / GROUND_COVER.coverTextureSubdivisions;
        const side = this.cellsPerSide * GROUND_COVER.coverTextureSubdivisions + 1;
        const blocked = this.occupancy.rasterize(
            "groundCover",
            this.originX,
            this.originZ,
            step,
            side
        );
        const channels = new Uint8Array(side * side * 4);
        const { forest, clearing, wetness, surface } = this.fields;

        for (let row = 0; row < side; row += 1) {
            const localZ = this.originZ + row * step;
            for (let column = 0; column < side; column += 1) {
                const index = row * side + column;
                const texel = index * 4;
                const weights = this.computeInterpolationWeights(
                    this.originX + column * step,
                    localZ
                );
                channels[texel] = Math.round(
                    clamp(this.interpolateWithWeights(forest, weights), 0, 1) * 255
                );
                channels[texel + 1] = Math.round(
                    clamp(this.interpolateWithWeights(clearing, weights), 0, 1) * 255
                );
                channels[texel + 2] = Math.round(
                    clamp(this.interpolateWithWeights(wetness, weights), 0, 1) * 255
                );
                channels[texel + 3] = Math.max(
                    blocked[index],
                    Math.round(clamp(this.interpolateWithWeights(surface, weights), 0, 1) * 255)
                );
            }
        }

        return LandMap.createFieldTexture(channels, side, UnsignedByteType);
    }

    affinityAt(affinity: CoverAffinity, localX: number, localZ: number): number {
        const weights = this.computeInterpolationWeights(localX, localZ);
        let density = 1;
        for (const cue of LandMap.COVER_CHANNELS) {
            const band = affinity[cue];
            if (!band) continue;
            const floor = band[2] ?? 0;
            density *=
                floor +
                (1 - floor) *
                    smoothstep(
                        band[0],
                        band[1],
                        this.interpolateWithWeights(this.fields[cue], weights)
                    );
        }
        return density;
    }

    private forEachPointIn(
        minX: number,
        maxX: number,
        minZ: number,
        maxZ: number,
        visit: (index: number, pointX: number, pointZ: number) => void
    ): void {
        const last = this.pointsPerSide - 1;
        const lastColumn = clamp(Math.ceil((maxX - this.originX) / this.cellSize), 0, last);
        const lastRow = clamp(Math.ceil((maxZ - this.originZ) / this.cellSize), 0, last);
        for (
            let row = clamp(Math.floor((minZ - this.originZ) / this.cellSize), 0, last);
            row <= lastRow;
            row += 1
        )
            for (
                let column = clamp(Math.floor((minX - this.originX) / this.cellSize), 0, last);
                column <= lastColumn;
                column += 1
            )
                visit(
                    row * this.pointsPerSide + column,
                    this.originX + column * this.cellSize,
                    this.originZ + row * this.cellSize
                );
    }

    private paintPoint(index: number, kindIndex: number, strength: number): void {
        const { surface, surfaceKind } = this.fields;
        if (strength <= surface[index]) return;
        surface[index] = strength;
        surfaceKind[index] = kindIndex;
    }

    private isWetPoint(index: number): boolean {
        return this.fields.waterDepth[index] > -WATER_CHANNEL.propBankMargin;
    }

    private refreshSteepness(indices: Int32Array, count: number): void {
        const { elevation, steepness } = this.fields;
        const last = this.pointsPerSide - 1;
        for (let read = 0; read < count; read += 1) {
            const index = indices[read];
            const column = index % this.pointsPerSide;
            const row = Math.floor(index / this.pointsPerSide);
            const left = row * this.pointsPerSide + Math.max(column - 1, 0);
            const right = row * this.pointsPerSide + Math.min(column + 1, last);
            const below = Math.max(row - 1, 0) * this.pointsPerSide + column;
            const above = Math.min(row + 1, last) * this.pointsPerSide + column;
            steepness[index] = Math.max(
                steepness[index],
                Math.hypot(
                    elevation[right] - elevation[left],
                    elevation[above] - elevation[below]
                ) /
                    (2 * this.cellSize)
            );
        }
        this.areCliffGradientsStale = true;
    }

    private refreshCliffGradients(): void {
        if (!this.areCliffGradientsStale) return;
        this.areCliffGradientsStale = false;
        this.measureCliffGradients();
    }

    private isWalkablePoint(index: number): boolean {
        return (
            this.fields.footprintDistance[index] <= this.border.flatReach &&
            Number.isFinite(this.fields.elevation[index])
        );
    }

    private measureWaterDistance(distances: Float32Array): void {
        const { waterDepth } = this.fields;
        const side = this.pointsPerSide;
        const straight = this.cellSize;
        const diagonal = this.cellSize * Math.SQRT2;
        let hasWater = false;
        for (let index = 0; index < distances.length; index += 1) {
            const wet = waterDepth[index] > 0;
            distances[index] = wet ? 0 : Infinity;
            if (wet) hasWater = true;
        }
        if (!hasWater) return;

        const relax = (index: number, neighbour: number, step: number): void => {
            const candidate = distances[neighbour] + step;
            if (candidate < distances[index]) distances[index] = candidate;
        };
        for (let row = 0; row < side; row += 1)
            for (let column = 0; column < side; column += 1) {
                const index = row * side + column;
                if (column > 0) relax(index, index - 1, straight);
                if (row > 0) relax(index, index - side, straight);
                if (row > 0 && column > 0) relax(index, index - side - 1, diagonal);
                if (row > 0 && column < side - 1) relax(index, index - side + 1, diagonal);
            }
        for (let row = side - 1; row >= 0; row -= 1)
            for (let column = side - 1; column >= 0; column -= 1) {
                const index = row * side + column;
                if (column < side - 1) relax(index, index + 1, straight);
                if (row < side - 1) relax(index, index + side, straight);
                if (row < side - 1 && column < side - 1) relax(index, index + side + 1, diagonal);
                if (row < side - 1 && column > 0) relax(index, index + side - 1, diagonal);
            }
    }

    private measureCliffGradients(): void {
        const { elevation, cliffGradientX, cliffGradientZ } = this.fields;
        const last = this.pointsPerSide - 1;

        for (let row = 0; row <= last; row += 1) {
            const below = Math.max(row - 1, 0);
            const above = Math.min(row + 1, last);

            for (let column = 0; column <= last; column += 1) {
                const left = Math.max(column - 1, 0);
                const right = Math.min(column + 1, last);
                const index = row * this.pointsPerSide + column;

                cliffGradientX[index] =
                    (elevation[row * this.pointsPerSide + right] -
                        elevation[row * this.pointsPerSide + left]) /
                    ((right - left) * this.cellSize);
                cliffGradientZ[index] =
                    (elevation[above * this.pointsPerSide + column] -
                        elevation[below * this.pointsPerSide + column]) /
                    ((above - below) * this.cellSize);
            }
        }
    }

    private interpolate(values: Float32Array, localX: number, localZ: number): number {
        return this.interpolateWithWeights(
            values,
            this.computeInterpolationWeights(localX, localZ)
        );
    }

    private computeInterpolationWeights(localX: number, localZ: number): IInterpolationWeights {
        const columnPosition = (localX - this.originX) / this.cellSize;
        const rowPosition = (localZ - this.originZ) / this.cellSize;

        const column = this.clampCellIndex(Math.floor(columnPosition));
        const row = this.clampCellIndex(Math.floor(rowPosition));
        const nearLeftIndex = row * this.pointsPerSide + column;
        const weights = this.interpolationWeights;

        weights.acrossRatio = clamp(columnPosition - column, 0, 1);
        weights.downRatio = clamp(rowPosition - row, 0, 1);
        weights.nearLeftIndex = nearLeftIndex;
        weights.farLeftIndex = nearLeftIndex + this.pointsPerSide;
        return weights;
    }

    private interpolateWithWeights(values: Float32Array, weights: IInterpolationWeights): number {
        const { nearLeftIndex, farLeftIndex, acrossRatio, downRatio } = weights;

        return lerp(
            lerp(values[nearLeftIndex], values[nearLeftIndex + 1], acrossRatio),
            lerp(values[farLeftIndex], values[farLeftIndex + 1], acrossRatio),
            downRatio
        );
    }

    private sampleTriangleSurface(weights: IInterpolationWeights): number {
        const { nearLeftIndex, farLeftIndex, acrossRatio, downRatio } = weights;

        const nearLeft = this.fields.elevation[nearLeftIndex];
        const nearRight = this.fields.elevation[nearLeftIndex + 1];
        const farLeft = this.fields.elevation[farLeftIndex];

        if (acrossRatio + downRatio <= 1)
            return (
                nearLeft + (nearRight - nearLeft) * acrossRatio + (farLeft - nearLeft) * downRatio
            );

        const farRight = this.fields.elevation[farLeftIndex + 1];

        return (
            farRight +
            (farLeft - farRight) * (1 - acrossRatio) +
            (nearRight - farRight) * (1 - downRatio)
        );
    }

    private clampCellIndex(value: number): number {
        return clamp(value, 0, this.pointsPerSide - 2);
    }
}

export function createGridSample(): IGridSample {
    return {
        elevation: 0,
        trailDistance: TRAIL.distanceLimit,
        steepness: 0,
        footprintDistance: 0,
        waterDepth: WATER_CHANNEL.dryDepth,
    };
}

function growEmbedReads(): void {
    const capacity = Math.max(EMBED_READS.indices.length * 2, 1);
    const indices = new Int32Array(capacity);
    const targets = new Float64Array(capacity);
    const nearest = new Float64Array(capacity);
    indices.set(EMBED_READS.indices);
    targets.set(EMBED_READS.targets);
    nearest.set(EMBED_READS.nearest);
    EMBED_READS.indices = indices;
    EMBED_READS.targets = targets;
    EMBED_READS.nearest = nearest;
}
