import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import {
    EXTMeshoptCompression,
    KHRMeshQuantization,
    KHRTextureBasisu,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import {
    ASSET_CONFIG,
    BYTES_PER_MEGABYTE,
    GEOMETRY_DRIFT_TOLERANCE,
    PACK_BUDGETS_MB,
    listFilesRecursively,
} from "./assetConfig";
import { readGltfJson } from "./gltfTextures";

const KTX2_IDENTIFIER = Buffer.from([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export class AssetVerifier {
    private readonly failures: string[] = [];

    private constructor() {}

    static async verify(sourceRoot: string, outputRoot: string): Promise<boolean> {
        return new AssetVerifier().runChecks(sourceRoot, outputRoot);
    }

    private async runChecks(sourceRoot: string, outputRoot: string): Promise<boolean> {
        const files = listFilesRecursively(outputRoot);
        const gltfPaths = files.filter((file) => file.endsWith(".gltf"));

        this.checkTextureBindings(gltfPaths, outputRoot);
        this.checkPackBudgets(files, outputRoot);
        this.checkNormalMapEncoding(files);
        await this.checkGeometryDrift(sourceRoot, files, outputRoot);
        this.checkTranscoderFiles();

        console.log("");
        if (this.failures.length > 0) {
            console.error(`${this.failures.length} check(s) failed:`);
            for (const failure of this.failures) console.error(`  - ${failure}`);
            return false;
        }
        console.log("all checks passed");
        return true;
    }

    private checkTextureBindings(gltfPaths: string[], outputRoot: string): void {
        for (const gltfPath of gltfPaths) {
            const document = readGltfJson(gltfPath);
            const images = document.images ?? [];
            const textures = document.textures ?? [];
            const directory = path.dirname(gltfPath);

            for (const [textureIndex, texture] of textures.entries()) {
                const source = (
                    texture.extensions as { KHR_texture_basisu?: { source?: number } } | undefined
                )?.KHR_texture_basisu?.source;
                if (source === undefined) {
                    this.failures.push(
                        `${gltfPath}: texture ${textureIndex} has no KHR_texture_basisu source`
                    );
                    continue;
                }

                const image = images[source];
                if (!image) {
                    this.failures.push(
                        `${gltfPath}: texture references missing image index ${source}`
                    );
                    continue;
                }
                if (!image.uri) {
                    this.failures.push(`${gltfPath}: image index ${source} has no uri`);
                    continue;
                }
                const ktx2Path = path.join(directory, decodeURIComponent(image.uri));
                if (!fs.existsSync(ktx2Path)) {
                    this.failures.push(
                        `${gltfPath}: missing ktx2 ${path.relative(outputRoot, ktx2Path)}`
                    );
                    continue;
                }
                if (!this.isValidKtx2(ktx2Path))
                    this.failures.push(
                        `${gltfPath}: corrupt ktx2 ${path.relative(outputRoot, ktx2Path)}`
                    );
            }

            for (const material of document.materials ?? []) {
                const materialTextureIndices = [
                    material.pbrMetallicRoughness?.baseColorTexture?.index,
                    material.normalTexture?.index,
                    material.emissiveTexture?.index,
                ];
                for (const textureIndex of materialTextureIndices) {
                    if (
                        textureIndex !== undefined &&
                        (textureIndex < 0 || textureIndex >= textures.length)
                    )
                        this.failures.push(
                            `${gltfPath}: material references out-of-range texture index ${textureIndex}`
                        );
                }
            }
        }
        console.log(`texture bindings: checked ${gltfPaths.length} gltf`);
    }

    private isValidKtx2(file: string): boolean {
        try {
            const descriptor = fs.openSync(file, "r");
            try {
                const head = Buffer.alloc(KTX2_IDENTIFIER.length);
                fs.readSync(descriptor, head, 0, head.length, 0);
                return head.equals(KTX2_IDENTIFIER);
            } finally {
                fs.closeSync(descriptor);
            }
        } catch {
            return false;
        }
    }

    private checkPackBudgets(files: string[], outputRoot: string): void {
        const bytesByPack = new Map<string, number>();
        for (const file of files) {
            const pack = path.relative(outputRoot, file).split(path.sep)[0];
            bytesByPack.set(pack, (bytesByPack.get(pack) ?? 0) + fs.statSync(file).size);
        }

        for (const [pack, bytes] of [...bytesByPack].sort()) {
            const mb = bytes / BYTES_PER_MEGABYTE;
            const budget = PACK_BUDGETS_MB[pack];
            if (budget === undefined) continue;

            const isWithinBudget = mb <= budget;
            const status = isWithinBudget ? "ok" : "OVER BUDGET";
            console.log(`  pack ${pack}: ${mb.toFixed(1)} / ${budget} MB (${status})`);
            if (!isWithinBudget)
                this.failures.push(`pack ${pack}: ${mb.toFixed(1)} MB exceeds ${budget} MB budget`);
        }

        for (const pack of Object.keys(PACK_BUDGETS_MB)) {
            if (bytesByPack.has(pack)) continue;
            console.log(`  pack ${pack}: MISSING`);
            this.failures.push(`pack ${pack}: missing from cooked output`);
        }
    }

    private checkNormalMapEncoding(files: string[]): void {
        const normalMaps = files.filter((file) => /_normal\.ktx2$/i.test(file));
        for (const file of normalMaps) {
            try {
                const info = execFileSync("ktx", ["info", file], { encoding: "utf8" });
                const channelLine = info.split("\n").find((line) => line.includes("Channel Type"));
                if (!channelLine?.includes("UASTC_RGB"))
                    this.failures.push(
                        `${file}: normal map not UASTC_RGB (${channelLine?.trim() ?? "no Channel Type reported"})`
                    );
            } catch (error) {
                this.failures.push(
                    `${file}: ktx info failed (${error instanceof Error ? error.message : error})`
                );
            }
        }
        console.log(`normal map encoding: checked ${normalMaps.length} files`);
    }

    private async checkGeometryDrift(
        sourceRoot: string,
        outputFiles: string[],
        outputRoot: string
    ): Promise<void> {
        if (!fs.existsSync(sourceRoot)) {
            console.log("geometry drift: skipped (source root missing)");
            return;
        }

        await MeshoptDecoder.ready;
        const cookedIo = new NodeIO()
            .registerExtensions([KHRTextureBasisu, KHRMeshQuantization, EXTMeshoptCompression])
            .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
        const sourceIo = new NodeIO();

        const cookedModels = outputFiles.filter(
            (file) => file.endsWith(".gltf") || file.endsWith(".glb")
        );
        let compared = 0;
        for (const cookedPath of cookedModels) {
            const relativePath = path.relative(outputRoot, cookedPath);
            const sourcePath = path.join(sourceRoot, relativePath);
            if (!fs.existsSync(sourcePath)) continue;

            try {
                const [sourceDoc, cookedDoc] = await Promise.all([
                    sourceIo.read(sourcePath),
                    cookedIo.read(cookedPath),
                ]);
                const sourceScene = sourceDoc.getRoot().listScenes()[0];
                const cookedScene = cookedDoc.getRoot().listScenes()[0];
                if (!sourceScene || !cookedScene) continue;

                const sourceBounds = getBounds(sourceScene);
                const cookedBounds = getBounds(cookedScene);
                const drift = Math.max(
                    ...sourceBounds.min.map((value, axis) =>
                        Math.abs(value - cookedBounds.min[axis])
                    ),
                    ...sourceBounds.max.map((value, axis) =>
                        Math.abs(value - cookedBounds.max[axis])
                    )
                );
                if (drift > GEOMETRY_DRIFT_TOLERANCE)
                    this.failures.push(
                        `${relativePath}: bounding box drift ${drift.toFixed(5)} exceeds tolerance`
                    );
                compared += 1;
            } catch (error) {
                this.failures.push(
                    `${relativePath}: failed to parse for drift check (${error instanceof Error ? error.message : error})`
                );
            }
        }

        if (compared === 0)
            console.log("geometry drift: skipped (no matching source models found)");
        else console.log(`geometry drift: compared ${compared} models`);
    }

    private checkTranscoderFiles(): void {
        for (const file of ASSET_CONFIG.transcoderFiles) {
            const transcoderPath = path.join(ASSET_CONFIG.transcoderOutputRoot, file);
            if (!fs.existsSync(transcoderPath))
                this.failures.push(`transcoder file missing: ${transcoderPath}`);
        }
        console.log(`transcoder files: checked ${ASSET_CONFIG.transcoderFiles.length}`);
    }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    AssetVerifier.verify(ASSET_CONFIG.sourceRoot, ASSET_CONFIG.outputRoot)
        .then((passed) => {
            if (!passed) process.exitCode = 1;
        })
        .catch((error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        });
}
