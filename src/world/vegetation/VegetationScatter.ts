import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import {
    createHeightMapSample,
    type IHeightMapSample,
    type TerrainHeightMap,
} from "@/world/terrain/TerrainHeightMap";
import type { Vector3Tuple } from "three";
import { PropGroupCollector } from "@/world/props/PropGroups";
import { createSeededRandom, lerp, pickRandomSubset, scaleBetween, FULL_TURN } from "@/lib/helpers";
import { VEGETATION } from "@/constants/placement";
import { TERRAIN, WORLD_EDGE } from "@/constants/world";
import { trailWearAt } from "../terrain/GroundMaterials";

const BUCKET_KEY_OFFSET = 1 << 20;

export function scatterVegetation(
    manifest: IThemeManifest,
    heightMap: TerrainHeightMap,
    scatterRadius: number,
    center: Vector3Tuple,
    seed: number
): IPropGroup[][] {
    const nextRandom = createSeededRandom(seed);
    const collectorsByBucket = new Map<number, PropGroupCollector>();
    const heightSample = createHeightMapSample();

    const trees = pickRandomSubset(
        manifest.props.filter((prop) => prop.role === PropRole.Landmark),
        VEGETATION.treeSpeciesPerBand,
        nextRandom
    );
    const fillers = pickRandomSubset(
        manifest.props.filter((prop) => prop.role === PropRole.Structure),
        VEGETATION.fillerSpeciesPerBand,
        nextRandom
    );
    const groundCover = pickRandomSubset(
        manifest.props.filter((prop) => prop.role === PropRole.Scatter),
        VEGETATION.groundCoverSpeciesPerBand,
        nextRandom
    );

    const bands: IVegetationBand[] = [
        {
            species: groundCover,
            radiusRange: [0, scatterRadius],
            density: VEGETATION.groundCoverDensity,
            slopeLimit: VEGETATION.grassSlopeLimit,
            scaleBoostRange: [1, 1],
        },
        {
            species: fillers,
            radiusRange: [0, scatterRadius],
            density: VEGETATION.fillerDensity,
            slopeLimit: VEGETATION.fillerSlopeLimit,
            scaleBoostRange: [1, 1.2],
        },
        {
            species: trees,
            radiusRange: [0, scatterRadius],
            density: VEGETATION.treeDensity,
            slopeLimit: VEGETATION.treeSlopeLimit,
            scaleBoostRange: VEGETATION.treeScaleBoost,
        },
    ];

    for (const band of bands)
        scatterBand(collectorsByBucket, band, { heightMap, center, nextRandom, heightSample });

    return [...collectorsByBucket.values()].map((collector) => collector.toGroups());
}

function scatterBand(
    collectorsByBucket: Map<number, PropGroupCollector>,
    band: IVegetationBand,
    world: IScatterWorld
): void {
    if (band.species.length === 0) return;

    const { heightMap, center, nextRandom, heightSample } = world;
    const [innerRadius, outerRadius] = band.radiusRange;
    const count = countForAnnulus(innerRadius, outerRadius, band.density);

    for (let index = 0; index < count; index += 1) {
        const prop = band.species[Math.floor(nextRandom() * band.species.length)];
        if (!prop) continue;

        const angle = nextRandom() * FULL_TURN;
        const radius = Math.sqrt(
            lerp(innerRadius * innerRadius, outerRadius * outerRadius, nextRandom())
        );

        const localX = Math.cos(angle) * radius;
        const localZ = Math.sin(angle) * radius;

        heightMap.sampleAt(localX, localZ, heightSample);
        if (trailWearAt(heightSample.trailDistance) > VEGETATION.trailWearRejectThreshold) continue;
        if (heightSample.footprintDistance > WORLD_EDGE.groundApron) continue;
        if (heightSample.steepness > band.slopeLimit) continue;

        const scale =
            scaleBetween(prop.scaleRange, nextRandom()) *
            lerp(band.scaleBoostRange[0], band.scaleBoostRange[1], nextRandom());

        collectorFor(collectorsByBucket, localX, localZ).add(prop, {
            position: [
                center[0] + localX,
                heightSample.elevation - VEGETATION.groundBite,
                center[2] + localZ,
            ],
            rotationY: nextRandom() * FULL_TURN,
            scale,
        });
    }
}

function countForAnnulus(innerRadius: number, outerRadius: number, density: number): number {
    const annulusArea = Math.PI * (outerRadius * outerRadius - innerRadius * innerRadius);

    return Math.min(Math.round(annulusArea * density), VEGETATION.maximumPerBand);
}

function collectorFor(
    collectorsByBucket: Map<number, PropGroupCollector>,
    localX: number,
    localZ: number
): PropGroupCollector {
    const bucketX = Math.floor(localX / TERRAIN.bucketSize);
    const bucketZ = Math.floor(localZ / TERRAIN.bucketSize);
    const bucketKey =
        (bucketX + BUCKET_KEY_OFFSET) * (BUCKET_KEY_OFFSET * 2) + (bucketZ + BUCKET_KEY_OFFSET);

    const existing = collectorsByBucket.get(bucketKey);
    if (existing) return existing;

    const collector = new PropGroupCollector(false);
    collectorsByBucket.set(bucketKey, collector);

    return collector;
}

interface IVegetationBand {
    species: IThemeProp[];
    radiusRange: [number, number];
    density: number;
    slopeLimit: number;
    scaleBoostRange: [number, number];
}

interface IScatterWorld {
    heightMap: TerrainHeightMap;
    center: Vector3Tuple;
    nextRandom: () => number;
    heightSample: IHeightMapSample;
}
