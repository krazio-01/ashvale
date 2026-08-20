import type { ITerrainProfile } from "@/types/theme";
import { TERRAIN, TERRAIN_DETAIL } from "@/constants/game";
import { clamp, lerp } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";

export interface IFlatArea {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
    height: number;
    floorColorIndex: number;
}

export interface IFlatPath {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
    height: number;
}

export interface ITerrainSample {
    height: number;
    flatWeight: number;
    floorColorIndex: number;
    isCorridor: boolean;
}

export class TerrainHeightField {
    private readonly profile: ITerrainProfile;
    private readonly playRadius: number;
    private readonly areas: IFlatArea[];
    private readonly paths: IFlatPath[];
    private readonly mountainNoise: FractalNoise;
    private readonly reliefNoise: FractalNoise;

    constructor(
        profile: ITerrainProfile,
        playRadius: number,
        areas: IFlatArea[],
        paths: IFlatPath[],
        seed: number
    ) {
        this.profile = profile;
        this.playRadius = playRadius;
        this.areas = areas;
        this.paths = paths;
        this.mountainNoise = new FractalNoise(seed);
        this.reliefNoise = new FractalNoise(seed + 1);
    }

    sampleAt(localX: number, localZ: number): ITerrainSample {
        const wildHeight = this.wildHeightAt(localX, localZ);

        let strongestWeight = 0;
        let weightedHeight = 0;
        let totalWeight = 0;
        let floorColorIndex = 0;
        let isCorridor = false;

        for (const area of this.areas) {
            const outsideX = Math.max(Math.abs(localX - area.centerX) - area.halfWidth, 0);
            const outsideZ = Math.max(Math.abs(localZ - area.centerZ) - area.halfDepth, 0);
            const weight = 1 - smoothstep(0, TERRAIN.bankWidth, Math.hypot(outsideX, outsideZ));

            if (weight <= 0) continue;

            weightedHeight += area.height * weight;
            totalWeight += weight;

            if (weight > strongestWeight) {
                strongestWeight = weight;
                floorColorIndex = area.floorColorIndex;
                isCorridor = false;
            }
        }

        for (const path of this.paths) {
            const spanDistance = distanceToSegment(localX, localZ, path);
            const weight =
                1 - smoothstep(0, TERRAIN.bankWidth, Math.max(spanDistance - path.halfWidth, 0));

            if (weight <= 0) continue;

            weightedHeight += (path.height - TERRAIN.corridorDrop) * weight;
            totalWeight += weight;

            if (weight > strongestWeight) {
                strongestWeight = weight;
                isCorridor = true;
            }
        }

        const carvedHeight = totalWeight > 0 ? weightedHeight / totalWeight : wildHeight;

        return {
            height: lerp(wildHeight, carvedHeight, strongestWeight),
            flatWeight: strongestWeight,
            floorColorIndex,
            isCorridor,
        };
    }

    heightAt(localX: number, localZ: number): number {
        return this.sampleAt(localX, localZ).height;
    }

    slopeAt(localX: number, localZ: number): number {
        const step = 1;
        const deltaX = this.heightAt(localX + step, localZ) - this.heightAt(localX - step, localZ);
        const deltaZ = this.heightAt(localX, localZ + step) - this.heightAt(localX, localZ - step);

        return Math.hypot(deltaX, deltaZ) / (2 * step);
    }

    private wildHeightAt(localX: number, localZ: number): number {
        const relief = this.reliefNoise.sample(
            localX * TERRAIN.wildReliefScale,
            localZ * TERRAIN.wildReliefScale,
            3,
            0.5
        );

        const microRelief =
            (this.reliefNoise.sample(
                localX * TERRAIN_DETAIL.microReliefScale,
                localZ * TERRAIN_DETAIL.microReliefScale,
                2,
                0.5
            ) -
                0.5) *
            TERRAIN_DETAIL.microReliefHeight;

        const interiorHeight =
            TERRAIN.pathLevel +
            this.profile.wildElevation +
            relief * this.profile.wildRelief +
            microRelief;

        const noiseX = localX / this.profile.featureSize;
        const noiseZ = localZ / this.profile.featureSize;
        const smoothSample = this.mountainNoise.sample(noiseX, noiseZ, 5, 0.5);
        const ridgedSample = this.mountainNoise.sampleRidged(noiseX, noiseZ, 4, 0.5);
        const mountainSample = lerp(smoothSample, ridgedSample, this.profile.ruggedness);

        const mountainHeight =
            TERRAIN.pathLevel +
            this.profile.wildElevation +
            Math.pow(mountainSample, TERRAIN.peakShaping) * this.profile.mountainHeight;

        const mountainRatio = smoothstep(
            this.playRadius,
            this.playRadius + TERRAIN.transition,
            Math.hypot(localX, localZ)
        );

        return lerp(interiorHeight, Math.max(mountainHeight, interiorHeight), mountainRatio);
    }
}

function distanceToSegment(x: number, z: number, path: IFlatPath): number {
    const spanX = path.toX - path.fromX;
    const spanZ = path.toZ - path.fromZ;
    const spanLengthSquared = spanX * spanX + spanZ * spanZ;

    if (spanLengthSquared === 0) return Math.hypot(x - path.fromX, z - path.fromZ);

    const projection = clamp(
        ((x - path.fromX) * spanX + (z - path.fromZ) * spanZ) / spanLengthSquared,
        0,
        1
    );

    return Math.hypot(x - (path.fromX + spanX * projection), z - (path.fromZ + spanZ * projection));
}

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
    const ratio = clamp((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
    return ratio * ratio * (3 - 2 * ratio);
}
