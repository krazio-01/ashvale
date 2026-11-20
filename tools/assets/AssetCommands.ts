import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    type Document,
    FileUtils,
    Format,
    type JSONDocument,
    type Node as GltfNode,
    type NodeIO,
    getBounds,
} from "@gltf-transform/core";
import { cloneDocument, compactPrimitive, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { format, resolveConfig } from "prettier";
import {
    FileTree,
    PIPELINE_CONFIG,
    PipelineCommand,
    assertExists,
    copyFileWithFolders,
    describeError,
    execFileAsync,
    fetchTextureSource,
    formatMegabytes,
    MILLIMETRES_PER_METRE,
    isWithin,
    readJsonFile,
    runWithConcurrency,
    textureFile,
    textureInfoFile,
    toMegabytes,
} from "../pipeline";
import { GROUND_SURFACE, GROUND_SURFACES, MODEL_MODULE_SEPARATOR } from "@/constants/world";
import { ASSET_CATEGORIES, assetCategory, type AssetCategory } from "./AssetCategories";
import { ASSET_KINDS, type AssetKind, type RecipeOf } from "./AssetManifest";
import {
    Findings,
    VALIDATION_LIMITS,
    boundsDrift,
    checkSize,
    extentsOf,
    scaleBounds,
    scaleExpectedSize,
    type IExpectedSize,
} from "./AssetValidation";
import {
    COOKED_EXTENSIONS,
    GltfDocument,
    ImageFile,
    TextureEncoder,
    TEXTURE_ROLE,
    TextureRoleMap,
    createGltfIo,
    textureSlotsOf,
} from "./AssetFormats";

const NO_IMAGE = new Uint8Array(0);

const GEOMETRY_SOURCE_FILES = [
    "AssetCommands.ts",
    "AssetValidation.ts",
    "AssetFormats.ts",
    "AssetCategories.ts",
];

export class AssetCooker extends PipelineCommand {
    static readonly FAR_TAG = ".far";

    private static readonly FAR_ERROR_ATTEMPTS = 4;

    private static readonly FAR_SIMPLIFY_FLAGS: ("Permissive" | "ErrorAbsolute")[] = [
        "Permissive",
        "ErrorAbsolute",
    ];

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
        await this.cookGeometry(FileTree.scan(outputRoot));
        const output = FileTree.scan(outputRoot);
        await new ModelListWriter().write(output);
        this.report(source, output);
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
            assetCategory(folder);
        return source;
    }

    private async encodeTextures(roles: TextureRoleMap, source: FileTree): Promise<void> {
        const texturesToEncode = roles.encodable();
        console.log(
            `encoding ${texturesToEncode.length}, stripping ${roles.size - texturesToEncode.length} unusable`
        );

        let encoded = 0;
        const usedKeys = new Set<string>();
        await runWithConcurrency(
            texturesToEncode,
            PIPELINE_CONFIG.textures.concurrency,
            async ([sourceFile, role]) => {
                const outputFile = source
                    .mirrorPath(sourceFile, PIPELINE_CONFIG.outputRoot)
                    .replace(/\.(png|jpe?g)$/i, ".ktx2");
                usedKeys.add(
                    await TextureEncoder.encode(
                        sourceFile,
                        role,
                        outputFile,
                        assetCategory(source.topFolderOf(sourceFile)).maxTextureSizeFor(
                            source.relativePath(sourceFile)
                        )
                    )
                );

                encoded += 1;
                if (encoded % 10 === 0)
                    console.log(`  encoded ${encoded}/${texturesToEncode.length}`);
            }
        );
        TextureEncoder.pruneCache(usedKeys);
    }

    private rewriteDocuments(
        documents: readonly GltfDocument[],
        roles: TextureRoleMap,
        source: FileTree
    ): void {
        for (const document of documents) {
            document.rewriteForKtx2(roles);
            document.markFoliageMaterials(PIPELINE_CONFIG.foliageMaterialPattern);
            document.writeTo(source.mirrorPath(document.filePath, PIPELINE_CONFIG.outputRoot));
        }
        console.log(`rewrote ${documents.length} gltf`);
    }

    private copyPassthroughFiles(source: FileTree): void {
        for (const file of source.withExtensions(".bin", ".glb")) {
            const destinationPath = source.mirrorPath(file, PIPELINE_CONFIG.outputRoot);
            copyFileWithFolders(file, destinationPath);
        }
    }

    private async cookGeometry(output: FileTree): Promise<void> {
        await MeshoptSimplifier.ready;
        const io = await createGltfIo(COOKED_EXTENSIONS, true);
        const compress = meshopt({ encoder: MeshoptEncoder, level: "high" });
        const cacheDirectory = path.join(
            PIPELINE_CONFIG.builds.workRoot,
            PIPELINE_CONFIG.geometry.cacheFolder
        );
        const toolHash = createHash("sha256").update(
            fs.readFileSync(path.resolve(__dirname, "../../package-lock.json"))
        );
        for (const sourceFile of GEOMETRY_SOURCE_FILES)
            toolHash.update(fs.readFileSync(path.join(__dirname, sourceFile)));
        const usedKeys = new Set<string>();
        const farCounts = new Map<string, number>();
        let reused = 0;
        for (const gltfPath of output.withExtensions(".gltf")) {
            const category = assetCategory(output.topFolderOf(gltfPath));
            const { farVersion, compressesGeometry, metresPerUnit } = category;
            if (!farVersion && !compressesGeometry) continue;
            const directory = path.dirname(gltfPath);
            const gltfBytes = fs.readFileSync(gltfPath);
            const json: JSONDocument["json"] = JSON.parse(gltfBytes.toString("utf8"));
            const keyHash = toolHash
                .copy()
                .update(gltfBytes)
                .update(JSON.stringify({ farVersion, compressesGeometry, metresPerUnit }));
            for (const { uri } of json.buffers ?? [])
                if (uri)
                    keyHash.update(fs.readFileSync(path.join(directory, decodeURIComponent(uri))));
            const key = keyHash.digest("hex");
            usedKeys.add(key);
            const entry = path.join(cacheDirectory, key);
            const farStem = `${path.basename(gltfPath, ".gltf")}${AssetCooker.FAR_TAG}`;
            const farName = `${farStem}.gltf`;
            if (fs.existsSync(entry)) {
                const entryFiles = fs.readdirSync(entry);
                for (const file of entryFiles)
                    fs.copyFileSync(path.join(entry, file), path.join(directory, file));
                if (entryFiles.includes(farName))
                    farCounts.set(category.name, (farCounts.get(category.name) ?? 0) + 1);
                reused += 1;
                continue;
            }

            const written = new Set<string>();
            const near = await readGeometry(io, gltfPath);
            const far = farVersion ? await this.farVersionOf(near, category, farVersion) : null;
            if (far) {
                farCounts.set(category.name, (farCounts.get(category.name) ?? 0) + 1);
                for (const buffer of far.getRoot().listBuffers()) buffer.setURI(`${farStem}.bin`);
                if (compressesGeometry) await far.transform(compress);
                for (const file of await writeGeometry(io, path.join(directory, farName), far))
                    written.add(file);
            }
            if (compressesGeometry) {
                await near.transform(compress);
                for (const file of await writeGeometry(io, gltfPath, near)) written.add(file);
            }
            const pending = `${entry}.${process.pid}.pending`;
            fs.mkdirSync(pending, { recursive: true });
            for (const file of written)
                fs.copyFileSync(file, path.join(pending, path.basename(file)));
            fs.renameSync(pending, entry);
        }
        if (fs.existsSync(cacheDirectory))
            for (const name of fs.readdirSync(cacheDirectory))
                if (!usedKeys.has(name))
                    fs.rmSync(path.join(cacheDirectory, name), { recursive: true, force: true });
        for (const [category, count] of farCounts)
            console.log(`far versions: ${category} ${count}`);
        console.log("meshopt complete");
        console.log(`geometry: ${reused} reused from ${cacheDirectory}`);
    }

    private async farVersionOf(
        near: Document,
        category: AssetCategory,
        farVersion: NonNullable<AssetCategory["farVersion"]>
    ): Promise<Document | null> {
        const nearBounds = getBounds(near.getRoot().listScenes()[0]);
        if (extentsOf(nearBounds)[1] * category.metresPerUnit < farVersion.minimumHeightMetres)
            return null;

        const welded = cloneDocument(near);
        await welded.transform(weld());

        const driftLimit = farVersion.errorMetres / category.metresPerUnit;
        const exceedsDrift = (far: Document): boolean => {
            const farScene = far.getRoot().listScenes()[0];
            return (
                farScene !== undefined && boundsDrift(nearBounds, getBounds(farScene)) > driftLimit
            );
        };
        let errorUnits = driftLimit;
        let far = await this.simplifiedCopy(welded, farVersion.ratio, errorUnits);
        for (
            let attempt = 1;
            attempt < AssetCooker.FAR_ERROR_ATTEMPTS && exceedsDrift(far);
            attempt++
        ) {
            errorUnits /= 2;
            far = await this.simplifiedCopy(welded, farVersion.ratio, errorUnits);
        }
        return far;
    }

    private async simplifiedCopy(
        welded: Document,
        ratio: number,
        errorUnits: number
    ): Promise<Document> {
        const document = cloneDocument(welded);
        for (const mesh of document.getRoot().listMeshes())
            for (const primitive of mesh.listPrimitives()) {
                const indices = primitive.getIndices()!;
                const indexArray = indices.getArray()!;
                const positions = primitive.getAttribute("POSITION")!.getArray()!;
                const [simplified] = MeshoptSimplifier.simplify(
                    indexArray instanceof Uint32Array ? indexArray : Uint32Array.from(indexArray),
                    positions instanceof Float32Array ? positions : Float32Array.from(positions),
                    3,
                    Math.floor((indices.getCount() * ratio) / 3) * 3,
                    errorUnits,
                    AssetCooker.FAR_SIMPLIFY_FLAGS
                );
                indices.setArray(Uint32Array.from(simplified));
                compactPrimitive(primitive);
            }
        await document.transform(prune());
        return document;
    }

    private report(source: FileTree, output: FileTree): void {
        const bytesByCategory = output.bytesByTopFolder();

        console.log("");
        for (const [name, bytes] of [...bytesByCategory].sort()) {
            const { budgetMegabytes: budget, budgetPerTheme } = assetCategory(name);
            const over = !budgetPerTheme && toMegabytes(bytes) > budget ? " OVER BUDGET" : "";
            console.log(
                `  ${name}: ${formatMegabytes(bytes)} MB / ${budget} MB${budgetPerTheme ? " per theme" : ""}${over}`
            );
        }

        const cookedTotal = [...bytesByCategory.values()].reduce(
            (total, bytes) => total + bytes,
            0
        );
        console.log(
            `\nsource ${formatMegabytes(source.totalBytes())} MB -> cooked ${formatMegabytes(cookedTotal)} MB`
        );
    }
}

export class ModelListWriter extends PipelineCommand {
    readonly usage = "";
    readonly summary = "Write the typed model list (files and kit modules) from public/models";

    async run(): Promise<void> {
        await this.write(FileTree.scan(PIPELINE_CONFIG.outputRoot));
    }

    async write(output: FileTree): Promise<void> {
        const { outputRoot, modelList } = PIPELINE_CONFIG;
        const files = new Set(output.files);
        const entries = output
            .withExtensions(".gltf")
            .filter((file) => !file.endsWith(`${AssetCooker.FAR_TAG}.gltf`))
            .sort()
            .map((file) => {
                const category = assetCategory(output.topFolderOf(file));
                const url = `/${path.relative(path.dirname(outputRoot), file).split(path.sep).join("/")}`;
                const name = path.basename(file, ".gltf");
                const modules = category.moduleNamesFor(name);
                const moduleList =
                    modules.length > 0
                        ? `, modules: [${modules.map((module) => `"${module}"`).join(", ")}]`
                        : "";
                const farEntry = files.has(file.replace(/\.gltf$/, `${AssetCooker.FAR_TAG}.gltf`))
                    ? `, far: "${url.replace(/\.gltf$/, `${AssetCooker.FAR_TAG}.gltf`)}"`
                    : "";
                return `"${url}": { category: "${category.name}", name: "${name}", unitScale: ${category.unitScale}${moduleList}${farEntry} },`;
            });
        const text = [
            'import type { IModelEntry } from "@/types/world";',
            "",
            `export const MODELS = {\n${entries.join("\n")}\n} as const satisfies Record<string, IModelEntry>;`,
            "",
            "export type ModelPath = keyof typeof MODELS;",
            "",
            'export type ModelCategory = (typeof MODELS)[keyof typeof MODELS]["category"];',
            "",
            "export type ModelName<TCategory extends ModelCategory> = Extract<",
            "    (typeof MODELS)[keyof typeof MODELS],",
            "    { category: TCategory }",
            '>["name"];',
            "",
            "export type ModelModuleKey = {",
            "    [TPath in keyof typeof MODELS]: (typeof MODELS)[TPath] extends {",
            "        modules: readonly (infer TModule extends string)[];",
            "    }",
            `        ? \`\${TPath}${MODEL_MODULE_SEPARATOR}\${TModule}\``,
            "        : never;",
            "}[keyof typeof MODELS];",
            "",
        ].join("\n");
        const config = await resolveConfig(modelList);
        fs.writeFileSync(modelList, await format(text, { ...config, filepath: modelList }));
        console.log(`model list: ${entries.length} models -> ${modelList}`);
    }
}

export class GroundSurfaceCooker extends PipelineCommand {
    private static readonly SIZE_TOLERANCE_METRES = 0.01;

    private static packArguments(albedo: string, height: string, packed: string): string[] {
        const { width, height: rows } = ImageFile.readDimensions(albedo);
        const size = `${width}x${rows}!`;
        return [
            albedo,
            "-colorspace",
            "RGB",
            "(",
            "-clone",
            "0",
            "-scale",
            "1x1!",
            "-scale",
            size,
            ")",
            "(",
            "-clone",
            "0",
            "-evaluate",
            "Multiply",
            "0.5",
            ")",
            "-delete",
            "0",
            "-compose",
            "DivideDst",
            "-composite",
            "-set",
            "colorspace",
            "RGB",
            "-colorspace",
            "sRGB",
            "(",
            height,
            "-colorspace",
            "gray",
            "-resize",
            size,
            "-alpha",
            "off",
            ")",
            "-compose",
            "CopyOpacity",
            "-composite",
            `PNG32:${packed}`,
        ];
    }

    readonly usage = "";
    readonly summary =
        "Fetch ground surface textures, pack detail relative to their mean plus height, encode to KTX2";

    async run(): Promise<void> {
        TextureEncoder.assertInstalled();
        await runWithConcurrency(
            Object.entries(GROUND_SURFACES),
            PIPELINE_CONFIG.textures.concurrency,
            async ([surfaceId, surface]) => {
                await fetchTextureSource(surface.source, ["albedo", "height"]);
                const albedo = textureFile(surface.source, "albedo");
                const height = textureFile(surface.source, "height");
                const { dimensions } = readJsonFile<{ dimensions: [number, number] }>(
                    textureInfoFile(surface.source)
                );
                const sourceMetres = dimensions[0] / MILLIMETRES_PER_METRE;
                if (
                    Math.abs(sourceMetres - surface.tileMetres) >
                    GroundSurfaceCooker.SIZE_TOLERANCE_METRES
                )
                    throw new Error(
                        `${surfaceId}: tileMetres ${surface.tileMetres} differs from the source's ${sourceMetres} m`
                    );

                const packed = path.join(
                    PIPELINE_CONFIG.builds.workRoot,
                    "ground",
                    `${surfaceId}.png`
                );
                const output = path.join("public", GROUND_SURFACE.folder, `${surfaceId}.ktx2`);
                const packArguments = GroundSurfaceCooker.packArguments(albedo, height, packed);
                const packKey = createHash("sha256")
                    .update(fs.readFileSync(albedo))
                    .update(fs.readFileSync(height))
                    .update(JSON.stringify(packArguments))
                    .digest("hex");
                const keyFile = `${packed}.key`;
                if (
                    !fs.existsSync(packed) ||
                    !fs.existsSync(keyFile) ||
                    fs.readFileSync(keyFile, "utf8") !== packKey
                ) {
                    fs.mkdirSync(path.dirname(packed), { recursive: true });
                    await execFileAsync("convert", packArguments);
                    fs.writeFileSync(keyFile, packKey);
                }
                await TextureEncoder.encode(
                    packed,
                    TEXTURE_ROLE.base,
                    output,
                    PIPELINE_CONFIG.maxTextureSize
                );
                console.log(
                    `${surfaceId}: ${surface.source} -> ${output} (${formatMegabytes(fs.statSync(output).size)})`
                );
            }
        );
    }
}

export class AssetVerifier extends PipelineCommand {
    readonly usage = "";
    readonly summary = "Check cooked output: bindings, budgets, normal encoding, geometry drift";

    private static worldPositions = new Float64Array(0);

    private failures = new Findings();

    async run(): Promise<void> {
        const output = FileTree.scan(PIPELINE_CONFIG.outputRoot);
        const io = await createGltfIo(COOKED_EXTENSIONS);
        const cookedDocuments = new Map<string, Promise<Document>>();
        const readCooked = (file: string): Promise<Document> => {
            let document = cookedDocuments.get(file);
            if (!document) {
                document = readGeometry(io, file);
                cookedDocuments.set(file, document);
            }
            return document;
        };

        this.checkTextureBindings(output);
        this.checkCategoryBudgets(output);
        this.checkFileBudgets();
        this.checkNormalMapEncoding(output);
        await this.checkGeometryDrift(output, io, readCooked);
        await this.checkTriangleBudgets(output, readCooked);
        await this.checkFarVersions(output, readCooked);
        await this.checkRecipeSizes(readCooked);
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
        const ktx2States = new Map<string, "missing" | "corrupt" | "valid">();
        for (const gltfPath of gltfPaths) {
            const { json, directory } = GltfDocument.read(gltfPath);
            const images = json.images ?? [];
            const textures = json.textures ?? [];

            for (const [textureIndex, texture] of textures.entries()) {
                const source = texture.extensions?.KHR_texture_basisu?.source;
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
                else {
                    let state = ktx2States.get(ktx2Path);
                    if (state === undefined) {
                        state = !fs.existsSync(ktx2Path)
                            ? "missing"
                            : TextureEncoder.isValidKtx2(ktx2Path)
                              ? "valid"
                              : "corrupt";
                        ktx2States.set(ktx2Path, state);
                    }
                    if (state !== "valid")
                        this.failures.push(
                            `${gltfPath}: ${state} ktx2 ${output.relativePath(ktx2Path)}`
                        );
                }
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
            const category = ASSET_CATEGORIES.find((candidate) => candidate.name === name);
            if (!category) {
                console.log(`  category ${name}: UNREGISTERED`);
                this.failures.push(
                    `category ${name}: cooked folder has no entry in tools/assets/AssetCategories.ts`
                );
                continue;
            }
            if (category.budgetPerTheme) this.checkThemeBudgets(output, category);
            else this.checkBudget(`category ${name}`, toMegabytes(bytes), category.budgetMegabytes);
        }

        for (const category of ASSET_CATEGORIES) {
            if (bytesByCategory.has(category.name)) continue;
            console.log(`  category ${category.name}: MISSING`);
            this.failures.push(`category ${category.name}: missing from cooked output`);
        }
    }

    private checkThemeBudgets(output: FileTree, category: (typeof ASSET_CATEGORIES)[number]): void {
        const kind = category.kind ? ASSET_KINDS[category.kind] : null;
        const bytesByTheme = new Map<string, number>();
        for (const file of output.files) {
            if (output.topFolderOf(file) !== category.name) continue;
            const stem = path.basename(file).split(/[._]/)[0];
            const themes = kind?.find(stem)?.themes ?? [];
            if (themes.length === 0) {
                this.failures.push(
                    `${file}: no recipe names its themes, so no theme budget covers it`
                );
                continue;
            }
            const bytes = fs.statSync(file).size;
            for (const themeId of themes)
                bytesByTheme.set(themeId, (bytesByTheme.get(themeId) ?? 0) + bytes);
        }
        for (const [themeId, bytes] of [...bytesByTheme].sort())
            this.checkBudget(
                `category ${category.name} (${themeId})`,
                toMegabytes(bytes),
                category.budgetMegabytes
            );
    }

    private checkFileBudgets(): void {
        for (const category of ASSET_CATEGORIES)
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
        for (const file of normalMaps)
            this.failures.failIf(
                !TextureEncoder.isUastcRgb(file),
                `${file}: normal map not UASTC_RGB`
            );
        console.log(`normal map encoding: checked ${normalMaps.length} files`);
    }

    private async checkGeometryDrift(
        output: FileTree,
        io: NodeIO,
        readCooked: (file: string) => Promise<Document>
    ): Promise<void> {
        const { sourceRoot, geometryDriftTolerance } = PIPELINE_CONFIG;
        if (!fs.existsSync(sourceRoot)) {
            console.log("geometry drift: skipped (source root missing)");
            return;
        }

        let compared = 0;
        for (const cookedPath of output.withExtensions(".gltf", ".glb")) {
            const relativePath = output.relativePath(cookedPath);
            const sourcePath = path.join(sourceRoot, relativePath);
            if (!fs.existsSync(sourcePath)) continue;

            try {
                const [sourceDocument, cookedDocument] = await Promise.all([
                    readGeometry(io, sourcePath),
                    readCooked(cookedPath),
                ]);
                const drift = documentDrift(sourceDocument, cookedDocument);
                if (drift === null) continue;
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

    private async checkTriangleBudgets(
        output: FileTree,
        readCooked: (file: string) => Promise<Document>
    ): Promise<void> {
        const largest = new Map<string, { triangles: number; budget: number }>();
        for (const cookedPath of output.withExtensions(".gltf")) {
            if (cookedPath.endsWith(`${AssetCooker.FAR_TAG}.gltf`)) continue;
            const label = output.relativePath(cookedPath);
            const category = assetCategory(output.topFolderOf(cookedPath));
            const budget = category.triangleBudgetFor(label);
            let triangles = 0;
            for (const node of (await readCooked(cookedPath)).getRoot().listNodes())
                for (const primitive of node.getMesh()?.listPrimitives() ?? [])
                    triangles +=
                        (primitive.getIndices() ?? primitive.getAttribute("POSITION")!).getCount() /
                        3;
            if (triangles > (largest.get(category.name)?.triangles ?? -1))
                largest.set(category.name, { triangles, budget });
            this.failures.failIf(
                triangles > budget,
                `${label}: ${triangles} triangles exceed its budget of ${budget}`
            );
        }
        for (const [name, { triangles, budget }] of [...largest].sort())
            console.log(`  triangles ${name}: largest ${triangles} / ${budget}`);
    }

    private async checkFarVersions(
        output: FileTree,
        readCooked: (file: string) => Promise<Document>
    ): Promise<void> {
        const farPaths = output.withExtensions(`${AssetCooker.FAR_TAG}.gltf`);
        for (const farPath of farPaths) {
            const label = output.relativePath(farPath);
            const category = assetCategory(output.topFolderOf(farPath));
            const farVersion = category.farVersion;
            if (!farVersion) {
                this.failures.push(`${label}: ${category.name} declares no far versions`);
                continue;
            }
            const nearPath = farPath.replace(`${AssetCooker.FAR_TAG}.gltf`, ".gltf");
            const [near, far] = await Promise.all([readCooked(nearPath), readCooked(farPath)]);
            const driftLimit = farVersion.errorMetres / category.metresPerUnit;
            const drift = documentDrift(near, far);
            this.failures.failIf(
                drift === null || drift > driftLimit,
                `${label}: bounds drift ${drift?.toFixed(5)} from the near model exceeds ${driftLimit}`
            );
            const farAreas = AssetVerifier.materialAreas(far);
            const keptFloor = 1 - VALIDATION_LIMITS.farMaterialAreaLoss;
            for (const [material, nearArea] of AssetVerifier.materialAreas(near)) {
                const kept = (farAreas.get(material) ?? 0) / nearArea;
                this.failures.failIf(
                    kept < keptFloor,
                    `${label}: material ${material} keeps ${(kept * 100).toFixed(1)}% of its area, below ${(keptFloor * 100).toFixed(1)}%`
                );
            }
        }
        console.log(`far versions: checked ${farPaths.length}`);
    }

    private async checkRecipeSizes(readCooked: (file: string) => Promise<Document>): Promise<void> {
        let checked = 0;
        for (const category of ASSET_CATEGORIES) {
            if (!category.kind) continue;
            const metresPerUnit = category.metresPerUnit;
            for (const recipe of ASSET_KINDS[category.kind].recipes()) {
                const sizes = AssetVerifier.expectedSizes(category.kind, recipe);
                if (sizes.length === 0) continue;
                const cookedPath = path.join(
                    PIPELINE_CONFIG.outputRoot,
                    category.name,
                    `${recipe.name}.gltf`
                );
                if (!fs.existsSync(cookedPath)) {
                    this.failures.push(
                        `${category.name}/${recipe.name}: recipe has no cooked model ${cookedPath}`
                    );
                    continue;
                }
                const root = (await readCooked(cookedPath)).getRoot();
                const nodesByName = new Map<string, GltfNode>();
                for (const node of root.listNodes())
                    if (!nodesByName.has(node.getName())) nodesByName.set(node.getName(), node);
                for (const size of sizes) {
                    const label = [category.name, recipe.name, size.node].filter(Boolean).join("/");
                    const subject =
                        size.node === null ? root.listScenes()[0] : nodesByName.get(size.node);
                    if (!subject) {
                        this.failures.push(`${label}: cooked model has no ${size.node ?? "scene"}`);
                        continue;
                    }
                    checkSize(
                        scaleExpectedSize(size, recipe.propScale),
                        scaleBounds(getBounds(subject), metresPerUnit),
                        `cooked ${label}`,
                        this.failures
                    );
                    checked += 1;
                }
            }
        }
        console.log(`recipe sizes: checked ${checked} models`);
    }

    private static expectedSizes<TKind extends AssetKind>(
        kind: TKind,
        recipe: RecipeOf<TKind>
    ): readonly IExpectedSize[] {
        return ASSET_KINDS[kind].pipeline.validator.expectedSizes(recipe);
    }

    private static materialAreas(document: Document): Map<string, number> {
        const areas = new Map<string, number>();
        const element = [0, 0, 0];
        for (const node of document.getRoot().listNodes()) {
            const mesh = node.getMesh();
            if (!mesh) continue;
            const [m0, m1, m2, , m4, m5, m6, , m8, m9, m10, , m12, m13, m14] =
                node.getWorldMatrix();
            for (const primitive of mesh.listPrimitives()) {
                const positions = primitive.getAttribute("POSITION")!;
                const vertexCount = positions.getCount();
                if (AssetVerifier.worldPositions.length < vertexCount * 3)
                    AssetVerifier.worldPositions = new Float64Array(vertexCount * 3);
                const world = AssetVerifier.worldPositions;
                for (let vertex = 0; vertex < vertexCount; vertex += 1) {
                    positions.getElement(vertex, element);
                    const x = element[0];
                    const y = element[1];
                    const z = element[2];
                    const offset = vertex * 3;
                    world[offset] = m0 * x + m4 * y + m8 * z + m12;
                    world[offset + 1] = m1 * x + m5 * y + m9 * z + m13;
                    world[offset + 2] = m2 * x + m6 * y + m10 * z + m14;
                }
                const indices = primitive.getIndices()?.getArray() ?? null;
                const count = indices ? indices.length : vertexCount;
                const material = primitive.getMaterial()?.getName() ?? "";
                let area = areas.get(material) ?? 0;
                for (let start = 0; start < count; start += 3) {
                    const first = (indices ? indices[start] : start) * 3;
                    const second = (indices ? indices[start + 1] : start + 1) * 3;
                    const third = (indices ? indices[start + 2] : start + 2) * 3;
                    const secondX = world[second];
                    const secondY = world[second + 1];
                    const secondZ = world[second + 2];
                    const thirdX = world[third] - secondX;
                    const thirdY = world[third + 1] - secondY;
                    const thirdZ = world[third + 2] - secondZ;
                    const firstX = world[first] - secondX;
                    const firstY = world[first + 1] - secondY;
                    const firstZ = world[first + 2] - secondZ;
                    const crossX = thirdY * firstZ - thirdZ * firstY;
                    const crossY = thirdZ * firstX - thirdX * firstZ;
                    const crossZ = thirdX * firstY - thirdY * firstX;
                    area += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) * 0.5;
                }
                areas.set(material, area);
            }
        }
        return areas;
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

export class SourceImporter extends PipelineCommand {
    readonly usage = "<category> [category arguments]";
    readonly summary = "Convert a raw download into glTF-ready source under assets-src/models";

    async run(args: readonly string[]): Promise<void> {
        const [categoryName, ...categoryArgs] = args;
        if (!categoryName) {
            console.log("importable categories:");
            for (const category of ASSET_CATEGORIES)
                if (category.importUsage) console.log(`  ${category.name} ${category.importUsage}`);
            throw new Error("import needs a category");
        }

        await assetCategory(categoryName).importSource(categoryArgs);
        console.log("\nnext: npm run cook && npm run verify:assets");
    }
}

const documentDrift = (first: Document, second: Document): number | null => {
    const firstScene = first.getRoot().listScenes()[0];
    const secondScene = second.getRoot().listScenes()[0];
    if (!firstScene || !secondScene) return null;
    return boundsDrift(getBounds(firstScene), getBounds(secondScene));
};

const readGeometry = async (io: NodeIO, file: string): Promise<Document> => {
    if (file.endsWith(".glb")) return io.read(file);
    const directory = path.dirname(file);
    const json = readJsonFile<JSONDocument["json"]>(file);
    const resources: JSONDocument["resources"] = {};
    for (const { uri } of json.images ?? []) if (uri) resources[uri] = NO_IMAGE;
    for (const { uri } of json.buffers ?? [])
        if (uri) resources[uri] = fs.readFileSync(path.join(directory, decodeURIComponent(uri)));
    return io.readJSON({ json, resources });
};

const writeGeometry = async (io: NodeIO, file: string, document: Document): Promise<string[]> => {
    const { json, resources } = await io.writeJSON(document, {
        format: Format.GLTF,
        basename: FileUtils.basename(file),
    });
    const directory = path.dirname(file);
    fs.writeFileSync(file, JSON.stringify(json, null, 2));
    const written = [file];
    for (const { uri } of json.buffers ?? []) {
        if (!uri) continue;
        const bufferPath = path.join(directory, decodeURIComponent(uri));
        fs.writeFileSync(bufferPath, resources[uri]);
        written.push(bufferPath);
    }
    return written;
};
