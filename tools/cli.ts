import {
    AssetCooker,
    AssetVerifier,
    SourceImporter,
    TranscoderInstaller,
} from "./assets/AssetCommands";
import { ClipAudition, ClipComparer, ClipCooker } from "./clips/ClipCommands";
import { describeError, type PipelineCommand } from "./pipeline";

const COMMANDS: readonly PipelineCommand[] = [
    new AssetCooker(),
    new AssetVerifier(),
    new SourceImporter(),
    new TranscoderInstaller(),
    new ClipCooker(),
    new ClipAudition(),
    new ClipComparer(),
];

function printUsage(): void {
    console.log("usage: npm run tools -- <command> [arguments]\n");
    const nameWidth = Math.max(...COMMANDS.map((command) => command.name.length));
    for (const command of COMMANDS) {
        console.log(`  ${command.name.padEnd(nameWidth)}  ${command.summary}`);
        if (command.usage) console.log(`  ${" ".repeat(nameWidth)}  ${command.usage}`);
    }
}

async function main(): Promise<void> {
    const [commandName, ...args] = process.argv.slice(2);
    const command = COMMANDS.find((candidate) => candidate.name === commandName);

    if (!command) {
        printUsage();
        if (commandName) throw new Error(`unknown command "${commandName}"`);
        return;
    }

    await command.run(args);
}

main().catch((error: unknown) => {
    console.error(describeError(error));
    process.exitCode = 1;
});
