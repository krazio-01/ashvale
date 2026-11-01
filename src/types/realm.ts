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

export interface IRepoReference {
    owner: string;
    name: string;
}

export interface IFeaturedRealm {
    repositoryOwner: string;
    repositoryName: string;
    repositoryFullName: string;
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

export interface ISuccessResponse<TData> {
    success: true;
    message: string;
    data: TData;
}

export interface IErrorResponse {
    success: false;
    message: string;
    data: null;
}

export interface IChapterTier {
    upperBound: number;
    chapterCount: number;
}

export interface IChapterArcEntry {
    title: string;
    artifactName: string;
}
