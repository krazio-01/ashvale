import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { runRetarget } from "./BlenderRunner";
import { MANIFEST, SOURCE_RIGS } from "./combatClipManifest";
import type { IClipJob, SourceRig } from "./combatClipManifest";

const SHEET_COLUMNS = 10;
const SHEET_PAGE_FRAMES = 40;
const VIEWS = ["front", "side"] as const;
const SCRATCH_ROOT = fs.realpathSync(os.tmpdir());

interface IAuditionJob extends Omit<IClipJob, "output"> {
    target: string;
    output: string;
}

const isSourceRig = (rig: string): rig is SourceRig =>
    (SOURCE_RIGS as readonly string[]).includes(rig);

function prepareOutDirectory(outDirectory: string): void {
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

function writeContactSheets(outDirectory: string): void {
    const renders = fs.readdirSync(outDirectory).filter((file) => file.endsWith(".png"));
    for (const view of VIEWS) {
        const frames = renders.filter((file) => file.startsWith(`${view}_`)).sort();
        for (let page = 0; page * SHEET_PAGE_FRAMES < frames.length; page += 1) {
            const pageFrames = frames.slice(
                page * SHEET_PAGE_FRAMES,
                (page + 1) * SHEET_PAGE_FRAMES
            );
            const suffix = page === 0 ? "" : `-${page + 1}`;
            const sheet = path.join(outDirectory, `sheet-${view}${suffix}.png`);
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

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
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

    if (!values.source || !values.rig || !values.out)
        throw new Error("audition needs --source, --rig and --out");
    if (!isSourceRig(values.rig))
        throw new Error(`unknown --rig ${values.rig}, expected one of ${SOURCE_RIGS.join(", ")}`);

    const outDirectory = path.resolve(values.out);
    prepareOutDirectory(outDirectory);

    const from = Number(values.from);
    const job: IAuditionJob = {
        target: path.resolve(MANIFEST.target),
        output: "Audition",
        source: path.resolve(values.source),
        rig: values.rig,
        frames: [from, Number(values.to)],
        rootMotion: values.extract ? "extract" : "inPlace",
        calibrationFrame: values.calibration === undefined ? from : Number(values.calibration),
        ...(values.action ? { action: values.action } : {}),
        ...(values["align-travel"] ? { alignToTravel: true } : {}),
    };
    const jobPath = path.join(outDirectory, "job.json");
    fs.writeFileSync(jobPath, JSON.stringify(job));

    const lines = runRetarget(
        "audition",
        [jobPath, outDirectory, values.step],
        ["STRIKE", "AUDITION"]
    );
    fs.writeFileSync(
        path.join(outDirectory, "profile.txt"),
        lines.filter((line) => line.startsWith("PROFILE")).join("\n")
    );

    writeContactSheets(outDirectory);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
