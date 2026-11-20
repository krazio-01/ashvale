import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
    Buffer,
    Node,
    NodeIO,
    type Accessor,
    type Document,
    type Property,
} from "@gltf-transform/core";
import {
    Box3,
    Euler,
    type Interpolant,
    Matrix4,
    Quaternion,
    QuaternionKeyframeTrack,
    Vector3,
    VectorKeyframeTrack,
} from "three";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import {
    copyToDocument,
    createDefaultPropertyResolver,
    dedup,
    prune,
    resample,
} from "@gltf-transform/functions";
import { CLIP, SKELETON_BONES } from "@/constants/characters";
import { PLAYER, PLAYER_STARTING_WEAPON } from "@/constants/player";
import {
    axisVector,
    degreesToRadians,
    measureBladeAxes,
    radiansToDegrees,
    roundTo,
} from "@/lib/helpers";
import { CLIP_MARKS } from "@/constants/combat";
import type { IClipMarks } from "@/types/combat";
import { assetCategory } from "../assets/AssetCategories";
import {
    Blender,
    PIPELINE_CONFIG,
    PipelineCommand,
    copyFileWithFolders,
    execFileAsync,
    formatMegabytes,
    readJsonFile,
    runWithConcurrency,
    sourcePathOf,
    toMegabytes,
} from "../pipeline";
import { accessorValues, createGltfIo } from "../assets/AssetFormats";
import {
    CLIP_JOBS,
    CLIP_BAKE_FILES,
    CLIPS_PROVIDED_BY_CHARACTER_MODEL,
    GAME_FIT,
    OUTPUT_FPS,
    authoredPoses,
    isBeatJob,
    SOURCE_RIGS,
    type ClipJob,
    type IRetargetJob,
    type SourceRig,
} from "./combatClipManifest";

interface ICarryAnchor {
    bone: string;
    hilt: number[];
    blade: number[];
}

interface IBakedClipMarks extends IClipMarks {
    seconds: number;
}

interface IClipTracks {
    duration: number;
    tracks: Map<string, Interpolant>;
}

interface IClipFile {
    clips: Map<string, IClipTracks>;
    rest: Map<string, number[]>;
}

interface IWorst {
    value: number;
    channel: string;
    time: number;
}

export class ClipCooker extends PipelineCommand {
    private static readonly CLIP_MARK_PRECISION = 1000;

    private static readonly TRANSLATION_NODES = new Set<string>([
        SKELETON_BONES.root,
        SKELETON_BONES.pelvis,
    ]);

    private static readonly RESAMPLE_TOLERANCE = 1e-4;

    private static readonly BAKE_LOG_PREFIXES = ["BAKED", "GROUND", "CHECK", "EXPORTED"];

    private static readonly MARK_TOLERANCE = 0.002;

    private static readonly MAX_MARK_DRIFT_FRAMES = 2;

    private static readonly roundMark = (_key: string, value: unknown): unknown =>
        typeof value === "number" ? roundTo(value, ClipCooker.CLIP_MARK_PRECISION) : value;

    readonly usage = "[--only <ClipName,ClipName> --out <file.glb>] [--merge <ClipName,ClipName>]";
    readonly summary =
        "Bake every manifest clip in Blender into CombatClips.glb (source + public); --only bakes a subset to --out without publishing; --merge bakes a subset into the published file";

    async run(args: readonly string[]): Promise<void> {
        const { values } = parseArgs({
            args: [...args],
            options: {
                only: { type: "string" },
                out: { type: "string" },
                merge: { type: "string" },
            },
        });
        if (Boolean(values.only) !== Boolean(values.out))
            throw new Error(`--only and --out go together; usage: ${this.usage}`);
        if (values.merge && values.only)
            throw new Error(`--merge and --only are exclusive; usage: ${this.usage}`);
        const subset = (values.only ?? values.merge)?.split(",");
        const requested = subset && new Set(subset);
        const jobs = requested ? CLIP_JOBS.filter((job) => requested.has(job.output)) : CLIP_JOBS;
        if (subset && jobs.length !== subset.length)
            throw new Error(`the subset names clips with no manifest job: ${subset.join(", ")}`);

        const io = await createGltfIo([EXTMeshoptCompression], true);
        const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "combat-clips-"));
        try {
            const jobsPath = path.join(workDirectory, "jobs.json");
            const rawPath = path.join(workDirectory, "raw.glb");
            const marksPath = path.join(workDirectory, "marks.json");
            const stagedPath = path.join(workDirectory, path.basename(CLIP_BAKE_FILES.output));
            fs.writeFileSync(
                jobsPath,
                JSON.stringify({
                    fps: OUTPUT_FPS,
                    target: path.resolve(CLIP_BAKE_FILES.target),
                    jobs,
                    game: await gameFit(io),
                })
            );
            new Blender().runScript(
                ["bake", jobsPath, rawPath, marksPath],
                ClipCooker.BAKE_LOG_PREFIXES
            );
            await this.stripResampleAndCompress(io, rawPath, stagedPath);
            if (values.out) {
                copyFileWithFolders(stagedPath, path.resolve(values.out));
                fs.copyFileSync(marksPath, `${path.resolve(values.out)}.marks.json`);
                console.log(
                    `subset of ${jobs.length} clips written to ${values.out}, nothing published`
                );
                return;
            }

            const missingBefore = values.merge
                ? await ClipCooker.mergeIntoPublished(io, stagedPath)
                : new Set<string>();

            const animations = (await io.read(stagedPath)).getRoot().listAnimations();
            const names = new Set(animations.map((animation) => animation.getName()));
            this.verifyCatalogue(names, missingBefore);
            const durations = new Map<string, number>();
            const lastTimeByInput = new Map<Accessor, number>();
            for (const animation of animations) {
                let seconds = 0;
                for (const sampler of animation.listSamplers()) {
                    const input = sampler.getInput();
                    if (!input) continue;
                    let lastTime = lastTimeByInput.get(input);
                    if (lastTime === undefined) {
                        lastTime = input.getMax([])[0];
                        lastTimeByInput.set(input, lastTime);
                    }
                    seconds = Math.max(seconds, lastTime);
                }
                durations.set(animation.getName(), seconds);
                console.log(`CLIP ${animation.getName()} ${seconds.toFixed(3)}`);
            }

            this.enforceBudget(stagedPath, names.size);
            this.verifyClipMarks(marksPath, durations);
            this.publish(stagedPath);
        } finally {
            fs.rmSync(workDirectory, { recursive: true, force: true });
        }
    }

    private static async mergeIntoPublished(io: NodeIO, stagedPath: string): Promise<Set<string>> {
        const published = await io.read(CLIP_BAKE_FILES.output);
        const publishedAnimations = published.getRoot().listAnimations();
        const publishedNames = new Set<string>();
        const baked = await io.read(stagedPath);
        const bakedAnimations = baked.getRoot().listAnimations();
        const replaced = new Set(bakedAnimations.map((animation) => animation.getName()));
        const catalogue = new Set<string>(Object.values(CLIP));
        for (const animation of publishedAnimations) {
            const name = animation.getName();
            publishedNames.add(name);
            if (!catalogue.has(name)) console.log(`dropped ${name} (no longer in CLIP)`);
            if (replaced.has(name) || !catalogue.has(name)) animation.dispose();
        }

        const nodesByName = new Map(
            published
                .getRoot()
                .listNodes()
                .map((node) => [node.getName(), node])
        );
        const [publishedBuffer] = published.getRoot().listBuffers();
        const resolveDefault = createDefaultPropertyResolver(published, baked);
        copyToDocument(published, baked, bakedAnimations, (property: Property) => {
            if (property instanceof Buffer) return publishedBuffer;
            if (!(property instanceof Node)) return resolveDefault(property);
            const existing = nodesByName.get(property.getName());
            if (!existing)
                throw new Error(
                    `merged clip targets a node the published file lacks: ${property.getName()}`
                );
            return existing;
        });

        await published.transform(dedup(), prune());
        published
            .createExtension(EXTMeshoptCompression)
            .setRequired(true)
            .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
        await io.write(stagedPath, published);
        console.log(`merged ${replaced.size} clips into ${CLIP_BAKE_FILES.output}`);
        return new Set(Object.values(CLIP).filter((name) => !publishedNames.has(name)));
    }

    private async stripResampleAndCompress(
        io: NodeIO,
        rawPath: string,
        outputPath: string
    ): Promise<void> {
        const document = await io.read(rawPath);
        for (const animation of document.getRoot().listAnimations())
            for (const channel of animation.listChannels()) {
                const targetPath = channel.getTargetPath();
                const nodeName = channel.getTargetNode()?.getName() ?? "";
                const isDropped =
                    targetPath === "scale" ||
                    (targetPath === "translation" && !ClipCooker.TRANSLATION_NODES.has(nodeName));
                if (!isDropped) continue;

                const sampler = channel.getSampler();
                channel.dispose();
                if (sampler && sampler.listParents().length <= 1) sampler.dispose();
            }

        await document.transform(
            resample({ tolerance: ClipCooker.RESAMPLE_TOLERANCE }),
            dedup(),
            prune()
        );
        document
            .createExtension(EXTMeshoptCompression)
            .setRequired(true)
            .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
        await io.write(outputPath, document);
    }

    private verifyClipMarks(marksPath: string, durations: Map<string, number>): void {
        const baked = readJsonFile<Record<string, IBakedClipMarks>>(marksPath);
        const problems: string[] = [];
        for (const [name, clip] of Object.entries(baked)) {
            const seconds = durations.get(name);
            if (
                seconds === undefined ||
                Math.abs(seconds - clip.seconds) > ClipCooker.MAX_MARK_DRIFT_FRAMES / OUTPUT_FPS
            )
                throw new Error(
                    `${name}: baked marks assume ${clip.seconds}s but the published clip is ${seconds}s`
                );

            const normalise = (time: number): number => Math.min(1, time / seconds);
            const normalisedMarks: IClipMarks = {
                marks: Object.fromEntries(
                    Object.entries(clip.marks).map(([mark, time]) => [mark, normalise(time)])
                ),
                grip: clip.grip && { from: normalise(clip.grip.from), to: normalise(clip.grip.to) },
            };
            const isEmpty =
                Object.keys(normalisedMarks.marks).length === 0 && !normalisedMarks.grip;
            const known = CLIP_MARKS[name];
            if (!known) {
                if (!isEmpty)
                    problems.push(
                        `${name}: missing from CLIP_MARKS, baked ${JSON.stringify(normalisedMarks, ClipCooker.roundMark)}`
                    );
                continue;
            }
            const drifted = [
                ...Object.entries(normalisedMarks.marks).map(
                    ([mark, value]) => [mark, value, known.marks[mark]] as const
                ),
                ...(normalisedMarks.grip
                    ? ([
                          ["grip.from", normalisedMarks.grip.from, known.grip?.from],
                          ["grip.to", normalisedMarks.grip.to, known.grip?.to],
                      ] as const)
                    : []),
            ].filter(
                ([, value, expected]) =>
                    expected === undefined || Math.abs(value - expected) > ClipCooker.MARK_TOLERANCE
            );
            for (const [mark, value, expected] of drifted)
                problems.push(
                    `${name}.${mark}: constants say ${expected}, baked clip gives ${roundTo(value, ClipCooker.CLIP_MARK_PRECISION)}`
                );
        }
        if (problems.length > 0)
            throw new Error(`CLIP_MARKS is out of date:\n  ${problems.join("\n  ")}`);
        console.log("CLIP_MARKS match the baked clips");
    }

    private verifyCatalogue(names: Set<string>, missingBefore: Set<string>): void {
        const missing = Object.values(CLIP).filter(
            (name) => !names.has(name) && !CLIPS_PROVIDED_BY_CHARACTER_MODEL.includes(name)
        );
        const stillMissing = missing.filter((name) => missingBefore.has(name));
        const newlyMissing = missing.filter((name) => !missingBefore.has(name));
        if (stillMissing.length > 0)
            console.log(
                `still missing (already absent before the merge): ${stillMissing.join(", ")}`
            );
        if (newlyMissing.length > 0)
            throw new Error(`CombatClips.glb is missing clips: ${newlyMissing.join(", ")}`);
    }

    private enforceBudget(stagedPath: string, clipCount: number): void {
        const owner = assetCategory("characters");
        const relativePath = path.basename(CLIP_BAKE_FILES.output);
        const budget = owner.budgetForFile(relativePath);
        if (budget === undefined)
            throw new Error(`${owner.name} has no file budget for ${relativePath}`);

        const bytes = fs.statSync(stagedPath).size;
        console.log(
            `${CLIP_BAKE_FILES.output}: ${clipCount} clips, ${formatMegabytes(bytes)} / ${budget} MB`
        );
        if (toMegabytes(bytes) > budget)
            throw new Error(`${relativePath} exceeds its ${budget} MB budget; not published`);
    }

    private publish(stagedPath: string): void {
        const cookedPath = path.join(
            PIPELINE_CONFIG.outputRoot,
            path.relative(PIPELINE_CONFIG.sourceRoot, CLIP_BAKE_FILES.output)
        );
        for (const destination of [CLIP_BAKE_FILES.output, cookedPath]) {
            copyFileWithFolders(stagedPath, destination);
            console.log(`published ${destination}`);
        }
    }
}

export class ClipAudition extends PipelineCommand {
    private static readonly AUDITION_LOG_PREFIXES = [
        "BAKED",
        "GROUND",
        "CHECK",
        "STRIKE",
        "AUDITION",
    ];

    private static readonly SHEET_COLUMNS = 10;

    private static readonly SHEET_PAGE_FRAMES = 40;

    private static readonly SHEET_VIEWS = ["front", "side", "close", "rear"] as const;

    private static readonly SCRATCH_ROOT = fs.realpathSync(os.tmpdir());

    private static readonly isSourceRig = (rig: string): rig is SourceRig =>
        (SOURCE_RIGS as readonly string[]).includes(rig);

    readonly usage =
        "--out <dir> (--clip <ClipName> | --source <file> --rig <rig> [--from --to --calibration --action --extract --align-travel]) [--step n]";
    readonly summary =
        "Bake one clip and render front/side/close contact sheets with a motion profile";

    async run(args: readonly string[]): Promise<void> {
        const { values } = parseArgs({
            args: [...args],
            options: {
                clip: { type: "string" },
                source: { type: "string" },
                rig: { type: "string" },
                from: { type: "string", default: "0" },
                to: { type: "string", default: "0" },
                step: { type: "string", default: "1" },
                calibration: { type: "string" },
                out: { type: "string" },
                action: { type: "string" },
                extract: { type: "boolean", default: false },
                "align-travel": { type: "boolean", default: false },
            },
        });
        if (!values.out) throw new Error(`audition needs --out; usage: ${this.usage}`);

        const jobs = values.clip ? this.manifestJobs(values.clip) : [this.sourceJob(values)];
        const outDirectory = path.resolve(values.out);
        this.prepareOutDirectory(outDirectory);

        const jobPath = path.join(outDirectory, "job.json");
        fs.writeFileSync(
            jobPath,
            JSON.stringify({
                fps: OUTPUT_FPS,
                target: path.resolve(CLIP_BAKE_FILES.target),
                jobs,
                game: await gameFit(await createGltfIo([EXTMeshoptCompression])),
            })
        );
        const lines = new Blender().runScript(
            ["audition", jobPath, outDirectory, values.step],
            ClipAudition.AUDITION_LOG_PREFIXES
        );
        fs.writeFileSync(
            path.join(outDirectory, "profile.txt"),
            lines.filter((line) => line.startsWith("PROFILE")).join("\n")
        );
        await this.writeContactSheets(outDirectory);
    }

    private manifestJobs(clipName: string): ClipJob[] {
        const jobsByOutput = new Map<string, ClipJob>();
        for (const job of CLIP_JOBS) jobsByOutput.set(job.output, job);
        const ordered: ClipJob[] = [];
        const visiting = new Set<string>();
        const complete = new Set<string>();
        const visit = (name: string): void => {
            if (complete.has(name)) return;
            if (visiting.has(name))
                throw new Error(`clip pose cycle: ${[...visiting, name].join(" -> ")}`);
            const job = jobsByOutput.get(name);
            if (!job) throw new Error(`no manifest job outputs ${name}`);
            visiting.add(name);
            if (isBeatJob(job))
                for (const pose of authoredPoses(job)) if (!pose.library) visit(pose.clip);
            visiting.delete(name);
            complete.add(name);
            ordered.push(job);
        };
        visit(clipName);
        return ordered;
    }

    private sourceJob(values: {
        source?: string;
        rig?: string;
        from: string;
        to: string;
        calibration?: string;
        action?: string;
        extract: boolean;
        "align-travel": boolean;
    }): Omit<IRetargetJob, "output"> & { output: string } {
        if (!values.source || !values.rig)
            throw new Error("audition needs --clip, or --source with --rig");
        if (!ClipAudition.isSourceRig(values.rig))
            throw new Error(
                `unknown --rig ${values.rig}, expected one of ${SOURCE_RIGS.join(", ")}`
            );

        const from = Number(values.from);
        return {
            output: "Audition",
            source: path.resolve(values.source),
            rig: values.rig,
            frames: [from, Number(values.to)],
            rootMotion: values.extract ? "extract" : "inPlace",
            calibrationFrame: values.calibration === undefined ? from : Number(values.calibration),
            ...(values.action ? { action: values.action } : {}),
            ...(values["align-travel"] ? { alignToTravel: true } : {}),
        };
    }

    private prepareOutDirectory(outDirectory: string): void {
        const isInsideScratch = outDirectory.startsWith(ClipAudition.SCRATCH_ROOT + path.sep);
        const isEmptyOrMissing =
            !fs.existsSync(outDirectory) || fs.readdirSync(outDirectory).length === 0;
        if (!isInsideScratch && !isEmptyOrMissing)
            throw new Error(
                `refusing to clear ${outDirectory}: not empty and not inside ${ClipAudition.SCRATCH_ROOT}`
            );
        fs.rmSync(outDirectory, { recursive: true, force: true });
        fs.mkdirSync(outDirectory, { recursive: true });
    }

    private async writeContactSheets(outDirectory: string): Promise<void> {
        const renders = fs.readdirSync(outDirectory).filter((file) => file.endsWith(".png"));
        const sheets: { sheet: string; pageFrames: string[] }[] = [];
        for (const view of ClipAudition.SHEET_VIEWS) {
            const frames = renders.filter((file) => file.startsWith(`${view}_`)).sort();
            for (let page = 0; page * ClipAudition.SHEET_PAGE_FRAMES < frames.length; page += 1)
                sheets.push({
                    sheet: path.join(
                        outDirectory,
                        `sheet-${view}${page === 0 ? "" : `-${page + 1}`}.png`
                    ),
                    pageFrames: frames.slice(
                        page * ClipAudition.SHEET_PAGE_FRAMES,
                        (page + 1) * ClipAudition.SHEET_PAGE_FRAMES
                    ),
                });
        }
        await runWithConcurrency(
            sheets,
            PIPELINE_CONFIG.textures.concurrency,
            async ({ sheet, pageFrames }) => {
                await execFileAsync("montage", [
                    "-pointsize",
                    "11",
                    "-label",
                    "%t",
                    ...pageFrames.map((file) => path.join(outDirectory, file)),
                    "-tile",
                    `${Math.min(ClipAudition.SHEET_COLUMNS, pageFrames.length)}x`,
                    "-geometry",
                    "+2+2",
                    sheet,
                ]);
            }
        );
        for (const { sheet } of sheets) console.log(`SHEET ${sheet}`);
    }
}

export class ClipComparer extends PipelineCommand {
    private static readonly COMPARED_PATHS = new Set(["rotation", "translation"]);

    private static readonly SAME_ROTATION_DEGREES = 0.01;

    private static readonly SAME_TRANSLATION_CENTIMETRES = 0.01;

    private static readonly beforeRotation = new Quaternion();

    private static readonly afterRotation = new Quaternion();

    private static readClipFile(document: Document, clipName?: string): IClipFile {
        const rest = new Map<string, number[]>();
        for (const node of document.getRoot().listNodes()) {
            rest.set(`${node.getName()}|rotation`, node.getRotation());
            rest.set(`${node.getName()}|translation`, node.getTranslation());
        }

        const clips = new Map<string, IClipTracks>();
        for (const animation of document.getRoot().listAnimations()) {
            if (clipName && animation.getName() !== clipName) continue;
            const tracks = new Map<string, Interpolant>();
            let duration = 0;
            for (const channel of animation.listChannels()) {
                const targetPath = channel.getTargetPath() ?? "";
                const sampler = channel.getSampler();
                const input = sampler?.getInput();
                const output = sampler?.getOutput();
                if (!ClipComparer.COMPARED_PATHS.has(targetPath) || !input || !output) continue;

                const times = trackValues(input);
                const values = trackValues(output);
                const name = `${channel.getTargetNode()?.getName()}|${targetPath}`;
                const Track =
                    targetPath === "rotation" ? QuaternionKeyframeTrack : VectorKeyframeTrack;
                tracks.set(name, new Track(name, times, values).InterpolantFactoryMethodLinear());
                duration = Math.max(duration, times[times.length - 1]);
            }
            clips.set(animation.getName(), { duration, tracks });
        }
        return { clips, rest };
    }

    readonly usage = "<before.glb> <after.glb> [--clip <ClipName>]";
    readonly summary = "Report per-clip rotation/translation differences between two clip files";

    async run(args: readonly string[]): Promise<void> {
        const { values, positionals } = parseArgs({
            args: [...args],
            allowPositionals: true,
            options: { clip: { type: "string" } },
        });
        const [beforePath, afterPath] = positionals;
        if (!beforePath || !afterPath) throw new Error(`usage: compare-clips ${this.usage}`);

        const io = await createGltfIo([EXTMeshoptCompression]);
        const [before, after] = await Promise.all(
            [beforePath, afterPath].map(async (file) =>
                ClipComparer.readClipFile(await io.read(file), values.clip)
            )
        );
        const names = [...new Set([...before.clips.keys(), ...after.clips.keys()])].sort();
        if (names.length === 0) throw new Error(`no clip named ${values.clip} in either file`);

        let changed = 0;
        for (const name of names) {
            const beforeClip = before.clips.get(name);
            const afterClip = after.clips.get(name);
            if (!beforeClip || !afterClip) {
                console.log(`ONLY ${beforeClip ? beforePath : afterPath} ${name}`);
                changed += 1;
                continue;
            }
            if (!this.reportClip(name, beforeClip, afterClip, before.rest, after.rest))
                changed += 1;
        }
        console.log(`${names.length} clips compared, ${changed} changed`);
    }

    private reportClip(
        name: string,
        before: IClipTracks,
        after: IClipTracks,
        beforeRest: Map<string, number[]>,
        afterRest: Map<string, number[]>
    ): boolean {
        const rotation: IWorst = { value: 0, channel: "", time: 0 };
        const translation: IWorst = { value: 0, channel: "", time: 0 };
        let rotationSum = 0;
        let rotationSamples = 0;
        const duration = Math.max(before.duration, after.duration);
        const channels = new Set([...before.tracks.keys(), ...after.tracks.keys()]);

        const lastFrame = Math.round(duration * OUTPUT_FPS);
        for (const channel of channels) {
            const isRotation = channel.endsWith("|rotation");
            const worst = isRotation ? rotation : translation;
            const beforeSource = before.tracks.get(channel) ?? beforeRest.get(channel);
            const afterSource = after.tracks.get(channel) ?? afterRest.get(channel);
            if (!beforeSource || !afterSource) continue;
            for (let frame = 0; frame <= lastFrame; frame += 1) {
                const time = frame / OUTPUT_FPS;
                const a = Array.isArray(beforeSource) ? beforeSource : beforeSource.evaluate(time);
                const b = Array.isArray(afterSource) ? afterSource : afterSource.evaluate(time);
                const difference = isRotation
                    ? radiansToDegrees(
                          ClipComparer.beforeRotation
                              .fromArray(a)
                              .normalize()
                              .angleTo(ClipComparer.afterRotation.fromArray(b).normalize())
                      )
                    : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
                if (difference > worst.value) {
                    worst.value = difference;
                    worst.channel = channel;
                    worst.time = time;
                }
                if (isRotation) {
                    rotationSum += difference;
                    rotationSamples += 1;
                }
            }
        }

        const isSame =
            rotation.value < ClipComparer.SAME_ROTATION_DEGREES &&
            translation.value < ClipComparer.SAME_TRANSLATION_CENTIMETRES &&
            Math.abs(before.duration - after.duration) < 1e-4;
        const bone = (worst: IWorst): string => worst.channel.split("|")[0];
        console.log(
            isSame
                ? `SAME ${name}`
                : `DIFF ${name} rotation max ${rotation.value.toFixed(2)}° (${bone(rotation)} at ${rotation.time.toFixed(2)}s) ` +
                      `mean ${(rotationSum / Math.max(rotationSamples, 1)).toFixed(2)}° | ` +
                      `translation max ${translation.value.toFixed(2)} cm (${bone(translation)}) | ` +
                      `duration ${before.duration.toFixed(3)}s -> ${after.duration.toFixed(3)}s`
        );
        return isSame;
    }
}

function trackValues(accessor: Accessor): ArrayLike<number> {
    return (!accessor.getNormalized() && accessor.getArray()) || accessorValues(accessor);
}

async function carryAnchor(io: NodeIO): Promise<ICarryAnchor> {
    const carry = PLAYER_STARTING_WEAPON.carry;
    if (!carry) throw new Error("the player weapon has no carry mount");
    const weaponRoot = (await io.read(sourcePathOf(PLAYER_STARTING_WEAPON.modelPath))).getRoot();
    const bounds = new Box3();
    const meshBounds = new Box3();
    const matrix = new Matrix4();
    for (const node of weaponRoot.listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        matrix.fromArray(node.getWorldMatrix());
        for (const primitive of mesh.listPrimitives()) {
            const positions = primitive.getAttribute("POSITION");
            if (!positions) continue;
            meshBounds.min.fromArray(positions.getMin([0, 0, 0]));
            meshBounds.max.fromArray(positions.getMax([0, 0, 0]));
            bounds.union(meshBounds.applyMatrix4(matrix));
        }
    }
    const { lengthAxis, tipDirectionSign } = measureBladeAxes(bounds);
    const characterRoot = (await io.read(CLIP_BAKE_FILES.target)).getRoot();
    const bone = characterRoot.listNodes().find((node) => node.getName() === carry.bone);
    if (!bone) throw new Error(`${CLIP_BAKE_FILES.target} has no ${carry.bone} bone`);
    const boneFrame = new Quaternion().setFromRotationMatrix(
        new Matrix4().fromArray(bone.getWorldMatrix())
    );
    const carryRotation = new Quaternion().setFromEuler(
        new Euler(...(carry.rotationDegrees.map(degreesToRadians) as [number, number, number]))
    );
    return {
        bone: carry.bone,
        hilt: new Vector3(...carry.position)
            .divideScalar(PLAYER.height)
            .applyQuaternion(boneFrame)
            .toArray(),
        blade: axisVector(lengthAxis, tipDirectionSign, new Vector3())
            .applyQuaternion(carryRotation)
            .applyQuaternion(boneFrame)
            .toArray(),
    };
}

async function gameFit(io: NodeIO): Promise<typeof GAME_FIT & { carry: ICarryAnchor }> {
    return { ...GAME_FIT, carry: await carryAnchor(io) };
}
