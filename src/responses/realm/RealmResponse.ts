import type {
    ChapterSeason,
    ChapterTheme,
    IChapterBoss,
    IChapterRegion,
    IFeaturedRealm,
    IRealmChapter,
    IRegionPathway,
    IResolvedRealm,
} from "@/types/realm";
import { mapFields, roundTo } from "@/lib/helpers";

export class RealmResponse {
    chapters: ChapterResponse[];

    constructor(realm: IResolvedRealm) {
        this.chapters = realm.chapters.map((chapter) => new ChapterResponse(chapter));
    }
}

export class ChapterResponse {
    private static readonly WORLD_UNIT_STEPS = 100;

    private static readonly RATIO_STEPS = 1000;

    private static roundRegion(region: IChapterRegion): IChapterRegion {
        return {
            ...mapFields(region, ["wallHeight"], (value) =>
                roundTo(value, ChapterResponse.WORLD_UNIT_STEPS)
            ),
            worldPosition: region.worldPosition.map((value) =>
                roundTo(value, ChapterResponse.WORLD_UNIT_STEPS)
            ) as IChapterRegion["worldPosition"],
            floorSize: region.floorSize.map((value) =>
                roundTo(value, ChapterResponse.WORLD_UNIT_STEPS)
            ) as IChapterRegion["floorSize"],
        };
    }

    private static readonly roundPathway = (pathway: IRegionPathway): IRegionPathway =>
        mapFields(pathway, ["corridorWidth"], (value) =>
            roundTo(value, ChapterResponse.WORLD_UNIT_STEPS)
        );

    private static readonly roundBoss = (boss: IChapterBoss): IChapterBoss =>
        mapFields(boss, ["commitShare", "commitGapVariation"], (value) =>
            roundTo(value, ChapterResponse.RATIO_STEPS)
        );

    chapterIndex: number;
    title: string;
    spawnRegionId: string;
    bossRegionId: string;
    regions: IChapterRegion[];
    pathways: IRegionPathway[];
    boss: IChapterBoss | null;
    theme: ChapterTheme;
    season: ChapterSeason;

    constructor(chapter: IRealmChapter) {
        this.chapterIndex = chapter.chapterIndex;
        this.title = chapter.title;
        this.spawnRegionId = chapter.spawnRegionId;
        this.bossRegionId = chapter.bossRegionId;
        this.regions = chapter.regions.map(ChapterResponse.roundRegion);
        this.pathways = chapter.pathways.map(ChapterResponse.roundPathway);
        this.boss = chapter.boss === null ? null : ChapterResponse.roundBoss(chapter.boss);
        this.theme = chapter.theme;
        this.season = chapter.season;
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
