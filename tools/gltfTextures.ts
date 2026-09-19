import fs from "node:fs";
import path from "node:path";

export const TEXTURE_ROLE = { base: "base", normal: "normal", strip: "strip" } as const;

export type TextureRole = (typeof TEXTURE_ROLE)[keyof typeof TEXTURE_ROLE];

export const ROLE_PRIORITY: Record<TextureRole, number> = { strip: 0, normal: 1, base: 2 };

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

export interface IGltfDocument {
    images?: { uri?: string; mimeType?: string; extensions?: unknown }[];
    textures?: { source?: number; sampler?: number; extensions?: unknown }[];
    materials?: IGltfMaterial[];
    buffers?: { uri?: string }[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
}

export function readGltfJson(gltfPath: string): IGltfDocument {
    return JSON.parse(fs.readFileSync(gltfPath, "utf8")) as IGltfDocument;
}

export function resolveTextureRoles(gltfPaths: string[]): Map<string, TextureRole> {
    const rolesByTextureFile = new Map<string, TextureRole>();

    const recordRole = (file: string | undefined, role: TextureRole): void => {
        if (!file) return;
        const existing = rolesByTextureFile.get(file);
        if (!existing || ROLE_PRIORITY[role] > ROLE_PRIORITY[existing])
            rolesByTextureFile.set(file, role);
    };

    for (const gltfPath of gltfPaths) {
        const directory = path.dirname(gltfPath);
        const document = readGltfJson(gltfPath);
        const images = (document.images ?? []).map((image) =>
            image.uri ? path.join(directory, decodeURIComponent(image.uri)) : undefined
        );
        const imagePathForTexture = (index: number): string | undefined =>
            images[(document.textures ?? [])[index]?.source ?? -1];

        for (const material of document.materials ?? []) {
            const pbr = material.pbrMetallicRoughness ?? {};
            if (pbr.baseColorTexture)
                recordRole(imagePathForTexture(pbr.baseColorTexture.index), TEXTURE_ROLE.base);
            if (material.emissiveTexture)
                recordRole(imagePathForTexture(material.emissiveTexture.index), TEXTURE_ROLE.base);
            if (material.normalTexture)
                recordRole(imagePathForTexture(material.normalTexture.index), TEXTURE_ROLE.normal);
            if (pbr.metallicRoughnessTexture)
                recordRole(
                    imagePathForTexture(pbr.metallicRoughnessTexture.index),
                    TEXTURE_ROLE.strip
                );
            if (material.occlusionTexture)
                recordRole(
                    imagePathForTexture(material.occlusionTexture.index),
                    TEXTURE_ROLE.strip
                );
        }
    }

    return rolesByTextureFile;
}

export function rewriteGltfForKtx2(
    document: IGltfDocument,
    directory: string,
    rolesByTextureFile: Map<string, TextureRole>
): IGltfDocument {
    for (const material of document.materials ?? []) {
        delete material.occlusionTexture;
        if (material.pbrMetallicRoughness)
            delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }

    const newImageIndexByOldIndex = new Map<number, number>();
    const newImages: { uri: string; mimeType: string }[] = [];

    for (const [index, image] of (document.images ?? []).entries()) {
        if (!image.uri) continue;
        const role = rolesByTextureFile.get(path.join(directory, decodeURIComponent(image.uri)));
        if (role !== TEXTURE_ROLE.base && role !== TEXTURE_ROLE.normal) continue;

        newImageIndexByOldIndex.set(index, newImages.length);
        newImages.push({
            uri: image.uri.replace(/\.(png|jpe?g)$/i, ".ktx2"),
            mimeType: "image/ktx2",
        });
    }

    const newTextureIndexByOldIndex = new Map<number, number>();
    const newTextures: {
        sampler?: number;
        extensions: { KHR_texture_basisu: { source: number } };
    }[] = [];

    for (const [index, texture] of (document.textures ?? []).entries()) {
        const source = newImageIndexByOldIndex.get(texture.source ?? -1);
        if (source === undefined) continue;

        newTextureIndexByOldIndex.set(index, newTextures.length);
        const basisuTexture: {
            sampler?: number;
            extensions: { KHR_texture_basisu: { source: number } };
        } = {
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
        remapTextureReference(material as unknown as Record<string, unknown>, "emissiveTexture");
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

    return document;
}
