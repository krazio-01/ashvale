import { execFileSync } from "node:child_process";
import { MANIFEST } from "./combatClipManifest";

const RETARGET_SCRIPT = "tools/blender/RetargetClips.py";
const BLENDER_LOG_BUFFER_BYTES = 256 * 1024 * 1024;

type RetargetMode = "bake" | "audition";

export function runRetarget(
    mode: RetargetMode,
    args: string[],
    echoPrefixes: readonly string[]
): string[] {
    const log = execFileSync(
        MANIFEST.blender,
        ["-b", "--python", RETARGET_SCRIPT, "--", mode, ...args],
        { encoding: "utf8", maxBuffer: BLENDER_LOG_BUFFER_BYTES }
    );
    const lines = log.split("\n");
    for (const line of lines)
        if (echoPrefixes.some((prefix) => line.startsWith(prefix))) console.log(line);
    return lines;
}
