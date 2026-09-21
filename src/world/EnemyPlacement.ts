import type { Vector3Tuple } from "three";
import { ENEMY_PLACEMENT, EnemyArchetype, SPAWNING } from "@/constants/characters";
import { dominantArchetypeFor } from "@/entities/characters/enemies/EnemySpawner";
import { specFor } from "@/entities/characters/enemies/EnemyModels";
import type { IChapterRegion } from "@/types/realm";
import { FULL_TURN, clamp, createSeededRandom, hashString } from "@/lib/helpers";

export interface IEnemyPlacement {
    archetype: EnemyArchetype;
    position: Vector3Tuple;
    facingYaw: number;
}

export interface IPlacementClearance {
    x: number;
    z: number;
    radius: number;
}

export interface IEnemyPlacementContext {
    groundHeightAt: (worldX: number, worldZ: number) => number;
    groundSteepnessAt: (worldX: number, worldZ: number) => number;
    propIsClear: (worldX: number, worldZ: number, radius: number) => boolean;
    clearance: IPlacementClearance | null;
}

const ARCHETYPES = [
    EnemyArchetype.Sentinel,
    EnemyArchetype.Wraith,
    EnemyArchetype.Golem,
    EnemyArchetype.Gremlin,
];

type RandomSource = () => number;

interface IPlacementRun {
    region: IChapterRegion;
    context: IEnemyPlacementContext;
    dominant: EnemyArchetype;
    nextRandom: RandomSource;
    clearanceX: number;
    clearanceZ: number;
    clearanceRadius: number;
}

export function placeRegionEnemies(
    region: IChapterRegion,
    context: IEnemyPlacementContext
): IEnemyPlacement[] {
    const run = createPlacementRun(region, context);
    const placements: IEnemyPlacement[] = [];
    const campCentres: number[] = [];

    let remaining = enemyBudgetFor(region);

    while (remaining > 0) {
        const centre = findCampCentre(run, campCentres);
        if (!centre) break;

        campCentres.push(centre[0], centre[1]);
        const requestedSize = nextCampSize(run.nextRandom, remaining);
        remaining -= appendCamp(placements, run, centre, requestedSize);
    }

    return placements;
}

function createPlacementRun(
    region: IChapterRegion,
    context: IEnemyPlacementContext
): IPlacementRun {
    const [width, depth] = region.floorSize;
    const clearance = context.clearance;
    const clearanceRadius = clearance
        ? Math.min(
              clearance.radius,
              (Math.min(width, depth) / 2) * ENEMY_PLACEMENT.spawnClearanceRegionFraction
          )
        : 0;

    return {
        region,
        context,
        dominant: dominantArchetypeFor(region),
        nextRandom: createSeededRandom(hashString(region.regionId)),
        clearanceX: clearance?.x ?? 0,
        clearanceZ: clearance?.z ?? 0,
        clearanceRadius,
    };
}

function enemyBudgetFor(region: IChapterRegion): number {
    const scaled = Math.floor(region.fileCount / SPAWNING.filesPerEnemy);
    return clamp(scaled, 1, SPAWNING.maximumEnemiesPerRegion);
}

function nextCampSize(nextRandom: RandomSource, remaining: number): number {
    if (remaining < ENEMY_PLACEMENT.smallestCamp) return remaining;
    if (nextRandom() >= ENEMY_PLACEMENT.campProbability) return 1;

    const largest = Math.min(ENEMY_PLACEMENT.largestCamp, remaining);
    const span = largest - ENEMY_PLACEMENT.smallestCamp + 1;

    return ENEMY_PLACEMENT.smallestCamp + Math.floor(nextRandom() * span);
}

function findCampCentre(run: IPlacementRun, takenCentres: number[]): [number, number] | null {
    const { region, context, nextRandom } = run;
    const [centreX, , centreZ] = region.worldPosition;
    const [width, depth] = region.floorSize;
    const halfWidth = Math.max(width / 2 - ENEMY_PLACEMENT.regionEdgeMargin, 0);
    const halfDepth = Math.max(depth / 2 - ENEMY_PLACEMENT.regionEdgeMargin, 0);
    const minimumCampSpacingSquared =
        ENEMY_PLACEMENT.minimumCampSpacing * ENEMY_PLACEMENT.minimumCampSpacing;

    for (let attempt = 0; attempt < ENEMY_PLACEMENT.samplingAttempts; attempt += 1) {
        const x = centreX + (nextRandom() * 2 - 1) * halfWidth;
        const z = centreZ + (nextRandom() * 2 - 1) * halfDepth;

        if (isInsideClearance(run, x, z)) continue;
        if (context.groundSteepnessAt(x, z) > ENEMY_PLACEMENT.maximumSteepness) continue;
        if (!context.propIsClear(x, z, ENEMY_PLACEMENT.propClearanceRadius)) continue;
        if (isCrowded(takenCentres, x, z, minimumCampSpacingSquared)) continue;

        return [x, z];
    }

    return null;
}

function isInsideClearance(run: IPlacementRun, x: number, z: number): boolean {
    const offsetX = x - run.clearanceX;
    const offsetZ = z - run.clearanceZ;

    return offsetX * offsetX + offsetZ * offsetZ < run.clearanceRadius * run.clearanceRadius;
}

function isCrowded(
    points: number[],
    x: number,
    z: number,
    minimumSpacingSquared: number
): boolean {
    for (let index = 0; index < points.length; index += 2) {
        const offsetX = x - (points[index] ?? 0);
        const offsetZ = z - (points[index + 1] ?? 0);

        if (offsetX * offsetX + offsetZ * offsetZ < minimumSpacingSquared) return true;
    }

    return false;
}

function appendCamp(
    placements: IEnemyPlacement[],
    run: IPlacementRun,
    centre: [number, number],
    size: number
): number {
    const { context, dominant, nextRandom } = run;
    const members = spreadCampMembers(run, centre, size);
    const memberCount = members.length / 2;
    const facingTarget = campFacingTarget(run, members, memberCount);

    for (let index = 0; index < members.length; index += 2) {
        const x = members[index] ?? 0;
        const z = members[index + 1] ?? 0;
        const archetype = pickArchetype(dominant, nextRandom);
        const spawnY =
            context.groundHeightAt(x, z) +
            specFor(archetype).height / 2 +
            SPAWNING.spawnClearanceBuffer;

        placements.push({
            archetype,
            position: [x, spawnY, z],
            facingYaw: facingYawTowards(x, z, facingTarget, nextRandom),
        });
    }

    return memberCount;
}

function spreadCampMembers(
    run: IPlacementRun,
    centre: [number, number],
    size: number
): number[] {
    const { context, nextRandom } = run;
    const members: number[] = [centre[0], centre[1]];
    const minimumMemberSpacingSquared =
        ENEMY_PLACEMENT.minimumMemberSpacing * ENEMY_PLACEMENT.minimumMemberSpacing;

    for (let member = 1; member < size; member += 1) {
        for (let attempt = 0; attempt < ENEMY_PLACEMENT.samplingAttempts; attempt += 1) {
            const angle = nextRandom() * FULL_TURN;
            const radius =
                ENEMY_PLACEMENT.minimumMemberSpacing +
                nextRandom() * (ENEMY_PLACEMENT.campRadius - ENEMY_PLACEMENT.minimumMemberSpacing);
            const x = centre[0] + Math.cos(angle) * radius;
            const z = centre[1] + Math.sin(angle) * radius;

            if (isInsideClearance(run, x, z)) continue;
            if (context.groundSteepnessAt(x, z) > ENEMY_PLACEMENT.maximumSteepness) continue;
            if (!context.propIsClear(x, z, ENEMY_PLACEMENT.propClearanceRadius)) continue;
            if (isCrowded(members, x, z, minimumMemberSpacingSquared)) continue;

            members.push(x, z);
            break;
        }
    }

    return members;
}

function campFacingTarget(
    run: IPlacementRun,
    members: number[],
    memberCount: number
): [number, number] {
    const { worldPosition } = run.region;
    if (memberCount <= 1) return [worldPosition[0], worldPosition[2]];

    let sumX = 0;
    let sumZ = 0;

    for (let index = 0; index < members.length; index += 2) {
        sumX += members[index] ?? 0;
        sumZ += members[index + 1] ?? 0;
    }

    return [sumX / memberCount, sumZ / memberCount];
}

function facingYawTowards(
    x: number,
    z: number,
    target: [number, number],
    nextRandom: RandomSource
): number {
    const offsetX = target[0] - x;
    const offsetZ = target[1] - z;
    const jitter = (nextRandom() * 2 - 1) * ENEMY_PLACEMENT.facingJitter;

    if (offsetX === 0 && offsetZ === 0) return nextRandom() * FULL_TURN;

    return Math.atan2(offsetX, offsetZ) + jitter;
}

function pickArchetype(dominant: EnemyArchetype, nextRandom: RandomSource): EnemyArchetype {
    if (nextRandom() < ENEMY_PLACEMENT.dominantArchetypeShare) return dominant;

    const alternatives = ARCHETYPES.filter((archetype) => archetype !== dominant);

    return alternatives[Math.floor(nextRandom() * alternatives.length)] ?? dominant;
}
