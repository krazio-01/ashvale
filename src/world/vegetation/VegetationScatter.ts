import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import type { Vector3Tuple } from "three";
import { PropGroupCollector } from "@/world/props/PropGroups";
import { createSeededRandom, lerp, pickRandomSubset, scaleBetween } from "@/lib/helpers";
import { VEGETATION } from "@/constants/placement";
import { TERRAIN } from "@/constants/world";

export function scatterVegetation(
    manifest: IThemeManifest,
    heightMap: TerrainHeightMap,
    playRadius: number,
    center: Vector3Tuple,
    seed: number
): IPropGroup[][] {
    const nextRandom = createSeededRandom(seed);
    const collectorsByBucket = new Map<string, PropGroupCollector>();

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

    const innerEdge = playRadius + VEGETATION.edgePadding;
    const slopeStart = playRadius + TERRAIN.transition;

    const bands: IVegetationBand[] = [
        {
            species: groundCover,
            radiusRange: [0, playRadius],
            density: VEGETATION.groundCoverDensity,
            densityFactor: 1,
            slopeLimit: VEGETATION.grassSlopeLimit,
            scaleBoostRange: [1, 1],
        },
        {
            species: fillers,
            radiusRange: [0, playRadius],
            density: VEGETATION.fillerDensity,
            densityFactor: 1,
            slopeLimit: VEGETATION.fillerSlopeLimit,
            scaleBoostRange: [1, 1.2],
        },
        {
            species: trees,
            radiusRange: [0, playRadius],
            density: VEGETATION.treeDensity,
            densityFactor: 1,
            slopeLimit: VEGETATION.treeSlopeLimit,
            scaleBoostRange: [1, 1.3],
        },
        {
            species: groundCover,
            radiusRange: [innerEdge, slopeStart],
            density: VEGETATION.groundCoverDensity,
            densityFactor: VEGETATION.outerDensityFactor,
            slopeLimit: VEGETATION.grassSlopeLimit,
            scaleBoostRange: [1, 1],
        },
        {
            species: fillers,
            radiusRange: [innerEdge, slopeStart + TERRAIN.spread * 0.5],
            density: VEGETATION.fillerDensity,
            densityFactor: VEGETATION.outerDensityFactor,
            slopeLimit: VEGETATION.fillerSlopeLimit,
            scaleBoostRange: [1, 1.3],
        },
        {
            species: trees,
            radiusRange: [innerEdge, slopeStart + TERRAIN.spread * 0.7],
            density: VEGETATION.treeDensity,
            densityFactor: VEGETATION.outerDensityFactor,
            slopeLimit: VEGETATION.treeSlopeLimit,
            scaleBoostRange: VEGETATION.treeScaleBoost,
        },
    ];

    for (const band of bands)
        scatterBand(collectorsByBucket, band, { heightMap, center, nextRandom });

    return [...collectorsByBucket.values()].map((collector) => collector.toGroups());
}

function scatterBand(
    collectorsByBucket: Map<string, PropGroupCollector>,
    band: IVegetationBand,
    world: IScatterWorld
): void {
    if (band.species.length === 0) return;

    const { heightMap, center, nextRandom } = world;
    const [innerRadius, outerRadius] = band.radiusRange;
    const count = countForAnnulus(innerRadius, outerRadius, band.density, band.densityFactor);

    for (let index = 0; index < count; index += 1) {
        const prop = band.species[Math.floor(nextRandom() * band.species.length)];
        if (!prop) continue;

        const angle = nextRandom() * Math.PI * 2;
        const radius = Math.sqrt(
            lerp(innerRadius * innerRadius, outerRadius * outerRadius, nextRandom())
        );

        const localX = Math.cos(angle) * radius;
        const localZ = Math.sin(angle) * radius;

        if (heightMap.carveStrengthAt(localX, localZ) > VEGETATION.carveRejectThreshold) continue;
        if (heightMap.steepnessAt(localX, localZ) > band.slopeLimit) continue;

        const scale =
            scaleBetween(prop.scaleRange, nextRandom()) *
            lerp(band.scaleBoostRange[0], band.scaleBoostRange[1], nextRandom());

        collectorFor(collectorsByBucket, localX, localZ).add(prop, {
            position: [
                center[0] + localX,
                heightMap.elevationAt(localX, localZ) - VEGETATION.groundBite,
                center[2] + localZ,
            ],
            rotationY: nextRandom() * Math.PI * 2,
            scale,
        });
    }
}

function countForAnnulus(
    innerRadius: number,
    outerRadius: number,
    density: number,
    densityFactor: number
): number {
    const annulusArea = Math.PI * (outerRadius * outerRadius - innerRadius * innerRadius);

    return Math.min(Math.round(annulusArea * density * densityFactor), VEGETATION.maximumPerBand);
}

function collectorFor(
    collectorsByBucket: Map<string, PropGroupCollector>,
    localX: number,
    localZ: number
): PropGroupCollector {
    const bucketKey = `${Math.floor(localX / TERRAIN.bucketSize)}:${Math.floor(localZ / TERRAIN.bucketSize)}`;
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
    densityFactor: number;
    slopeLimit: number;
    scaleBoostRange: [number, number];
}

interface IScatterWorld {
    heightMap: TerrainHeightMap;
    center: Vector3Tuple;
    nextRandom: () => number;
}
