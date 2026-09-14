import { Vector2, type DataTexture } from "three";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { GROUND_COVER } from "@/constants/placement";
import { WORLD_EDGE } from "@/constants/world";

export const GROUND_COVER_GLSL = `
    uniform sampler2D terrainField;
    uniform vec2 fieldOrigin;
    uniform float fieldCellSize;
    uniform float fieldPointsPerSide;
    uniform vec2 steepGroundBand;
    uniform vec2 growthStopBand;
    uniform vec2 coverTrailBand;

    vec3 randomTriple(vec3 seed) {
        vec3 scattered = fract(seed * vec3(0.1031, 0.1030, 0.0973));
        scattered += dot(scattered, scattered.yxz + 33.33);

        return fract((scattered.xxy + scattered.yxx) * scattered.zyx);
    }

    float randomScalar(vec2 seed, float salt) {
        return fract(sin(dot(seed, vec2(127.1, 311.7)) + salt) * 43758.5453);
    }

    vec2 fieldPointCoordAt(vec2 ground) {
        return (ground - fieldOrigin) / fieldCellSize;
    }

    vec4 sampleTerrainField(vec2 pointCoord) {
        return texture2D(terrainField, (pointCoord + 0.5) / fieldPointsPerSide);
    }

    float insideTerrainField(vec2 pointCoord) {
        float lastPoint = fieldPointsPerSide - 1.0;

        return step(0.0, pointCoord.x) * step(pointCoord.x, lastPoint)
            * step(0.0, pointCoord.y) * step(pointCoord.y, lastPoint);
    }

    float withinGrowableGround(float steepness, float growthStopDistance) {
        float offSteepGround = 1.0 - smoothstep(steepGroundBand.x, steepGroundBand.y, steepness);
        float shortOfStop = 1.0 - smoothstep(growthStopBand.x, growthStopBand.y, growthStopDistance);

        return offSteepGround * shortOfStop;
    }

    vec2 groundCoverAt(vec2 ground, vec4 field) {
        vec2 growth = groundGrowthOf(groundMaterialShareAt(ground, 0.0));
        float offTrail = smoothstep(coverTrailBand.x, coverTrailBand.y, field.g);

        return vec2(
            growth.x * offTrail * withinGrowableGround(field.b, field.a),
            growth.y * offTrail
        );
    }

    float smoothNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 within = fract(point);
        vec2 blend = within * within * (3.0 - 2.0 * within);

        return mix(
            mix(randomScalar(cell, 0.0), randomScalar(cell + vec2(1.0, 0.0), 0.0), blend.x),
            mix(
                randomScalar(cell + vec2(0.0, 1.0), 0.0),
                randomScalar(cell + vec2(1.0, 1.0), 0.0),
                blend.x
            ),
            blend.y
        );
    }
`;

export const PATCH_FIELD_GLSL = `
    uniform float patchSpacing;
    uniform vec2 patchRadiusRange;
    uniform float patchChance;
    uniform float patchCoreRatio;
    uniform float patchEdgeWavelength;
    uniform float patchEdgeStrength;

    vec2 patchDensityAt(vec2 ground) {
        vec2 baseCell = floor(ground / patchSpacing);

        float rim = smoothNoise(ground / patchEdgeWavelength);
        float rimScale = mix(1.0 - patchEdgeStrength, 1.0 + patchEdgeStrength, rim);

        float strongest = 0.0;
        float speciesPick = 0.0;

        for (int offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            for (int offsetX = -1; offsetX <= 1; offsetX += 1) {
                vec2 cell = baseCell + vec2(float(offsetX), float(offsetZ));
                float occupancy = randomScalar(cell, 19.0);
                if (occupancy > patchChance) continue;

                vec3 placement = randomTriple(vec3(cell, 29.0));
                vec2 centre = (cell + placement.xy) * patchSpacing;
                float radius = max(
                    mix(patchRadiusRange.x, patchRadiusRange.y, placement.z) * rimScale,
                    0.001
                );
                float reach = length(ground - centre) / radius;
                float density = 1.0 - smoothstep(patchCoreRatio, 1.0, reach);

                if (density <= strongest) continue;

                strongest = density;
                speciesPick = occupancy / patchChance;
            }
        }

        return vec2(strongest, speciesPick);
    }
`;

export const groundCoverUniforms = (
    fieldTexture: DataTexture,
    heightMap: TerrainSampleGrid,
    steepGroundBand: [number, number]
) => ({
    terrainField: { value: fieldTexture },
    fieldOrigin: { value: new Vector2(heightMap.originX, heightMap.originZ) },
    fieldCellSize: { value: heightMap.cellSize },
    fieldPointsPerSide: { value: heightMap.pointsPerSide },
    steepGroundBand: { value: new Vector2(...steepGroundBand) },
    coverTrailBand: { value: new Vector2(...GROUND_COVER.coverTrailBand) },
    growthStopBand: {
        value: new Vector2(
            WORLD_EDGE.groundApron - GROUND_COVER.worldEdgeFadeWidth,
            WORLD_EDGE.groundApron
        ),
    },
});

export const patchFieldUniforms = (patch: IPatchFieldSettings) => ({
    patchSpacing: { value: patch.spacing },
    patchRadiusRange: { value: new Vector2(...patch.radiusRange) },
    patchChance: { value: patch.chance },
    patchCoreRatio: { value: patch.coreRatio },
    patchEdgeWavelength: { value: patch.edgeWavelength },
    patchEdgeStrength: { value: patch.edgeStrength },
});

export interface IPatchFieldSettings {
    spacing: number;
    radiusRange: [number, number];
    chance: number;
    coreRatio: number;
    edgeWavelength: number;
    edgeStrength: number;
}

export interface IDetailBand {
    innerRadius: number;
    outerRadius: number;
    subdivisions: number;
}

export function buildDetailBands(levelRadii: number[]): IDetailBand[] {
    const finestSubdivisions = 1 << (levelRadii.length - 1);
    let innerRadius = 0;

    return levelRadii.map((outerRadius, bandIndex) => {
        const band = {
            innerRadius,
            outerRadius,
            subdivisions: finestSubdivisions >> bandIndex,
        };

        innerRadius = outerRadius;

        return band;
    });
}

export function collectBandCells(band: IDetailBand, cellSpacing: number): Float32Array {
    const reach = Math.ceil(band.outerRadius / cellSpacing);
    const innerCellsSquared = (band.innerRadius / cellSpacing) ** 2;
    const outerCellsSquared = (band.outerRadius / cellSpacing) ** 2;

    const offsets = new Float32Array((reach * 2 + 1) ** 2 * 2);
    let count = 0;

    for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1)
        for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
            const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

            if (distanceSquared >= outerCellsSquared || distanceSquared < innerCellsSquared)
                continue;

            offsets[count] = offsetX;
            offsets[count + 1] = offsetZ;
            count += 2;
        }

    return offsets.slice(0, count);
}
