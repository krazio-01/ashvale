import fs from "node:fs";
import path from "node:path";
import type { Document, Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { SCALE } from "@/constants/world";
import { PIPELINE_CONFIG, formatMegabytes, isWithin } from "../pipeline";
import { TEXTURE_SLOTS, createGltfIo } from "./AssetFormats";
import { ASSET_KINDS, type AssetKind } from "./AssetManifest";

interface IFarVersion {
    ratio: number;
    errorMetres: number;
    minimumHeightMetres: number;
}

export interface IAssetCategoryOptions {
    name: string;
    budgetMegabytes: number;
    budgetPerTheme?: boolean;
    triangleBudget?: number;
    farVersion?: IFarVersion;
    compressesGeometry?: boolean;
    fileBudgetsMegabytes?: Readonly<Record<string, number>>;
    kind?: AssetKind;
    unitScale?: number;
    keepSourceTextures?: boolean;
    importsStagingFolders?: boolean;
}

export class AssetCategory {
    private static readonly TEXTURE_EXTENSIONS = new Map([
        ["image/png", "png"],
        ["image/jpeg", "jpg"],
    ]);

    private static readonly STRIPPED_TEXTURE_SLOTS = TEXTURE_SLOTS.filter(
        (slot) => !slot.keptOnImport
    );

    readonly name: string;
    readonly budgetMegabytes: number;
    readonly budgetPerTheme: boolean;
    readonly triangleBudget: number | null;
    readonly farVersion: IFarVersion | null;
    readonly compressesGeometry: boolean;
    readonly kind: AssetKind | null;
    readonly unitScale: number;
    private readonly fileBudgetsMegabytes: Readonly<Record<string, number>>;
    private readonly keepSourceTextures: boolean;
    private readonly importsStagingFolders: boolean;

    constructor(options: IAssetCategoryOptions) {
        this.name = options.name;
        this.budgetMegabytes = options.budgetMegabytes;
        this.budgetPerTheme = options.budgetPerTheme ?? false;
        this.triangleBudget = options.triangleBudget ?? null;
        this.farVersion = options.farVersion ?? null;
        this.compressesGeometry = options.compressesGeometry ?? true;
        this.fileBudgetsMegabytes = options.fileBudgetsMegabytes ?? {};
        this.kind = options.kind ?? null;
        this.unitScale = options.unitScale ?? 1;
        this.keepSourceTextures = options.keepSourceTextures ?? false;
        this.importsStagingFolders = options.importsStagingFolders ?? false;
    }

    get metresPerUnit(): number {
        return this.unitScale / SCALE.unitsPerMetre;
    }

    get sourceDirectory(): string {
        return path.join(PIPELINE_CONFIG.sourceRoot, this.name);
    }

    get budgetedFiles(): [string, number][] {
        return Object.entries(this.fileBudgetsMegabytes);
    }

    get importUsage(): string | undefined {
        if (!this.kind) return undefined;
        const recipeUsage = `<${this.kind} name from tools/assets/AssetManifest.ts> [--from <stage>] [--until <stage>]`;
        return this.importsStagingFolders
            ? `${recipeUsage} | <staging-directory with one <Name>.glb per creature>`
            : recipeUsage;
    }

    budgetForFile(relativePath: string): number | undefined {
        return this.fileBudgetsMegabytes[relativePath];
    }

    triangleBudgetFor(relativePath: string): number {
        const owner = this.kind && ASSET_KINDS[this.kind].find(path.parse(relativePath).name);
        const budget = owner ? owner.triangles : this.triangleBudget;
        if (budget === null)
            throw new Error(
                `${relativePath}: no recipe owns it and ${this.name} declares no triangle budget`
            );
        return budget;
    }

    moduleNamesFor(name: string): readonly string[] {
        return this.kind ? ASSET_KINDS[this.kind].moduleNamesOf(name) : [];
    }

    maxTextureSizeFor(relativePath: string): number {
        const owner =
            this.kind && ASSET_KINDS[this.kind].findOwningFile(path.basename(relativePath));
        return owner ? owner.textureSize : PIPELINE_CONFIG.maxTextureSize;
    }

    async importSource(args: readonly string[]): Promise<void> {
        const kind = this.kind;
        if (!kind)
            throw new Error(
                `${this.name} has no importer: drop glTF-ready files into ${this.sourceDirectory}`
            );
        const [target] = args;
        if (
            this.importsStagingFolders &&
            target &&
            !ASSET_KINDS[kind].find(target) &&
            fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()
        )
            return this.importBuiltGlbs(target);
        await this.importRecipe(kind, args);
    }

    private async importBuiltGlbs(stagingDirectory: string): Promise<void> {
        const staging = path.resolve(stagingDirectory);
        const sourceRoot = path.resolve(PIPELINE_CONFIG.sourceRoot);
        if (isWithin(sourceRoot, staging))
            throw new Error(
                `staging directory ${staging} is inside ${sourceRoot}; ` +
                    `importing there would convert the committed ${this.name} files`
            );

        const glbFiles = fs
            .readdirSync(staging)
            .filter((file) => file.endsWith(".glb"))
            .sort();
        if (glbFiles.length === 0) throw new Error(`no .glb files in ${staging}`);

        fs.mkdirSync(this.sourceDirectory, { recursive: true });
        const io = await createGltfIo(ALL_EXTENSIONS);
        for (const file of glbFiles) {
            const name = path.basename(file, ".glb");
            const sourceFile = path.join(staging, file);
            const document = await io.read(sourceFile);
            if (!this.keepSourceTextures) this.stripNonColourTextures(document);
            await document.transform(prune());
            this.assignTextureUris(document, name);

            const root = document.getRoot();
            const keptTextures = root.listTextures().map((texture) => texture.getURI());
            await io.write(path.join(this.sourceDirectory, `${name}.gltf`), document);
            console.log(
                `${name}: ${formatMegabytes(fs.statSync(sourceFile).size)} MB source, ` +
                    `${root.listSkins().length} skin(s), ${keptTextures.length} texture(s) kept -> ` +
                    keptTextures.join(", ")
            );
        }
        this.reportSourceSizes();
    }

    private usageError(): Error {
        return new Error(`usage: npm run import:asset -- ${this.name} ${this.importUsage}`);
    }

    private async importRecipe<TKind extends AssetKind>(
        kind: TKind,
        args: readonly string[]
    ): Promise<void> {
        const [name, ...flags] = args;
        if (!name) throw this.usageError();
        const definition = ASSET_KINDS[kind];
        const recipe = definition.find(name);
        if (!recipe)
            throw new Error(
                `no ${kind} recipe ${name} in tools/assets/AssetManifest.ts ` +
                    `(known: ${definition
                        .recipes()
                        .map((candidate) => candidate.name)
                        .join(", ")})`
            );
        await definition.prepare(recipe);
        definition.assertReady(recipe);
        const pipeline = definition.pipeline;
        const build = pipeline.createBuild(recipe);
        if (await pipeline.run(build, flags)) await this.importBuiltGlbs(build.file("out"));
    }

    private stripNonColourTextures(document: Document): void {
        for (const material of document.getRoot().listMaterials())
            for (const slot of AssetCategory.STRIPPED_TEXTURE_SLOTS) slot.clear(material);
    }

    private assignTextureUris(document: Document, name: string): void {
        const stems = new Set<string>();
        const namedTextures = new Set<Texture>();
        const prefix = `${name}_`;
        for (const material of document.getRoot().listMaterials())
            for (const { fileRole: role, textureOf } of TEXTURE_SLOTS) {
                const texture = textureOf(material);
                if (!texture || namedTextures.has(texture)) continue;
                const ownName = texture.getName();
                const stem = ownName.startsWith(prefix) ? ownName : `${prefix}${role}`;
                if (stems.has(stem))
                    throw new Error(
                        `${name}: more than one ${role} texture, cannot name them by role`
                    );
                const mimeType = texture.getMimeType();
                const extension = AssetCategory.TEXTURE_EXTENSIONS.get(mimeType);
                if (!extension)
                    throw new Error(`${name}: ${role} texture has unsupported type ${mimeType}`);
                texture.setURI(`${stem}.${extension}`);
                stems.add(stem);
                namedTextures.add(texture);
            }
    }

    private reportSourceSizes(): void {
        console.log(`\nwritten to ${this.sourceDirectory}`);
        let total = 0;
        for (const file of fs.readdirSync(this.sourceDirectory).sort()) {
            const bytes = fs.statSync(path.join(this.sourceDirectory, file)).size;
            total += bytes;
            console.log(`  ${file}: ${formatMegabytes(bytes)} MB`);
        }
        console.log(`  total: ${formatMegabytes(total)} MB`);
    }
}

export const assetCategory = (name: string): AssetCategory => {
    const category = CATEGORIES_BY_NAME.get(name);
    if (!category)
        throw new Error(
            `no asset category "${name}"; register it in tools/assets/AssetCategories.ts ` +
                `(known: ${[...CATEGORIES_BY_NAME.keys()].join(", ")})`
        );
    return category;
};

const kindCategory = (kind: AssetKind): AssetCategory =>
    new AssetCategory({ ...ASSET_KINDS[kind].category, kind });

export const ASSET_CATEGORIES: readonly AssetCategory[] = [
    kindCategory("character"),
    kindCategory("weapon"),
    new AssetCategory({
        name: "woodland",
        budgetMegabytes: 10,
        triangleBudget: 11_000,
        farVersion: PIPELINE_CONFIG.farVersion,
    }),
    new AssetCategory({
        name: "medieval-village",
        budgetMegabytes: 8,
        triangleBudget: 5_000,
        unitScale: SCALE.unitsPerMetre,
    }),
    new AssetCategory({
        name: "highlands",
        budgetMegabytes: 6,
        triangleBudget: 6_000,
        farVersion: PIPELINE_CONFIG.farVersion,
    }),
    kindCategory("sculpt"),
    kindCategory("scan"),
    kindCategory("kit"),
    new AssetCategory({
        name: "architecture",
        budgetMegabytes: 4,
        triangleBudget: 5_000,
        unitScale: SCALE.unitsPerMetre,
    }),
];

const CATEGORIES_BY_NAME = new Map(ASSET_CATEGORIES.map((category) => [category.name, category]));
