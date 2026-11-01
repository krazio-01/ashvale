import { range } from "@/lib/helpers";
import type { IChapterTier, IChapterArcEntry, IRepoReference } from "@/types/realm";
import { CHAPTER_TEXT } from "@/constants/strings";
export const CHAPTER_DESIGN = {
    minChapters: 3,
    maxChapters: 7,
    regionsPerChapter: 8,
    seedOffsetPerChapter: 7919,
};

export const CHAPTER_TIERS_BY_COMMIT_COUNT: IChapterTier[] = [
    { upperBound: 30, chapterCount: 3 },
    { upperBound: 500, chapterCount: 4 },
    { upperBound: 5000, chapterCount: 5 },
    { upperBound: 25000, chapterCount: 6 },
];

export const CHAPTER_TIERS_BY_DIRECTORY_COUNT: IChapterTier[] = [
    { upperBound: 8, chapterCount: 3 },
    { upperBound: 25, chapterCount: 4 },
    { upperBound: 80, chapterCount: 5 },
    { upperBound: 200, chapterCount: 6 },
];

export const REGION_DESIGN = {
    footprintRange: range(40, 140),
    aspectJitter: 0.3,
    wallHeightRange: range(5, 16),
    regionGap: 45,
    bossRegionMinSizeRatio: 0.5,
    spawnSizeRatio: 0.25,
};

export const ROUTE_DESIGN = {
    sideRoomCount: 2,
    minimumRouteRegions: 3,
    minTurnAngle: Math.PI / 4,
    maxTurnAngle: Math.PI * 0.62,
    placementAttempts: 12,
    spacingGrowthPerAttempt: 0.25,
    corridorClearance: 5,
    terraceStepHeight: 9,
    terraceLevelRange: [-2, 2],
    terraceLevelSteps: [-1, 0, 0, 1],
    sideRoomLevelDrop: 1,
};

export const CORRIDOR_DESIGN = {
    minWidth: 15,
    maxWidth: 30,
    widthRatio: 0.4,
};

export const ROOT_REGION = {
    id: ".",
    displayName: "root",
};

export const SMALL_REPOSITORY_FILE_LIMIT = 400;

export const FEATURED_REALM_LIMIT = 12;

export const QUICK_PLAY_FALLBACK_REPOS: IRepoReference[] = [
    { owner: "expressjs", name: "express" },
    { owner: "chalk", name: "chalk" },
    { owner: "axios", name: "axios" },
    { owner: "lodash", name: "lodash" },
    { owner: "sveltejs", name: "svelte" },
    { owner: "pallets", name: "flask" },
];

export const CHAPTER_TITLES: IChapterArcEntry[] = CHAPTER_TEXT.arc;

export const FALLBACK_CHAPTER_TITLE: IChapterArcEntry = CHAPTER_TEXT.fallback;
