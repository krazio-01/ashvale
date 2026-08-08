import type {
    IChapterBoss,
    IChapterRegion,
    IRealmChapter,
    IRegionPathway,
    IResolvedRealm,
} from "@/types/realm";

const WORLD_UNIT_PRECISION = 2;
const RATIO_PRECISION = 3;

export class RealmResponse {
    repositoryOwner: string;
    repositoryName: string;
    starCount: number;
    primaryLanguage: string | null;
    totalCommitCount: number;
    generationSeed: number;
    chapters: ChapterResponse[];

    constructor(realm: IResolvedRealm) {
        const [repositoryOwner = "", repositoryName = ""] = realm.repositoryFullName.split("/");
        this.repositoryOwner = repositoryOwner;
        this.repositoryName = repositoryName;
        this.starCount = realm.starCount;
        this.primaryLanguage = realm.primaryLanguage;
        this.totalCommitCount = realm.totalCommitCount;
        this.generationSeed = realm.generationSeed;
        this.chapters = realm.chapters.map((chapter) => new ChapterResponse(chapter));
    }
}

export class ChapterResponse {
    chapterIndex: number;
    title: string;
    startedAt: string;
    endedAt: string;
    commitCount: number;
    artifactName: string;
    interludeParagraphs: string[];
    spawnRegionId: string;
    bossRegionId: string;
    regions: IChapterRegion[];
    pathways: IRegionPathway[];
    boss: IChapterBoss | null;

    constructor(chapter: IRealmChapter) {
        this.chapterIndex = chapter.chapterIndex;
        this.title = chapter.title;
        this.startedAt = new Date(chapter.startedAt).toISOString();
        this.endedAt = new Date(chapter.endedAt).toISOString();
        this.commitCount = chapter.commitCount;
        this.artifactName = chapter.artifactName;
        this.interludeParagraphs = chapter.interludeParagraphs;
        this.spawnRegionId = chapter.spawnRegionId;
        this.bossRegionId = chapter.bossRegionId;
        this.regions = chapter.regions.map(roundRegion);
        this.pathways = chapter.pathways.map(roundPathway);
        this.boss = chapter.boss === null ? null : roundBoss(chapter.boss);
    }
}

function roundRegion(region: IChapterRegion): IChapterRegion {
    const [x, y, z] = region.worldPosition;
    const [width, depth] = region.floorSize;

    return {
        regionId: region.regionId,
        displayName: region.displayName,
        worldPosition: [
            round(x, WORLD_UNIT_PRECISION),
            round(y, WORLD_UNIT_PRECISION),
            round(z, WORLD_UNIT_PRECISION),
        ],
        floorSize: [round(width, WORLD_UNIT_PRECISION), round(depth, WORLD_UNIT_PRECISION)],
        wallHeight: round(region.wallHeight, WORLD_UNIT_PRECISION),
        nestingDepth: region.nestingDepth,
        spawnDistance: region.spawnDistance,
        fileCount: region.fileCount,
    };
}

function roundPathway(pathway: IRegionPathway): IRegionPathway {
    return {
        fromRegionId: pathway.fromRegionId,
        toRegionId: pathway.toRegionId,
        corridorWidth: round(pathway.corridorWidth, WORLD_UNIT_PRECISION),
    };
}

function roundBoss(boss: IChapterBoss): IChapterBoss {
    return {
        contributorLogin: boss.contributorLogin,
        avatarUrl: boss.avatarUrl,
        commitShare: round(boss.commitShare, RATIO_PRECISION),
        commitGapVariation: round(boss.commitGapVariation, RATIO_PRECISION),
        chapterAppearanceCount: boss.chapterAppearanceCount,
    };
}

function round(value: number, decimals: number): number {
    const scale = 10 ** decimals;

    return Math.round(value * scale) / scale;
}
