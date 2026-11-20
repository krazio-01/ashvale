import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
    type Document,
    type GLTF,
    type Node as GltfNode,
    NodeIO,
    type Skin,
    type vec3,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { Matrix4 } from "three";
import { CLIP } from "@/constants/characters";
import { PHYSICS } from "@/constants/physics";
import type { IPhysicsDefinition } from "@/types/physics";
import { Blender, MILLIMETRES_PER_METRE, ensureBlenderPackages, readJsonFile } from "../pipeline";
import { accessorValues, createGltfIo } from "./AssetFormats";
import type {
    IResolvedCharacterRecipe,
    IResolvedImportedRecipe,
    IResolvedKitRecipe,
    IResolvedScanRecipe,
} from "./AssetManifest";
import type { ISharedTuning } from "./PipelineTuning";
import { VALIDATION_LIMITS, type BuildValidator } from "./AssetValidation";

type ArrayKind = Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;

export interface IBuildRecipe {
    name: string;
    bakes: boolean;
}

interface IBakeInputs {
    textureSize: number;
    heightMetres: number;
    referenceHeightMetres: number;
    tuning: ISharedTuning;
    bakes: boolean;
}

interface IBlenderStageInputs {
    import: Pick<
        IResolvedImportedRecipe,
        "source" | "objects" | "facingYawDegrees" | "heightMetres" | "patches"
    >;
    align: IBuildRecipe;
    decimate: Pick<IResolvedImportedRecipe, "triangles" | "tuning">;
    generate: Pick<IResolvedKitRecipe, "tuning" | "materials" | "modules">;
    modules: Pick<IResolvedKitRecipe, "bakes" | "materials" | "modules" | "tuning">;
    unwrap: IBakeInputs;
    bake: IBakeInputs;
    "shared-material": Pick<IResolvedScanRecipe, "sharedMaterial">;
    export: Pick<IResolvedImportedRecipe, "name" | "extras" | "tuning" | "propScale">;
    "module-export": Pick<
        IResolvedKitRecipe,
        | "name"
        | "extras"
        | "tuning"
        | "bakes"
        | "materials"
        | "propScale"
        | "sharedMaterial"
        | "sway"
    >;
    closeups: IBuildRecipe;
    "module-closeups": Pick<IResolvedKitRecipe, "modules">;
    prepare: IResolvedCharacterRecipe;
    thickness: IResolvedCharacterRecipe;
    joints: IResolvedCharacterRecipe;
    "skinned-closeups": IResolvedCharacterRecipe;
    masks: IResolvedCharacterRecipe;
    physics: IResolvedCharacterRecipe;
    rig: IResolvedCharacterRecipe;
    bones: IResolvedCharacterRecipe;
    weights: IResolvedCharacterRecipe;
    "skinned-export": IResolvedCharacterRecipe;
    anim: IResolvedCharacterRecipe;
}

type BlenderStageName = keyof IBlenderStageInputs;

type StageNameFor<TRecipe> = {
    [TName in BlenderStageName]: TRecipe extends IBlenderStageInputs[TName] ? TName : never;
}[BlenderStageName];

export interface IDetectionReport {
    physics: { name: string; attachBone: string; columns?: number; rows?: number }[];
}

interface IArraysMeta {
    vertices: number;
    triangles: number;
    jointNames: string[];
}

export class AssetBuild<TRecipe extends IBuildRecipe = IBuildRecipe> {
    private static readonly WORKSPACE_FOLDERS = ["validation", "out", "arrays", "preview"];

    readonly name: string;
    readonly recipe: TRecipe;
    readonly root: string;

    constructor(recipe: TRecipe, workRoot: string) {
        this.name = recipe.name;
        this.recipe = recipe;
        this.root = path.resolve(workRoot, recipe.name);
    }

    get recipeFile(): string {
        return this.file("recipe.json");
    }

    file(...parts: string[]): string {
        return path.join(this.root, ...parts);
    }

    prepareWorkspace(fresh: boolean): void {
        if (fresh) fs.rmSync(this.root, { recursive: true, force: true });
        for (const folder of AssetBuild.WORKSPACE_FOLDERS)
            fs.mkdirSync(this.file(folder), { recursive: true });
        fs.writeFileSync(this.recipeFile, JSON.stringify(this.recipe, null, 4));
    }

    assertHasFiles(files: readonly string[], reader: string): void {
        const missing = files.map((file) => this.file(file)).filter((file) => !fs.existsSync(file));
        if (missing.length > 0)
            throw new Error(`${reader} needs ${missing.join(", ")}: run the earlier stages first`);
    }

    readJson<T>(...parts: string[]): T {
        return readJsonFile<T>(this.file(...parts));
    }

    readArray<T extends ArrayKind>(name: string, kind: new (buffer: ArrayBuffer) => T): T {
        const bytes = fs.readFileSync(this.file("arrays", name));
        const ownsBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
        return new kind(
            ownsBuffer
                ? bytes.buffer
                : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        );
    }
}

export abstract class BuildStage<TRecipe extends IBuildRecipe = IBuildRecipe> {
    abstract readonly name: string;
    readonly canShareBlenderProcess: boolean = false;
    protected readonly reads: readonly string[] = [];

    async execute(build: AssetBuild<TRecipe>, blender: Blender): Promise<void> {
        build.assertHasFiles(this.reads, `stage ${this.name}`);
        await this.run(build, blender);
    }

    protected abstract run(build: AssetBuild<TRecipe>, blender: Blender): Promise<void>;
}

export class BlenderStage<TRecipe extends IBuildRecipe = IBuildRecipe> extends BuildStage<TRecipe> {
    private static readonly STAGE_ECHO_PREFIXES = ["STAGE", "CHECK", "WARN"];

    readonly name: StageNameFor<TRecipe>;
    override readonly canShareBlenderProcess: boolean = true;

    constructor(name: StageNameFor<TRecipe>) {
        super();
        this.name = name;
    }

    static runTogether<TRecipe extends IBuildRecipe>(
        build: AssetBuild<TRecipe>,
        blender: Blender,
        stages: readonly BlenderStage<TRecipe>[]
    ): void {
        build.assertHasFiles(stages[0].reads, `stage ${stages[0].name}`);
        blender.runScript(
            ["model", stages.map((stage) => stage.name).join(","), build.recipeFile, build.root],
            BlenderStage.STAGE_ECHO_PREFIXES
        );
    }

    protected async run(build: AssetBuild<TRecipe>, blender: Blender): Promise<void> {
        BlenderStage.runTogether(build, blender, [this]);
    }
}

export class SkeletonStage extends BuildStage<IResolvedCharacterRecipe> {
    private static readonly IDENTITY_TOLERANCE = 1e-6;

    readonly name = "skeleton";

    private static assertIdentity(node: GltfNode, file: string): void {
        const isIdentity = node
            .getWorldMatrix()
            .every(
                (value, index) =>
                    Math.abs(value - (index % 5 === 0 ? 1 : 0)) <= SkeletonStage.IDENTITY_TOLERANCE
            );
        if (!isIdentity)
            throw new Error(
                `${file}: node ${node.getName()} must have an identity world transform`
            );
    }

    protected async run(build: AssetBuild<IResolvedCharacterRecipe>): Promise<void> {
        const { io, document, skin, skinnedNode } = await readSkinnedSkeleton(
            build.recipe.skeleton
        );
        const { height, orderedJoints } = this.readSkeleton(
            document,
            skin,
            skinnedNode,
            build.recipe.skeleton
        );
        const clips = await this.readClips(
            io,
            build.recipe.clipLibraries,
            build.recipe.skeletonDescriptor.bones.pelvis
        );

        const jointIndex = new Map(orderedJoints.map((joint, index) => [joint, index]));
        fs.writeFileSync(
            build.file("skeleton.json"),
            JSON.stringify({
                height,
                skin: skin.listJoints().map((joint) => joint.getName()),
                nodes: orderedJoints.map((joint) => {
                    const parent = joint.getParentNode();
                    return {
                        name: joint.getName(),
                        parent: parent ? (jointIndex.get(parent) ?? -1) : -1,
                        translation: joint.getTranslation(),
                        rotation: joint.getRotation(),
                        scale: joint.getScale(),
                    };
                }),
                clips,
            })
        );
        console.log(
            `STAGE skeleton joints=${orderedJoints.length} clips=${Object.keys(clips).length}`
        );
    }

    private readSkeleton(
        document: Document,
        skin: Skin,
        skinnedNode: GltfNode,
        file: string
    ): { height: number; orderedJoints: GltfNode[] } {
        const root = document.getRoot();
        const position = skinnedNode.getMesh()?.listPrimitives()[0]?.getAttribute("POSITION");
        if (!position) throw new Error(`${file} has no skinned mesh`);
        SkeletonStage.assertIdentity(skinnedNode, file);

        const joints = new Set(skin.listJoints());
        const orderedJoints: GltfNode[] = [];
        const visit = (node: GltfNode): void => {
            if (joints.has(node)) orderedJoints.push(node);
            node.listChildren().forEach(visit);
        };
        root.listScenes().forEach((scene) => scene.listChildren().forEach(visit));
        for (const joint of orderedJoints) {
            const parent = joint.getParentNode();
            if (parent && !joints.has(parent)) SkeletonStage.assertIdentity(parent, file);
        }
        return {
            height: position.getMax([])[1] - position.getMin([])[1],
            orderedJoints,
        };
    }

    private async readClips(
        io: NodeIO,
        clipLibraries: readonly string[],
        pelvisBone: string
    ): Promise<Record<string, unknown>> {
        const missing = new Set<string>(Object.values(CLIP));
        const clips: Record<string, unknown> = {};
        for (const library of clipLibraries) {
            if (missing.size === 0) break;
            const libraryRoot = (await io.read(library)).getRoot();
            const animations = libraryRoot
                .listAnimations()
                .filter((animation) => missing.has(animation.getName()));
            if (animations.length === 0) continue;

            const pelvisRest =
                libraryRoot
                    .listNodes()
                    .find((node) => node.getName() === pelvisBone)
                    ?.getTranslation() ?? null;
            for (const animation of animations) {
                const name = animation.getName();
                if (!missing.delete(name)) continue;
                clips[name] = {
                    pelvisRest,
                    channels: animation.listChannels().map((channel) => {
                        const sampler = channel.getSampler()!;
                        return {
                            node: channel.getTargetNode()?.getName(),
                            path: channel.getTargetPath(),
                            interpolation: sampler.getInterpolation(),
                            times: accessorValues(sampler.getInput()!),
                            values: accessorValues(sampler.getOutput()!),
                        };
                    }),
                };
            }
        }
        if (missing.size > 0)
            console.log(
                `WARN skeleton: game clips missing from the clip libraries: ${[...missing].join(", ")}`
            );
        return clips;
    }
}

export class AssembleGlbStage extends BuildStage<IResolvedCharacterRecipe> {
    private static readonly PRIMITIVE_ATTRIBUTES = [
        ["POSITION", "VEC3", "positions.f32", Float32Array],
        ["NORMAL", "VEC3", "normals.f32", Float32Array],
        ["TEXCOORD_0", "VEC2", "uvs.f32", Float32Array],
        ["JOINTS_0", "VEC4", "joints.u16", Uint16Array],
        ["WEIGHTS_0", "VEC4", "weights.f32", Float32Array],
    ] as const;

    readonly name = "graft";
    protected override readonly reads = [
        "arrays/meta.json",
        "arrays/rest.json",
        "arrays/ibm.f32",
        ...AssembleGlbStage.PRIMITIVE_ATTRIBUTES.map(([, , file]) => `arrays/${file}`),
        "arrays/indices.u32",
        "baseColor.png",
        "normal.png",
        "detection.json",
    ];

    protected async run(build: AssetBuild<IResolvedCharacterRecipe>): Promise<void> {
        const detection = build.readJson<IDetectionReport>("detection.json");
        const meta = build.readJson<IArraysMeta>("arrays", "meta.json");
        const physics = detection.physics.length
            ? build.readJson<IPhysicsDefinition>("arrays", "physics.json")
            : null;
        const { io, document, skin, skinnedNode } = await readSkinnedSkeleton(
            build.recipe.skeleton
        );
        const root = document.getRoot();
        if (physics) this.addLatticeJoints(document, skin, physics);

        this.fitRestPose(skin, meta, build);
        this.replaceMesh(document, skinnedNode, build);
        if (physics) {
            root.listScenes()[0].setExtras({ [PHYSICS.dataKey]: physics });
            this.assertLatticeBind(skin, physics);
        }

        await document.transform(prune({ keepAttributes: true }));
        const clipCount = root.listAnimations().length;
        const previewPath = build.file("preview", `${build.name}_clips.glb`);
        await io.write(previewPath, document);

        this.removeAnimations(document);
        await document.transform(prune({ keepAttributes: true }));
        const outputPath = build.file("out", `${build.name}.glb`);
        await io.write(outputPath, document);
        console.log(
            `STAGE graft ${outputPath} (${meta.vertices} vertices, ${meta.triangles} triangles); ` +
                `preview with ${clipCount} clips at ${previewPath}`
        );
    }

    private addLatticeJoints(document: Document, skin: Skin, physics: IPhysicsDefinition): void {
        const joints = new Map(skin.listJoints().map((joint) => [joint.getName(), joint]));
        for (const body of physics.bodies) {
            const parent = joints.get(body.attachBone);
            if (!parent)
                throw new Error(
                    `physics body ${body.name}: attach bone ${body.attachBone} is not a skin joint`
                );
            for (const name of body.nodeBones) {
                const node = document.createNode(name);
                parent.addChild(node);
                skin.addJoint(node);
            }
        }
    }

    private fitRestPose(
        skin: Skin,
        meta: IArraysMeta,
        build: AssetBuild<IResolvedCharacterRecipe>
    ): void {
        const joints = skin.listJoints();
        if (
            joints.length !== meta.jointNames.length ||
            joints.some((joint, index) => joint.getName() !== meta.jointNames[index])
        )
            throw new Error("exported joint order does not match the skeleton's skin");
        const restTranslations = build.readJson<Record<string, vec3>>("arrays", "rest.json");
        for (const joint of joints) {
            const translation = restTranslations[joint.getName()];
            if (!translation) throw new Error(`no fitted rest translation for ${joint.getName()}`);
            joint.setTranslation(translation);
        }
    }

    private removeAnimations(document: Document): void {
        for (const animation of document.getRoot().listAnimations()) {
            for (const channel of animation.listChannels()) channel.dispose();
            for (const sampler of animation.listSamplers()) sampler.dispose();
            animation.dispose();
        }
    }

    private assertLatticeBind(skin: Skin, physics: IPhysicsDefinition): void {
        const inverseBinds = skin.getInverseBindMatrices()!;
        const joints = skin.listJoints();
        const jointIndexByName = new Map<string, number>();
        joints.forEach((joint, index) => {
            if (!jointIndexByName.has(joint.getName()))
                jointIndexByName.set(joint.getName(), index);
        });
        const inverseBind: number[] = [];
        const bind = new Matrix4();
        let worstSquaredMetres = 0;
        let worstJoint = "";
        for (const body of physics.bodies) {
            for (const [node, name] of body.nodeBones.entries()) {
                const index = jointIndexByName.get(name) ?? -1;
                if (index < 0) throw new Error(`lattice joint ${name} is not in the skin`);
                bind.fromArray(inverseBinds.getElement(index, inverseBind)).invert();
                const offset = node * 3;
                const dx = bind.elements[12] - body.restPositions[offset];
                const dy = bind.elements[13] - body.restPositions[offset + 1];
                const dz = bind.elements[14] - body.restPositions[offset + 2];
                const deviationSquaredMetres = dx * dx + dy * dy + dz * dz;
                if (!Number.isFinite(deviationSquaredMetres))
                    throw new Error(`lattice joint ${name} has a non-finite bind position`);
                if (deviationSquaredMetres > worstSquaredMetres) {
                    worstSquaredMetres = deviationSquaredMetres;
                    worstJoint = name;
                }
            }
        }
        const worst = Math.sqrt(worstSquaredMetres) * MILLIMETRES_PER_METRE;
        if (worst > VALIDATION_LIMITS.latticeBindMillimetres)
            throw new Error(
                `lattice joint ${worstJoint} binds ${worst.toFixed(3)} mm away from its node target (limit ${VALIDATION_LIMITS.latticeBindMillimetres} mm)`
            );
        console.log(`  lattice joints bind on their node targets (worst ${worst.toFixed(4)} mm)`);
    }

    private replaceMesh(
        document: Document,
        skinnedNode: GltfNode,
        build: AssetBuild<IResolvedCharacterRecipe>
    ): void {
        const root = document.getRoot();
        const buffer = root.listBuffers()[0];
        const accessor = (type: GLTF.AccessorType, array: ArrayKind) =>
            document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
        const texture = (name: string, file: string) =>
            document
                .createTexture(name)
                .setImage(fs.readFileSync(build.file(file)))
                .setMimeType("image/png");

        root.listSkins()[0].setInverseBindMatrices(
            accessor("MAT4", build.readArray("ibm.f32", Float32Array))
        );
        const material = document
            .createMaterial(build.name)
            .setBaseColorTexture(texture("baseColor", "baseColor.png"))
            .setNormalTexture(texture("normal", "normal.png"))
            .setNormalScale(build.recipe.tuning.material.normalScale)
            .setMetallicFactor(0)
            .setRoughnessFactor(build.recipe.tuning.material.roughness)
            .setDoubleSided(true);
        const primitive = document.createPrimitive().setMaterial(material);
        for (const [semantic, type, file, kind] of AssembleGlbStage.PRIMITIVE_ATTRIBUTES)
            primitive.setAttribute(
                semantic,
                accessor(type, build.readArray<ArrayKind>(file, kind))
            );
        primitive.setIndices(accessor("SCALAR", build.readArray("indices.u32", Uint32Array)));
        const previousMesh = skinnedNode.getMesh();
        skinnedNode.setMesh(document.createMesh(build.name).addPrimitive(primitive));
        skinnedNode.setName(build.name);
        previousMesh?.dispose();
    }
}

export class ValidationStage<
    TRecipe extends IBuildRecipe,
    TMeasurements,
> extends BlenderStage<TRecipe> {
    readonly validator: BuildValidator<TRecipe, TMeasurements>;
    override readonly canShareBlenderProcess: boolean = false;

    constructor(name: StageNameFor<TRecipe>, validator: BuildValidator<TRecipe, TMeasurements>) {
        super(name);
        this.validator = validator;
    }

    protected override async run(build: AssetBuild<TRecipe>, blender: Blender): Promise<void> {
        await super.run(build, blender);
        this.validator.validate(build);
    }
}

export class AssetBuildPipeline<TRecipe extends IBuildRecipe> {
    readonly validator: BuildValidator<TRecipe, unknown>;
    private readonly workRoot: string;
    private readonly stages: readonly BuildStage<TRecipe>[];

    constructor(
        workRoot: string,
        stages: readonly BuildStage<TRecipe>[],
        validation: ValidationStage<TRecipe, unknown>
    ) {
        this.workRoot = workRoot;
        this.stages = [...stages, validation];
        this.validator = validation.validator;
    }

    createBuild(recipe: TRecipe): AssetBuild<TRecipe> {
        return new AssetBuild(recipe, this.workRoot);
    }

    async run(build: AssetBuild<TRecipe>, flags: readonly string[]): Promise<boolean> {
        const { from, until } = parseArgs({
            args: [...flags],
            options: { from: { type: "string" }, until: { type: "string" } },
            strict: true,
            allowPositionals: false,
        }).values;
        const first = from === undefined ? 0 : this.stageIndex(from);
        const last = until === undefined ? this.stages.length - 1 : this.stageIndex(until);
        if (first > last) throw new Error(`--from ${from} comes after --until ${until}`);
        const blender = new Blender();
        blender.assertInstalled();
        ensureBlenderPackages();
        build.prepareWorkspace(first === 0);

        const selected = this.stages.slice(first, last + 1);

        for (let start = 0; start < selected.length;) {
            let end = start + 1;
            while (
                selected[start].canShareBlenderProcess &&
                end < selected.length &&
                selected[end].canShareBlenderProcess
            )
                end += 1;
            const group = selected.slice(start, end);
            const label = group.map((stage) => stage.name).join(" + ");
            const started = Date.now();
            console.log(`\n== ${label}`);
            if (group.length === 1) await group[0].execute(build, blender);
            else
                BlenderStage.runTogether(
                    build,
                    blender,
                    group.filter(
                        (stage): stage is BlenderStage<TRecipe> => stage instanceof BlenderStage
                    )
                );
            console.log(`== ${label} ${((Date.now() - started) / 1000).toFixed(1)} s`);
            start = end;
        }
        console.log(`\nworkspace: ${build.root}`);
        return last === this.stages.length - 1;
    }

    private stageIndex(name: string): number {
        const index = this.stages.findIndex((stage) => stage.name === name);
        if (index === -1)
            throw new Error(
                `unknown stage ${name} (stages: ${this.stages.map((stage) => stage.name).join(", ")})`
            );
        return index;
    }
}

const readSkinnedSkeleton = async (file: string) => {
    const io = await createGltfIo(ALL_EXTENSIONS);
    const document = await io.read(file);
    const root = document.getRoot();
    const skin = root.listSkins()[0];
    if (!skin) throw new Error(`${file} has no skinned mesh`);
    const skinnedNode = root.listNodes().find((node) => node.getSkin() === skin && node.getMesh());
    if (!skinnedNode) throw new Error(`${file} has no skinned mesh`);
    return { io, document, skin, skinnedNode };
};
