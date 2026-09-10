const REPO_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i;
const SHORTHAND_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;
const GIT_SUFFIX_PATTERN = /\.git$/i;

export interface IParsedRepo {
    owner: string;
    name: string;
}

export function parseRepoInput(rawInput: string): IParsedRepo | null {
    const trimmed = rawInput.trim().replace(/\/+$/, "");
    if (!trimmed) return null;

    const match = trimmed.match(REPO_URL_PATTERN) ?? trimmed.match(SHORTHAND_PATTERN);
    const [, owner, rawName] = match ?? [];
    if (!owner || !rawName) return null;

    const name = rawName.replace(GIT_SUFFIX_PATTERN, "");
    if (!name) return null;

    return { owner, name };
}
