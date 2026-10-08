import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    combatAssetsRoot:
        process.env.COMBAT_ASSETS_ROOT ??
        path.join(os.homedir(), "Downloads/assets/Combat/extracted"),
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
    encodeConcurrency: 1,
    geometryDriftTolerance: 1e-3,
} as const;

export const BYTES_PER_MEGABYTE = 1_048_576;

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

export abstract class PipelineCommand {
    abstract readonly name: string;
    abstract readonly usage: string;
    abstract readonly summary: string;

    abstract run(args: readonly string[]): Promise<void>;
}

const listFilesRecursively = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
    });

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

const PROCESS_LOG_BUFFER_BYTES = 256 * 1024 * 1024;

export class BlenderPackages {
    private readonly settings = PIPELINE_CONFIG.characters.blenderPackages;

    get directory(): string {
        return this.settings.directory;
    }

    ensureInstalled(): void {
        const marker = path.join(this.directory, ".installed");
        const wanted = this.settings.requirements.join(" ");
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
                    this.settings.pythonVersion,
                    ...this.settings.platforms.flatMap((platform) => ["--platform", platform]),
                    "--dest",
                    downloads,
                    ...this.settings.requirements,
                ],
                { stdio: "inherit" }
            );
            fs.rmSync(this.directory, { recursive: true, force: true });
            fs.mkdirSync(this.directory, { recursive: true });
            for (const wheel of fs.readdirSync(downloads).filter((file) => file.endsWith(".whl")))
                execFileSync(PIPELINE_CONFIG.python.interpreter, [
                    "-m",
                    "zipfile",
                    "-e",
                    path.join(downloads, wheel),
                    this.directory,
                ]);
            fs.writeFileSync(marker, wanted);
            console.log(`blender packages installed in ${this.directory}: ${wanted}`);
        } finally {
            fs.rmSync(downloads, { recursive: true, force: true });
        }
    }
}

export class Blender {
    private readonly binary: string;

    constructor(binary: string = PIPELINE_CONFIG.blender.binary) {
        this.binary = binary;
    }

    assertInstalled(): void {
        assertExists(
            this.binary,
            `blender not found at ${this.binary}: install it or set BLENDER_BIN`
        );
    }

    runScript(script: string, args: readonly string[], echoPrefixes: readonly string[]): string[] {
        const log = execFileSync(
            this.binary,
            ["-b", "--python-exit-code", "1", "--python", script, "--", ...args],
            {
                encoding: "utf8",
                maxBuffer: PROCESS_LOG_BUFFER_BYTES,
                env: { ...process.env, ASHVALE_BLENDER_PACKAGES: new BlenderPackages().directory },
            }
        );
        const lines = log.split("\n");
        for (const line of lines)
            if (echoPrefixes.some((prefix) => line.startsWith(prefix))) console.log(line);
        return lines;
    }
}
