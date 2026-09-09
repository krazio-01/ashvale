import { DEFAULT_FAMILY, type IThemeProp } from "@/types/theme";
import type { IPropFieldInput, IRegionSite, ISpeciesByLayer } from "@/world/props/PropField";
import {
    collidesWithPlayer,
    pickSpecies,
    placeProp,
    PlacementOutcome,
    type IFieldContext,
    type IPlacementRules,
} from "@/world/props/PropPlacement";
import { PROP_FIELD } from "@/constants/placement";
import { WATER_CHANNEL } from "@/constants/world";
import { FractalNoise } from "@/lib/noise";
import { clamp, lerp, pickRandomSubset, scaleBetween, smoothstep, FULL_TURN } from "@/lib/helpers";

export function seedClumps(
    input: IPropFieldInput,
    speciesByLayer: ISpeciesByLayer,
    nextRandom: () => number
): IPropClump[] {
    const settings = PROP_FIELD.clump;
    const mask = new FractalNoise(input.seed + 11);
    const biomeNoise = new FractalNoise(input.seed + 59);
    const canopyByFamily = groupByFamily(speciesByLayer.canopy);
    const canopyFamilies = Array.from(canopyByFamily.keys());
    const clumps: IPropClump[] = [];

    const [minimumRadius, maximumRadius] = settings.radiusRange;
    const spacing = settings.candidateSpacing;
    const cellsFromCentre = Math.ceil(input.fieldRadius / spacing);

    for (let row = -cellsFromCentre; row <= cellsFromCentre; row += 1) {
        for (let column = -cellsFromCentre; column <= cellsFromCentre; column += 1) {
            const centerX = (column + nextRandom() - 0.5) * spacing;
            const centerZ = (row + nextRandom() - 0.5) * spacing;

            if (Math.hypot(centerX, centerZ) > input.fieldRadius) continue;

            const forestStrength = mask.sample(
                centerX / settings.maskWavelength,
                centerZ / settings.maskWavelength,
                settings.maskOctaves,
                settings.maskGain
            );

            if (forestStrength < settings.forestThreshold) continue;

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
                standingRules: isOutcrop ? PROP_FIELD.rock : PROP_FIELD.canopy,
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
    }

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

    const settings = PROP_FIELD.biomeRegion;
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

    return families[chosenIndex] ?? DEFAULT_FAMILY;
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

function richnessAt(localX: number, localZ: number, sites: IRegionSite[]): number {
    const [minimumRichness, maximumRichness] = PROP_FIELD.richnessRange;

    for (const site of sites) {
        if (Math.abs(localX - site.centerX) > site.halfWidth) continue;
        if (Math.abs(localZ - site.centerZ) > site.halfDepth) continue;

        return clamp(
            site.fileCount / PROP_FIELD.typicalFileCount,
            minimumRichness,
            maximumRichness
        );
    }

    return 1;
}

export function fillClump(clump: IPropClump, field: IFieldContext): void {
    const clumpArea = Math.PI * clump.radius * clump.radius;
    const standingRules = clump.standingRules;

    const standingPlaced = scatterAroundCentre(
        clump.centerX,
        clump.centerZ,
        clump.standing,
        Math.round(clumpArea * standingRules.density * clump.richness),
        standingRules,
        clump.radius,
        field
    );

    scatterAgainstNeighbours(
        clump,
        clump.understory,
        Math.round(clumpArea * PROP_FIELD.understory.density * clump.richness),
        standingPlaced,
        field
    );

    scatterAroundCentre(
        clump.centerX,
        clump.centerZ,
        clump.groundcover,
        Math.round(clumpArea * PROP_FIELD.groundcover.density * clump.richness),
        PROP_FIELD.groundcover,
        clump.radius,
        field
    );
}

function scatterAroundCentre(
    centerX: number,
    centerZ: number,
    species: IThemeProp[],
    count: number,
    rules: IPlacementRules,
    spreadRadius: number,
    field: IFieldContext
): IPlacedStanding[] {
    const placed: IPlacedStanding[] = [];
    if (species.length === 0) return placed;

    for (let index = 0; index < count; index += 1) {
        const prop = pickSpecies(species, field.nextRandom);
        if (!prop) continue;

        for (let attempt = 0; attempt < PROP_FIELD.placementAttempts; attempt += 1) {
            const angle = field.nextRandom() * FULL_TURN;
            const distance = Math.pow(field.nextRandom(), rules.centreBias) * spreadRadius;
            const localX = centerX + Math.cos(angle) * distance;
            const localZ = centerZ + Math.sin(angle) * distance;

            const outcome = placeProp(prop, localX, localZ, rules, field);
            if (outcome === PlacementOutcome.Blocked) continue;

            if (outcome === PlacementOutcome.Placed && collidesWithPlayer(prop.layer))
                placed.push({
                    localX,
                    localZ,
                    maxFootprintRadius:
                        prop.footprintRadius * prop.scaleRange[1] * rules.scaleBoost[1],
                });

            break;
        }
    }

    return placed;
}

function scatterAgainstNeighbours(
    clump: IPropClump,
    species: IThemeProp[],
    count: number,
    neighbours: IPlacedStanding[],
    field: IFieldContext
): void {
    if (species.length === 0) return;

    const { huddleRatio, huddleRadius, huddleCentreBias } = PROP_FIELD.understory;

    for (let index = 0; index < count; index += 1) {
        const prop = pickSpecies(species, field.nextRandom);
        if (!prop) continue;

        const huddles = neighbours.length > 0 && field.nextRandom() < huddleRatio;
        const host = huddles
            ? neighbours[Math.floor(field.nextRandom() * neighbours.length)]
            : undefined;

        const understoryFootprint =
            prop.footprintRadius * prop.scaleRange[1] * PROP_FIELD.understory.scaleBoost[1];
        const minDistance = host
            ? host.maxFootprintRadius + understoryFootprint + PROP_FIELD.understory.spacingGap
            : 0;
        const maxDistance = host ? Math.max(huddleRadius, minDistance) : clump.radius;

        for (let attempt = 0; attempt < PROP_FIELD.placementAttempts; attempt += 1) {
            const angle = field.nextRandom() * FULL_TURN;
            const distance = host
                ? lerp(minDistance, maxDistance, Math.pow(field.nextRandom(), huddleCentreBias))
                : Math.sqrt(field.nextRandom()) * clump.radius;

            const localX = (host ? host.localX : clump.centerX) + Math.cos(angle) * distance;
            const localZ = (host ? host.localZ : clump.centerZ) + Math.sin(angle) * distance;

            if (
                placeProp(prop, localX, localZ, PROP_FIELD.understory, field) !==
                PlacementOutcome.Blocked
            )
                break;
        }
    }
}

export function scatterGroundcoverPatches(
    input: IPropFieldInput,
    species: IThemeProp[],
    field: IFieldContext
): void {
    if (species.length === 0) return;

    const settings = PROP_FIELD.groundcoverPatch;
    const mask = new FractalNoise(input.seed + 23);
    const rim = new FractalNoise(input.seed + 41);

    const spacing = settings.spacing;
    const cellsFromCentre = Math.ceil(input.fieldRadius / spacing);
    const [minimumRadius, maximumRadius] = settings.radiusRange;
    const [minimumCount, maximumCount] = settings.countRange;

    for (let row = -cellsFromCentre; row <= cellsFromCentre; row += 1) {
        for (let column = -cellsFromCentre; column <= cellsFromCentre; column += 1) {
            const centerX = (column + field.nextRandom() - 0.5) * spacing;
            const centerZ = (row + field.nextRandom() - 0.5) * spacing;

            if (Math.hypot(centerX, centerZ) > input.fieldRadius) continue;

            const meadowStrength = mask.sample(
                centerX / settings.maskWavelength,
                centerZ / settings.maskWavelength,
                PROP_FIELD.clump.maskOctaves,
                PROP_FIELD.clump.maskGain
            );

            if (meadowStrength < settings.maskThreshold) continue;

            const patchSpecies = pickRandomSubset(
                species,
                settings.speciesPerPatch,
                field.nextRandom
            );
            if (patchSpecies.length === 0) continue;

            const strength =
                (meadowStrength - settings.maskThreshold) / (1 - settings.maskThreshold);

            fillPatch(
                centerX,
                centerZ,
                lerp(minimumRadius, maximumRadius, strength),
                Math.round(lerp(minimumCount, maximumCount, strength)),
                patchSpecies,
                rim,
                field
            );
        }
    }
}

function fillPatch(
    centerX: number,
    centerZ: number,
    radius: number,
    count: number,
    species: IThemeProp[],
    rim: FractalNoise,
    field: IFieldContext
): void {
    const settings = PROP_FIELD.groundcoverPatch;

    for (let index = 0; index < count; index += 1) {
        const prop = pickSpecies(species, field.nextRandom);
        if (!prop) continue;

        for (let attempt = 0; attempt < PROP_FIELD.placementAttempts; attempt += 1) {
            const angle = field.nextRandom() * FULL_TURN;
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
            const distance = Math.pow(field.nextRandom(), settings.coreBias) * reach;

            const outcome = placeProp(
                prop,
                centerX + towardsX * distance,
                centerZ + towardsZ * distance,
                PROP_FIELD.groundcover,
                field
            );

            if (outcome !== PlacementOutcome.Blocked) break;
        }
    }
}

export interface IPropClump {
    centerX: number;
    centerZ: number;
    radius: number;
    richness: number;
    standing: IThemeProp[];
    standingRules: IPlacementRules;
    understory: IThemeProp[];
    groundcover: IThemeProp[];
}

interface IPlacedStanding {
    localX: number;
    localZ: number;
    maxFootprintRadius: number;
}

export function scatterDebris(
    input: IPropFieldInput,
    species: IThemeProp[],
    field: IFieldContext
): void {
    if (species.length === 0 || input.lanes.length === 0) return;

    const settings = PROP_FIELD.debris;
    const fieldArea = Math.PI * input.fieldRadius * input.fieldRadius;
    const count = Math.round(fieldArea * settings.density);

    for (let index = 0; index < count; index += 1) {
        const prop = pickSpecies(species, field.nextRandom);
        if (!prop) continue;

        for (let attempt = 0; attempt < PROP_FIELD.placementAttempts; attempt += 1) {
            const spot =
                field.nextRandom() < settings.trailShoulderRatio
                    ? proposeTrailShoulder(input, field)
                    : proposeOpenGround(input.fieldRadius, field);

            if (
                placeProp(prop, spot.localX, spot.localZ, settings, field) !==
                PlacementOutcome.Blocked
            )
                break;
        }
    }
}

function proposeTrailShoulder(input: IPropFieldInput, field: IFieldContext): IGroundSpot {
    const lane = input.lanes[Math.floor(field.nextRandom() * input.lanes.length)];
    if (!lane) return proposeOpenGround(input.fieldRadius, field);

    const spanX = lane.toX - lane.fromX;
    const spanZ = lane.toZ - lane.fromZ;
    const spanLength = Math.hypot(spanX, spanZ);
    if (spanLength === 0) return proposeOpenGround(input.fieldRadius, field);

    const alongRatio = field.nextRandom();
    const side = field.nextRandom() < 0.5 ? -1 : 1;
    const [nearShoulder, farShoulder] = PROP_FIELD.debris.shoulderOffsetRatio;
    const lateralDistance =
        lane.halfWidth * lerp(1 + nearShoulder, 1 + farShoulder, field.nextRandom());

    return {
        localX: lane.fromX + spanX * alongRatio + (-spanZ / spanLength) * side * lateralDistance,
        localZ: lane.fromZ + spanZ * alongRatio + (spanX / spanLength) * side * lateralDistance,
    };
}

function proposeOpenGround(fieldRadius: number, field: IFieldContext): IGroundSpot {
    const angle = field.nextRandom() * FULL_TURN;
    const distance = Math.sqrt(field.nextRandom()) * fieldRadius;

    return { localX: Math.cos(angle) * distance, localZ: Math.sin(angle) * distance };
}

interface IGroundSpot {
    localX: number;
    localZ: number;
}

export function scatterDistantTreeline(
    input: IPropFieldInput,
    canopySpecies: IThemeProp[],
    field: IFieldContext
): void {
    if (canopySpecies.length === 0) return;

    const settings = PROP_FIELD.distantTreeline;
    const noise = new FractalNoise(input.seed + 71);
    const spacing = settings.candidateSpacing;
    const cellsFromCentre = Math.ceil(input.fieldRadius / spacing);
    const outerReach = settings.innerReach + settings.extraReach;
    const biomeNoise = new FractalNoise(input.seed + 59);
    const canopyByFamily = groupByFamily(canopySpecies);
    const canopyFamilies = Array.from(canopyByFamily.keys());

    for (let row = -cellsFromCentre; row <= cellsFromCentre; row += 1) {
        for (let column = -cellsFromCentre; column <= cellsFromCentre; column += 1) {
            const localX = (column + field.nextRandom() - 0.5) * spacing;
            const localZ = (row + field.nextRandom() - 0.5) * spacing;

            if (Math.hypot(localX, localZ) > input.fieldRadius) continue;

            const sample = field.heightMap.sampleAt(localX, localZ, field.heightSample);

            if (sample.footprintDistance <= settings.innerReach) continue;
            if (sample.footprintDistance > outerReach) continue;
            if (sample.waterDepth > -WATER_CHANNEL.propBankMargin) continue;
            if (sample.steepness > settings.slopeLimit) continue;

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
            if (roll > density) continue;

            const family = dominantFamilyAt(
                localX,
                localZ,
                canopyFamilies,
                biomeNoise,
                field.nextRandom
            );
            const prop = pickSpecies(canopyByFamily.get(family) ?? canopySpecies, field.nextRandom);
            if (!prop) continue;

            const scale =
                scaleBetween(prop.scaleRange, field.nextRandom()) *
                lerp(settings.scaleBoost[0], settings.scaleBoost[1], field.nextRandom());

            field.collector.add(
                prop,
                false,
                field.center[0] + localX,
                sample.elevation - PROP_FIELD.groundBite,
                field.center[2] + localZ,
                field.nextRandom() * FULL_TURN,
                scale
            );
        }
    }
}
