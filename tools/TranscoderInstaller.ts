import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_CONFIG } from "./assetConfig";

export function installTranscoder(): void {
    const { transcoderSourceRoot, transcoderOutputRoot, transcoderFiles } = ASSET_CONFIG;

    fs.mkdirSync(transcoderOutputRoot, { recursive: true });

    for (const file of transcoderFiles) {
        const sourcePath = path.join(transcoderSourceRoot, file);
        if (!fs.existsSync(sourcePath))
            throw new Error(
                `basis transcoder missing at ${sourcePath} — is three installed? ` +
                    `KTX2 textures cannot decode without it.`
            );
        fs.copyFileSync(sourcePath, path.join(transcoderOutputRoot, file));
    }

    console.log(`synced ${transcoderFiles.length} transcoder files to ${transcoderOutputRoot}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    try {
        installTranscoder();
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
