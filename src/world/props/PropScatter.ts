import { type IThemeProp } from "@/types/world";
import type { IRegionFloor, ISpeciesByLayer, IPropFieldInput } from "@/types/world";
import {
    collidesWithPlayer,
    placeProp,
    PlacementOutcome,
    type IPropScatterContext,
    type IPlacementRules,
    rollPropScale,
    scatterSpecies,
    placeUnlessBlocked,
} from "@/world/props/PropPlacement";
import { WATER_CHANNEL } from "@/constants/world";
import { PROP_SCATTER, DEFAULT_FAMILY } from "@/constants/placement";
import { FractalNoise } from "@/lib/noise";
import {
    clamp,
    lerp,
    pickRandomSubset,
    smoothstep,
    FULL_TURN,
    pointAtAngle,
    segmentFrame,
    randomPointInDisc,
    pickRandomOrNull,
    firstFit,
    pickRandom,
} from "@/lib/helpers";
import type { RandomSource } from "@/lib/helpers";

interface IPropClump {
    centerX: number;
    centerZ: number;
    radius: number;
    richness: number;
    standing: IThemeProp[];
    standingRules: IPlacementRules;
    understory: IThemeProp[];
    groundcover: IThemeProp[];
}

interface IPlacedHost {
    localX: number;
    localZ: number;
    maxFootprintRadius: number;
    pack: string;
}

interface IGroundSpot {
    localX: number;
    localZ: number;
}

export function seedClumps(
    input: IPropFieldInput,
    speciesByLayer: ISpeciesByLayer,
    nextRandom: () => number
): IPropClump[] {
    const settings = PROP_SCATTER.clump;
    const mask = new FractalNoise(input.seed + 11);
    const biomeNoise = new FractalNoise(input.seed + 59);
    const canopyByFamily = groupByFamily(speciesByLayer.canopy);
    const canopyFamilies = Array.from(canopyByFamily.keys());
    const clumps: IPropClump[] = [];

    const [minimumRadius, maximumRadius] = settings.radiusRange;
    forEachJitteredCandidate(
        input.fieldRadius,
        settings.candidateSpacing,
        nextRandom,
        (centerX, centerZ) => {
            const forestStrength = mask.sample(
                centerX / settings.maskWavelength,
                centerZ / settings.maskWavelength,
                settings.maskOctaves,
                settings.maskGain
            );

            if (forestStrength < settings.forestThreshold) return;

            const groveStrength =
                (forestStrength - settings.forestThreshold) / (1 - settings.forestThreshold);
            const isOutcrop =
                forestStrength > settings.outcropThreshold && speciesByLayer.rock.length > 0;

            clumps.push({
                centerX,
                centerZ,
                radius: lerp(minimumRadius, maximumRadius, groveStrength),
                richness: richnessAt(centerX, centerZ, input.sites),
                standing: isOutcrop
                    ? pickRandomSubset(
                          speciesByLayer.rock,
                          settings.canopySpeciesPerClump,
                          nextRandom
                      )
                    : pickFamilyCoherentSpecies(
                          canopyByFamily,
                          canopyFamilies,
                          centerX,
                          centerZ,
                          biomeNoise,
                          settings.canopySpeciesPerClump,
                          nextRandom
                      ),
                standingRules: isOutcrop ? PROP_SCATTER.rock : PROP_SCATTER.canopy,
                understory: pickRandomSubset(
                    speciesByLayer.understory,
                    settings.understorySpeciesPerClump,
                    nextRandom
                ),
                groundcover: pickRandomSubset(
                    speciesByLayer.groundcover,
                    settings.groundcoverSpeciesPerClump,
                    nextRandom
                ),
            });
        }
    );

    return clumps;
}

function groupByFamily(species: IThemeProp[]): Map<string, IThemeProp[]> {
    const byFamily = new Map<string, IThemeProp[]>();

    for (const prop of species) {
        const family = byFamily.get(prop.family);
        if (family) family.push(prop);
        else byFamily.set(prop.family, [prop]);
    }

    return byFamily;
}

function dominantFamilyAt(
    localX: number,
    localZ: number,
    families: string[],
    noise: FractalNoise,
    nextRandom: () => number
): string {
    if (families.length <= 1) return families[0] ?? DEFAULT_FAMILY;

    const settings = PROP_SCATTER.biomeRegion;
    const rawValue = noise.sample(
        localX / settings.wavelength,
        localZ / settings.wavelength,
        settings.octaves,
        settings.gain
    );

    const regionValue = smoothstep(settings.equalizeBand[0], settings.equalizeBand[1], rawValue);

    const bandWidth = 1 / families.length;
    const bandIndex = clamp(Math.floor(regionValue / bandWidth), 0, families.length - 1);
    const bandLocal = (regionValue - bandIndex * bandWidth) / bandWidth;

    const towardsPreviousBand = bandLocal < 0.5;
    const edgeDistance = towardsPreviousBand ? bandLocal : 1 - bandLocal;
    const neighbourIndex = clamp(
        bandIndex + (towardsPreviousBand ? -1 : 1),
        0,
        families.length - 1
    );

    const neighbourWeight = 0.5 * (1 - smoothstep(0, settings.transitionWidth / 2, edgeDistance));
    const chosenIndex = nextRandom() < neighbourWeight ? neighbourIndex : bandIndex;

    return families[chosenIndex];
}

function pickFamilyCoherentSpecies(
    speciesByFamily: Map<string, IThemeProp[]>,
    families: string[],
    localX: number,
    localZ: number,
    noise: FractalNoise,
    count: number,
    nextRandom: () => number
): IThemeProp[] {
    const family = dominantFamilyAt(localX, localZ, families, noise, nextRandom);

    return pickRandomSubset(speciesByFamily.get(family) ?? [], count, nextRandom);
}

function richnessAt(localX: number, localZ: number, sites: IRegionFloor[]): number {
    const [minimumRichness, maximumRichness] = PROP_SCATTER.densityScaleRange;

    for (const site of sites) {
        if (Math.abs(localX - site.centerX) > site.halfWidth) continue;
        if (Math.abs(localZ - site.centerZ) > site.halfDepth) continue;

        return clamp(
            site.fileCount / PROP_SCATTER.typicalFileCount,
            minimumRichness,
            maximumRichness
        );
    }

    return 1;
}

export function fillClump(clump: IPropClump, scatter: IPropScatterContext): void {
    const clumpArea = Math.PI * clump.radius * clump.radius;
    const standingRules = clump.standingRules;

    const standingPlaced = scatterAroundCentre(
        clump.centerX,
        clump.centerZ,
        clump.standing,
        Math.round(clumpArea * standingRules.density * clump.richness),
        standingRules,
        clump.radius,
        scatter
    );

    scatterAgainstNeighbours(
        clump,
        clump.understory,
        Math.round(clumpArea * PROP_SCATTER.understory.density * clump.richness),
        standingPlaced,
        scatter
    );

    scatterAroundCentre(
        clump.centerX,
        clump.centerZ,
        clump.groundcover,
        Math.round(clumpArea * PROP_SCATTER.groundcover.density * clump.richness),
        PROP_SCATTER.groundcover,
        clump.radius,
        scatter
    );
}

function scatterAroundCentre(
    centerX: number,
    centerZ: number,
    species: IThemeProp[],
    count: number,
    rules: IPlacementRules,
    spreadRadius: number,
    scatter: IPropScatterContext
): IPlacedHost[] {
    const placed: IPlacedHost[] = [];
    if (species.length === 0) return placed;

    scatterSpecies(species, count, scatter.nextRandom, (prop) =>
        firstFit(PROP_SCATTER.placementAttempts, () => {
            const angle = scatter.nextRandom() * FULL_TURN;
            const distance = Math.pow(scatter.nextRandom(), rules.centreBias) * spreadRadius;
            const [localX, localZ] = pointAtAngle(centerX, centerZ, angle, distance);

            const outcome = placeProp(prop, localX, localZ, rules, scatter);
            if (outcome === PlacementOutcome.Blocked) return null;

            if (outcome === PlacementOutcome.Placed && collidesWithPlayer(prop))
                placed.push({
                    localX,
                    localZ,
                    maxFootprintRadius:
                        prop.footprintRadius * prop.scaleRange[1] * rules.scaleBoost[1],
                    pack: prop.pack,
                });
            return outcome;
        })
    );

    return placed;
}

function scatterAgainstNeighbours(
    clump: IPropClump,
    species: IThemeProp[],
    count: number,
    neighbours: IPlacedHost[],
    scatter: IPropScatterContext
): void {
    if (species.length === 0) return;

    const naturalHosts = neighbours.filter((neighbour) => neighbour.pack !== "architecture");
    const { clusterChance, clusterRadius, clusterCentreBias } = PROP_SCATTER.understory;

    scatterSpecies(species, count, scatter.nextRandom, (prop) => {
        const joinsCluster = naturalHosts.length > 0 && scatter.nextRandom() < clusterChance;
        const host = joinsCluster ? pickRandom(naturalHosts, scatter.nextRandom) : undefined;

        const understoryFootprint =
            prop.footprintRadius * prop.scaleRange[1] * PROP_SCATTER.understory.scaleBoost[1];
        const minDistance = host
            ? host.maxFootprintRadius + understoryFootprint + PROP_SCATTER.understory.spacingGap
            : 0;
        const maxDistance = host ? Math.max(clusterRadius, minDistance) : clump.radius;

        firstFit(PROP_SCATTER.placementAttempts, () => {
            const angle = scatter.nextRandom() * FULL_TURN;
            const distance = host
                ? lerp(minDistance, maxDistance, Math.pow(scatter.nextRandom(), clusterCentreBias))
                : Math.sqrt(scatter.nextRandom()) * clump.radius;

            const [localX, localZ] = pointAtAngle(
                host ? host.localX : clump.centerX,
                host ? host.localZ : clump.centerZ,
                angle,
                distance
            );

            return placeUnlessBlocked(prop, localX, localZ, PROP_SCATTER.understory, scatter);
        });
    });
}

export function scatterGroundcoverPatches(
    input: IPropFieldInput,
    species: IThemeProp[],
    scatter: IPropScatterContext
): void {
    if (species.length === 0) return;

    const settings = PROP_SCATTER.groundcoverPatch;
    const mask = new FractalNoise(input.seed + 23);
    const rim = new FractalNoise(input.seed + 41);

    const [minimumRadius, maximumRadius] = settings.radiusRange;
    const [minimumCount, maximumCount] = settings.countRange;

    forEachJitteredCandidate(
        input.fieldRadius,
        settings.spacing,
        scatter.nextRandom,
        (centerX, centerZ) => {
            const meadowStrength = mask.sample(
                centerX / settings.maskWavelength,
                centerZ / settings.maskWavelength,
                PROP_SCATTER.clump.maskOctaves,
                PROP_SCATTER.clump.maskGain
            );

            if (meadowStrength < settings.maskThreshold) return;

            const patchSpecies = pickRandomSubset(
                species,
                settings.speciesPerPatch,
                scatter.nextRandom
            );
            if (patchSpecies.length === 0) return;

            const strength =
                (meadowStrength - settings.maskThreshold) / (1 - settings.maskThreshold);

            fillPatch(
                centerX,
                centerZ,
                lerp(minimumRadius, maximumRadius, strength),
                Math.round(lerp(minimumCount, maximumCount, strength)),
                patchSpecies,
                rim,
                scatter
            );
        }
    );
}

function fillPatch(
    centerX: number,
    centerZ: number,
    radius: number,
    count: number,
    species: IThemeProp[],
    rim: FractalNoise,
    scatter: IPropScatterContext
): void {
    const settings = PROP_SCATTER.groundcoverPatch;

    scatterSpecies(species, count, scatter.nextRandom, (prop) =>
        firstFit(PROP_SCATTER.placementAttempts, () => {
            const angle = scatter.nextRandom() * FULL_TURN;
            const towardsX = Math.cos(angle);
            const towardsZ = Math.sin(angle);
            const rimStrength = rim.sample(
                (centerX + towardsX * radius) / settings.rimWavelength,
                (centerZ + towardsZ * radius) / settings.rimWavelength,
                2,
                0.5
            );
            const reach =
                radius * lerp(1 - settings.rimStrength, 1 + settings.rimStrength, rimStrength);
            const distance = Math.pow(scatter.nextRandom(), settings.coreBias) * reach;

            return placeUnlessBlocked(
                prop,
                centerX + towardsX * distance,
                centerZ + towardsZ * distance,
                PROP_SCATTER.groundcover,
                scatter
            );
        })
    );
}

export function scatterDebris(
    input: IPropFieldInput,
    species: IThemeProp[],
    scatter: IPropScatterContext
): void {
    if (species.length === 0 || input.lanes.length === 0) return;

    const settings = PROP_SCATTER.debris;
    const fieldArea = Math.PI * input.fieldRadius * input.fieldRadius;
    const count = Math.round(fieldArea * settings.density);

    scatterSpecies(species, count, scatter.nextRandom, (prop) =>
        firstFit(PROP_SCATTER.placementAttempts, () => {
            const spot =
                scatter.nextRandom() < settings.trailShoulderRatio
                    ? proposeTrailShoulder(input, scatter)
                    : proposeOpenGround(input.fieldRadius, scatter);

            return placeUnlessBlocked(prop, spot.localX, spot.localZ, settings, scatter);
        })
    );
}

function proposeTrailShoulder(input: IPropFieldInput, scatter: IPropScatterContext): IGroundSpot {
    const lane = pickRandom(input.lanes, scatter.nextRandom);

    const { acrossX, acrossZ, length } = segmentFrame(lane.fromX, lane.fromZ, lane.toX, lane.toZ);
    if (length === 0) return proposeOpenGround(input.fieldRadius, scatter);

    const alongRatio = scatter.nextRandom();
    const side = scatter.nextRandom() < 0.5 ? -1 : 1;
    const baseDistance = Math.max(
        lane.halfWidth * (1 + PROP_SCATTER.debris.shoulderOffsetRatio),
        PROP_SCATTER.softEdges.trailClearance + 0.8
    );
    const lateralDistance = baseDistance + lerp(0, 2.5, scatter.nextRandom());

    return {
        localX: lerp(lane.fromX, lane.toX, alongRatio) + acrossX * side * lateralDistance,
        localZ: lerp(lane.fromZ, lane.toZ, alongRatio) + acrossZ * side * lateralDistance,
    };
}

function proposeOpenGround(fieldRadius: number, scatter: IPropScatterContext): IGroundSpot {
    const [localX, localZ] = randomPointInDisc(scatter.nextRandom, fieldRadius);

    return { localX, localZ };
}

export function scatterDistantTreeline(
    input: IPropFieldInput,
    canopySpecies: IThemeProp[],
    scatter: IPropScatterContext
): void {
    if (canopySpecies.length === 0) return;

    const settings = PROP_SCATTER.distantTreeline;
    const noise = new FractalNoise(input.seed + 71);
    const outerReach = settings.innerReach + settings.extraReach;
    const biomeNoise = new FractalNoise(input.seed + 59);
    const canopyByFamily = groupByFamily(canopySpecies);
    const canopyFamilies = Array.from(canopyByFamily.keys());

    forEachJitteredCandidate(
        input.fieldRadius,
        settings.candidateSpacing,
        scatter.nextRandom,
        (localX, localZ) => {
            const sample = scatter.sampleGrid.sampleAt(localX, localZ, scatter.scratchSample);

            if (sample.footprintDistance <= settings.innerReach) return;
            if (sample.footprintDistance > outerReach) return;
            if (sample.waterDepth > -WATER_CHANNEL.propBankMargin) return;
            if (sample.steepness > settings.slopeLimit) return;

            const bandRatio = clamp(
                (sample.footprintDistance - settings.innerReach) / settings.extraReach,
                0,
                1
            );
            const growth = smoothstep(0, 0.8, bandRatio);
            const taper = 1 - smoothstep(0.8, 1, bandRatio);
            const density = lerp(settings.innerDensity, settings.outerDensity, growth) * taper;

            const roll = noise.sample(
                localX / settings.maskWavelength,
                localZ / settings.maskWavelength,
                2,
                0.5
            );
            if (roll > density) return;

            const family = dominantFamilyAt(
                localX,
                localZ,
                canopyFamilies,
                biomeNoise,
                scatter.nextRandom
            );
            const prop = pickRandomOrNull(
                canopyByFamily.get(family) ?? canopySpecies,
                scatter.nextRandom
            );
            if (!prop) return;

            const scale = rollPropScale(prop, settings.scaleBoost, scatter.nextRandom);

            scatter.collector.add(
                prop,
                false,
                scatter.center[0] + localX,
                sample.elevation - PROP_SCATTER.sinkIntoGround,
                scatter.center[2] + localZ,
                scatter.nextRandom() * FULL_TURN,
                scale
            );
        }
    );
}

function forEachJitteredCandidate(
    fieldRadius: number,
    spacing: number,
    nextRandom: RandomSource,
    visit: (localX: number, localZ: number) => void
): void {
    const cellsFromCentre = Math.ceil(fieldRadius / spacing);

    for (let row = -cellsFromCentre; row <= cellsFromCentre; row += 1) {
        for (let column = -cellsFromCentre; column <= cellsFromCentre; column += 1) {
            const localX = (column + nextRandom() - 0.5) * spacing;
            const localZ = (row + nextRandom() - 0.5) * spacing;

            if (Math.hypot(localX, localZ) > fieldRadius) continue;
            visit(localX, localZ);
        }
    }
}
