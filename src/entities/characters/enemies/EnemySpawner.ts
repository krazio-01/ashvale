import type { Vector3Tuple } from "three";
import {
    ARCHETYPES,
    ENEMY_PLACEMENT,
    SPAWNING,
    ENEMY_ARCHETYPES,
    REGION_ARCHETYPES,
} from "@/constants/enemies";
import type { EnemyArchetype } from "@/types/combat";
import type { IChapterRegion } from "@/types/realm";
import {
    FULL_TURN,
    clamp,
    createSeededRandom,
    hashString,
    yawFromDirection,
    pointAtAngle,
    randomOffset,
    firstFit,
    pickRandom,
} from "@/lib/helpers";
import type { RandomSource } from "@/lib/helpers";

interface IEnemyPlacement {
    archetype: EnemyArchetype;
    position: Vector3Tuple;
    facingYaw: number;
}

interface IPlacementClearance {
    x: number;
    z: number;
    radius: number;
}

interface IEnemyPlacementContext {
    groundHeightAt: (worldX: number, worldZ: number) => number;
    groundSteepnessAt: (worldX: number, worldZ: number) => number;
    propIsClear: (worldX: number, worldZ: number, radius: number) => boolean;
    clearance: IPlacementClearance | null;
}

interface IRegionPlacementState {
    region: IChapterRegion;
    context: IEnemyPlacementContext;
    dominant: EnemyArchetype;
    nextRandom: RandomSource;
    clearanceX: number;
    clearanceZ: number;
    clearanceRadius: number;
}

export function standingSpawnHeight(groundHeight: number, bodyHeight: number): number {
    return groundHeight + bodyHeight / 2 + SPAWNING.spawnClearanceBuffer;
}

function dominantArchetypeFor(region: IChapterRegion): EnemyArchetype {
    for (const rule of REGION_ARCHETYPES.rules)
        if (rule.directoryPattern.test(region.displayName)) return rule.archetype;

    return REGION_ARCHETYPES.fallback;
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
): IRegionPlacementState {
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

function findCampCentre(
    run: IRegionPlacementState,
    takenCentres: number[]
): [number, number] | null {
    const { region, nextRandom } = run;
    const [centreX, , centreZ] = region.worldPosition;
    const [width, depth] = region.floorSize;
    const halfWidth = Math.max(width / 2 - ENEMY_PLACEMENT.regionEdgeMargin, 0);
    const halfDepth = Math.max(depth / 2 - ENEMY_PLACEMENT.regionEdgeMargin, 0);
    const minimumCampSpacingSquared =
        ENEMY_PLACEMENT.minimumCampSpacing * ENEMY_PLACEMENT.minimumCampSpacing;

    return firstFit(ENEMY_PLACEMENT.samplingAttempts, (): [number, number] | null => {
        const x = centreX + randomOffset(nextRandom, halfWidth);
        const z = centreZ + randomOffset(nextRandom, halfDepth);

        if (!isSpotOpen(run, x, z)) return null;
        if (isCrowded(takenCentres, x, z, minimumCampSpacingSquared)) return null;
        return [x, z];
    });
}

function isSpotOpen(run: IRegionPlacementState, x: number, z: number): boolean {
    return (
        !isInsideClearance(run, x, z) &&
        !(run.context.groundSteepnessAt(x, z) > ENEMY_PLACEMENT.maximumSteepness) &&
        run.context.propIsClear(x, z, ENEMY_PLACEMENT.propClearanceRadius)
    );
}

function isInsideClearance(run: IRegionPlacementState, x: number, z: number): boolean {
    const offsetX = x - run.clearanceX;
    const offsetZ = z - run.clearanceZ;

    return offsetX * offsetX + offsetZ * offsetZ < run.clearanceRadius * run.clearanceRadius;
}

function isCrowded(points: number[], x: number, z: number, minimumSpacingSquared: number): boolean {
    for (let index = 0; index < points.length; index += 2) {
        const offsetX = x - points[index];
        const offsetZ = z - points[index + 1];

        if (offsetX * offsetX + offsetZ * offsetZ < minimumSpacingSquared) return true;
    }

    return false;
}

function appendCamp(
    placements: IEnemyPlacement[],
    run: IRegionPlacementState,
    centre: [number, number],
    size: number
): number {
    const { context, dominant, nextRandom } = run;
    const members = spreadCampMembers(run, centre, size);
    const memberCount = members.length / 2;
    const facingTarget = campFacingTarget(run, members, memberCount);

    for (let index = 0; index < members.length; index += 2) {
        const x = members[index];
        const z = members[index + 1];
        const archetype = pickArchetype(dominant, nextRandom);
        const spawnY = standingSpawnHeight(
            context.groundHeightAt(x, z),
            ARCHETYPES[archetype].height
        );

        placements.push({
            archetype,
            position: [x, spawnY, z],
            facingYaw: facingYawTowards(x, z, facingTarget, nextRandom),
        });
    }

    return memberCount;
}

function spreadCampMembers(
    run: IRegionPlacementState,
    centre: [number, number],
    size: number
): number[] {
    const { nextRandom } = run;
    const members: number[] = [centre[0], centre[1]];
    const minimumMemberSpacingSquared =
        ENEMY_PLACEMENT.minimumMemberSpacing * ENEMY_PLACEMENT.minimumMemberSpacing;

    for (let member = 1; member < size; member += 1) {
        const spot = firstFit(ENEMY_PLACEMENT.samplingAttempts, () => {
            const angle = nextRandom() * FULL_TURN;
            const radius =
                ENEMY_PLACEMENT.minimumMemberSpacing +
                nextRandom() * (ENEMY_PLACEMENT.campRadius - ENEMY_PLACEMENT.minimumMemberSpacing);
            const point = pointAtAngle(centre[0], centre[1], angle, radius);

            if (!isSpotOpen(run, point[0], point[1])) return null;
            if (isCrowded(members, point[0], point[1], minimumMemberSpacingSquared)) return null;
            return point;
        });
        if (spot) members.push(spot[0], spot[1]);
    }

    return members;
}

function campFacingTarget(
    run: IRegionPlacementState,
    members: number[],
    memberCount: number
): [number, number] {
    const { worldPosition } = run.region;
    if (memberCount <= 1) return [worldPosition[0], worldPosition[2]];

    let sumX = 0;
    let sumZ = 0;

    for (let index = 0; index < members.length; index += 2) {
        sumX += members[index];
        sumZ += members[index + 1];
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
    const jitter = randomOffset(nextRandom, ENEMY_PLACEMENT.facingJitter);

    if (offsetX === 0 && offsetZ === 0) return nextRandom() * FULL_TURN;

    return yawFromDirection(offsetX, offsetZ) + jitter;
}

function pickArchetype(dominant: EnemyArchetype, nextRandom: RandomSource): EnemyArchetype {
    if (nextRandom() < ENEMY_PLACEMENT.dominantArchetypeShare) return dominant;

    return pickRandom(
        ENEMY_ARCHETYPES.filter((archetype) => archetype !== dominant),
        nextRandom
    );
}
