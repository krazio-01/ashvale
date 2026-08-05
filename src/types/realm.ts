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
    objectiveRegionId: string;
    regions: IChapterRegion[];
    pathways: IRegionPathway[];
    boss: IChapterBoss | null;
}

export interface IChapterRegion {
    regionId: string;
    displayName: string;
    worldPosition: [number, number, number];
    floorSize: [number, number];
    wallHeight: number;
    nestingDepth: number;
    clearanceTier: number;
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
    sampledCommitShare: number;
    regionId: string;
}
