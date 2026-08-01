export const MIN_CHAPTER_COUNT = 3;
export const MAX_CHAPTER_COUNT = 7;

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
        this.generationSeed = RealmLayout.deriveSeed(repositoryOwner, repositoryName);

        let busiestRegionChangeCount = 0;
        for (const chapter of chapters) {
            for (const region of chapter.regions) {
                if (region.commitActivity > busiestRegionChangeCount)
                    busiestRegionChangeCount = region.commitActivity;
            }
        }

        const activityCeiling = Math.log1p(busiestRegionChangeCount);
        for (const chapter of chapters) {
            for (const region of chapter.regions) {
                region.commitActivity =
                    activityCeiling === 0 ? 0 : Math.log1p(region.commitActivity) / activityCeiling;
            }
        }
    }

    static resolveChapterCount(totalCommitCount: number, directoryCount: number): number {
        return Math.max(
            MIN_CHAPTER_COUNT,
            Math.min(
                resolveTier(CHAPTER_TIERS_BY_COMMIT_COUNT, totalCommitCount),
                resolveTier(CHAPTER_TIERS_BY_DIRECTORY_COUNT, directoryCount)
            )
        );
    }

    static deriveSeed(repositoryOwner: string, repositoryName: string): number {
        const repositoryIdentifier = `${repositoryOwner}/${repositoryName}`;
        let seed = 0;
        for (let i = 0; i < repositoryIdentifier.length; i++) {
            seed = (seed * 31 + repositoryIdentifier.charCodeAt(i)) | 0;
        }
        return Math.abs(seed);
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
