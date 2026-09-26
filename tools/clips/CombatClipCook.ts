import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, resample } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { CLIP } from "@/constants/characters";
import { CLIP_JOBS, CLIPS_PROVIDED_BY_CHARACTER_MODEL, MANIFEST } from "./combatClipManifest";
import { BYTES_PER_MEGABYTE, COMBAT_CLIPS_BUDGET_MB, formatMegabytes } from "../assets/assetConfig";
import { runRetarget } from "./BlenderRunner";

const TRANSLATION_NODES = new Set(["root", "pelvis"]);
const RESAMPLE_TOLERANCE = 1e-4;

async function stripChannels(io: NodeIO, rawPath: string): Promise<void> {
    const document = await io.read(rawPath);

    for (const animation of document.getRoot().listAnimations()) {
        for (const channel of animation.listChannels()) {
            const nodeName = channel.getTargetNode()?.getName() ?? "";
            const targetPath = channel.getTargetPath();
            const isDroppedScale = targetPath === "scale";
            const isDroppedTranslation =
                targetPath === "translation" && !TRANSLATION_NODES.has(nodeName);

            if (!isDroppedScale && !isDroppedTranslation) continue;

            const sampler = channel.getSampler();
            channel.dispose();
            if (sampler && sampler.listParents().length <= 1) sampler.dispose();
        }
    }

    await document.transform(resample({ tolerance: RESAMPLE_TOLERANCE }), dedup(), prune());
    document
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

    await io.write(MANIFEST.output, document);
}

function verifyCatalogue(names: Set<string>): void {
    const missing = Object.values(CLIP).filter(
        (name) => !names.has(name) && !CLIPS_PROVIDED_BY_CHARACTER_MODEL.includes(name)
    );
    if (missing.length > 0)
        throw new Error(`CombatClips.glb is missing clips: ${missing.join(", ")}`);
}

async function main(): Promise<void> {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({
        "meshopt.encoder": MeshoptEncoder,
        "meshopt.decoder": MeshoptDecoder,
    });

    const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "combat-clips-"));
    try {
        const jobsPath = path.join(workDirectory, "jobs.json");
        const rawPath = path.join(workDirectory, "raw.glb");

        fs.writeFileSync(
            jobsPath,
            JSON.stringify({
                target: path.resolve(MANIFEST.target),
                jobs: CLIP_JOBS,
            })
        );

        runRetarget("bake", [jobsPath, rawPath], ["BAKED", "EXPORTED", "MISSING_LIBRARY_CLIPS"]);

        await stripChannels(io, rawPath);
    } finally {
        fs.rmSync(workDirectory, { recursive: true, force: true });
    }

    const written = await io.read(MANIFEST.output);
    const names = new Set(
        written
            .getRoot()
            .listAnimations()
            .map((animation) => animation.getName())
    );
    verifyCatalogue(names);

    for (const animation of written.getRoot().listAnimations()) {
        const seconds = Math.max(
            0,
            ...animation.listSamplers().map((sampler) => sampler.getInput()?.getMax([])[0] ?? 0)
        );
        console.log(`CLIP ${animation.getName()} ${seconds.toFixed(3)}`);
    }

    const bytes = fs.statSync(MANIFEST.output).size;
    console.log(`${MANIFEST.output}: ${names.size} clips, ${formatMegabytes(bytes)} MB`);
    if (bytes / BYTES_PER_MEGABYTE > COMBAT_CLIPS_BUDGET_MB)
        throw new Error(`CombatClips.glb exceeds ${COMBAT_CLIPS_BUDGET_MB} MB budget`);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
