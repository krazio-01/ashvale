import { execFileSync, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
    EXTMeshoptCompression,
    KHRMeshQuantization,
    KHRTextureBasisu,
} from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import {
    ASSET_CONFIG,
    BYTES_PER_MEGABYTE,
    PACK_BUDGETS_MB,
    formatMegabytes,
    listFilesRecursively,
} from "./assetConfig";
import {
    TEXTURE_ROLE,
    readGltfJson,
    resolveTextureRoles,
    rewriteGltfForKtx2,
    type TextureRole,
} from "./gltfTextures";

const execFileAsync = promisify(execFile);

interface IImageDimensions {
    width: number;
    height: number;
}

const IMAGE_HEAD_BYTES = 65536;
const KTX2_IDENTIFIER = Buffer.from([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ENCODE_ATTEMPT_LIMIT = 3;

function readHead(file: string, size: number): Buffer {
    const descriptor = fs.openSync(file, "r");
    try {
        const head = Buffer.alloc(size);
        const bytesRead = fs.readSync(descriptor, head, 0, size, 0);
        return head.subarray(0, bytesRead);
    } finally {
        fs.closeSync(descriptor);
    }
}

function scanImageDimensions(buffer: Buffer): IImageDimensions | undefined {
    try {
        if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };

        let offset = 2;
        while (offset < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1;
                continue;
            }

            while (buffer[offset + 1] === 0xff) offset += 1;

            const marker = buffer[offset + 1];
            const isStartOfFrame =
                marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

            if (isStartOfFrame)
                return {
                    height: buffer.readUInt16BE(offset + 5),
                    width: buffer.readUInt16BE(offset + 7),
                };

            offset += 2 + buffer.readUInt16BE(offset + 2);
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function readImageDimensions(file: string): IImageDimensions {
    const dimensions =
        scanImageDimensions(readHead(file, IMAGE_HEAD_BYTES)) ??
        scanImageDimensions(fs.readFileSync(file));
    if (!dimensions) throw new Error(`could not read image dimensions: ${file}`);
    return dimensions;
}

function fitTextureDimensions(file: string): IImageDimensions {
    const { width, height } = readImageDimensions(file);
    const scale = Math.min(1, ASSET_CONFIG.maxTextureSize / Math.max(width, height));
    const snapToBlockMultiple = (value: number): number =>
        Math.max(4, Math.floor((value * scale) / 4) * 4);

    return { width: snapToBlockMultiple(width), height: snapToBlockMultiple(height) };
}

export async function encodeTexture(
    sourceFile: string,
    role: TextureRole,
    outputFile: string
): Promise<void> {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    const { width, height } = fitTextureDimensions(sourceFile);

    const sharedArgs = [
        "create",
        "--generate-mipmap",
        "--width",
        String(width),
        "--height",
        String(height),
    ];

    const args =
        role === TEXTURE_ROLE.normal
            ? [
                  ...sharedArgs,
                  "--format",
                  "R8G8B8A8_UNORM",
                  "--assign-tf",
                  "linear",
                  "--encode",
                  "uastc",
                  "--uastc-quality",
                  "2",
                  "--zstd",
                  "18",
              ]
            : [
                  ...sharedArgs,
                  "--format",
                  "R8G8B8A8_SRGB",
                  "--assign-tf",
                  "srgb",
                  "--encode",
                  "basis-lz",
                  "--clevel",
                  "2",
                  "--qlevel",
                  "200",
              ];

    for (let attempt = 1; attempt <= ENCODE_ATTEMPT_LIMIT; attempt++) {
        await execFileAsync("ktx", [...args, sourceFile, outputFile]);
        if (isValidKtx2(outputFile)) return;
        if (attempt === ENCODE_ATTEMPT_LIMIT)
            throw new Error(
                `ktx produced an invalid file after ${ENCODE_ATTEMPT_LIMIT} attempts: ${outputFile}`
            );
    }
}

function isValidKtx2(file: string): boolean {
    try {
        return readHead(file, KTX2_IDENTIFIER.length).equals(KTX2_IDENTIFIER);
    } catch {
        return false;
    }
}

class AssetCooker {
    private constructor() {}

    static async cook(sourceRoot: string, outputRoot: string): Promise<void> {
        await new AssetCooker().cookSourceTree(sourceRoot, outputRoot);
    }

    private async cookSourceTree(sourceRoot: string, outputRoot: string): Promise<void> {
        if (!fs.existsSync(sourceRoot)) throw new Error(`source not found: ${sourceRoot}`);

        const source = path.resolve(sourceRoot);
        const output = path.resolve(outputRoot);
        if (source === output || source.startsWith(output + path.sep))
            throw new Error(`output would delete the source: ${output} contains ${source}`);

        const files = listFilesRecursively(sourceRoot);
        if (files.length === 0) throw new Error(`source is empty: ${sourceRoot}`);

        const gltfPaths = files.filter((file) => file.endsWith(".gltf"));
        const rolesByTextureFile = resolveTextureRoles(gltfPaths);

        console.log(`source: ${sourceRoot} -> ${outputRoot}`);
        console.log(`${gltfPaths.length} gltf, ${rolesByTextureFile.size} referenced textures`);

        execFileSync("ktx", ["--version"], { stdio: "ignore" });
        fs.rmSync(outputRoot, { recursive: true, force: true });

        await this.encodeTextures(rolesByTextureFile, sourceRoot, outputRoot);
        this.rewriteDocuments(gltfPaths, rolesByTextureFile, sourceRoot, outputRoot);
        this.copyPassthroughFiles(files, sourceRoot, outputRoot);
        await this.compressGeometry(outputRoot);
        this.report(files, sourceRoot, outputRoot);
    }

    private isGeometryExemptPack(file: string, root: string): boolean {
        const pack = path.relative(root, file).split(path.sep)[0];
        return pack !== undefined && ASSET_CONFIG.geometryExemptPacks.includes(pack);
    }

    private async encodeTextures(
        rolesByTextureFile: Map<string, TextureRole>,
        sourceRoot: string,
        outputRoot: string
    ): Promise<void> {
        const texturesToEncode = [...rolesByTextureFile].filter(
            ([, role]) => role !== TEXTURE_ROLE.strip
        );
        console.log(
            `encoding ${texturesToEncode.length}, stripping ${rolesByTextureFile.size - texturesToEncode.length} unusable`
        );

        let nextIndex = 0;
        let encoded = 0;
        const worker = async (): Promise<void> => {
            while (nextIndex < texturesToEncode.length) {
                const [sourceFile, role] = texturesToEncode[nextIndex++];
                const outputFile = path
                    .join(outputRoot, path.relative(sourceRoot, sourceFile))
                    .replace(/\.(png|jpe?g)$/i, ".ktx2");

                await encodeTexture(sourceFile, role, outputFile);

                encoded += 1;
                if (encoded % 10 === 0)
                    console.log(`  encoded ${encoded}/${texturesToEncode.length}`);
            }
        };

        await Promise.all(
            Array.from(
                { length: Math.min(ASSET_CONFIG.encodeConcurrency, texturesToEncode.length) },
                worker
            )
        );
    }

    private rewriteDocuments(
        gltfPaths: string[],
        rolesByTextureFile: Map<string, TextureRole>,
        sourceRoot: string,
        outputRoot: string
    ): void {
        for (const gltfPath of gltfPaths) {
            const document = rewriteGltfForKtx2(
                readGltfJson(gltfPath),
                path.dirname(gltfPath),
                rolesByTextureFile
            );
            const outputPath = path.join(outputRoot, path.relative(sourceRoot, gltfPath));

            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, JSON.stringify(document));
        }

        console.log(`rewrote ${gltfPaths.length} gltf`);
    }

    private copyPassthroughFiles(files: string[], sourceRoot: string, outputRoot: string): void {
        for (const file of files) {
            if (!file.endsWith(".bin") && !file.endsWith(".glb")) continue;

            const destinationPath = path.join(outputRoot, path.relative(sourceRoot, file));
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            fs.copyFileSync(file, destinationPath);
        }
    }

    private async compressGeometry(outputRoot: string): Promise<void> {
        await MeshoptEncoder.ready;

        const io = new NodeIO()
            .registerExtensions([KHRTextureBasisu, KHRMeshQuantization, EXTMeshoptCompression])
            .registerDependencies({
                "meshopt.decoder": MeshoptDecoder,
                "meshopt.encoder": MeshoptEncoder,
            });

        const gltfPaths = listFilesRecursively(outputRoot).filter(
            (file) => file.endsWith(".gltf") && !this.isGeometryExemptPack(file, outputRoot)
        );

        let nextIndex = 0;
        const worker = async (): Promise<void> => {
            while (nextIndex < gltfPaths.length) {
                const gltfPath = gltfPaths[nextIndex++];
                const document = await io.read(gltfPath);
                await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
                await io.write(gltfPath, document);
            }
        };

        await Promise.all(
            Array.from(
                { length: Math.min(ASSET_CONFIG.encodeConcurrency, gltfPaths.length) },
                worker
            )
        );

        console.log("meshopt complete");
    }

    private report(sourceFiles: string[], sourceRoot: string, outputRoot: string): void {
        const totalSize = (files: string[]): number =>
            files.reduce((total, file) => total + fs.statSync(file).size, 0);

        const bytesByPack = new Map<string, number>();
        for (const file of listFilesRecursively(outputRoot)) {
            const pack = path.relative(outputRoot, file).split(path.sep)[0];
            bytesByPack.set(pack, (bytesByPack.get(pack) ?? 0) + fs.statSync(file).size);
        }

        console.log("");
        for (const [pack, bytes] of [...bytesByPack].sort()) {
            const budget = PACK_BUDGETS_MB[pack];
            const over =
                budget !== undefined && bytes / BYTES_PER_MEGABYTE > budget ? " OVER BUDGET" : "";
            console.log(
                `  ${pack}: ${formatMegabytes(bytes)} MB${budget ? ` / ${budget} MB${over}` : ""}`
            );
        }

        const cookedTotal = [...bytesByPack.values()].reduce((total, bytes) => total + bytes, 0);
        console.log(
            `\nsource ${formatMegabytes(totalSize(sourceFiles))} MB -> cooked ${formatMegabytes(cookedTotal)} MB`
        );
    }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    AssetCooker.cook(ASSET_CONFIG.sourceRoot, ASSET_CONFIG.outputRoot).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
