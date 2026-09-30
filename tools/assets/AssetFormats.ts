import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const TEXTURE_ROLE = { base: "base", normal: "normal", strip: "strip" } as const;

export type TextureRole = (typeof TEXTURE_ROLE)[keyof typeof TEXTURE_ROLE];

const ROLE_PRIORITY: Record<TextureRole, number> = { strip: 0, normal: 1, base: 2 };

interface ITextureReference {
    index: number;
}

interface IGltfMaterial {
    pbrMetallicRoughness?: {
        baseColorTexture?: ITextureReference;
        metallicRoughnessTexture?: ITextureReference;
    };
    normalTexture?: ITextureReference;
    emissiveTexture?: ITextureReference;
    occlusionTexture?: ITextureReference;
}

interface IBasisuTexture {
    sampler?: number;
    extensions: { KHR_texture_basisu: { source: number } };
}

export interface IGltfJson {
    images?: { uri?: string; mimeType?: string; extensions?: unknown }[];
    textures?: { source?: number; sampler?: number; extensions?: unknown }[];
    materials?: IGltfMaterial[];
    buffers?: { uri?: string }[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
}

export class TextureRoleMap {
    private readonly rolesByFile = new Map<string, TextureRole>();

    static collect(documents: readonly GltfDocument[]): TextureRoleMap {
        const roles = new TextureRoleMap();
        for (const document of documents) document.recordTextureRoles(roles);
        return roles;
    }

    get size(): number {
        return this.rolesByFile.size;
    }

    record(file: string | undefined, role: TextureRole): void {
        if (!file) return;
        const existing = this.rolesByFile.get(file);
        if (!existing || ROLE_PRIORITY[role] > ROLE_PRIORITY[existing])
            this.rolesByFile.set(file, role);
    }

    roleOf(file: string): TextureRole | undefined {
        return this.rolesByFile.get(file);
    }

    encodable(): [string, TextureRole][] {
        return [...this.rolesByFile].filter(([, role]) => role !== TEXTURE_ROLE.strip);
    }
}

export class GltfDocument {
    readonly filePath: string;
    readonly json: IGltfJson;

    private constructor(filePath: string, json: IGltfJson) {
        this.filePath = filePath;
        this.json = json;
    }

    static read(filePath: string): GltfDocument {
        return new GltfDocument(
            filePath,
            JSON.parse(fs.readFileSync(filePath, "utf8")) as IGltfJson
        );
    }

    get directory(): string {
        return path.dirname(this.filePath);
    }

    recordTextureRoles(roles: TextureRoleMap): void {
        const images = (this.json.images ?? []).map((image) =>
            image.uri ? path.join(this.directory, decodeURIComponent(image.uri)) : undefined
        );
        const imagePathForTexture = (index: number): string | undefined =>
            images[(this.json.textures ?? [])[index]?.source ?? -1];

        for (const material of this.json.materials ?? []) {
            const pbr = material.pbrMetallicRoughness ?? {};
            if (pbr.baseColorTexture)
                roles.record(imagePathForTexture(pbr.baseColorTexture.index), TEXTURE_ROLE.base);
            if (material.emissiveTexture)
                roles.record(
                    imagePathForTexture(material.emissiveTexture.index),
                    TEXTURE_ROLE.base
                );
            if (material.normalTexture)
                roles.record(
                    imagePathForTexture(material.normalTexture.index),
                    TEXTURE_ROLE.normal
                );
            if (pbr.metallicRoughnessTexture)
                roles.record(
                    imagePathForTexture(pbr.metallicRoughnessTexture.index),
                    TEXTURE_ROLE.strip
                );
            if (material.occlusionTexture)
                roles.record(
                    imagePathForTexture(material.occlusionTexture.index),
                    TEXTURE_ROLE.strip
                );
        }
    }

    rewriteForKtx2(roles: TextureRoleMap): void {
        const document = this.json;

        for (const material of document.materials ?? []) {
            delete material.occlusionTexture;
            if (material.pbrMetallicRoughness)
                delete material.pbrMetallicRoughness.metallicRoughnessTexture;
        }

        const newImageIndexByOldIndex = new Map<number, number>();
        const newImages: { uri: string; mimeType: string }[] = [];
        for (const [index, image] of (document.images ?? []).entries()) {
            if (!image.uri) continue;
            const role = roles.roleOf(path.join(this.directory, decodeURIComponent(image.uri)));
            if (role !== TEXTURE_ROLE.base && role !== TEXTURE_ROLE.normal) continue;

            newImageIndexByOldIndex.set(index, newImages.length);
            newImages.push({
                uri: image.uri.replace(/\.(png|jpe?g)$/i, ".ktx2"),
                mimeType: "image/ktx2",
            });
        }

        const newTextureIndexByOldIndex = new Map<number, number>();
        const newTextures: IBasisuTexture[] = [];
        for (const [index, texture] of (document.textures ?? []).entries()) {
            const source = newImageIndexByOldIndex.get(texture.source ?? -1);
            if (source === undefined) continue;

            newTextureIndexByOldIndex.set(index, newTextures.length);
            const basisuTexture: IBasisuTexture = {
                extensions: { KHR_texture_basisu: { source } },
            };
            if (texture.sampler !== undefined) basisuTexture.sampler = texture.sampler;
            newTextures.push(basisuTexture);
        }

        const remapTextureReference = (
            owner: Record<string, unknown> | undefined,
            key: string
        ): void => {
            const reference = owner?.[key] as ITextureReference | undefined;
            if (!owner || !reference) return;
            const index = newTextureIndexByOldIndex.get(reference.index);
            if (index === undefined) delete owner[key];
            else reference.index = index;
        };

        for (const material of document.materials ?? []) {
            remapTextureReference(
                material.pbrMetallicRoughness as Record<string, unknown> | undefined,
                "baseColorTexture"
            );
            remapTextureReference(material as unknown as Record<string, unknown>, "normalTexture");
            remapTextureReference(
                material as unknown as Record<string, unknown>,
                "emissiveTexture"
            );
        }

        if (newImages.length > 0) document.images = newImages;
        else delete document.images;

        if (newTextures.length > 0) document.textures = newTextures;
        else delete document.textures;

        if (newImages.length > 0) {
            const declareBasisuExtension = (list: string[] | undefined): string[] => [
                ...new Set([...(list ?? []), "KHR_texture_basisu"]),
            ];
            document.extensionsUsed = declareBasisuExtension(document.extensionsUsed);
            document.extensionsRequired = declareBasisuExtension(document.extensionsRequired);
        }
    }

    writeTo(outputPath: string): void {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(this.json));
    }
}

const execFileAsync = promisify(execFile);

interface IImageDimensions {
    width: number;
    height: number;
}

const IMAGE_HEAD_BYTES = 65536;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const KTX2_IDENTIFIER = Buffer.from([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ENCODE_ATTEMPT_LIMIT = 3;

const NORMAL_ENCODE_ARGS = [
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
];

const BASE_ENCODE_ARGS = [
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
        if (buffer.subarray(0, 8).equals(PNG_SIGNATURE))
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

export class TextureEncoder {
    private readonly maxTextureSize: number;

    constructor(maxTextureSize: number) {
        this.maxTextureSize = maxTextureSize;
    }

    static assertInstalled(): void {
        execFileSync("ktx", ["--version"], { stdio: "ignore" });
    }

    static isValidKtx2(file: string): boolean {
        try {
            return readHead(file, KTX2_IDENTIFIER.length).equals(KTX2_IDENTIFIER);
        } catch {
            return false;
        }
    }

    static readChannelType(file: string): string | undefined {
        const info = execFileSync("ktx", ["info", file], { encoding: "utf8" });
        return info
            .split("\n")
            .find((line) => line.includes("Channel Type"))
            ?.trim();
    }

    async encode(sourceFile: string, role: TextureRole, outputFile: string): Promise<void> {
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        const { width, height } = this.fitDimensions(sourceFile);
        const args = [
            "create",
            "--generate-mipmap",
            "--width",
            String(width),
            "--height",
            String(height),
            ...(role === TEXTURE_ROLE.normal ? NORMAL_ENCODE_ARGS : BASE_ENCODE_ARGS),
        ];

        for (let attempt = 1; attempt <= ENCODE_ATTEMPT_LIMIT; attempt++) {
            await execFileAsync("ktx", [...args, sourceFile, outputFile]);
            if (TextureEncoder.isValidKtx2(outputFile)) return;
            if (attempt === ENCODE_ATTEMPT_LIMIT)
                throw new Error(
                    `ktx produced an invalid file after ${ENCODE_ATTEMPT_LIMIT} attempts: ${outputFile}`
                );
        }
    }

    private fitDimensions(file: string): IImageDimensions {
        const { width, height } = readImageDimensions(file);
        const scale = Math.min(1, this.maxTextureSize / Math.max(width, height));
        const snapToBlockMultiple = (value: number): number =>
            Math.max(4, Math.floor((value * scale) / 4) * 4);
        return { width: snapToBlockMultiple(width), height: snapToBlockMultiple(height) };
    }
}
