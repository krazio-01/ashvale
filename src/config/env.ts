import "server-only";

function requireEnv(key: string, fallback?: string): string {
    const value = process.env[key] ?? fallback;

    if (value === undefined) throw new Error(`Missing required environment variable: ${key}`);

    return value;
}

export const env = {
    port: requireEnv("PORT", "4000"),
    nodeEnv: requireEnv("NODE_ENV", "development"),
    corsOrigin: requireEnv("CORS_ORIGIN", "http://localhost:3000"),
    mongoUri: requireEnv("MONGO_URI"),
    githubToken: requireEnv("GITHUB_TOKEN"),
    githubApiBaseUrl: requireEnv("", "https://api.github.com"),
    githubRequestTimeoutMs: Number(requireEnv("", "30000")),
};
