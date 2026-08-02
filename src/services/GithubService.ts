import "server-only";
import { env } from "../config/env";
import { HttpStatus } from "../constants/strings";
import { ErrorWrapper } from "../lib/ResponseWrapper";
import { httpGet } from "./HttpService";

const LAST_PAGE_PATTERN = /[?&]page=(\d+)>;\s*rel="last"/;
const COMPARE_FILES_PER_PAGE = 300;

const GITHUB_HEADERS = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${env.githubToken}`,
    "user-agent": "ashvale",
};

export async function fetchRepository(owner: string, name: string): Promise<IGithubRepository> {
    const { data } = await requestGithub<IGithubRepositoryResponse>(
        buildRepositoryPath(owner, name)
    );

    return {
        fullName: data.full_name,
        starCount: data.stargazers_count,
        primaryLanguage: data.language,
        defaultBranch: data.default_branch,
    };
}

export async function fetchTotalCommitCount(owner: string, name: string): Promise<number> {
    const { data, lastPageNumber } = await requestGithub<unknown[]>(
        `${buildRepositoryPath(owner, name)}/commits?per_page=1`
    );

    return lastPageNumber ?? data.length;
}

export async function fetchCommitAtPosition(
    owner: string,
    name: string,
    positionFromNewest: number
): Promise<IGithubCommit> {
    const { data } = await requestGithub<IGithubCommitResponse[]>(
        `${buildRepositoryPath(owner, name)}/commits?per_page=1&page=${positionFromNewest + 1}`
    );

    const entry = data[0];
    if (!entry)
        throw new ErrorWrapper(`no commit at position ${positionFromNewest}`, HttpStatus.NOT_FOUND);

    return {
        sha: entry.sha,
        committedAt: new Date(entry.commit.committer.date),
        message: entry.commit.message,
        authorLogin: entry.author?.login ?? null,
    };
}

export async function fetchTreeAtCommit(
    owner: string,
    name: string,
    commitSha: string
): Promise<IGithubTree> {
    const { data } = await requestGithub<IGithubTreeResponse>(
        `${buildRepositoryPath(owner, name)}/git/trees/${commitSha}?recursive=1`
    );

    const directoryPaths: string[] = [];
    const filePaths: string[] = [];
    for (const entry of data.tree) {
        if (entry.type === "tree") directoryPaths.push(entry.path);
        else if (entry.type === "blob") filePaths.push(entry.path);
    }

    return { directoryPaths, filePaths, isTruncated: data.truncated };
}

export async function fetchChangesBetweenCommits(
    owner: string,
    name: string,
    baseSha: string,
    headSha: string
): Promise<IGithubChangeSummary> {
    const { data } = await requestGithub<IGithubComparisonResponse>(
        `${buildRepositoryPath(owner, name)}/compare/${baseSha}...${headSha}?per_page=${COMPARE_FILES_PER_PAGE}`
    );

    const changedFiles = data.files ?? [];
    const changedLineCountByFilePath = new Map<string, number>();
    for (const file of changedFiles) {
        changedLineCountByFilePath.set(file.filename, file.changes);
    }

    const commitCountByLogin = new Map<string, number>();
    const avatarUrlByLogin = new Map<string, string>();
    for (const entry of data.commits ?? []) {
        if (!entry.author) continue;
        commitCountByLogin.set(
            entry.author.login,
            (commitCountByLogin.get(entry.author.login) ?? 0) + 1
        );
        avatarUrlByLogin.set(entry.author.login, entry.author.avatar_url);
    }

    const contributors: IGithubContributor[] = [];
    for (const [login, commitCount] of commitCountByLogin) {
        contributors.push({ login, avatarUrl: avatarUrlByLogin.get(login) ?? "", commitCount });
    }
    contributors.sort((first, second) => second.commitCount - first.commitCount);

    return {
        changedLineCountByFilePath,
        contributors,
        commitCount: data.total_commits,
        isTruncated: changedFiles.length >= COMPARE_FILES_PER_PAGE,
    };
}

async function requestGithub<T>(path: string): Promise<IGithubResponse<T>> {
    const response = await httpGet<T>(
        `${env.githubApiBaseUrl}${path}`,
        GITHUB_HEADERS,
        env.githubRequestTimeoutMs
    );

    if (!response.isSuccess) {
        if (response.status === 404)
            throw new ErrorWrapper("repository not found", HttpStatus.NOT_FOUND);

        if (response.status === 409)
            throw new ErrorWrapper("repository has no commits", HttpStatus.CONFLICT);

        if (response.status === 403 || response.status === 429) {
            if (response.headers["x-ratelimit-remaining"] === "0") {
                const resetsAt = new Date(Number(response.headers["x-ratelimit-reset"]) * 1000);
                throw new ErrorWrapper(
                    `github rate limit exhausted, resets at ${resetsAt.toISOString()}`,
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }
            throw new ErrorWrapper("github denied the request", HttpStatus.FORBIDDEN);
        }

        throw new ErrorWrapper(`github responded ${response.status}`, HttpStatus.BAD_GATEWAY);
    }

    if (response.status === 202)
        throw new ErrorWrapper(
            "github is still computing repository statistics",
            HttpStatus.ACCEPTED
        );

    const lastPageMatch = response.headers["link"]?.match(LAST_PAGE_PATTERN);
    return { data: response.data, lastPageNumber: lastPageMatch ? Number(lastPageMatch[1]) : null };
}

function buildRepositoryPath(owner: string, name: string): string {
    return `/repos/${owner}/${name}`;
}

export interface IGithubResponse<T> {
    data: T;
    lastPageNumber: number | null;
}

export interface IGithubRepository {
    fullName: string;
    starCount: number;
    primaryLanguage: string | null;
    defaultBranch: string;
}

export interface IGithubCommit {
    sha: string;
    committedAt: Date;
    message: string;
    authorLogin: string | null;
}

export interface IGithubTree {
    directoryPaths: string[];
    filePaths: string[];
    isTruncated: boolean;
}

export interface IGithubContributor {
    login: string;
    avatarUrl: string;
    commitCount: number;
}

export interface IGithubChangeSummary {
    changedLineCountByFilePath: Map<string, number>;
    contributors: IGithubContributor[];
    commitCount: number;
    isTruncated: boolean;
}

export interface IGithubRepositoryResponse {
    full_name: string;
    stargazers_count: number;
    language: string | null;
    default_branch: string;
}

export interface IGithubCommitResponse {
    sha: string;
    commit: { message: string; committer: { date: string } };
    author: { login: string; avatar_url: string } | null;
}

export interface IGithubTreeResponse {
    tree: { path: string; type: string }[];
    truncated: boolean;
}

export interface IGithubComparisonResponse {
    files?: { filename: string; changes: number }[];
    commits?: { author: { login: string; avatar_url: string } | null }[];
    total_commits: number;
}
