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
    minFootprint: 40,
    maxFootprint: 140,
    aspectJitter: 0.3,
    minWallHeight: 5,
    maxWallHeight: 16,
    regionGap: 45,
    objectiveFootprintRatio: 0.5,
    spawnSizeRatio: 0.25,
};

export const ROUTE_DESIGN = {
    sideRoomCount: 2,
    minimumRouteRegions: 3,
    maxTurnAngle: Math.PI / 3,
    placementAttempts: 12,
    spacingGrowthPerAttempt: 0.25,
    corridorClearance: 5,
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

export const CHAPTER_ARC: IChapterArcEntry[] = [
    { title: "The Founding", artifactName: "Ember of Origin" },
    { title: "The First Expansion", artifactName: "Shard of Ascent" },
    { title: "The Long Climb", artifactName: "Sigil of Endurance" },
    { title: "The Reckoning", artifactName: "Crown of Reckoning" },
    { title: "The Great Refactor", artifactName: "Kernel of Renewal" },
    { title: "The Widening", artifactName: "Lens of Expanse" },
    { title: "The Present Day", artifactName: "Heart of the Living Repo" },
];

export const FALLBACK_CHAPTER_ARC: IChapterArcEntry = {
    title: "The Untold Era",
    artifactName: "Fragment of the Deep Log",
};

export interface IChapterTier {
    upperBound: number;
    chapterCount: number;
}

export interface IChapterArcEntry {
    title: string;
    artifactName: string;
}
