import { Vector2, type DataTexture } from "three";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { GROUND_FIELD } from "@/constants/placement";
import { WORLD_EDGE } from "@/constants/world";

export const GROUND_FIELD_GLSL = /* glsl */ `
    uniform sampler2D terrainField;
    uniform vec2 fieldOrigin;
    uniform float fieldCellSize;
    uniform float fieldPointsPerSide;
    uniform vec2 steepGroundBand;
    uniform vec2 worldEdgeBand;

    vec3 randomTriple(vec3 seed) {
        vec3 scattered = fract(seed * vec3(0.1031, 0.1030, 0.0973));
        scattered += dot(scattered, scattered.yxz + 33.33);

        return fract((scattered.xxy + scattered.yxx) * scattered.zyx);
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

    float withinGrowableGround(float steepness, float footprintDistance) {
        float offSteepGround = 1.0 - smoothstep(steepGroundBand.x, steepGroundBand.y, steepness);
        float insideWorldEdge = 1.0 - smoothstep(worldEdgeBand.x, worldEdgeBand.y, footprintDistance);

        return offSteepGround * insideWorldEdge;
    }

    float latticeValue(vec2 lattice) {
        return fract(sin(dot(lattice, vec2(127.1, 311.7))) * 43758.5453);
    }

    float smoothNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 within = fract(point);
        vec2 blend = within * within * (3.0 - 2.0 * within);

        return mix(
            mix(latticeValue(cell), latticeValue(cell + vec2(1.0, 0.0)), blend.x),
            mix(latticeValue(cell + vec2(0.0, 1.0)), latticeValue(cell + vec2(1.0, 1.0)), blend.x),
            blend.y
        );
    }

    /* two octaves is enough to break up the lattice while keeping patch edges legible,
       which is what makes drifts read as drifts rather than as gradient noise */
    float driftNoise(vec2 point) {
        return smoothNoise(point) * 0.65 + smoothNoise(point * 2.17) * 0.35;
    }
`;

export const groundFieldUniforms = (
    fieldTexture: DataTexture,
    heightMap: TerrainHeightMap,
    steepGroundBand: [number, number]
) => ({
    terrainField: { value: fieldTexture },
    fieldOrigin: { value: new Vector2(heightMap.originX, heightMap.originZ) },
    fieldCellSize: { value: heightMap.cellSize },
    fieldPointsPerSide: { value: heightMap.pointsPerSide },
    steepGroundBand: { value: new Vector2(...steepGroundBand) },
    worldEdgeBand: {
        value: new Vector2(
            WORLD_EDGE.groundApron - GROUND_FIELD.worldEdgeFadeWidth,
            WORLD_EDGE.groundApron
        ),
    },
});

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

export interface IDetailBand {
    innerRadius: number;
    outerRadius: number;
    subdivisions: number;
}
