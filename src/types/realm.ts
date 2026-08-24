export interface IResolvedRealm {
    repositoryFullName: string;
    starCount: number;
    primaryLanguage: string | null;
    totalCommitCount: number;
    generationSeed: number;
    chapters: IRealmChapter[];
}

export interface IRealmChapter {
    chapterIndex: number;
    title: string;
    startedAt: Date;
    endedAt: Date;
    commitCount: number;
    artifactName: string;
    interludeParagraphs: string[];
    spawnRegionId: string;
    bossRegionId: string;
    regions: IChapterRegion[];
    pathways: IRegionPathway[];
    boss: IChapterBoss | null;
    theme: ChapterTheme;
    season: ChapterSeason;
}

export interface IChapterRegion {
    regionId: string;
    displayName: string;
    worldPosition: [number, number, number];
    floorSize: [number, number];
    wallHeight: number;
    nestingDepth: number;
    spawnDistance: number;
    fileCount: number;
}

export interface IRegionPathway {
    fromRegionId: string;
    toRegionId: string;
    corridorWidth: number;
}

export interface IChapterBoss {
    contributorLogin: string;
    avatarUrl: string;
    commitShare: number;
    commitGapVariation: number;
    chapterAppearanceCount: number;
}

export enum ChapterTheme {
    Woodland = "woodland",
    Settlement = "settlement",
    Ruins = "ruins",
    Highlands = "highlands",
}

export enum ChapterSeason {
    Spring = "spring",
    Summer = "summer",
    Autumn = "autumn",
    Winter = "winter",
}
