import "server-only";
import { env } from "@/config/env";
import { HttpStatus } from "@/constants/strings";
import { ErrorWrapper } from "@/lib/ResponseWrapper";
import { httpGet } from "@/services/HttpService";

const LAST_PAGE_PATTERN = /[?&]page=(\d+)>;\s*rel="last"/;
const NEXT_PAGE_PATTERN = /[?&]page=(\d+)>;\s*rel="next"/;

const AUTOMATED_LOGIN_SUFFIX_PATTERN = /(\[bot\]|[-_]bot)$/i;
const AUTOMATED_ACCOUNT_TYPE = "Bot";

const DIRECTORY_ENTRY_TYPE = "tree";
const FILE_ENTRY_TYPE = "blob";

const CONTRIBUTOR_SAMPLE_SIZE = 100;

const GITHUB_HEADERS = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${env.githubToken}`,
    "user-agent": "ashvale",
};

export async function fetchRepository(owner: string, name: string): Promise<IGithubRepository> {
    const { data } = await requestGithub<IRepositoryPayload>(owner, name);

    return {
        fullName: data.full_name,
        starCount: data.stargazers_count,
        primaryLanguage: data.language,
        defaultBranch: data.default_branch,
    };
}

export async function fetchTotalCommitCount(owner: string, name: string): Promise<number> {
    const { data, headers } = await requestGithub<unknown[]>(owner, name, "/commits?per_page=1");
    const linkHeader = headers["link"] ?? "";

    const lastPageMatch = linkHeader.match(LAST_PAGE_PATTERN);
    if (lastPageMatch) return Number(lastPageMatch[1]);

    if (NEXT_PAGE_PATTERN.test(linkHeader))
        throw new ErrorWrapper("github would not report a commit total", HttpStatus.BAD_GATEWAY);

    return data.length;
}

export async function fetchCommitAtPosition(
    owner: string,
    name: string,
    positionFromNewest: number
): Promise<IGithubCommit> {
    const { data } = await requestGithub<ICommitPayload[]>(
        owner,
        name,
        `/commits?per_page=1&page=${positionFromNewest + 1}`
    );

    const commit = data[0];
    if (!commit)
        throw new ErrorWrapper(`no commit at position ${positionFromNewest}`, HttpStatus.NOT_FOUND);

    return { sha: commit.sha, committedAt: new Date(commit.commit.committer.date) };
}

export async function fetchTreeAtCommit(
    owner: string,
    name: string,
    commitSha: string
): Promise<IGithubTree> {
    const tree = await fetchTreeRecursively(owner, name, commitSha);

    return tree.isTruncated ? fetchTreeThroughSubtrees(owner, name, commitSha) : tree;
}

export async function fetchContributorsBetweenDates(
    owner: string,
    name: string,
    since: Date,
    until: Date
): Promise<IGithubContributor[]> {
    const query = new URLSearchParams({
        since: since.toISOString(),
        until: until.toISOString(),
        per_page: String(CONTRIBUTOR_SAMPLE_SIZE),
    });

    const { data } = await requestGithub<ICommitPayload[]>(owner, name, `/commits?${query}`);
    const contributorByLogin = new Map<string, IGithubContributor>();

    for (const { author } of data) {
        if (!author) continue;

        const existing = contributorByLogin.get(author.login);

        if (existing) {
            existing.sampledCommitCount++;
            continue;
        }

        contributorByLogin.set(author.login, {
            login: author.login,
            avatarUrl: author.avatar_url ?? "",
            sampledCommitCount: 1,
            isAutomated: isAutomatedAccount(author),
        });
    }

    return [...contributorByLogin.values()].sort(
        (first, second) => second.sampledCommitCount - first.sampledCommitCount
    );
}

export async function isCommitDescendedFrom(
    owner: string,
    name: string,
    ancestorSha: string,
    descendantSha: string
): Promise<boolean> {
    if (ancestorSha === descendantSha) return true;

    try {
        await requestGithub<unknown>(
            owner,
            name,
            `/compare/${ancestorSha}...${descendantSha}?per_page=1`
        );

        return true;
    } catch (error) {
        if (!(error instanceof ErrorWrapper)) throw error;
        if (error.statusCode === HttpStatus.NOT_FOUND) return false;
        if (error.statusCode === HttpStatus.UNPROCESSABLE_ENTITY) return true;

        throw error;
    }
}

async function fetchTreeRecursively(
    owner: string,
    name: string,
    treeSha: string,
    pathPrefix = ""
): Promise<IGithubTree> {
    const { data } = await requestGithub<ITreePayload>(
        owner,
        name,
        `/git/trees/${treeSha}?recursive=1`
    );

    return buildTreeFromPayload(data, pathPrefix);
}

async function fetchTreeThroughSubtrees(
    owner: string,
    name: string,
    commitSha: string
): Promise<IGithubTree> {
    const { data } = await requestGithub<ITreePayload>(owner, name, `/git/trees/${commitSha}`);

    const subtrees = await Promise.all(
        data.tree
            .filter((entry) => entry.type === DIRECTORY_ENTRY_TYPE)
            .map((root) => fetchSubtreeOrEmpty(owner, name, root))
    );

    return mergeTrees([buildTreeFromPayload(data), ...subtrees]);
}

async function fetchSubtreeOrEmpty(
    owner: string,
    name: string,
    root: ITreeEntryPayload
): Promise<IGithubTree> {
    try {
        return await fetchTreeRecursively(owner, name, root.sha, `${root.path}/`);
    } catch (error) {
        console.warn(`subtree unavailable for ${root.path}:`, error);

        return { directoryPaths: [], filePaths: [], isTruncated: true };
    }
}

function buildTreeFromPayload(payload: ITreePayload, pathPrefix = ""): IGithubTree {
    const directoryPaths: string[] = [];
    const filePaths: string[] = [];

    for (const entry of payload.tree) {
        const path = `${pathPrefix}${entry.path}`;

        if (entry.type === DIRECTORY_ENTRY_TYPE) directoryPaths.push(path);
        else if (entry.type === FILE_ENTRY_TYPE) filePaths.push(path);
    }

    return { directoryPaths, filePaths, isTruncated: payload.truncated };
}

function mergeTrees(trees: IGithubTree[]): IGithubTree {
    return {
        directoryPaths: trees.flatMap((tree) => tree.directoryPaths),
        filePaths: trees.flatMap((tree) => tree.filePaths),
        isTruncated: trees.some((tree) => tree.isTruncated),
    };
}

function isAutomatedAccount(author: ICommitAuthorPayload): boolean {
    return (
        author.type === AUTOMATED_ACCOUNT_TYPE || AUTOMATED_LOGIN_SUFFIX_PATTERN.test(author.login)
    );
}

async function requestGithub<T>(
    owner: string,
    name: string,
    resourcePath = ""
): Promise<IGithubResponse<T>> {
    const path = `/repos/${owner}/${name}${resourcePath}`;

    const response = await httpGet<T>(
        `${env.githubApiBaseUrl}${path}`,
        GITHUB_HEADERS,
        env.githubRequestTimeoutMs
    );

    if (!response.isSuccess) throw buildGithubError(response.status, response.headers, path);

    return { data: response.data, headers: response.headers };
}

function buildGithubError(status: number, headers: ResponseHeaders, path: string): ErrorWrapper {
    switch (status) {
        case 404:
            return new ErrorWrapper(`github resource not found: ${path}`, HttpStatus.NOT_FOUND);
        case 409:
            return new ErrorWrapper("repository has no commits", HttpStatus.CONFLICT);
        case 422:
            return new ErrorWrapper(
                `github could not process the request: ${path}`,
                HttpStatus.UNPROCESSABLE_ENTITY
            );
        case 403:
        case 429: {
            if (headers["x-ratelimit-remaining"] !== "0")
                return new ErrorWrapper(`github denied the request: ${path}`, HttpStatus.FORBIDDEN);

            const resetsAt = new Date(Number(headers["x-ratelimit-reset"]) * 1000);

            return new ErrorWrapper(
                `github rate limit exhausted, resets at ${resetsAt.toISOString()}`,
                HttpStatus.TOO_MANY_REQUESTS
            );
        }
        default:
            return new ErrorWrapper(`github responded ${status}: ${path}`, HttpStatus.BAD_GATEWAY);
    }
}

type ResponseHeaders = Record<string, string | undefined>;

export interface IGithubRepository {
    fullName: string;
    starCount: number;
    primaryLanguage: string | null;
    defaultBranch: string;
}

export interface IGithubCommit {
    sha: string;
    committedAt: Date;
}

export interface IGithubTree {
    directoryPaths: string[];
    filePaths: string[];
    isTruncated: boolean;
}

export interface IGithubContributor {
    login: string;
    avatarUrl: string;
    sampledCommitCount: number;
    isAutomated: boolean;
}

interface IGithubResponse<T> {
    data: T;
    headers: ResponseHeaders;
}

interface IRepositoryPayload {
    full_name: string;
    stargazers_count: number;
    language: string | null;
    default_branch: string;
}

interface ICommitPayload {
    sha: string;
    commit: { committer: { date: string } };
    author: ICommitAuthorPayload | null;
}

interface ICommitAuthorPayload {
    login: string;
    avatar_url: string;
    type: string;
}

interface ITreePayload {
    tree: ITreeEntryPayload[];
    truncated: boolean;
}

interface ITreeEntryPayload {
    path: string;
    type: string;
    sha: string;
}
