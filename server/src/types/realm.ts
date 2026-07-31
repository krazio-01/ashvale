const MAX_CHAPTER_COUNT = 7;

const CHAPTER_TIERS_BY_COMMIT_COUNT = [
    { upperBound: 30, chapterCount: 3 },
    { upperBound: 500, chapterCount: 4 },
    { upperBound: 5000, chapterCount: 5 },
    { upperBound: 25000, chapterCount: 6 },
];

const CHAPTER_TIERS_BY_DIRECTORY_COUNT = [
    { upperBound: 8, chapterCount: 3 },
    { upperBound: 25, chapterCount: 4 },
    { upperBound: 80, chapterCount: 5 },
    { upperBound: 200, chapterCount: 6 },
];

export class RealmLayout {
    repositoryOwner: string;
    repositoryName: string;
    generationSeed: number;
    starCount: number;
    primaryLanguage: string | null;
    totalCommitCount: number;
    chapters: IRealmChapter[];
    generatedAt: Date;

    constructor(
        repositoryOwner: string,
        repositoryName: string,
        starCount: number,
        primaryLanguage: string | null,
        totalCommitCount: number,
        chapters: IRealmChapter[]
    ) {
        this.repositoryOwner = repositoryOwner;
        this.repositoryName = repositoryName;
        this.starCount = starCount;
        this.primaryLanguage = primaryLanguage;
        this.totalCommitCount = totalCommitCount;
        this.chapters = chapters;
        this.generatedAt = new Date();

        const repositoryIdentifier = `${repositoryOwner}/${repositoryName}`;
        let seed = 0;
        for (let i = 0; i < repositoryIdentifier.length; i++) {
            seed = (seed * 31 + repositoryIdentifier.charCodeAt(i)) | 0;
        }
        this.generationSeed = Math.abs(seed);

        let busiestRegionCommitCount = 0;
        for (const chapter of chapters) {
            for (const region of chapter.regions) {
                if (region.commitActivity > busiestRegionCommitCount)
                    busiestRegionCommitCount = region.commitActivity;
            }
        }
        for (const chapter of chapters) {
            for (const region of chapter.regions) {
                region.commitActivity =
                    busiestRegionCommitCount === 0
                        ? 0
                        : region.commitActivity / busiestRegionCommitCount;
            }
        }
    }

    static resolveChapterCount(totalCommitCount: number, directoryCount: number): number {
        return Math.min(
            resolveTier(CHAPTER_TIERS_BY_COMMIT_COUNT, totalCommitCount),
            resolveTier(CHAPTER_TIERS_BY_DIRECTORY_COUNT, directoryCount)
        );
    }
}

function resolveTier(tiers: { upperBound: number; chapterCount: number }[], value: number): number {
    for (const tier of tiers) if (value < tier.upperBound) return tier.chapterCount;

    return MAX_CHAPTER_COUNT;
}

export interface IRealmChapter {
    chapterIndex: number;
    title: string;
    commitSha: string;
    eraStartedAt: Date;
    eraEndedAt: Date;
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
    commitActivity: number;
    fileCount: number;
    primaryLanguage: string | null;
}

export interface IRegionPathway {
    fromRegionId: string;
    toRegionId: string;
    corridorWidth: number;
}

export interface IChapterBoss {
    contributorLogin: string;
    avatarUrl: string;
    commitCount: number;
    regionId: string;
}
