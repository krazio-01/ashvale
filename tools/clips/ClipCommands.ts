import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { NodeIO, type Document } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, resample } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { CLIP } from "@/constants/characters";
import { ASSET_CATALOGUE } from "../assets/AssetCategories";
import {
    Blender,
    PIPELINE_CONFIG,
    PipelineCommand,
    formatMegabytes,
    toMegabytes,
} from "../pipeline";
import {
    CLIP_JOBS,
    CLIP_LIBRARY,
    CLIPS_PROVIDED_BY_CHARACTER_MODEL,
    isAuthoredJob,
    SOURCE_RIGS,
    type ClipJob,
    type IRetargetJob,
    type SourceRig,
} from "./combatClipManifest";

const OUTPUT_FPS = 30;
const TRANSLATION_NODES = new Set(["root", "pelvis"]);
const RESAMPLE_TOLERANCE = 1e-4;
const BAKE_LOG_PREFIXES = ["BAKED", "GROUND", "CHECK", "EXPORTED"];
const AUDITION_LOG_PREFIXES = ["BAKED", "GROUND", "CHECK", "STRIKE", "AUDITION"];
const SHEET_COLUMNS = 10;
const SHEET_PAGE_FRAMES = 40;
const SHEET_VIEWS = ["front", "side", "close"] as const;
const SCRATCH_ROOT = fs.realpathSync(os.tmpdir());
const SAME_ROTATION_DEGREES = 0.01;
const SAME_TRANSLATION_CENTIMETRES = 0.01;

async function createClipIo(): Promise<NodeIO> {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    return new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({
        "meshopt.encoder": MeshoptEncoder,
        "meshopt.decoder": MeshoptDecoder,
    });
}

export class ClipCooker extends PipelineCommand {
    readonly name = "cook-clips";
    readonly usage = "";
    readonly summary = "Bake every manifest clip in Blender into CombatClips.glb (source + public)";

    async run(): Promise<void> {
        const io = await createClipIo();
        const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "combat-clips-"));
        try {
            const jobsPath = path.join(workDirectory, "jobs.json");
            const rawPath = path.join(workDirectory, "raw.glb");
            const stagedPath = path.join(workDirectory, path.basename(CLIP_LIBRARY.output));
            fs.writeFileSync(
                jobsPath,
                JSON.stringify({ target: path.resolve(CLIP_LIBRARY.target), jobs: CLIP_JOBS })
            );
            new Blender().runScript(
                PIPELINE_CONFIG.blender.script,
                ["bake", jobsPath, rawPath],
                BAKE_LOG_PREFIXES
            );
            await this.stripChannels(io, rawPath, stagedPath);

            const animations = (await io.read(stagedPath)).getRoot().listAnimations();
            const names = new Set(animations.map((animation) => animation.getName()));
            this.verifyCatalogue(names);
            for (const animation of animations) {
                const seconds = Math.max(
                    0,
                    ...animation
                        .listSamplers()
                        .map((sampler) => sampler.getInput()?.getMax([])[0] ?? 0)
                );
                console.log(`CLIP ${animation.getName()} ${seconds.toFixed(3)}`);
            }

            this.enforceBudget(stagedPath, names.size);
            this.publish(stagedPath);
        } finally {
            fs.rmSync(workDirectory, { recursive: true, force: true });
        }
    }

    private async stripChannels(io: NodeIO, rawPath: string, outputPath: string): Promise<void> {
        const document = await io.read(rawPath);
        for (const animation of document.getRoot().listAnimations())
            for (const channel of animation.listChannels()) {
                const targetPath = channel.getTargetPath();
                const nodeName = channel.getTargetNode()?.getName() ?? "";
                const isDropped =
                    targetPath === "scale" ||
                    (targetPath === "translation" && !TRANSLATION_NODES.has(nodeName));
                if (!isDropped) continue;

                const sampler = channel.getSampler();
                channel.dispose();
                if (sampler && sampler.listParents().length <= 1) sampler.dispose();
            }

        await document.transform(resample({ tolerance: RESAMPLE_TOLERANCE }), dedup(), prune());
        document
            .createExtension(EXTMeshoptCompression)
            .setRequired(true)
            .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
        await io.write(outputPath, document);
    }

    private verifyCatalogue(names: Set<string>): void {
        const missing = Object.values(CLIP).filter(
            (name) => !names.has(name) && !CLIPS_PROVIDED_BY_CHARACTER_MODEL.includes(name)
        );
        if (missing.length > 0)
            throw new Error(`CombatClips.glb is missing clips: ${missing.join(", ")}`);
    }

    private enforceBudget(stagedPath: string, clipCount: number): void {
        const owner = ASSET_CATALOGUE.ownerOfSourceFile(CLIP_LIBRARY.output);
        const relativePath = path.relative(owner.sourceDirectory, CLIP_LIBRARY.output);
        const budget = owner.budgetForFile(relativePath);
        if (budget === undefined)
            throw new Error(`${owner.name} has no file budget for ${relativePath}`);

        const bytes = fs.statSync(stagedPath).size;
        console.log(
            `${CLIP_LIBRARY.output}: ${clipCount} clips, ${formatMegabytes(bytes)} / ${budget} MB`
        );
        if (toMegabytes(bytes) > budget)
            throw new Error(`${relativePath} exceeds its ${budget} MB budget; not published`);
    }

    private publish(stagedPath: string): void {
        const cookedPath = path.join(
            PIPELINE_CONFIG.outputRoot,
            path.relative(PIPELINE_CONFIG.sourceRoot, CLIP_LIBRARY.output)
        );
        for (const destination of [CLIP_LIBRARY.output, cookedPath]) {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(stagedPath, destination);
            console.log(`published ${destination}`);
        }
    }
}

const isSourceRig = (rig: string): rig is SourceRig =>
    (SOURCE_RIGS as readonly string[]).includes(rig);

export class ClipAudition extends PipelineCommand {
    readonly name = "audition";
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
            JSON.stringify({ target: path.resolve(CLIP_LIBRARY.target), jobs })
        );
        const lines = new Blender().runScript(
            PIPELINE_CONFIG.blender.script,
            ["audition", jobPath, outDirectory, values.step],
            AUDITION_LOG_PREFIXES
        );
        fs.writeFileSync(
            path.join(outDirectory, "profile.txt"),
            lines.filter((line) => line.startsWith("PROFILE")).join("\n")
        );
        this.writeContactSheets(outDirectory);
    }

    private manifestJobs(clipName: string): ClipJob[] {
        const jobsByOutput = new Map<string, ClipJob>(CLIP_JOBS.map((job) => [job.output, job]));
        const ordered: ClipJob[] = [];
        const visit = (name: string, chain: readonly string[]): void => {
            if (chain.includes(name))
                throw new Error(`clip pose cycle: ${[...chain, name].join(" -> ")}`);
            const job = jobsByOutput.get(name);
            if (!job) throw new Error(`no manifest job outputs ${name}`);
            if (ordered.includes(job)) return;
            if (isAuthoredJob(job))
                for (const key of job.keys)
                    if (!key.pose.library) visit(key.pose.clip, [...chain, name]);
            ordered.push(job);
        };
        visit(clipName, []);
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
        if (!isSourceRig(values.rig))
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
        const isInsideScratch = outDirectory.startsWith(SCRATCH_ROOT + path.sep);
        const isEmptyOrMissing =
            !fs.existsSync(outDirectory) || fs.readdirSync(outDirectory).length === 0;
        if (!isInsideScratch && !isEmptyOrMissing)
            throw new Error(
                `refusing to clear ${outDirectory}: not empty and not inside ${SCRATCH_ROOT}`
            );
        fs.rmSync(outDirectory, { recursive: true, force: true });
        fs.mkdirSync(outDirectory, { recursive: true });
    }

    private writeContactSheets(outDirectory: string): void {
        const renders = fs.readdirSync(outDirectory).filter((file) => file.endsWith(".png"));
        for (const view of SHEET_VIEWS) {
            const frames = renders.filter((file) => file.startsWith(`${view}_`)).sort();
            for (let page = 0; page * SHEET_PAGE_FRAMES < frames.length; page += 1) {
                const pageFrames = frames.slice(
                    page * SHEET_PAGE_FRAMES,
                    (page + 1) * SHEET_PAGE_FRAMES
                );
                const sheet = path.join(
                    outDirectory,
                    `sheet-${view}${page === 0 ? "" : `-${page + 1}`}.png`
                );
                execFileSync("montage", [
                    "-pointsize",
                    "11",
                    "-label",
                    "%t",
                    ...pageFrames.map((file) => path.join(outDirectory, file)),
                    "-tile",
                    `${Math.min(SHEET_COLUMNS, pageFrames.length)}x`,
                    "-geometry",
                    "+2+2",
                    sheet,
                ]);
                console.log(`SHEET ${sheet}`);
            }
        }
    }
}

interface ITrack {
    times: number[];
    values: number[][];
}

interface IClipTracks {
    duration: number;
    tracks: Map<string, ITrack>;
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

const COMPARED_PATHS = new Set(["rotation", "translation"]);

function sampleTrack(track: ITrack, time: number, isRotation: boolean): number[] {
    const { times, values } = track;
    if (time <= times[0]) return values[0];
    if (time >= times[times.length - 1]) return values[values.length - 1];

    let upper = 1;
    while (times[upper] < time) upper += 1;
    const amount = (time - times[upper - 1]) / (times[upper] - times[upper - 1]);
    const from = values[upper - 1];
    const to = values[upper];
    const sign =
        isRotation && from.reduce((sum, value, index) => sum + value * to[index], 0) < 0 ? -1 : 1;
    const mixed = from.map((value, index) => value + (sign * to[index] - value) * amount);
    if (!isRotation) return mixed;
    const length = Math.hypot(...mixed);
    return mixed.map((value) => value / length);
}

function readClipFile(document: Document): IClipFile {
    const rest = new Map<string, number[]>();
    for (const node of document.getRoot().listNodes()) {
        rest.set(`${node.getName()}|rotation`, node.getRotation());
        rest.set(`${node.getName()}|translation`, node.getTranslation());
    }

    const clips = new Map<string, IClipTracks>();
    for (const animation of document.getRoot().listAnimations()) {
        const tracks = new Map<string, ITrack>();
        let duration = 0;
        for (const channel of animation.listChannels()) {
            const targetPath = channel.getTargetPath() ?? "";
            const input = channel.getSampler()?.getInput();
            const output = channel.getSampler()?.getOutput();
            if (!COMPARED_PATHS.has(targetPath) || !input || !output) continue;

            const times = Array.from(
                { length: input.getCount() },
                (_, index) => input.getElement(index, [])[0]
            );
            const values = Array.from({ length: output.getCount() }, (_, index) =>
                output.getElement(index, [])
            );
            tracks.set(`${channel.getTargetNode()?.getName()}|${targetPath}`, { times, values });
            duration = Math.max(duration, times[times.length - 1]);
        }
        clips.set(animation.getName(), { duration, tracks });
    }
    return { clips, rest };
}

export class ClipComparer extends PipelineCommand {
    readonly name = "compare-clips";
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

        const io = await createClipIo();
        const [before, after] = await Promise.all(
            [beforePath, afterPath].map(async (file) => readClipFile(await io.read(file)))
        );
        const names = [...new Set([...before.clips.keys(), ...after.clips.keys()])]
            .filter((name) => !values.clip || name === values.clip)
            .sort();
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

        for (const channel of channels) {
            const isRotation = channel.endsWith("|rotation");
            const valueAt = (
                clip: IClipTracks,
                rest: Map<string, number[]>,
                time: number
            ): number[] => {
                const track = clip.tracks.get(channel);
                return track ? sampleTrack(track, time, isRotation) : (rest.get(channel) ?? []);
            };
            for (let frame = 0; frame <= Math.round(duration * OUTPUT_FPS); frame += 1) {
                const time = frame / OUTPUT_FPS;
                const a = valueAt(before, beforeRest, time);
                const b = valueAt(after, afterRest, time);
                if (a.length === 0 || b.length === 0) continue;

                const unitDot = (): number =>
                    a.reduce((sum, value, index) => sum + value * b[index], 0) /
                    (Math.hypot(...a) * Math.hypot(...b));
                const difference = isRotation
                    ? (2 * Math.acos(Math.min(1, Math.abs(unitDot()))) * 180) / Math.PI
                    : Math.hypot(...a.map((value, index) => value - b[index])) * 100;
                const worst = isRotation ? rotation : translation;
                if (difference > worst.value)
                    Object.assign(worst, { value: difference, channel, time });
                if (isRotation) {
                    rotationSum += difference;
                    rotationSamples += 1;
                }
            }
        }

        const isSame =
            rotation.value < SAME_ROTATION_DEGREES &&
            translation.value < SAME_TRANSLATION_CENTIMETRES &&
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
