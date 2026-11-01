import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { type Accessor, NodeIO } from "@gltf-transform/core";
import {
    EXTMeshoptCompression,
    KHRMeshQuantization,
    KHRTextureBasisu,
} from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { readJsonFile } from "../pipeline";

export const TEXTURE_ROLE = { base: "base", normal: "normal", strip: "strip" } as const;

export const COOKED_EXTENSIONS = [KHRTextureBasisu, KHRMeshQuantization, EXTMeshoptCompression];

const TEXTURE_SLOTS: readonly { owner?: "pbrMetallicRoughness"; key: string; role: TextureRole }[] =
    [
        { owner: "pbrMetallicRoughness", key: "baseColorTexture", role: TEXTURE_ROLE.base },
        { key: "normalTexture", role: TEXTURE_ROLE.normal },
        { key: "emissiveTexture", role: TEXTURE_ROLE.base },
        {
            owner: "pbrMetallicRoughness",
            key: "metallicRoughnessTexture",
            role: TEXTURE_ROLE.strip,
        },
        { key: "occlusionTexture", role: TEXTURE_ROLE.strip },
    ];

type TextureRole = (typeof TEXTURE_ROLE)[keyof typeof TEXTURE_ROLE];

interface ITextureReference {
    index: number;
}

type TextureHolder = Partial<Record<string, ITextureReference>>;

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

interface IGltfJson {
    images?: { uri?: string }[];
    textures?: {
        source?: number;
        sampler?: number;
        extensions?: { KHR_texture_basisu?: { source?: number } };
    }[];
    materials?: IGltfMaterial[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
}

interface IImageDimensions {
    width: number;
    height: number;
}

export class TextureRoleMap {
    private static readonly ROLE_PRIORITY: Record<TextureRole, number> = {
        strip: 0,
        normal: 1,
        base: 2,
    };

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
        if (
            !existing ||
            TextureRoleMap.ROLE_PRIORITY[role] > TextureRoleMap.ROLE_PRIORITY[existing]
        )
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
    private static readonly BASISU_EXTENSION = "KHR_texture_basisu";

    readonly filePath: string;
    readonly json: IGltfJson;

    private constructor(filePath: string, json: IGltfJson) {
        this.filePath = filePath;
        this.json = json;
    }

    static read(filePath: string): GltfDocument {
        return new GltfDocument(filePath, readJsonFile<IGltfJson>(filePath));
    }

    get directory(): string {
        return path.dirname(this.filePath);
    }

    recordTextureRoles(roles: TextureRoleMap): void {
        const images = (this.json.images ?? []).map((image) => this.imagePath(image.uri));
        const imagePathForTexture = (index: number): string | undefined =>
            images[(this.json.textures ?? [])[index]?.source ?? -1];

        for (const material of this.json.materials ?? []) {
            for (const { reference, role } of textureSlotsOf(material))
                if (reference) roles.record(imagePathForTexture(reference.index), role);
        }
    }

    rewriteForKtx2(roles: TextureRoleMap): void {
        this.dropStrippedTextureSlots();
        const imageIndexMap = this.rebuildImages(roles);
        const textureIndexMap = this.rebuildTextures(imageIndexMap);
        this.remapMaterialTextures(textureIndexMap);
        if (imageIndexMap.size > 0) this.declareBasisuExtension();
    }

    writeTo(outputPath: string): void {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(this.json));
    }

    private imagePath(uri: string | undefined): string | undefined {
        return uri ? path.join(this.directory, decodeURIComponent(uri)) : undefined;
    }

    private dropStrippedTextureSlots(): void {
        for (const material of this.json.materials ?? [])
            for (const { holder, key, role } of textureSlotsOf(material))
                if (role === TEXTURE_ROLE.strip) delete holder?.[key];
    }

    private rebuildImages(roles: TextureRoleMap): Map<number, number> {
        const newIndexByOldIndex = new Map<number, number>();
        const images: { uri: string; mimeType: string }[] = [];
        for (const [index, image] of (this.json.images ?? []).entries()) {
            if (!image.uri) continue;
            const role = roles.roleOf(this.imagePath(image.uri)!);
            if (role !== TEXTURE_ROLE.base && role !== TEXTURE_ROLE.normal) continue;

            newIndexByOldIndex.set(index, images.length);
            images.push({
                uri: image.uri.replace(/\.(png|jpe?g)$/i, ".ktx2"),
                mimeType: "image/ktx2",
            });
        }
        if (images.length > 0) this.json.images = images;
        else delete this.json.images;
        return newIndexByOldIndex;
    }

    private rebuildTextures(imageIndexMap: Map<number, number>): Map<number, number> {
        const newIndexByOldIndex = new Map<number, number>();
        const textures: IBasisuTexture[] = [];
        for (const [index, texture] of (this.json.textures ?? []).entries()) {
            const source = imageIndexMap.get(texture.source ?? -1);
            if (source === undefined) continue;

            newIndexByOldIndex.set(index, textures.length);
            const basisuTexture: IBasisuTexture = {
                extensions: { KHR_texture_basisu: { source } },
            };
            if (texture.sampler !== undefined) basisuTexture.sampler = texture.sampler;
            textures.push(basisuTexture);
        }
        if (textures.length > 0) this.json.textures = textures;
        else delete this.json.textures;
        return newIndexByOldIndex;
    }

    private remapMaterialTextures(textureIndexMap: Map<number, number>): void {
        for (const material of this.json.materials ?? [])
            for (const { holder, key, role, reference } of textureSlotsOf(material)) {
                if (!holder || !reference || role === TEXTURE_ROLE.strip) continue;
                const index = textureIndexMap.get(reference.index);
                if (index === undefined) delete holder[key];
                else reference.index = index;
            }
    }

    private declareBasisuExtension(): void {
        const declare = (list: string[] | undefined): string[] => [
            ...new Set([...(list ?? []), GltfDocument.BASISU_EXTENSION]),
        ];
        this.json.extensionsUsed = declare(this.json.extensionsUsed);
        this.json.extensionsRequired = declare(this.json.extensionsRequired);
    }
}

class ImageFile {
    private static readonly IMAGE_HEAD_BYTES = 65536;

    private static readonly PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    static readHead(file: string, size: number): Buffer {
        const descriptor = fs.openSync(file, "r");
        try {
            const head = Buffer.alloc(size);
            const bytesRead = fs.readSync(descriptor, head, 0, size, 0);
            return head.subarray(0, bytesRead);
        } finally {
            fs.closeSync(descriptor);
        }
    }

    static readDimensions(file: string): IImageDimensions {
        const dimensions =
            ImageFile.scanDimensions(ImageFile.readHead(file, ImageFile.IMAGE_HEAD_BYTES)) ??
            ImageFile.scanDimensions(fs.readFileSync(file));
        if (!dimensions) throw new Error(`could not read image dimensions: ${file}`);
        return dimensions;
    }

    private static scanDimensions(buffer: Buffer): IImageDimensions | undefined {
        try {
            if (buffer.subarray(0, 8).equals(ImageFile.PNG_SIGNATURE))
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
}

export class TextureEncoder {
    private static readonly KTX2_IDENTIFIER = Buffer.from([
        0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    private static readonly BLOCK_SIZE = 4;

    private static readonly NORMAL_ENCODE_ARGS = [
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

    private static readonly BASE_ENCODE_ARGS = [
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

    private static readonly execFileAsync = promisify(execFile);

    static assertInstalled(): void {
        execFileSync("ktx", ["--version"], { stdio: "ignore" });
    }

    static isValidKtx2(file: string): boolean {
        try {
            return ImageFile.readHead(file, TextureEncoder.KTX2_IDENTIFIER.length).equals(
                TextureEncoder.KTX2_IDENTIFIER
            );
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

    static async encode(
        sourceFile: string,
        role: TextureRole,
        outputFile: string,
        maxTextureSize: number
    ): Promise<void> {
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        const { width, height } = TextureEncoder.fitDimensions(sourceFile, maxTextureSize);
        const args = [
            "create",
            "--generate-mipmap",
            "--width",
            String(width),
            "--height",
            String(height),
            ...(role === TEXTURE_ROLE.normal
                ? TextureEncoder.NORMAL_ENCODE_ARGS
                : TextureEncoder.BASE_ENCODE_ARGS),
        ];

        await TextureEncoder.execFileAsync("ktx", [...args, sourceFile, outputFile]);
        if (!TextureEncoder.isValidKtx2(outputFile))
            throw new Error(`ktx produced an invalid file: ${outputFile}`);
    }

    private static fitDimensions(file: string, maxTextureSize: number): IImageDimensions {
        const { width, height } = ImageFile.readDimensions(file);
        const scale = Math.min(1, maxTextureSize / Math.max(width, height));
        const snapToBlockMultiple = (value: number): number =>
            Math.max(
                TextureEncoder.BLOCK_SIZE,
                Math.floor((value * scale) / TextureEncoder.BLOCK_SIZE) * TextureEncoder.BLOCK_SIZE
            );
        return { width: snapToBlockMultiple(width), height: snapToBlockMultiple(height) };
    }
}

export const createGltfIo = async (
    extensions: Parameters<NodeIO["registerExtensions"]>[0],
    withEncoder = false
): Promise<NodeIO> => {
    await Promise.all([MeshoptDecoder.ready, withEncoder && MeshoptEncoder.ready]);
    return new NodeIO().registerExtensions(extensions).registerDependencies({
        "meshopt.decoder": MeshoptDecoder,
        ...(withEncoder && { "meshopt.encoder": MeshoptEncoder }),
    });
};

export const accessorElements = (accessor: Accessor): number[][] =>
    Array.from({ length: accessor.getCount() }, (_, index) => accessor.getElement(index, []));

export const textureSlotsOf = (material: IGltfMaterial) =>
    TEXTURE_SLOTS.map(({ owner, key, role }) => {
        const holder = (owner ? material[owner] : material) as TextureHolder | undefined;
        return { holder, key, role, reference: holder?.[key] };
    });
