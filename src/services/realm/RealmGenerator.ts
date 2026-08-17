import "server-only";
import {
    CHAPTER_ARC,
    CHAPTER_DESIGN,
    CHAPTER_TIERS_BY_COMMIT_COUNT,
    CHAPTER_TIERS_BY_DIRECTORY_COUNT,
    FALLBACK_CHAPTER_ARC,
    IChapterArcEntry,
    IChapterTier,
    ROOT_REGION,
    SMALL_REPOSITORY_FILE_LIMIT,
} from "@/constants/realm";
import { HttpStatus } from "@/constants/strings";
import { ErrorWrapper } from "@/lib/ResponseWrapper";
import {
    fetchCommitAtPosition,
    fetchContributorsBetweenDates,
    fetchRepository,
    fetchTotalCommitCount,
    fetchTreeAtCommit,
    IGithubCommit,
    IGithubContributor,
    IGithubTree,
    isCommitDescendedFrom,
} from "@/services/github/GithubService";
import { packChapterRegions } from "@/services/realm/RegionPacker";
import { IChapterBoss, IChapterRegion, IRealmChapter, IResolvedRealm } from "@/types/realm";

const NEWEST_COMMIT_POSITION = 0;
const SEED_HASH_MULTIPLIER = 31;

export async function generateRealm(
    repositoryOwner: string,
    repositoryName: string
): Promise<IGeneratedRealm> {
    const [repository, totalCommitCount] = await Promise.all([
        fetchRepository(repositoryOwner, repositoryName),
        fetchTotalCommitCount(repositoryOwner, repositoryName),
    ]);

    if (totalCommitCount < CHAPTER_DESIGN.minChapters) {
        throw new ErrorWrapper(
            `repository has ${totalCommitCount} commits, needs at least ${CHAPTER_DESIGN.minChapters}`,
            HttpStatus.BAD_REQUEST
        );
    }

    const [headCommitTree, foundingCommit] = await Promise.all([
        fetchTreeAtCommit(repositoryOwner, repositoryName, repository.defaultBranch),
        fetchCommitAtPosition(repositoryOwner, repositoryName, totalCommitCount - 1),
    ]);

    const chapterCount = resolveChapterCount(
        totalCommitCount,
        headCommitTree.directoryPaths.length
    );

    const boundaries = await resolveChapterBoundaries(
        repositoryOwner,
        repositoryName,
        foundingCommit,
        totalCommitCount,
        chapterCount
    );

    const chapterSpans = buildChapterSpans(boundaries);
    const finalSpan = chapterSpans[chapterSpans.length - 1];

    if (!finalSpan)
        throw new ErrorWrapper("failed to resolve chapter boundaries", HttpStatus.INTERNAL_ERROR);

    const context: IRealmContext = {
        repositoryOwner,
        repositoryName,
        repositoryFullName: repository.fullName,
        chapterCount,
        headCommitTree,
        generationSeed: deriveSeed(repositoryOwner, repositoryName),
    };

    const chapters = assignBossAppearanceCounts(
        await Promise.all(
            chapterSpans.map((span, chapterIndex) => buildChapter(context, chapterIndex, span))
        )
    );

    return {
        realm: {
            repositoryFullName: repository.fullName,
            starCount: repository.starCount,
            primaryLanguage: repository.primaryLanguage,
            totalCommitCount,
            generationSeed: context.generationSeed,
            chapters,
        },
        headCommitSha: finalSpan.endCommit.sha,
    };
}

async function resolveChapterBoundaries(
    repositoryOwner: string,
    repositoryName: string,
    foundingCommit: IGithubCommit,
    totalCommitCount: number,
    chapterCount: number
): Promise<IChapterBoundary[]> {
    const commitsPerChapter = Math.floor(totalCommitCount / chapterCount);
    const foundingPosition = totalCommitCount - 1;

    const plannedPositions = [
        ...Array.from({ length: chapterCount }, (_, boundaryIndex) =>
            Math.max(NEWEST_COMMIT_POSITION, foundingPosition - boundaryIndex * commitsPerChapter)
        ),
        NEWEST_COMMIT_POSITION,
    ];

    const maxPositionsToSkip = Math.floor(commitsPerChapter / 2);

    return Promise.all(
        plannedPositions.map((plannedPosition, boundaryIndex) =>
            boundaryIndex === 0
                ? { commit: foundingCommit, position: plannedPosition }
                : resolveBoundaryOnFoundingHistory(
                    repositoryOwner,
                    repositoryName,
                    plannedPosition,
                    foundingCommit.sha,
                    maxPositionsToSkip
                )
        )
    );
}

async function resolveBoundaryOnFoundingHistory(
    repositoryOwner: string,
    repositoryName: string,
    plannedPosition: number,
    foundingCommitSha: string,
    maxPositionsToSkip: number
): Promise<IChapterBoundary> {
    for (let positionsSkipped = 0; positionsSkipped <= maxPositionsToSkip; positionsSkipped++) {
        const position = Math.max(NEWEST_COMMIT_POSITION, plannedPosition - positionsSkipped);
        const commit = await fetchCommitAtPosition(repositoryOwner, repositoryName, position);

        const isOnFoundingHistory = await isCommitDescendedFrom(
            repositoryOwner,
            repositoryName,
            foundingCommitSha,
            commit.sha
        );

        if (isOnFoundingHistory) return { commit, position };
        if (position === NEWEST_COMMIT_POSITION) break;
    }

    throw new ErrorWrapper(
        `no commit on the founding history within ${maxPositionsToSkip} of position ${plannedPosition}`,
        HttpStatus.BAD_GATEWAY
    );
}

function buildChapterSpans(boundaries: IChapterBoundary[]): IChapterSpan[] {
    const [foundingBoundary, ...laterBoundaries] = boundaries;
    if (!foundingBoundary) return [];

    const spans: IChapterSpan[] = [];
    let startBoundary = foundingBoundary;

    for (const endBoundary of laterBoundaries) {
        const isFoundingChapter = startBoundary === foundingBoundary;

        spans.push({
            startCommit: startBoundary.commit,
            endCommit: endBoundary.commit,
            commitCount:
                startBoundary.position - endBoundary.position + (isFoundingChapter ? 1 : 0),
        });

        startBoundary = endBoundary;
    }

    return spans;
}

async function buildChapter(
    context: IRealmContext,
    chapterIndex: number,
    span: IChapterSpan
): Promise<IRealmChapter> {
    const chapterPosition = resolveChapterPosition(chapterIndex, context.chapterCount);

    const [tree, contributors] = await Promise.all([
        resolveChapterTree(context, span, chapterPosition),
        resolveChapterContributors(context, span),
    ]);

    const geometry = packChapterRegions(
        tree.directoryPaths,
        tree.filePaths,
        context.generationSeed + chapterIndex * CHAPTER_DESIGN.seedOffsetPerChapter
    );

    const boss = resolveChapterBoss(contributors);
    const arc = resolveChapterArc(chapterIndex, context.chapterCount);

    return {
        chapterIndex,
        title: arc.title,
        startedAt: span.startCommit.committedAt,
        endedAt: span.endCommit.committedAt,
        commitCount: span.commitCount,
        artifactName: arc.artifactName,
        interludeParagraphs: composeInterludeParagraphs({
            repositoryFullName: context.repositoryFullName,
            chapterPosition,
            span,
            repositoryFileCount: resolveRepositoryFileCount(geometry.regions),
            bossRegionId: geometry.bossRegionId,
            boss,
        }),
        spawnRegionId: geometry.spawnRegionId,
        bossRegionId: geometry.bossRegionId,
        regions: geometry.regions,
        pathways: geometry.pathways,
        boss,
    };
}

async function resolveChapterTree(
    context: IRealmContext,
    span: IChapterSpan,
    chapterPosition: ChapterPosition
): Promise<IGithubTree> {
    if (chapterPosition === "present") return context.headCommitTree;

    return fetchTreeAtCommit(context.repositoryOwner, context.repositoryName, span.endCommit.sha);
}

async function resolveChapterContributors(
    context: IRealmContext,
    span: IChapterSpan
): Promise<IGithubContributor[]> {
    try {
        const sampledContributors = await fetchContributorsBetweenDates(
            context.repositoryOwner,
            context.repositoryName,
            span.startCommit.committedAt,
            span.endCommit.committedAt
        );

        const humans = sampledContributors.filter((contributor) => !contributor.isBotAccount);

        return humans.length > 0 ? humans : sampledContributors;
    } catch (error) {
        if (isRateLimitError(error)) throw error;

        console.warn(`contributors unavailable for chapter ending ${span.endCommit.sha}:`, error);

        return [];
    }
}

function isRateLimitError(error: unknown): boolean {
    return (
        error instanceof ErrorWrapper &&
        (error.statusCode === HttpStatus.FORBIDDEN || error.statusCode === HttpStatus.TOO_MANY_REQUESTS)
    );
}

function assignBossAppearanceCounts(chapters: IRealmChapter[]): IRealmChapter[] {
    const appearanceCountByLogin = new Map<string, number>();

    for (const chapter of chapters) {
        if (!chapter.boss) continue;

        const count = (appearanceCountByLogin.get(chapter.boss.contributorLogin) ?? 0) + 1;
        appearanceCountByLogin.set(chapter.boss.contributorLogin, count);
    }

    return chapters.map((chapter) =>
        chapter.boss === null
            ? chapter
            : {
                ...chapter,
                boss: {
                    ...chapter.boss,
                    chapterAppearanceCount:
                        appearanceCountByLogin.get(chapter.boss.contributorLogin) ?? 1,
                },
            }
    );
}

function resolveChapterBoss(contributors: IGithubContributor[]): IChapterBoss | null {
    const [leadContributor] = contributors;
    if (!leadContributor) return null;

    const sampledCommitTotal = contributors.reduce(
        (total, contributor) => total + contributor.sampledCommitCount,
        0
    );

    return {
        contributorLogin: leadContributor.login,
        avatarUrl: leadContributor.avatarUrl,
        commitShare: leadContributor.sampledCommitCount / sampledCommitTotal,
        commitGapVariation: leadContributor.commitGapVariation,
        chapterAppearanceCount: 1,
    };
}

function composeInterludeParagraphs(interlude: IInterludeFacts): string[] {
    const paragraphs = [
        describeChapterOpening(interlude),
        `${interlude.span.commitCount} commits reshaped the land in this chapter.`,
    ];

    if (interlude.boss) {
        paragraphs.push(
            `As it closed, its will belonged to ${interlude.boss.contributorLogin}, who waits at ${interlude.bossRegionId}.`
        );
    }

    return paragraphs;
}

function describeChapterOpening(interlude: IInterludeFacts): string {
    const timespan = describeTimespan(interlude.span);

    switch (interlude.chapterPosition) {
        case "founding":
            return interlude.repositoryFileCount < SMALL_REPOSITORY_FILE_LIMIT
                ? `In the beginning ${interlude.repositoryFullName} was small enough to hold in one hand. ${timespan}.`
                : `${interlude.repositoryFullName} was already vast when this era opened. ${timespan}.`;

        case "middle":
            return `The realm had grown, and grown uneasy. ${timespan}.`;

        case "present":
            return `This is where the realm stands now. ${timespan}, and it has not stopped.`;
    }
}

function describeTimespan(span: IChapterSpan): string {
    const startYear = span.startCommit.committedAt.getUTCFullYear();
    const endYear = span.endCommit.committedAt.getUTCFullYear();

    return startYear === endYear
        ? `It lasted through ${startYear}`
        : `It stretched from ${startYear} to ${endYear}`;
}

function resolveRepositoryFileCount(regions: IChapterRegion[]): number {
    return regions.find((region) => region.regionId === ROOT_REGION.id)?.fileCount ?? 0;
}

function resolveChapterPosition(chapterIndex: number, chapterCount: number): ChapterPosition {
    if (chapterIndex === 0) return "founding";
    if (chapterIndex === chapterCount - 1) return "present";

    return "middle";
}

function resolveChapterArc(chapterIndex: number, chapterCount: number): IChapterArcEntry {
    if (chapterCount <= 1) return CHAPTER_ARC[0] ?? FALLBACK_CHAPTER_ARC;

    const arcIndex = Math.round((chapterIndex * (CHAPTER_ARC.length - 1)) / (chapterCount - 1));

    return CHAPTER_ARC[arcIndex] ?? FALLBACK_CHAPTER_ARC;
}

function resolveChapterCount(totalCommitCount: number, directoryCount: number): number {
    return Math.max(
        CHAPTER_DESIGN.minChapters,
        Math.min(
            resolveTieredChapterCount(CHAPTER_TIERS_BY_COMMIT_COUNT, totalCommitCount),
            resolveTieredChapterCount(CHAPTER_TIERS_BY_DIRECTORY_COUNT, directoryCount)
        )
    );
}

function resolveTieredChapterCount(tiers: IChapterTier[], count: number): number {
    for (const tier of tiers) if (count < tier.upperBound) return tier.chapterCount;

    return CHAPTER_DESIGN.maxChapters;
}

function deriveSeed(repositoryOwner: string, repositoryName: string): number {
    const repositoryIdentifier = `${repositoryOwner}/${repositoryName}`;
    let seed = 0;

    for (let index = 0; index < repositoryIdentifier.length; index++)
        seed = (seed * SEED_HASH_MULTIPLIER + repositoryIdentifier.charCodeAt(index)) >>> 0;

    return seed;
}

type ChapterPosition = "founding" | "middle" | "present";

export interface IGeneratedRealm {
    realm: IResolvedRealm;
    headCommitSha: string;
}

interface IRealmContext {
    repositoryOwner: string;
    repositoryName: string;
    repositoryFullName: string;
    chapterCount: number;
    headCommitTree: IGithubTree;
    generationSeed: number;
}

interface IChapterBoundary {
    commit: IGithubCommit;
    position: number;
}

interface IChapterSpan {
    startCommit: IGithubCommit;
    endCommit: IGithubCommit;
    commitCount: number;
}

interface IInterludeFacts {
    repositoryFullName: string;
    chapterPosition: ChapterPosition;
    span: IChapterSpan;
    repositoryFileCount: number;
    bossRegionId: string;
    boss: IChapterBoss | null;
}
