import { TranscoderInstaller, describeError, type PipelineCommand } from "./pipeline";

const assetCommands = () => import("./assets/AssetCommands");
const clipCommands = () => import("./clips/ClipCommands");

const COMMANDS = new Map<string, () => Promise<PipelineCommand>>([
    ["cook", async () => new (await assetCommands()).AssetCooker()],
    ["verify", async () => new (await assetCommands()).AssetVerifier()],
    ["ground", async () => new (await assetCommands()).GroundSurfaceCooker()],
    ["model-list", async () => new (await assetCommands()).ModelListWriter()],
    ["check-pairs", async () => new (await assetCommands()).PairChecker()],
    ["import", async () => new (await assetCommands()).SourceImporter()],
    ["sync-transcoder", async () => new TranscoderInstaller()],
    ["cook-clips", async () => new (await clipCommands()).ClipCooker()],
    ["audition", async () => new (await clipCommands()).ClipAudition()],
    ["compare-clips", async () => new (await clipCommands()).ClipComparer()],
]);

async function printUsage(): Promise<void> {
    console.log("usage: npm run tools -- <command> [arguments]\n");
    const nameWidth = Math.max(...[...COMMANDS.keys()].map((name) => name.length));
    for (const [name, load] of COMMANDS) {
        const command = await load();
        console.log(`  ${name.padEnd(nameWidth)}  ${command.summary}`);
        if (command.usage) console.log(`  ${" ".repeat(nameWidth)}  ${command.usage}`);
    }
}

async function main(): Promise<void> {
    const [commandName, ...args] = process.argv.slice(2);
    const load = COMMANDS.get(commandName);

    if (!load) {
        await printUsage();
        if (commandName) throw new Error(`unknown command "${commandName}"`);
        return;
    }

    await (await load()).run(args);
}

main().catch((error: unknown) => {
    console.error(describeError(error));
    process.exitCode = 1;
});
