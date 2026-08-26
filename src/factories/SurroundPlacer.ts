import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import type { TerrainHeightField } from "@/world/TerrainHeightField";
import type { Vector3Tuple } from "three";
import { SURROUND, TERRAIN } from "@/constants/game";
import { createSeededRandom, lerp, pickRandomSubset, scaleBetween } from "@/lib/helpers";

export function placeSurroundVegetation(
    manifest: IThemeManifest,
    heightField: TerrainHeightField,
    playRadius: number,
    center: Vector3Tuple,
    seed: number
): IPropGroup[][] {
    const nextRandom = createSeededRandom(seed);
    const groupsByBucket = new Map<string, Map<string, IPropGroup>>();

    const trees = pickRandomSubset(
        manifest.props.filter((prop) => prop.role === PropRole.Landmark),
        SURROUND.treeSpeciesPerBand,
        nextRandom
    );
    const fillers = pickRandomSubset(
        manifest.props.filter((prop) => prop.role === PropRole.Structure),
        SURROUND.fillerSpeciesPerBand,
        nextRandom
    );
    const groundCover = pickRandomSubset(
        manifest.props.filter((prop) => prop.role === PropRole.Scatter),
        SURROUND.groundCoverSpeciesPerBand,
        nextRandom
    );

    const innerEdge = playRadius + SURROUND.edgePadding;
    const slopeStart = playRadius + TERRAIN.transition;

    const bands: IVegetationBand[] = [
        {
            species: groundCover,
            radiusRange: [0, playRadius],
            density: SURROUND.groundCoverDensity,
            densityFactor: 1,
            slopeLimit: SURROUND.grassSlopeLimit,
            scaleBoostRange: [1, 1],
        },
        {
            species: fillers,
            radiusRange: [0, playRadius],
            density: SURROUND.fillerDensity,
            densityFactor: 1,
            slopeLimit: SURROUND.fillerSlopeLimit,
            scaleBoostRange: [1, 1.2],
        },
        {
            species: trees,
            radiusRange: [0, playRadius],
            density: SURROUND.treeDensity,
            densityFactor: 1,
            slopeLimit: SURROUND.treeSlopeLimit,
            scaleBoostRange: [1, 1.3],
        },
        {
            species: groundCover,
            radiusRange: [innerEdge, slopeStart],
            density: SURROUND.groundCoverDensity,
            densityFactor: SURROUND.outerDensityFactor,
            slopeLimit: SURROUND.grassSlopeLimit,
            scaleBoostRange: [1, 1],
        },
        {
            species: fillers,
            radiusRange: [innerEdge, slopeStart + TERRAIN.spread * 0.5],
            density: SURROUND.fillerDensity,
            densityFactor: SURROUND.outerDensityFactor,
            slopeLimit: SURROUND.fillerSlopeLimit,
            scaleBoostRange: [1, 1.3],
        },
        {
            species: trees,
            radiusRange: [innerEdge, slopeStart + TERRAIN.spread * 0.7],
            density: SURROUND.treeDensity,
            densityFactor: SURROUND.outerDensityFactor,
            slopeLimit: SURROUND.treeSlopeLimit,
            scaleBoostRange: SURROUND.treeScaleBoost,
        },
    ];

    for (const band of bands)
        scatterBand(groupsByBucket, band, { heightField, center, nextRandom });

    return [...groupsByBucket.values()].map((groups) => [...groups.values()]);
}

function scatterBand(
    groupsByBucket: Map<string, Map<string, IPropGroup>>,
    band: IVegetationBand,
    world: IScatterWorld
): void {
    if (band.species.length === 0) return;

    const { heightField, center, nextRandom } = world;
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

        const sample = heightField.sampleTerrainAt(localX, localZ);
        if (sample.carveStrength > SURROUND.carveRejectThreshold) continue;
        if (heightField.steepnessAt(localX, localZ) > band.slopeLimit) continue;

        const scale =
            scaleBetween(prop.scaleRange, nextRandom()) *
            lerp(band.scaleBoostRange[0], band.scaleBoostRange[1], nextRandom());

        appendPlacement(groupsByBucket, prop, localX, localZ, {
            position: [center[0] + localX, sample.elevation - 0.02, center[2] + localZ],
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

    return Math.min(Math.round(annulusArea * density * densityFactor), SURROUND.maximumPerBand);
}

function appendPlacement(
    groupsByBucket: Map<string, Map<string, IPropGroup>>,
    prop: IThemeProp,
    localX: number,
    localZ: number,
    placement: IPropGroup["placements"][number]
): void {
    const bucketKey = `${Math.floor(localX / TERRAIN.bucketSize)}:${Math.floor(localZ / TERRAIN.bucketSize)}`;

    let bucket = groupsByBucket.get(bucketKey);
    if (!bucket) {
        bucket = new Map<string, IPropGroup>();
        groupsByBucket.set(bucketKey, bucket);
    }

    const existingGroup = bucket.get(prop.modelPath);

    if (existingGroup) {
        existingGroup.placements.push(placement);
        return;
    }

    bucket.set(prop.modelPath, {
        modelPath: prop.modelPath,
        role: prop.role,
        hasCollider: false,
        footprintRadius: prop.footprintRadius,
        placements: [placement],
    });
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
    heightField: TerrainHeightField;
    center: Vector3Tuple;
    nextRandom: () => number;
}
