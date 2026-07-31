import "dotenv/config";

function requireEnv(key: string, fallback?: string): string {
    const value = process.env[key] ?? fallback;

    if (value === undefined) throw new Error(`Missing required environment variable: ${key}`);

    return value;
}

export const env = {
    port: requireEnv("PORT", "4000"),
    nodeEnv: requireEnv("NODE_ENV", "development"),
    corsOrigin: requireEnv("CORS_ORIGIN", "http://localhost:3000"),
    MONGO_URI: requireEnv("MONGO_URI"),
};
