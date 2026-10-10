import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
    type Accessor,
    type Document,
    type GLTF,
    type Node as GltfNode,
    NodeIO,
    type Skin,
    type vec3,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { CLIP } from "@/constants/characters";
import { PHYSICS } from "@/constants/physics";
import type { IPhysicsDefinition } from "@/types/physics";
import { Blender, BlenderPackages, PIPELINE_CONFIG, readJsonFile } from "../pipeline";
import { createGltfIo } from "./AssetFormats";
import type { IResolvedCharacterRecipe } from "./AssetManifest";
import { CharacterValidator, VALIDATION_LIMITS, type BuildValidator } from "./AssetValidation";

const STAGE_ECHO_PREFIXES = ["STAGE", "CHECK", "WARN"];
const WORKSPACE_FOLDERS = ["validation", "out", "arrays", "preview"];
const MATERIAL_ROUGHNESS = 0.85;
const IDENTITY_TOLERANCE = 1e-6;
const METRES_TO_MILLIMETRES = 1000;

type ArrayKind = Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;

const PRIMITIVE_ATTRIBUTES = [
    ["POSITION", "VEC3", "positions.f32", Float32Array],
    ["NORMAL", "VEC3", "normals.f32", Float32Array],
    ["TEXCOORD_0", "VEC2", "uvs.f32", Float32Array],
    ["JOINTS_0", "VEC4", "joints.u16", Uint16Array],
    ["WEIGHTS_0", "VEC4", "weights.f32", Float32Array],
] as const;

export interface IBuildRecipe {
    name: string;
}

export interface IDetectionReport {
    props: { name: string; bone: string; segmentedParts: number[] }[];
    physics: { name: string; attachBone: string; columns?: number; rows?: number }[];
    candidates: { faces: number; area: number; decision: string }[];
    dropped: { name: string; reason: string }[];
}

interface IStageInputs {
    work?: readonly string[];
}

interface IArraysMeta {
    vertices: number;
    triangles: number;
    jointNames: string[];
}

export class AssetBuild<TRecipe extends IBuildRecipe = IBuildRecipe> {
    readonly kind: string;
    readonly name: string;
    readonly recipe: TRecipe;
    readonly root: string;

    constructor(kind: string, recipe: TRecipe, workRoot: string) {
        this.kind = kind;
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
        for (const folder of WORKSPACE_FOLDERS)
            fs.mkdirSync(this.file(folder), { recursive: true });
        fs.writeFileSync(this.recipeFile, JSON.stringify(this.recipe, null, 4));
    }

    readJson<T>(...parts: string[]): T {
        return readJsonFile<T>(this.file(...parts));
    }

    readArray<T extends ArrayKind>(name: string, kind: new (buffer: ArrayBuffer) => T): T {
        const bytes = fs.readFileSync(this.file("arrays", name));
        return new kind(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
}

export abstract class BuildStage<TRecipe extends IBuildRecipe = IBuildRecipe> {
    abstract readonly name: string;
    private readonly inputs: IStageInputs;

    constructor(inputs: IStageInputs = {}) {
        this.inputs = inputs;
    }

    async execute(build: AssetBuild<TRecipe>, blender: Blender): Promise<void> {
        const missing = (this.inputs.work ?? [])
            .map((file) => build.file(file))
            .filter((file) => !fs.existsSync(file));
        if (missing.length > 0)
            throw new Error(
                `stage ${this.name} needs ${missing.join(", ")}: run the earlier stages first`
            );
        await this.run(build, blender);
    }

    protected abstract run(build: AssetBuild<TRecipe>, blender: Blender): Promise<void>;
}

class BlenderStage<TRecipe extends IBuildRecipe = IBuildRecipe> extends BuildStage<TRecipe> {
    readonly name: string;

    constructor(name: string, inputs: IStageInputs = {}) {
        super(inputs);
        this.name = name;
    }

    protected async run(build: AssetBuild<TRecipe>, blender: Blender): Promise<void> {
        blender.runScript(
            PIPELINE_CONFIG.blender.script,
            ["model", build.kind, this.name, build.recipeFile, build.root],
            STAGE_ECHO_PREFIXES
        );
    }
}

class SkeletonStage extends BuildStage<IResolvedCharacterRecipe> {
    readonly name = "skeleton";

    private static elementsOf(accessor: Accessor): number[] {
        const values: number[] = [];
        for (let index = 0; index < accessor.getCount(); index += 1)
            values.push(...accessor.getElement(index, []));
        return values;
    }

    private static assertIdentity(node: GltfNode, file: string): void {
        const drift = node
            .getWorldMatrix()
            .reduce(
                (worst, value, index) =>
                    Math.max(worst, Math.abs(value - (index % 5 === 0 ? 1 : 0))),
                0
            );
        if (drift > IDENTITY_TOLERANCE)
            throw new Error(
                `${file}: node ${node.getName()} must have an identity world transform`
            );
    }

    protected async run(build: AssetBuild<IResolvedCharacterRecipe>): Promise<void> {
        const io = await createGltfIo(ALL_EXTENSIONS);
        const document = await io.read(build.recipe.skeleton);
        const { skin, height, orderedJoints } = this.readSkeleton(document, build.recipe.skeleton);
        const clips = await this.readClips(
            io,
            build.recipe.clipLibraries,
            build.recipe.skeletonDescriptor.bones.pelvis
        );

        fs.writeFileSync(
            build.file("skeleton.json"),
            JSON.stringify({
                height,
                skin: skin.listJoints().map((joint) => joint.getName()),
                nodes: orderedJoints.map((joint) => ({
                    name: joint.getName(),
                    parent: orderedJoints.indexOf(joint.getParentNode() as GltfNode),
                    translation: joint.getTranslation(),
                    rotation: joint.getRotation(),
                    scale: joint.getScale(),
                })),
                clips,
            })
        );
        console.log(
            `STAGE skeleton joints=${orderedJoints.length} clips=${Object.keys(clips).length}`
        );
    }

    private readSkeleton(
        document: Document,
        file: string
    ): { skin: Skin; height: number; orderedJoints: GltfNode[] } {
        const root = document.getRoot();
        const skin = root.listSkins()[0];
        const skinnedNode = root.listNodes().find((node) => node.getSkin() === skin);
        const position = skinnedNode?.getMesh()?.listPrimitives()[0]?.getAttribute("POSITION");
        if (!skin || !skinnedNode || !position) throw new Error(`${file} has no skinned mesh`);
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
            skin,
            height: position.getMax([])[1] - position.getMin([])[1],
            orderedJoints,
        };
    }

    private async readClips(
        io: NodeIO,
        clipLibraries: readonly string[],
        pelvisBone: string
    ): Promise<Record<string, unknown>> {
        const clipNames = new Set<string>(Object.values(CLIP));
        const clips: Record<string, unknown> = {};
        for (const library of clipLibraries) {
            const libraryRoot = (await io.read(library)).getRoot();
            const pelvis = libraryRoot.listNodes().find((node) => node.getName() === pelvisBone);
            for (const animation of libraryRoot.listAnimations()) {
                const name = animation.getName();
                if (!clipNames.has(name) || name in clips) continue;
                clips[name] = {
                    pelvisRest: pelvis?.getTranslation() ?? null,
                    channels: animation.listChannels().map((channel) => ({
                        node: channel.getTargetNode()?.getName(),
                        path: channel.getTargetPath(),
                        interpolation: channel.getSampler()?.getInterpolation(),
                        times: SkeletonStage.elementsOf(channel.getSampler()!.getInput()!),
                        values: SkeletonStage.elementsOf(channel.getSampler()!.getOutput()!),
                    })),
                };
            }
        }
        const missing = [...clipNames].filter((name) => !(name in clips));
        if (missing.length > 0)
            console.log(
                `WARN skeleton: game clips missing from the clip libraries: ${missing.join(", ")}`
            );
        return clips;
    }
}

class GraftStage extends BuildStage<IResolvedCharacterRecipe> {
    readonly name = "graft";

    protected async run(build: AssetBuild<IResolvedCharacterRecipe>): Promise<void> {
        const io = await createGltfIo(ALL_EXTENSIONS);
        const document = await io.read(build.recipe.skeleton);
        const root = document.getRoot();
        const skin = root.listSkins()[0];
        const skinnedNode = root
            .listNodes()
            .find((node) => node.getSkin() === skin && node.getMesh());
        if (!skin || !skinnedNode)
            throw new Error(`${build.recipe.skeleton} has no skinned mesh node`);
        const physics = build.readJson<IDetectionReport>("detection.json").physics.length
            ? build.readJson<IPhysicsDefinition>("arrays", "physics.json")
            : null;
        if (physics) this.addLatticeJoints(document, skin, physics);

        const meta = build.readJson<IArraysMeta>("arrays", "meta.json");
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
        const skinJoints = skin.listJoints().map((joint) => joint.getName());
        if (skinJoints.join(",") !== meta.jointNames.join(","))
            throw new Error("exported joint order does not match the skeleton's skin");
        const restTranslations = build.readJson<Record<string, vec3>>("arrays", "rest.json");
        for (const joint of skin.listJoints()) {
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

    private bindPositionOf(inverseBind: number[]): number[] {
        return [0, 1, 2].map(
            (axis) =>
                -(
                    inverseBind[axis * 4]! * inverseBind[12]! +
                    inverseBind[axis * 4 + 1]! * inverseBind[13]! +
                    inverseBind[axis * 4 + 2]! * inverseBind[14]!
                )
        );
    }

    private assertLatticeBind(skin: Skin, physics: IPhysicsDefinition): void {
        const inverseBinds = skin.getInverseBindMatrices()!;
        const joints = skin.listJoints();
        let worst = 0;
        let worstJoint = "";
        for (const body of physics.bodies) {
            for (const [node, name] of body.nodeBones.entries()) {
                const index = joints.findIndex((joint) => joint.getName() === name);
                if (index < 0) throw new Error(`lattice joint ${name} is not in the skin`);
                const bindPosition = this.bindPositionOf(inverseBinds.getElement(index, []));
                const target = body.restPositions.slice(node * 3, node * 3 + 3);
                const deviationMm =
                    Math.hypot(
                        bindPosition[0]! - target[0]!,
                        bindPosition[1]! - target[1]!,
                        bindPosition[2]! - target[2]!
                    ) * METRES_TO_MILLIMETRES;
                if (!Number.isFinite(deviationMm))
                    throw new Error(`lattice joint ${name} has a non-finite bind position`);
                if (deviationMm > worst) {
                    worst = deviationMm;
                    worstJoint = name;
                }
            }
        }
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
            .setMetallicFactor(0)
            .setRoughnessFactor(MATERIAL_ROUGHNESS)
            .setDoubleSided(true);
        const primitive = document.createPrimitive().setMaterial(material);
        for (const [semantic, type, file, kind] of PRIMITIVE_ATTRIBUTES)
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

class ValidationStage<TRecipe extends IBuildRecipe, TMeasurements> extends BlenderStage<TRecipe> {
    private readonly validator: BuildValidator<TRecipe, TMeasurements>;

    constructor(
        name: string,
        inputs: IStageInputs,
        validator: BuildValidator<TRecipe, TMeasurements>
    ) {
        super(name, inputs);
        this.validator = validator;
    }

    protected override async run(build: AssetBuild<TRecipe>, blender: Blender): Promise<void> {
        await super.run(build, blender);
        this.validator.validate(build);
    }
}

export class AssetBuildPipeline<TRecipe extends IBuildRecipe> {
    readonly kind: string;
    private readonly workRoot: string;
    private readonly stages: readonly BuildStage<TRecipe>[];

    constructor(kind: string, workRoot: string, stages: readonly BuildStage<TRecipe>[]) {
        this.kind = kind;
        this.workRoot = workRoot;
        this.stages = stages;
    }

    createBuild(recipe: TRecipe): AssetBuild<TRecipe> {
        return new AssetBuild(this.kind, recipe, this.workRoot);
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
        new BlenderPackages().ensureInstalled();
        build.prepareWorkspace(first === 0);

        for (const stage of this.stages.slice(first, last + 1)) {
            const started = Date.now();
            console.log(`\n== ${stage.name}`);
            await stage.execute(build, blender);
            console.log(`== ${stage.name} ${((Date.now() - started) / 1000).toFixed(1)} s`);
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

const CHARACTER_PIPELINE = new AssetBuildPipeline<IResolvedCharacterRecipe>(
    "character",
    PIPELINE_CONFIG.characters.workRoot,
    [
        new BlenderStage("prepare"),
        new BlenderStage("unwrap", { work: ["lo.npz"] }),
        new BlenderStage("bake", { work: ["hi.blend", "atlas.npz", "lo.npz"] }),
        new SkeletonStage(),
        new BlenderStage("joints", {
            work: [
                "lo_split.npz",
                "albedo.png",
                "hi.npz",
                "thick.npy",
                "skeleton.json",
                "atlas.npz",
                "reference.json",
                "reference.npz",
                "detection.json",
            ],
        }),
        new BlenderStage("closeups", { work: ["lo.blend", "joints.json"] }),
        new BlenderStage("masks", {
            work: ["lo.blend", "props.npy", "skin.npy", "detection.json"],
        }),
        new BlenderStage("physics", {
            work: [
                "lo_split.npz",
                "lo.blend",
                "atlas.npz",
                "thick.npy",
                "skin.npy",
                "hi.npz",
                "reference.npz",
                "props.npy",
                "joints.json",
                "skeleton.json",
                "detection.json",
            ],
        }),
        new BlenderStage("rig", {
            work: [
                "lo.blend",
                "joints.json",
                "skeleton.json",
                "props.npy",
                "pieces.npy",
                "thick.npy",
                "physics.json",
                "detection.json",
            ],
        }),
        new BlenderStage("bones", {
            work: ["rig.npz", "lo.blend", "skeleton.json", "joints.json"],
        }),
        new BlenderStage("weights", {
            work: [
                "raw.npz",
                "rig.npz",
                "lo_split.npz",
                "skeleton.json",
                "thick.npy",
                "detection.json",
            ],
        }),
        new BlenderStage("export", {
            work: [
                "final.npz",
                "rig.npz",
                "lo_split.npz",
                "skeleton.json",
                "albedo.png",
                "detection.json",
            ],
        }),
        new GraftStage({
            work: [
                "arrays/meta.json",
                "arrays/rest.json",
                "baseColor.png",
                "normal.png",
                "detection.json",
            ],
        }),
        new ValidationStage(
            "anim",
            {
                work: [
                    "lo.blend",
                    "final.npz",
                    "rig.npz",
                    "skeleton.json",
                    "lo_split.npz",
                    "props.npy",
                    "joints.json",
                    "validation/measurements.json",
                ],
            },
            new CharacterValidator()
        ),
    ]
);

export const ASSET_PIPELINES = { character: CHARACTER_PIPELINE } as const;
