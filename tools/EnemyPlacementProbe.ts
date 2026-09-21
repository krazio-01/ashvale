import { ENEMY_PLACEMENT } from "../src/constants/characters";
import { placeRegionEnemies } from "../src/world/EnemyPlacement";
import type { IChapterRegion } from "../src/types/realm";

const REALM_URL = "http://localhost:3000/api/realms/axios/axios";

interface IChapterLike {
    regions: IChapterRegion[];
    spawnRegionId: string;
    bossRegionId: string;
}

function distance(a: [number, number], b: [number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function effectiveSpawnClearance(region: IChapterRegion): number {
    const [width, depth] = region.floorSize;
    return Math.min(
        ENEMY_PLACEMENT.playerSpawnClearance,
        (Math.min(width, depth) / 2) * ENEMY_PLACEMENT.spawnClearanceRegionFraction
    );
}

function auditRegion(region: IChapterRegion, isSpawnRegion: boolean): void {
    const [centreX, , centreZ] = region.worldPosition;

    const placements = placeRegionEnemies(region, {
        groundHeightAt: () => 0,
        groundSteepnessAt: () => 0,
        propIsClear: () => true,
        clearance: isSpawnRegion
            ? { x: centreX, z: centreZ, radius: ENEMY_PLACEMENT.playerSpawnClearance }
            : null,
    });

    if (placements.length === 0) {
        console.log(`  ${region.displayName}: no placements`);
        return;
    }

    const points = placements.map((p): [number, number] => [p.position[0], p.position[2]]);
    const radii = points.map((p) => distance(p, [centreX, centreZ]));

    let closestPair = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1)
        for (let j = i + 1; j < points.length; j += 1)
            closestPair = Math.min(closestPair, distance(points[i]!, points[j]!));

    const archetypes = [...new Set(placements.map((p) => p.archetype))];
    const yaws = [...new Set(placements.map((p) => p.facingYaw.toFixed(3)))];
    const radiusSpread = Math.max(...radii) - Math.min(...radii);
    const closestToCentre = Math.min(...radii);

    console.log(
        `  ${region.displayName.padEnd(12)} n=${placements.length} ` +
            `radiusSpread=${radiusSpread.toFixed(2)} closestPair=${closestPair === Infinity ? "n/a" : closestPair.toFixed(2)} ` +
            `archetypes=${archetypes.length} distinctYaws=${yaws.length}` +
            (isSpawnRegion ? ` closestToSpawn=${closestToCentre.toFixed(2)}` : "")
    );

    if (radiusSpread < 0.01 && placements.length > 1)
        console.error(`    FAIL: all at identical radius - still a ring`);
    if (closestPair < ENEMY_PLACEMENT.minimumMemberSpacing - 0.01)
        console.error(
            `    FAIL: pair ${closestPair.toFixed(2)} closer than minimum ${ENEMY_PLACEMENT.minimumMemberSpacing}`
        );
    if (isSpawnRegion) {
        const expectedClearance = effectiveSpawnClearance(region);
        if (closestToCentre < expectedClearance - 0.01)
            console.error(
                `    FAIL: enemy ${closestToCentre.toFixed(2)} inside effective spawn clearance ${expectedClearance.toFixed(2)}`
            );
    }
    if (yaws.length === 1 && placements.length > 1)
        console.error(`    FAIL: every enemy shares one facing`);
}

async function main(): Promise<void> {
    const response = await fetch(REALM_URL);
    const body = (await response.json()) as { data: { chapters: IChapterLike[] } };
    const chapters = body.data.chapters;

    console.log(`auditing ${chapters.length} chapters\n`);

    const archetypeTotals = new Map<string, number>();

    for (const [index, chapter] of chapters.entries()) {
        console.log(`chapter ${index}:`);

        for (const region of chapter.regions) {
            if (region.regionId === chapter.bossRegionId) continue;
            auditRegion(region, region.regionId === chapter.spawnRegionId);

            for (const placement of placeRegionEnemies(region, {
                groundHeightAt: () => 0,
                groundSteepnessAt: () => 0,
                propIsClear: () => true,
                clearance: null,
            }))
                archetypeTotals.set(
                    placement.archetype,
                    (archetypeTotals.get(placement.archetype) ?? 0) + 1
                );
        }
        console.log("");
    }

    console.log("archetype spread across all chapters:");
    for (const [archetype, count] of [...archetypeTotals].sort())
        console.log(`  ${archetype.padEnd(10)} ${count}`);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
