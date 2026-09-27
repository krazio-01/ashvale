import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { formatMegabytes } from "./assetConfig";

const OUTPUT_DIRECTORY = "assets-src/models/characters";
const CREATURE_NAMES = ["Imp", "Puglin"];

function stripUnshadedTextures(document: Awaited<ReturnType<NodeIO["read"]>>): void {
    for (const material of document.getRoot().listMaterials()) {
        material.setMetallicRoughnessTexture(null);
        material.setOcclusionTexture(null);
        material.setEmissiveTexture(null);
        material.setEmissiveFactor([0, 0, 0]);
    }
}

function assignTextureUris(document: Awaited<ReturnType<NodeIO["read"]>>, name: string): void {
    for (const material of document.getRoot().listMaterials()) {
        material.getBaseColorTexture()?.setURI(`${name}_baseColor.png`);
        material.getNormalTexture()?.setURI(`${name}_normal.png`);
    }
}

async function prepareCreature(io: NodeIO, stagingDirectory: string, name: string): Promise<void> {
    const sourceFile = path.join(stagingDirectory, `${name}.glb`);
    const sourceBytes = fs.statSync(sourceFile).size;

    const document = await io.read(sourceFile);
    stripUnshadedTextures(document);
    await document.transform(prune());
    assignTextureUris(document, name);

    const root = document.getRoot();
    const keptTextures = root.listTextures().map((texture) => texture.getName() || "unnamed");

    await io.write(path.join(OUTPUT_DIRECTORY, `${name}.gltf`), document);

    console.log(
        `${name}: ${formatMegabytes(sourceBytes)} MB source, ${root.listSkins().length} skin(s), ` +
            `${keptTextures.length} texture(s) kept -> ${keptTextures.join(", ")}`
    );
}

function reportOutputSizes(): void {
    console.log(`\nwritten to ${OUTPUT_DIRECTORY}`);

    let total = 0;

    for (const file of fs.readdirSync(OUTPUT_DIRECTORY).sort()) {
        const bytes = fs.statSync(path.join(OUTPUT_DIRECTORY, file)).size;
        total += bytes;
        console.log(`  ${file}: ${formatMegabytes(bytes)} MB`);
    }

    console.log(`  total: ${formatMegabytes(total)} MB`);
}

async function main(): Promise<void> {
    const stagingDirectory = process.argv[2];
    if (!stagingDirectory)
        throw new Error("usage: tsx tools/assets/CharacterSourcePrep.ts <staging-directory>");

    fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    const io = new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]);

    for (const name of CREATURE_NAMES) await prepareCreature(io, stagingDirectory, name);

    reportOutputSizes();
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
