import { PropRole, type IPropGroup, type IThemeManifest, type IThemeProp } from "@/types/theme";
import type { TerrainHeightField } from "@/world/TerrainHeightField";
import type { Vector3Tuple } from "three";
import { SURROUND, TERRAIN } from "@/constants/game";
import { createSeededRandom, lerp } from "@/lib/helpers";

export function placeSurroundVegetation(
    manifest: IThemeManifest,
    heightField: TerrainHeightField,
    playRadius: number,
    center: Vector3Tuple,
    seed: number
): IPropGroup[][] {
    const nextRandom = createSeededRandom(seed);
    const groupsByBucket = new Map<string, Map<string, IPropGroup>>();

    const trees = manifest.props.filter((prop) => prop.role === PropRole.Landmark);
    const fillers = manifest.props.filter((prop) => prop.role === PropRole.Structure);
    const grasses = manifest.props.filter((prop) => prop.role === PropRole.Scatter);

    const innerEdge = playRadius + SURROUND.edgePadding;
    const slopeStart = playRadius + TERRAIN.transition;

    const bands = [
        {
            species: grasses,
            count: SURROUND.innerGrassCount,
            range: [0, playRadius],
            slopeLimit: SURROUND.grassSlopeLimit,
            boost: [1, 1],
        },
        {
            species: fillers,
            count: SURROUND.innerFillerCount,
            range: [0, playRadius],
            slopeLimit: SURROUND.fillerSlopeLimit,
            boost: [1, 1.2],
        },
        {
            species: trees,
            count: SURROUND.innerTreeCount,
            range: [0, playRadius],
            slopeLimit: SURROUND.treeSlopeLimit,
            boost: [1, 1.3],
        },
        {
            species: grasses,
            count: SURROUND.outerGrassCount,
            range: [innerEdge, slopeStart],
            slopeLimit: SURROUND.grassSlopeLimit,
            boost: [1, 1],
        },
        {
            species: fillers,
            count: SURROUND.outerFillerCount,
            range: [innerEdge, slopeStart + TERRAIN.spread * 0.5],
            slopeLimit: SURROUND.fillerSlopeLimit,
            boost: [1, 1.3],
        },
        {
            species: trees,
            count: SURROUND.outerTreeCount,
            range: [innerEdge, slopeStart + TERRAIN.spread * 0.7],
            slopeLimit: SURROUND.treeSlopeLimit,
            boost: SURROUND.treeScaleBoost,
        },
    ];

    for (const band of bands)
        scatterBand(groupsByBucket, band.species, band.count, {
            heightField,
            center,
            nextRandom,
            radiusRange: [band.range[0] ?? 0, band.range[1] ?? 0],
            slopeLimit: band.slopeLimit,
            scaleBoostRange: [band.boost[0] ?? 1, band.boost[1] ?? 1],
        });

    return [...groupsByBucket.values()].map((groups) => [...groups.values()]);
}

interface IScatterBandOptions {
    heightField: TerrainHeightField;
    center: Vector3Tuple;
    nextRandom: () => number;
    radiusRange: [number, number];
    slopeLimit: number;
    scaleBoostRange: [number, number];
}

function scatterBand(
    groupsByBucket: Map<string, Map<string, IPropGroup>>,
    species: IThemeProp[],
    count: number,
    options: IScatterBandOptions
): void {
    if (species.length === 0) return;

    const { heightField, center, nextRandom, radiusRange, slopeLimit, scaleBoostRange } = options;
    const [innerRadius, outerRadius] = radiusRange;

    for (let index = 0; index < count; index += 1) {
        const prop = species[Math.floor(nextRandom() * species.length)];
        if (!prop) continue;

        const angle = nextRandom() * Math.PI * 2;
        const radius = Math.sqrt(
            lerp(innerRadius * innerRadius, outerRadius * outerRadius, nextRandom())
        );

        const localX = Math.cos(angle) * radius;
        const localZ = Math.sin(angle) * radius;

        const sample = heightField.sampleAt(localX, localZ);
        if (sample.flatWeight > SURROUND.flatRejectWeight) continue;
        if (heightField.slopeAt(localX, localZ) > slopeLimit) continue;

        const scale =
            scaleBetween(prop.scaleRange, nextRandom()) *
            lerp(scaleBoostRange[0], scaleBoostRange[1], nextRandom());

        appendPlacement(groupsByBucket, prop, localX, localZ, {
            position: [center[0] + localX, sample.height - 0.02, center[2] + localZ],
            rotationY: nextRandom() * Math.PI * 2,
            scale,
        });
    }
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

function scaleBetween([minimum, maximum]: [number, number], ratio: number): number {
    return minimum + ratio * (maximum - minimum);
}
