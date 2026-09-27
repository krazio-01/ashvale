import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    reactStrictMode: false,
    headers: async () => [
        {
            source: "/models/:path*",
            headers: [
                {
                    key: "Cache-Control",
                    value: "public, max-age=31536000, immutable",
                },
            ],
        },
        {
            source: "/models/characters/CombatClips.glb",
            headers: [
                {
                    key: "Cache-Control",
                    value: "public, max-age=0, must-revalidate",
                },
            ],
        },
    ],
};

export default nextConfig;
