import type {
    IChapterBoss,
    IChapterRegion,
    IEraSignals,
    IFeaturedRealm,
    IRealmChapter,
    IRegionPathway,
    IResolvedRealm,
} from "@/types/realm";
import { keysOf, mapFields, roundTo } from "@/lib/helpers";

export class RealmResponse {
    version: string;
    chapters: ChapterResponse[];

    constructor(realm: IResolvedRealm) {
        this.version = realm.headCommitSha;
        this.chapters = realm.chapters.map((chapter) => new ChapterResponse(chapter));
    }
}

export class ChapterResponse {
    private static readonly WORLD_UNIT_STEPS = 100;

    private static readonly RATIO_STEPS = 1000;

    private static readonly roundWorldUnits = (value: number): number =>
        roundTo(value, ChapterResponse.WORLD_UNIT_STEPS);

    private static readonly roundRatio = (value: number): number =>
        roundTo(value, ChapterResponse.RATIO_STEPS);

    private static roundRegion(region: IChapterRegion): IChapterRegion {
        const { roundWorldUnits, roundRatio } = ChapterResponse;
        const [positionX, positionZ] = region.mapPosition;
        const [floorWidth, floorDepth] = region.floorSize;

        return {
            ...mapFields(region, ["sizeRatio", "changeShare"], roundRatio),
            mapPosition: [roundWorldUnits(positionX), roundWorldUnits(positionZ)],
            floorSize: [roundWorldUnits(floorWidth), roundWorldUnits(floorDepth)],
        };
    }

    private static readonly roundPathway = (pathway: IRegionPathway): IRegionPathway =>
        mapFields(pathway, ["corridorWidth"], ChapterResponse.roundWorldUnits);

    private static readonly roundBoss = (boss: IChapterBoss | null): IChapterBoss | null =>
        boss === null
            ? null
            : mapFields(boss, ["commitShare", "commitGapVariation"], ChapterResponse.roundRatio);

    chapterIndex: number;
    seed: number;
    title: string;
    interludeParagraphs: string[];
    eraSignals: IEraSignals;
    loreLines: string[];
    spawnRegionId: string;
    bossRegionId: string;
    regions: IChapterRegion[];
    pathways: IRegionPathway[];
    boss: IChapterBoss | null;
    hiddenBoss: IChapterBoss | null;
    hiddenBossRegionId: string | null;

    constructor(chapter: IRealmChapter) {
        this.chapterIndex = chapter.chapterIndex;
        this.seed = chapter.seed;
        this.title = chapter.title;
        this.interludeParagraphs = chapter.interludeParagraphs;
        this.eraSignals = mapFields(
            chapter.eraSignals,
            keysOf(chapter.eraSignals),
            ChapterResponse.roundRatio
        );
        this.loreLines = chapter.loreLines;
        this.spawnRegionId = chapter.spawnRegionId;
        this.bossRegionId = chapter.bossRegionId;
        this.regions = chapter.regions.map(ChapterResponse.roundRegion);
        this.pathways = chapter.pathways.map(ChapterResponse.roundPathway);
        this.boss = ChapterResponse.roundBoss(chapter.boss);
        this.hiddenBoss = ChapterResponse.roundBoss(chapter.hiddenBoss);
        this.hiddenBossRegionId = chapter.hiddenBossRegionId;
    }
}

export class FeaturedRealmResponse {
    owner: string;
    name: string;

    constructor(realm: IFeaturedRealm) {
        this.owner = realm.repositoryOwner;
        this.name = realm.repositoryName;
    }
}
