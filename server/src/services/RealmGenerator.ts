import { IChapterBoss, IRealmChapter, MIN_CHAPTER_COUNT, RealmLayout } from "../types/realm";
import {
    fetchChangesBetweenCommits,
    fetchCommitAtPosition,
    fetchRepository,
    fetchTotalCommitCount,
    fetchTreeAtCommit,
    IGithubChangeSummary,
    IGithubCommit,
    IGithubContributor,
    IGithubTree,
} from "./GithubService";
import { packChapterRegions } from "./RegionPacker";

const REGION_BUDGET_PER_REALM = 30;
const MIN_REGIONS_PER_CHAPTER = 3;
const CHAPTER_SEED_STRIDE = 7919;

const CHAPTER_TITLES = [
    "The Founding",
    "The First Expansion",
    "The Long Climb",
    "The Reckoning",
    "The Great Refactor",
    "The Widening",
    "The Present Day",
];

const ARTIFACT_NAMES = [
    "Ember of Origin",
    "Shard of Ascent",
    "Sigil of Endurance",
    "Crown of Reckoning",
    "Kernel of Renewal",
    "Lens of Expanse",
    "Heart of the Living Repo",
];

export async function generateRealm(
    repositoryOwner: string,
    repositoryName: string
): Promise<IGeneratedRealm> {
    const [repository, totalCommitCount] = await Promise.all([
        fetchRepository(repositoryOwner, repositoryName),
        fetchTotalCommitCount(repositoryOwner, repositoryName),
    ]);

    if (totalCommitCount < MIN_CHAPTER_COUNT) {
        throw new Error(
            `repository has ${totalCommitCount} commits, needs at least ${MIN_CHAPTER_COUNT}`
        );
    }

    const headCommitTree = await fetchTreeAtCommit(
        repositoryOwner,
        repositoryName,
        repository.defaultBranch
    );
    const chapterCount = RealmLayout.resolveChapterCount(
        totalCommitCount,
        headCommitTree.directoryPaths.length
    );
    const regionBudgetPerChapter = Math.max(
        MIN_REGIONS_PER_CHAPTER,
        Math.round(REGION_BUDGET_PER_REALM / chapterCount)
    );

    const chapterBoundaryPositions = resolveChapterBoundaryPositions(
        totalCommitCount,
        chapterCount
    );
    const chapterBoundaryCommits = await Promise.all(
        chapterBoundaryPositions.map((position) =>
            fetchCommitAtPosition(repositoryOwner, repositoryName, position)
        )
    );

    const headCommit = chapterBoundaryCommits[chapterCount];
    if (!headCommit) throw new Error("failed to resolve head commit for realm");

    const chapterSourceData = await Promise.all(
        Array.from({ length: chapterCount }, (unusedValue, chapterIndex) =>
            fetchChapterSourceData(
                repositoryOwner,
                repositoryName,
                chapterBoundaryCommits,
                chapterIndex,
                chapterCount,
                headCommitTree
            )
        )
    );

    const realmSeed = RealmLayout.deriveSeed(repositoryOwner, repositoryName);
    const chapters: IRealmChapter[] = [];

    for (let chapterIndex = 0; chapterIndex < chapterCount; chapterIndex++) {
        const sourceData = chapterSourceData[chapterIndex];
        if (!sourceData) throw new Error(`missing source data for chapter ${chapterIndex}`);

        const leadContributorLogin = sourceData.changes.contributors[0]?.login ?? null;
        const chapterGeometry = packChapterRegions(
            sourceData.tree.directoryPaths,
            sourceData.tree.filePaths,
            sourceData.changes.changedLineCountByFilePath,
            regionBudgetPerChapter,
            realmSeed + chapterIndex * CHAPTER_SEED_STRIDE
        );

        chapters.push({
            chapterIndex,
            title: CHAPTER_TITLES[chapterIndex] ?? `Chapter ${chapterIndex + 1}`,
            commitSha: sourceData.endCommit.sha,
            startedAt: sourceData.startCommit.committedAt,
            endedAt: sourceData.endCommit.committedAt,
            commitCount: sourceData.changes.commitCount,
            artifactName: ARTIFACT_NAMES[chapterIndex] ?? "Fragment of the Deep Log",
            interludeParagraphs: composeInterludeParagraphs(
                repository.fullName,
                chapterIndex,
                chapterCount,
                sourceData.startCommit.committedAt,
                sourceData.endCommit.committedAt,
                sourceData.changes.commitCount,
                leadContributorLogin,
                chapterGeometry.objectiveRegionId
            ),
            spawnRegionId: chapterGeometry.spawnRegionId,
            objectiveRegionId: chapterGeometry.objectiveRegionId,
            regions: chapterGeometry.regions,
            pathways: chapterGeometry.pathways,
            boss: buildChapterBoss(
                sourceData.changes.contributors,
                chapterGeometry.objectiveRegionId
            ),
        });
    }

    return {
        layout: new RealmLayout(
            repositoryOwner,
            repositoryName,
            repository.starCount,
            repository.primaryLanguage,
            totalCommitCount,
            chapters
        ),
        repositoryFullName: repository.fullName,
        headCommitSha: headCommit.sha,
    };
}

function resolveChapterBoundaryPositions(totalCommitCount: number, chapterCount: number): number[] {
    const commitsPerChapter = Math.floor(totalCommitCount / chapterCount);
    const positions: number[] = [];

    for (let boundaryIndex = 0; boundaryIndex < chapterCount; boundaryIndex++) {
        positions.push(Math.max(0, totalCommitCount - 1 - boundaryIndex * commitsPerChapter));
    }
    positions.push(0);

    return positions;
}

async function fetchChapterSourceData(
    repositoryOwner: string,
    repositoryName: string,
    chapterBoundaryCommits: IGithubCommit[],
    chapterIndex: number,
    chapterCount: number,
    headCommitTree: IGithubTree
): Promise<IChapterSourceData> {
    const startCommit = chapterBoundaryCommits[chapterIndex];
    const endCommit = chapterBoundaryCommits[chapterIndex + 1];
    if (!startCommit || !endCommit)
        throw new Error(`missing boundary commit for chapter ${chapterIndex}`);

    const isFinalChapter = chapterIndex === chapterCount - 1;

    const [tree, changes] = await Promise.all([
        isFinalChapter
            ? Promise.resolve(headCommitTree)
            : fetchTreeAtCommit(repositoryOwner, repositoryName, endCommit.sha),
        fetchChangesBetweenCommits(repositoryOwner, repositoryName, startCommit.sha, endCommit.sha),
    ]);

    return { startCommit, endCommit, tree, changes };
}

function buildChapterBoss(
    contributors: IGithubContributor[],
    objectiveRegionId: string
): IChapterBoss | null {
    const leadContributor = contributors[0];
    if (!leadContributor) return null;

    return {
        contributorLogin: leadContributor.login,
        avatarUrl: leadContributor.avatarUrl,
        commitCount: leadContributor.commitCount,
        regionId: objectiveRegionId,
    };
}

function composeInterludeParagraphs(
    repositoryFullName: string,
    chapterIndex: number,
    chapterCount: number,
    startedAt: Date,
    endedAt: Date,
    commitCount: number,
    leadContributorLogin: string | null,
    objectiveRegionId: string
): string[] {
    const paragraphs: string[] = [];
    const timespanDescription = describeTimespan(startedAt, endedAt);

    if (chapterIndex === 0) {
        paragraphs.push(
            `In the beginning ${repositoryFullName} was small enough to hold in one hand. ${timespanDescription}.`
        );
    } else if (chapterIndex === chapterCount - 1) {
        paragraphs.push(
            `This is where the realm stands now. ${timespanDescription}, and it has not stopped.`
        );
    } else {
        paragraphs.push(`The realm had grown, and grown uneasy. ${timespanDescription}.`);
    }

    paragraphs.push(`${commitCount} commits reshaped the land in this chapter.`);

    if (leadContributorLogin) {
        paragraphs.push(
            `Its will belonged to ${leadContributorLogin}, who waits at ${objectiveRegionId}.`
        );
    }

    return paragraphs;
}

function describeTimespan(startedAt: Date, endedAt: Date): string {
    const startYear = startedAt.getUTCFullYear();
    const endYear = endedAt.getUTCFullYear();

    if (startYear === endYear) return `It lasted through ${startYear}`;
    return `It stretched from ${startYear} to ${endYear}`;
}

export interface IGeneratedRealm {
    layout: RealmLayout;
    repositoryFullName: string;
    headCommitSha: string;
}

export interface IChapterSourceData {
    startCommit: IGithubCommit;
    endCommit: IGithubCommit;
    tree: IGithubTree;
    changes: IGithubChangeSummary;
}
