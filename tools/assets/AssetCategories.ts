import fs from "node:fs";
import path from "node:path";
import { NodeIO, type Document } from "@gltf-transform/core";
import { KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { Blender, PIPELINE_CONFIG, PipelineCommand, formatMegabytes } from "../pipeline";

export interface IAssetCategoryOptions {
    name: string;
    budgetMegabytes: number;
    compressesGeometry?: boolean;
    fileBudgetsMegabytes?: Readonly<Record<string, number>>;
}

export abstract class AssetCategory {
    readonly name: string;
    readonly budgetMegabytes: number;
    readonly compressesGeometry: boolean;
    private readonly fileBudgetsMegabytes: Readonly<Record<string, number>>;

    constructor(options: IAssetCategoryOptions) {
        this.name = options.name;
        this.budgetMegabytes = options.budgetMegabytes;
        this.compressesGeometry = options.compressesGeometry ?? true;
        this.fileBudgetsMegabytes = options.fileBudgetsMegabytes ?? {};
    }

    get sourceDirectory(): string {
        return path.join(PIPELINE_CONFIG.sourceRoot, this.name);
    }

    get budgetedFiles(): [string, number][] {
        return Object.entries(this.fileBudgetsMegabytes);
    }

    get importUsage(): string | undefined {
        return undefined;
    }

    budgetForFile(relativePath: string): number | undefined {
        return this.fileBudgetsMegabytes[relativePath];
    }

    importSource(_args: readonly string[]): Promise<void> {
        throw new Error(
            `${this.name} has no importer: drop glTF-ready files into ${this.sourceDirectory}`
        );
    }

    protected usageError(): Error {
        return new Error(`usage: npm run import:asset -- ${this.name} ${this.importUsage}`);
    }
}

export class EnvironmentCategory extends AssetCategory {}

export class CharacterCategory extends AssetCategory {
    override get importUsage(): string {
        return "<staging-directory with one <Name>.glb per creature>";
    }

    override async importSource(args: readonly string[]): Promise<void> {
        const [stagingDirectory] = args;
        if (!stagingDirectory) throw this.usageError();

        const staging = path.resolve(stagingDirectory);
        const sourceRoot = path.resolve(PIPELINE_CONFIG.sourceRoot);
        if (staging === sourceRoot || staging.startsWith(sourceRoot + path.sep))
            throw new Error(
                `staging directory ${staging} is inside ${sourceRoot}; ` +
                    `importing there would convert the committed character files`
            );

        const creatureFiles = fs
            .readdirSync(staging)
            .filter((file) => file.endsWith(".glb"))
            .sort();
        if (creatureFiles.length === 0) throw new Error(`no .glb files in ${staging}`);

        fs.mkdirSync(this.sourceDirectory, { recursive: true });
        const io = new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]);
        for (const file of creatureFiles) await this.importCreature(io, path.join(staging, file));
        this.reportSourceSizes();
    }

    private async importCreature(io: NodeIO, sourceFile: string): Promise<void> {
        const name = path.basename(sourceFile, ".glb");
        const document = await io.read(sourceFile);
        this.stripUnshadedTextures(document);
        await document.transform(prune());
        this.assignTextureUris(document, name);

        const root = document.getRoot();
        const keptTextures = root.listTextures().map((texture) => texture.getName() || "unnamed");
        await io.write(path.join(this.sourceDirectory, `${name}.gltf`), document);

        console.log(
            `${name}: ${formatMegabytes(fs.statSync(sourceFile).size)} MB source, ` +
                `${root.listSkins().length} skin(s), ${keptTextures.length} texture(s) kept -> ` +
                keptTextures.join(", ")
        );
    }

    private stripUnshadedTextures(document: Document): void {
        for (const material of document.getRoot().listMaterials()) {
            material.setMetallicRoughnessTexture(null);
            material.setOcclusionTexture(null);
            material.setEmissiveTexture(null);
            material.setEmissiveFactor([0, 0, 0]);
        }
    }

    private assignTextureUris(document: Document, name: string): void {
        for (const material of document.getRoot().listMaterials()) {
            material.getBaseColorTexture()?.setURI(`${name}_baseColor.png`);
            material.getNormalTexture()?.setURI(`${name}_normal.png`);
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

export class WeaponCategory extends AssetCategory {
    override get importUsage(): string {
        return "<pack.blend|pack.fbx> [objectName=OutputName ...] (no renames: list meshes)";
    }

    override async importSource(args: readonly string[]): Promise<void> {
        const [packFile, ...renames] = args;
        if (!packFile) throw this.usageError();
        if (!fs.existsSync(packFile)) throw new Error(`weapon pack not found: ${packFile}`);

        fs.mkdirSync(this.sourceDirectory, { recursive: true });
        new Blender().runScript(
            PIPELINE_CONFIG.blender.script,
            [
                "split-weapons",
                path.resolve(packFile),
                path.resolve(this.sourceDirectory),
                ...renames,
            ],
            ["MESH", "EXPORTED"]
        );
    }
}

export class AssetCatalogue {
    private readonly categoriesByName: ReadonlyMap<string, AssetCategory>;

    constructor(categories: readonly AssetCategory[]) {
        const categoriesByName = new Map<string, AssetCategory>();
        for (const category of categories) {
            if (categoriesByName.has(category.name))
                throw new Error(`asset category ${category.name} is registered twice`);
            categoriesByName.set(category.name, category);
        }
        this.categoriesByName = categoriesByName;
    }

    get categories(): AssetCategory[] {
        return [...this.categoriesByName.values()];
    }

    find(name: string): AssetCategory | undefined {
        return this.categoriesByName.get(name);
    }

    get(name: string): AssetCategory {
        const category = this.find(name);
        if (!category)
            throw new Error(
                `no asset category "${name}"; register it in tools/assets/AssetCategories.ts ` +
                    `(known: ${[...this.categoriesByName.keys()].join(", ")})`
            );
        return category;
    }

    ownerOfSourceFile(sourceFile: string): AssetCategory {
        return this.get(path.relative(PIPELINE_CONFIG.sourceRoot, sourceFile).split(path.sep)[0]);
    }
}

export const ASSET_CATALOGUE = new AssetCatalogue([
    new CharacterCategory({
        name: "characters",
        budgetMegabytes: 24,
        compressesGeometry: false,
        fileBudgetsMegabytes: { "CombatClips.glb": 6 },
    }),
    new WeaponCategory({ name: "weapons", budgetMegabytes: 4 }),
    new EnvironmentCategory({ name: "woodland", budgetMegabytes: 10 }),
    new EnvironmentCategory({ name: "medieval-village", budgetMegabytes: 8 }),
    new EnvironmentCategory({ name: "highlands", budgetMegabytes: 6 }),
    new EnvironmentCategory({ name: "architecture", budgetMegabytes: 4 }),
]);

export class SourceImporter extends PipelineCommand {
    readonly name = "import";
    readonly usage = "<category> [category arguments]";
    readonly summary = "Convert a raw download into glTF-ready source under assets-src/models";

    async run(args: readonly string[]): Promise<void> {
        const [categoryName, ...categoryArgs] = args;
        if (!categoryName) {
            console.log("importable categories:");
            for (const category of ASSET_CATALOGUE.categories)
                if (category.importUsage) console.log(`  ${category.name} ${category.importUsage}`);
            throw new Error("import needs a category");
        }

        await ASSET_CATALOGUE.get(categoryName).importSource(categoryArgs);
        console.log("\nnext: npm run cook && npm run verify:assets");
    }
}
