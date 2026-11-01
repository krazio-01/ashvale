import "server-only";
import { ERRORS } from "@/constants/strings";

function requireEnv(key: string, fallback?: string): string {
    const value = process.env[key] ?? fallback;

    if (value === undefined) throw new Error(ERRORS.missingEnvironmentVariable(key));

    return value;
}

export const env = {
    mongoUri: requireEnv("MONGO_URI"),
    githubToken: requireEnv("GITHUB_TOKEN"),
    githubApiBaseUrl: requireEnv("", "https://api.github.com"),
    githubRequestTimeoutMs: Number(requireEnv("", "30000")),
};
