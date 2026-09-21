import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import type { Node } from "@gltf-transform/core";

const REFERENCE_MODEL = "public/models/characters/UAL1_Standard.glb";
const CLIP_LIBRARIES = [
    "public/models/characters/UAL1_Standard.glb",
    "public/models/characters/UAL2_Standard.glb",
];
const POSTURE_REPORT_THRESHOLD_DEGREES = 5;
const AXIS_MISMATCH_DEGREES = 75;
const SYMMETRY_TOLERANCE_DEGREES = 1;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const SIDE_SUFFIX = /_(l|r)$/;

type Quaternion = [number, number, number, number];

interface IRestPose {
    rotation: Quaternion;
    translation: [number, number, number];
}

async function readJointPoses(io: NodeIO, file: string): Promise<Map<string, IRestPose>> {
    const document = await io.read(file);
    const poses = new Map<string, IRestPose>();

    for (const skin of document.getRoot().listSkins())
        for (const joint of skin.listJoints()) collectJoint(joint, poses);

    return poses;
}

function collectJoint(joint: Node, poses: Map<string, IRestPose>): void {
    const name = joint.getName();
    if (!name || poses.has(name)) return;

    poses.set(name, {
        rotation: joint.getRotation() as Quaternion,
        translation: joint.getTranslation() as [number, number, number],
    });
}

function angleBetweenDegrees(first: Quaternion, second: Quaternion): number {
    let dot = 0;
    for (let index = 0; index < 4; index += 1) dot += (first[index] ?? 0) * (second[index] ?? 0);

    return 2 * Math.acos(Math.min(1, Math.abs(dot))) * DEGREES_PER_RADIAN;
}

async function readAnimatedBoneNames(io: NodeIO, files: string[]): Promise<Set<string>> {
    const names = new Set<string>();

    for (const file of files) {
        const document = await io.read(file);

        for (const animation of document.getRoot().listAnimations())
            for (const channel of animation.listChannels()) {
                const name = channel.getTargetNode()?.getName();
                if (name) names.add(name);
            }
    }

    return names;
}

function reportCompatibility(divergenceByBone: Map<string, number>): void {
    const perpendicular: string[] = [];
    const asymmetric: string[] = [];

    for (const [name, degrees] of divergenceByBone) {
        if (degrees > AXIS_MISMATCH_DEGREES) perpendicular.push(`${name}: ${degrees.toFixed(1)} deg`);

        const side = SIDE_SUFFIX.exec(name)?.[1];
        if (side !== "l") continue;

        const mirrored = divergenceByBone.get(name.replace(SIDE_SUFFIX, "_r"));
        if (mirrored === undefined) continue;

        if (Math.abs(mirrored - degrees) > SYMMETRY_TOLERANCE_DEGREES)
            asymmetric.push(
                `${name}: ${degrees.toFixed(1)} deg vs mirror ${mirrored.toFixed(1)} deg`
            );
    }

    reportList(`bones diverging beyond ${AXIS_MISMATCH_DEGREES} deg (axis mismatch)`, perpendicular);
    reportList("left/right pairs disagreeing (axis mismatch)", asymmetric);

    const isCompatible = perpendicular.length === 0 && asymmetric.length === 0;

    console.log(
        `\nVERDICT: ${
            isCompatible
                ? "bone axes consistent - clips should retarget; confirm posture visually"
                : "AXIS MISMATCH - clips will not retarget correctly"
        }`
    );
}

function reportList(label: string, entries: string[]): void {
    console.log(`\n${label} (${entries.length}):`);
    console.log(entries.length > 0 ? entries.map((entry) => `  ${entry}`).join("\n") : "  none");
}

async function main(): Promise<void> {
    const targetFile = process.argv[2];
    if (!targetFile) throw new Error("usage: tsx tools/SkeletonProbe.ts <monster.glb>");

    const io = new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]);
    const reference = await readJointPoses(io, REFERENCE_MODEL);
    const target = await readJointPoses(io, targetFile);

    console.log(`reference joints: ${reference.size}  target joints: ${target.size}`);

    const missing: string[] = [];
    const divergenceByBone = new Map<string, number>();

    for (const [name, targetPose] of target) {
        const referencePose = reference.get(name);

        if (!referencePose) {
            missing.push(name);
            continue;
        }

        divergenceByBone.set(
            name,
            angleBetweenDegrees(referencePose.rotation, targetPose.rotation)
        );
    }

    reportList("target joints absent from reference", missing);

    const posture = [...divergenceByBone]
        .filter(([, degrees]) => degrees > POSTURE_REPORT_THRESHOLD_DEGREES)
        .map(([name, degrees]) => `${name}: ${degrees.toFixed(1)} deg`);

    reportList(
        `rest-pose divergence beyond ${POSTURE_REPORT_THRESHOLD_DEGREES} deg (posture difference, not a defect)`,
        posture
    );

    const animatedBones = await readAnimatedBoneNames(io, CLIP_LIBRARIES);
    const unbindable = [...animatedBones].filter((name) => !target.has(name));

    reportList(`clip-targeted bones absent from ${path.basename(targetFile)}`, unbindable);

    reportCompatibility(divergenceByBone);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
