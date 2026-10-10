import fs from "node:fs";
import path from "node:path";
import { getBounds } from "@gltf-transform/core";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import {
    FileTree,
    PIPELINE_CONFIG,
    PipelineCommand,
    assertExists,
    describeError,
    formatMegabytes,
    isWithin,
    toMegabytes,
} from "../pipeline";
import { ASSET_CATALOGUE } from "./AssetCategories";
import { Findings } from "./AssetValidation";
import {
    COOKED_EXTENSIONS,
    GltfDocument,
    TextureEncoder,
    TEXTURE_ROLE,
    TextureRoleMap,
    createGltfIo,
    textureSlotsOf,
} from "./AssetFormats";

export class AssetCooker extends PipelineCommand {
    readonly name = "cook";
    readonly usage = "";
    readonly summary =
        "Encode textures to KTX2, rewrite glTF and meshopt geometry into public/models";

    async run(): Promise<void> {
        const { sourceRoot, outputRoot } = PIPELINE_CONFIG;
        const source = this.scanSource(sourceRoot, outputRoot);

        const documents = source.withExtensions(".gltf").map((file) => GltfDocument.read(file));
        const roles = TextureRoleMap.collect(documents);
        console.log(`source: ${sourceRoot} -> ${outputRoot}`);
        console.log(`${documents.length} gltf, ${roles.size} referenced textures`);

        TextureEncoder.assertInstalled();
        fs.rmSync(outputRoot, { recursive: true, force: true });
        fs.mkdirSync(outputRoot, { recursive: true });

        await this.encodeTextures(roles, source);
        this.rewriteDocuments(documents, roles, source);
        this.copyPassthroughFiles(source);
        await this.compressGeometry();
        this.report(source);
    }

    private scanSource(sourceRoot: string, outputRoot: string): FileTree {
        assertExists(sourceRoot, `source not found: ${sourceRoot}`);

        const sourcePath = path.resolve(sourceRoot);
        const outputPath = path.resolve(outputRoot);
        if (isWithin(outputPath, sourcePath))
            throw new Error(`output would delete the source: ${outputPath} contains ${sourcePath}`);

        const source = FileTree.scan(sourceRoot);
        if (source.files.length === 0) throw new Error(`source is empty: ${sourceRoot}`);
        const strayFile = source.files.find(
            (file) => !source.relativePath(file).includes(path.sep)
        );
        if (strayFile)
            throw new Error(
                `stray file ${strayFile}: sources must sit inside a category folder, delete or move it`
            );
        for (const folder of new Set(source.files.map((file) => source.topFolderOf(file))))
            ASSET_CATALOGUE.get(folder);
        return source;
    }

    private async encodeTextures(roles: TextureRoleMap, source: FileTree): Promise<void> {
        const texturesToEncode = roles.encodable();
        console.log(
            `encoding ${texturesToEncode.length}, stripping ${roles.size - texturesToEncode.length} unusable`
        );

        let encoded = 0;
        await this.forEachConcurrently(texturesToEncode, async ([sourceFile, role]) => {
            const outputFile = source
                .mirrorPath(sourceFile, PIPELINE_CONFIG.outputRoot)
                .replace(/\.(png|jpe?g)$/i, ".ktx2");
            await TextureEncoder.encode(
                sourceFile,
                role,
                outputFile,
                ASSET_CATALOGUE.ownerOfSourceFile(sourceFile).maxTextureSizeFor(
                    source.relativePath(sourceFile)
                )
            );

            encoded += 1;
            if (encoded % 10 === 0) console.log(`  encoded ${encoded}/${texturesToEncode.length}`);
        });
    }

    private rewriteDocuments(
        documents: readonly GltfDocument[],
        roles: TextureRoleMap,
        source: FileTree
    ): void {
        for (const document of documents) {
            document.rewriteForKtx2(roles);
            document.writeTo(source.mirrorPath(document.filePath, PIPELINE_CONFIG.outputRoot));
        }
        console.log(`rewrote ${documents.length} gltf`);
    }

    private copyPassthroughFiles(source: FileTree): void {
        for (const file of source.withExtensions(".bin", ".glb")) {
            const destinationPath = source.mirrorPath(file, PIPELINE_CONFIG.outputRoot);
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            fs.copyFileSync(file, destinationPath);
        }
    }

    private async compressGeometry(): Promise<void> {
        const io = await createGltfIo(COOKED_EXTENSIONS, true);

        const output = FileTree.scan(PIPELINE_CONFIG.outputRoot);
        const compressible = output
            .withExtensions(".gltf")
            .filter((file) => ASSET_CATALOGUE.get(output.topFolderOf(file)).compressesGeometry);

        await this.forEachConcurrently(compressible, async (gltfPath) => {
            const document = await io.read(gltfPath);
            await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
            await io.write(gltfPath, document);
        });
        console.log("meshopt complete");
    }

    private report(source: FileTree): void {
        const bytesByCategory = FileTree.scan(PIPELINE_CONFIG.outputRoot).bytesByTopFolder();

        console.log("");
        for (const [name, bytes] of [...bytesByCategory].sort()) {
            const budget = ASSET_CATALOGUE.get(name).budgetMegabytes;
            const over = toMegabytes(bytes) > budget ? " OVER BUDGET" : "";
            console.log(`  ${name}: ${formatMegabytes(bytes)} MB / ${budget} MB${over}`);
        }

        const cookedTotal = [...bytesByCategory.values()].reduce(
            (total, bytes) => total + bytes,
            0
        );
        console.log(
            `\nsource ${formatMegabytes(source.totalBytes())} MB -> cooked ${formatMegabytes(cookedTotal)} MB`
        );
    }

    private async forEachConcurrently<Item>(
        items: readonly Item[],
        task: (item: Item) => Promise<void>
    ): Promise<void> {
        let nextIndex = 0;
        const worker = async (): Promise<void> => {
            while (nextIndex < items.length) await task(items[nextIndex++]);
        };
        await Promise.all(
            Array.from(
                { length: Math.min(PIPELINE_CONFIG.encodeConcurrency, items.length) },
                worker
            )
        );
    }
}

export class TranscoderInstaller extends PipelineCommand {
    readonly name = "sync-transcoder";
    readonly usage = "";
    readonly summary = "Copy the basis transcoder from the installed three into public/vendor";

    async run(): Promise<void> {
        const { sourceRoot, outputRoot, files } = PIPELINE_CONFIG.transcoder;
        fs.mkdirSync(outputRoot, { recursive: true });

        for (const file of files) {
            const sourcePath = path.join(sourceRoot, file);
            assertExists(
                sourcePath,
                `basis transcoder missing at ${sourcePath} — is three installed? ` +
                    `KTX2 textures cannot decode without it.`
            );
            fs.copyFileSync(sourcePath, path.join(outputRoot, file));
        }

        console.log(`synced ${files.length} transcoder files to ${outputRoot}`);
    }
}

export class AssetVerifier extends PipelineCommand {
    readonly name = "verify";
    readonly usage = "";
    readonly summary = "Check cooked output: bindings, budgets, normal encoding, geometry drift";

    private failures = new Findings();

    async run(): Promise<void> {
        this.failures = new Findings();
        const output = FileTree.scan(PIPELINE_CONFIG.outputRoot);

        this.checkTextureBindings(output);
        this.checkCategoryBudgets(output);
        this.checkFileBudgets();
        this.checkNormalMapEncoding(output);
        await this.checkGeometryDrift(output);
        this.checkTranscoderFiles();

        console.log("");
        if (this.failures.length > 0) {
            console.error(`${this.failures.length} check(s) failed:`);
            for (const failure of this.failures) console.error(`  - ${failure}`);
            throw new Error("asset verification failed");
        }
        console.log("all checks passed");
    }

    private checkTextureBindings(output: FileTree): void {
        const gltfPaths = output.withExtensions(".gltf");
        for (const gltfPath of gltfPaths) {
            const { json, directory } = GltfDocument.read(gltfPath);
            const images = json.images ?? [];
            const textures = json.textures ?? [];

            for (const [textureIndex, texture] of textures.entries()) {
                const source = (
                    texture.extensions as { KHR_texture_basisu?: { source?: number } } | undefined
                )?.KHR_texture_basisu?.source;
                const image = source === undefined ? undefined : images[source];
                const ktx2Path = image?.uri && path.join(directory, decodeURIComponent(image.uri));

                if (source === undefined)
                    this.failures.push(
                        `${gltfPath}: texture ${textureIndex} has no KHR_texture_basisu source`
                    );
                else if (!image)
                    this.failures.push(
                        `${gltfPath}: texture references missing image index ${source}`
                    );
                else if (!ktx2Path)
                    this.failures.push(`${gltfPath}: image index ${source} has no uri`);
                else if (!fs.existsSync(ktx2Path))
                    this.failures.push(
                        `${gltfPath}: missing ktx2 ${output.relativePath(ktx2Path)}`
                    );
                else if (!TextureEncoder.isValidKtx2(ktx2Path))
                    this.failures.push(
                        `${gltfPath}: corrupt ktx2 ${output.relativePath(ktx2Path)}`
                    );
            }

            for (const material of json.materials ?? []) {
                for (const { reference, role } of textureSlotsOf(material))
                    if (
                        reference &&
                        role !== TEXTURE_ROLE.strip &&
                        (reference.index < 0 || reference.index >= textures.length)
                    )
                        this.failures.push(
                            `${gltfPath}: material references out-of-range texture index ${reference.index}`
                        );
            }
        }
        console.log(`texture bindings: checked ${gltfPaths.length} gltf`);
    }

    private checkCategoryBudgets(output: FileTree): void {
        const bytesByCategory = output.bytesByTopFolder();

        for (const [name, bytes] of [...bytesByCategory].sort()) {
            const category = ASSET_CATALOGUE.find(name);
            if (!category) {
                console.log(`  category ${name}: UNREGISTERED`);
                this.failures.push(
                    `category ${name}: cooked folder has no entry in tools/assets/AssetCategories.ts`
                );
                continue;
            }
            this.checkBudget(`category ${name}`, toMegabytes(bytes), category.budgetMegabytes);
        }

        for (const category of ASSET_CATALOGUE.categories) {
            if (bytesByCategory.has(category.name)) continue;
            console.log(`  category ${category.name}: MISSING`);
            this.failures.push(`category ${category.name}: missing from cooked output`);
        }
    }

    private checkFileBudgets(): void {
        for (const category of ASSET_CATALOGUE.categories)
            for (const [relativePath, budget] of category.budgetedFiles) {
                const cookedFile = path.join(
                    PIPELINE_CONFIG.outputRoot,
                    category.name,
                    relativePath
                );
                if (!fs.existsSync(cookedFile)) {
                    this.failures.push(
                        `file ${cookedFile}: budgeted but missing from cooked output`
                    );
                    continue;
                }
                this.checkBudget(
                    `file ${cookedFile}`,
                    toMegabytes(fs.statSync(cookedFile).size),
                    budget
                );
            }
    }

    private checkBudget(label: string, megabytes: number, budget: number): void {
        const isWithinBudget = megabytes <= budget;
        console.log(
            `  ${label}: ${megabytes.toFixed(1)} / ${budget} MB (${isWithinBudget ? "ok" : "OVER BUDGET"})`
        );
        this.failures.failIf(
            !isWithinBudget,
            `${label}: ${megabytes.toFixed(1)} MB exceeds ${budget} MB budget`
        );
    }

    private checkNormalMapEncoding(output: FileTree): void {
        const normalMaps = output.files.filter((file) => /_normal\.ktx2$/i.test(file));
        for (const file of normalMaps) {
            try {
                const channelType = TextureEncoder.readChannelType(file);
                if (!channelType?.includes("UASTC_RGB"))
                    this.failures.push(
                        `${file}: normal map not UASTC_RGB (${channelType ?? "no Channel Type reported"})`
                    );
            } catch (error) {
                this.failures.push(`${file}: ktx info failed (${describeError(error)})`);
            }
        }
        console.log(`normal map encoding: checked ${normalMaps.length} files`);
    }

    private async checkGeometryDrift(output: FileTree): Promise<void> {
        const { sourceRoot, geometryDriftTolerance } = PIPELINE_CONFIG;
        if (!fs.existsSync(sourceRoot)) {
            console.log("geometry drift: skipped (source root missing)");
            return;
        }

        const io = await createGltfIo(COOKED_EXTENSIONS);

        let compared = 0;
        for (const cookedPath of output.withExtensions(".gltf", ".glb")) {
            const relativePath = output.relativePath(cookedPath);
            const sourcePath = path.join(sourceRoot, relativePath);
            if (!fs.existsSync(sourcePath)) continue;

            try {
                const [sourceDocument, cookedDocument] = await Promise.all([
                    io.read(sourcePath),
                    io.read(cookedPath),
                ]);
                const sourceScene = sourceDocument.getRoot().listScenes()[0];
                const cookedScene = cookedDocument.getRoot().listScenes()[0];
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
                if (drift > geometryDriftTolerance)
                    this.failures.push(
                        `${relativePath}: bounding box drift ${drift.toFixed(5)} exceeds tolerance`
                    );
                compared += 1;
            } catch (error) {
                this.failures.push(
                    `${relativePath}: failed to parse for drift check (${describeError(error)})`
                );
            }
        }

        if (compared === 0)
            console.log("geometry drift: skipped (no matching source models found)");
        else console.log(`geometry drift: compared ${compared} models`);
    }

    private checkTranscoderFiles(): void {
        const { outputRoot, files } = PIPELINE_CONFIG.transcoder;
        for (const file of files) {
            const transcoderPath = path.join(outputRoot, file);
            if (!fs.existsSync(transcoderPath))
                this.failures.push(`transcoder file missing: ${transcoderPath}`);
        }
        console.log(`transcoder files: checked ${files.length}`);
    }
}
