import fs from "node:fs";
import path from "node:path";

export const BYTES_PER_MEGABYTE = 1_048_576;

export const ASSET_CONFIG = {
    sourceRoot: "assets-src/models",
    outputRoot: "public/models",
    transcoderOutputRoot: "public/vendor/basis",
    transcoderSourceRoot: "node_modules/three/examples/jsm/libs/basis",
    transcoderFiles: ["basis_transcoder.js", "basis_transcoder.wasm"],
    maxTextureSize: 1024,
    cookExemptPacks: ["characters"],
    // Concurrent `ktx create` invocations were found to silently corrupt output under
    // memory pressure (partial writes surviving a magic-byte check) even at low
    // concurrency. Serial encoding is the only setting proven safe; see AssetCooker.ts.
    encodeConcurrency: 1,
};

export const PACK_BUDGETS_MB: Record<string, number> = {
    woodland: 10,
    "medieval-village": 8,
    highlands: 6,
    architecture: 4,
    characters: 16,
};

export const GEOMETRY_DRIFT_TOLERANCE = 1e-3;

export const formatMegabytes = (bytes: number): string => (bytes / BYTES_PER_MEGABYTE).toFixed(1);

export const listFilesRecursively = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
    });
