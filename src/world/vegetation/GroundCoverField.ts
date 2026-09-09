import { Vector2, type DataTexture } from "three";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { GROUND_COVER } from "@/constants/placement";
import { WORLD_EDGE } from "@/constants/world";

/* Everything GrassField and BloomField both need that isn't specific to blade or petal shape:
   the shared GLSL vocabulary for reading the terrain sample grid and placing camera-relative
   instances on it, and the LOD ring geometry each field bakes its instance count into. */

/* Shared vertex-shader vocabulary for every camera-relative ground cover field (grass,
   blooms). Each field reads the terrain height map as an RGBA texture - r elevation,
   g trail distance, b steepness, a growth-stop distance - so placement decisions happen on
   the GPU and the CPU never touches per-instance state.

   Must be concatenated AFTER GROUND_MATERIAL_GLSL, which declares groundGrowthOf and
   groundMaterialShareAt. */
export const GROUND_COVER_GLSL = /* glsl */ `
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

    /* trail wear is passed as zero into the material share on purpose. Folding wear into the
       material weights runs it through the exponential sharpening the ground colour needs,
       which collapsed cover from full to bare inside a metre; the explicit metre-scale band
       below is what makes a path read as worn in rather than stamped out. Patch tone is faded
       by the same band so the tufts that survive nearest a path keep their dry, trampled
       colouring instead of standing lush against bare soil. Returns (cover, patchTone). */
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

/* Discrete patch structure: cluster centres on a jittered grid, each with its own radius,
   falloff and species. This replaces gating a field on broad gradient noise, which spreads a
   uniform low spawn chance across tens of metres and reads as haze rather than as clumps.

   Must be concatenated AFTER GROUND_COVER_GLSL, which declares randomTriple, randomScalar
   and smoothNoise.

   Cost note: 9 scalar hashes for the cell sweep plus 4 for the one-octave rim warp is 13
   sin-based hashes per vertex, against the 16 the two driftNoise calls this replaces cost
   (two octaves, four lattice corners each, twice over) - so this is cheaper per vertex than
   the gradient-noise gate it supersedes, not merely equivalent. */
export const PATCH_FIELD_GLSL = /* glsl */ `
    uniform float patchSpacing;
    uniform vec2 patchRadiusRange;
    uniform float patchChance;
    uniform float patchCoreRatio;
    uniform float patchEdgeWavelength;
    uniform float patchEdgeStrength;

    /* the 3x3 sweep is not optional: a centre sits anywhere in its cell and reaches up to
       patchRadiusRange.y, which exceeds one cell, so ignoring neighbours would clip every
       patch to its cell and the grid would read as square tiles. Cells are gated on a single
       scalar hash first, so an empty cell - most of them - costs one hash and nothing more.

       Returns (density, speciesPick), the species being drawn from the winning patch so that
       one patch is one species rather than a blend of three. */
    vec2 patchDensityAt(vec2 ground) {
        vec2 baseCell = floor(ground / patchSpacing);

        /* The rim warp scales each patch's RADIUS before the falloff is evaluated, so the
           boundary itself moves in and out with position and a disc becomes an irregular
           blob. Scaling the resulting density instead would do neither of the things this
           needs to do: outside a patch the density is already zero, so no amount of noise
           can push the boundary outwards, and inside one it would punch holes through the
           middle of the patch rather than ragging its edge.

           Sampled once, before the loop, since it depends only on where we are - and at one
           octave, because a 4.5m wavelength warp does not need a second. */
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
                /* floored away from zero, not just left to patchRadiusRange/patchEdgeStrength
                   staying sane by convention - rimScale can reach 0 (or go negative) once
                   patchEdgeStrength hits 1.0, and dividing by a zero/negative radius here is a
                   NaN or Inf that propagates through smoothstep below with undefined results on
                   at least some mobile GPUs. Current tuning never reaches that, but the guard is
                   free and the failure mode is silent corruption, not a crash to notice tuning
                   by. Caught in review. */
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

/* Concentric level-of-detail rings around the camera. Each band covers an annulus of ground
   and halves the geometry subdivision of the one inside it, so a tuft near the camera carries
   the full blade segment count while one at the horizon costs a fraction of it. The cell
   offsets are baked once into an instanced attribute; only the ring's centre moves each
   frame, which is what keeps the whole field at two draw calls. */

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
