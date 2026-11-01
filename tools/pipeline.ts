import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GAME_ASSETS_ROOT =
    process.env.GAME_ASSETS_ROOT ?? path.join(os.homedir(), "Documents/Personal/gameAssets");

export const PIPELINE_CONFIG = {
    sourceRoot: "assets-src/models",
    outputRoot: "public/models",
    transcoder: {
        sourceRoot: "node_modules/three/examples/jsm/libs/basis",
        outputRoot: "public/vendor/basis",
        files: ["basis_transcoder.js", "basis_transcoder.wasm"],
    },
    blender: {
        binary: process.env.BLENDER_BIN ?? "/snap/bin/blender",
        script: "tools/blender/BlenderPipeline.py",
    },
    gameAssetsRoot: GAME_ASSETS_ROOT,
    combatAssetsRoot:
        process.env.COMBAT_ASSETS_ROOT ?? path.join(GAME_ASSETS_ROOT, "combat/extracted"),
    characters: {
        workRoot: ".local/characters",
        blenderPackages: {
            directory:
                process.env.ASHVALE_BLENDER_PACKAGES ??
                path.join(os.homedir(), ".cache/ashvale/blender-site-packages"),
            pythonVersion: "3.13",
            platforms: ["manylinux_2_28_x86_64", "manylinux2014_x86_64"],
            requirements: ["xatlas==0.0.11", "scipy==1.18.1"],
        },
    },
    python: { interpreter: process.env.PYTHON_BIN ?? "python3" },
    maxTextureSize: 1024,
    geometryDriftTolerance: 1e-3,
} as const;

const BYTES_PER_MEGABYTE = 1_048_576;

export abstract class PipelineCommand {
    abstract readonly name: string;
    abstract readonly usage: string;
    abstract readonly summary: string;

    abstract run(args: readonly string[]): Promise<void>;
}

export class FileTree {
    readonly root: string;
    readonly files: readonly string[];

    private constructor(root: string, files: readonly string[]) {
        this.root = root;
        this.files = files;
    }

    static scan(root: string): FileTree {
        return new FileTree(root, listFilesRecursively(root));
    }

    withExtensions(...extensions: string[]): string[] {
        return this.files.filter((file) =>
            extensions.some((extension) => file.endsWith(extension))
        );
    }

    relativePath(file: string): string {
        return path.relative(this.root, file);
    }

    topFolderOf(file: string): string {
        return this.relativePath(file).split(path.sep)[0];
    }

    mirrorPath(file: string, otherRoot: string): string {
        return path.join(otherRoot, this.relativePath(file));
    }

    totalBytes(): number {
        return this.files.reduce((total, file) => total + fs.statSync(file).size, 0);
    }

    bytesByTopFolder(): Map<string, number> {
        const bytesByFolder = new Map<string, number>();
        for (const file of this.files) {
            const folder = this.topFolderOf(file);
            bytesByFolder.set(folder, (bytesByFolder.get(folder) ?? 0) + fs.statSync(file).size);
        }
        return bytesByFolder;
    }
}

export class Blender {
    private static readonly PROCESS_LOG_BUFFER_BYTES = 256 * 1024 * 1024;

    assertInstalled(): void {
        const { binary } = PIPELINE_CONFIG.blender;
        assertExists(binary, `blender not found at ${binary}: install it or set BLENDER_BIN`);
    }

    runScript(args: readonly string[], echoPrefixes: readonly string[]): string[] {
        const { binary, script } = PIPELINE_CONFIG.blender;
        const log = execFileSync(
            binary,
            ["-b", "--python-exit-code", "1", "--python", script, "--", ...args],
            {
                encoding: "utf8",
                maxBuffer: Blender.PROCESS_LOG_BUFFER_BYTES,
                env: {
                    ...process.env,
                    ASHVALE_BLENDER_PACKAGES: PIPELINE_CONFIG.characters.blenderPackages.directory,
                },
            }
        );
        const lines = log.split("\n");
        for (const line of lines)
            if (echoPrefixes.some((prefix) => line.startsWith(prefix))) console.log(line);
        return lines;
    }
}

export const toMegabytes = (bytes: number): number => bytes / BYTES_PER_MEGABYTE;

export const formatMegabytes = (bytes: number): string => toMegabytes(bytes).toFixed(1);

export const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export const assertExists = (file: string, message: string): void => {
    if (!fs.existsSync(file)) throw new Error(message);
};

export const isWithin = (parent: string, child: string): boolean =>
    child === parent || child.startsWith(parent + path.sep);

export const readJsonFile = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

export const copyFileWithFolders = (source: string, destination: string): void => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
};

export const sourcePathOf = (publicUrl: string): string =>
    path.join(path.dirname(PIPELINE_CONFIG.sourceRoot), publicUrl);

const listFilesRecursively = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
    });

export const ensureBlenderPackages = (): void => {
    const { directory, pythonVersion, platforms, requirements } =
        PIPELINE_CONFIG.characters.blenderPackages;
    const marker = path.join(directory, ".installed");
    const wanted = requirements.join(" ");
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === wanted) return;

    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "ashvale-wheels-"));
    try {
        execFileSync(
            PIPELINE_CONFIG.python.interpreter,
            [
                "-m",
                "pip",
                "download",
                "--quiet",
                "--only-binary=:all:",
                "--no-deps",
                "--python-version",
                pythonVersion,
                ...platforms.flatMap((platform) => ["--platform", platform]),
                "--dest",
                downloads,
                ...requirements,
            ],
            { stdio: "inherit" }
        );
        fs.rmSync(directory, { recursive: true, force: true });
        fs.mkdirSync(directory, { recursive: true });
        for (const wheel of fs.readdirSync(downloads).filter((file) => file.endsWith(".whl")))
            execFileSync(PIPELINE_CONFIG.python.interpreter, [
                "-m",
                "zipfile",
                "-e",
                path.join(downloads, wheel),
                directory,
            ]);
        fs.writeFileSync(marker, wanted);
        console.log(`blender packages installed in ${directory}: ${wanted}`);
    } finally {
        fs.rmSync(downloads, { recursive: true, force: true });
    }
};
