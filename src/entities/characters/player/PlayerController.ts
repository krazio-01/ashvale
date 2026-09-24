import { PlayerInput } from "@/entities/characters/player/PlayerInput";

export interface IPlayerCommands {
    moveForward: number;
    moveRight: number;
    wantsSprint: boolean;
    crouchPressed: boolean;
    jump: boolean;
    light: boolean;
    heavy: boolean;
    heavyHeld: boolean;
    dodge: boolean;
    parry: boolean;
    finisher: boolean;
    toggleLock: boolean;
    cycleLock: number;
}

export class PlayerController {
    readonly commands: IPlayerCommands = {
        moveForward: 0,
        moveRight: 0,
        wantsSprint: false,
        crouchPressed: false,
        jump: false,
        light: false,
        heavy: false,
        heavyHeld: false,
        dodge: false,
        parry: false,
        finisher: false,
        toggleLock: false,
        cycleLock: 0,
    };

    private readonly input = new PlayerInput();

    read(): IPlayerCommands {
        const commands = this.commands;
        const input = this.input;

        commands.moveForward = input.axis("backward", "forward");
        commands.moveRight = input.axis("left", "right");
        commands.dodge = input.consumePress("evade");
        commands.wantsSprint = input.isHeld("evade");
        commands.crouchPressed = input.consumePress("crouch");
        commands.jump = input.consumePress("jump");
        commands.light = input.consumePress("light");
        commands.heavy = input.consumePress("heavy");
        commands.heavyHeld = input.isHeld("heavy");
        commands.parry = input.consumePress("parry");
        commands.finisher = input.consumePress("finisher");
        commands.toggleLock = input.consumePress("lock");
        commands.cycleLock = input.consumeWheel();

        return commands;
    }

    discardPending(): void {
        this.input.discardPresses();
    }

    consumeLook(target: { x: number; y: number }): void {
        this.input.consumeMouseDelta(target);
    }

    dispose(): void {
        this.input.dispose();
    }
}
