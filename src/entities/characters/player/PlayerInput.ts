import { INPUT_BINDINGS, MOUSE_BINDINGS } from "@/constants/player";

const ACTION_BY_KEY_CODE = new Map<string, KeyAction>();

const ACTION_BY_MOUSE_BUTTON = new Map<number, PointerAction>();

type KeyAction = keyof typeof INPUT_BINDINGS;

type PointerAction = keyof typeof MOUSE_BINDINGS;

type InputAction = KeyAction | PointerAction;

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
    draw: boolean;
    toggleLock: boolean;
    cycleLock: number;
}

export class PlayerInput {
    private readonly heldCounts = new Map<InputAction, number>();
    private readonly pendingPresses = new Set<InputAction>();
    private mouseDeltaX = 0;
    private mouseDeltaY = 0;
    private wheelSteps = 0;

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.repeat) return;
        const action = ACTION_BY_KEY_CODE.get(event.code);
        if (action) this.press(action);
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        const action = ACTION_BY_KEY_CODE.get(event.code);
        if (action) this.release(action);
    };

    private readonly handleMouseDown = (event: MouseEvent): void => {
        if (!document.pointerLockElement) return;
        const action = ACTION_BY_MOUSE_BUTTON.get(event.button);
        if (action) this.press(action);
    };

    private readonly handleMouseUp = (event: MouseEvent): void => {
        const action = ACTION_BY_MOUSE_BUTTON.get(event.button);
        if (action) this.release(action);
    };

    private readonly handleMouseMove = (event: MouseEvent): void => {
        if (!document.pointerLockElement) return;
        this.mouseDeltaX += event.movementX;
        this.mouseDeltaY += event.movementY;
    };

    private readonly handleWheel = (event: WheelEvent): void => {
        if (!document.pointerLockElement || event.deltaY === 0) return;
        this.wheelSteps += Math.sign(event.deltaY);
    };

    private readonly handleContextMenu = (event: MouseEvent): void => {
        if (document.pointerLockElement) event.preventDefault();
    };

    private readonly handleBlur = (): void => {
        this.heldCounts.clear();
        this.pendingPresses.clear();
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        this.wheelSteps = 0;
    };

    constructor() {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
        window.addEventListener("mousedown", this.handleMouseDown);
        window.addEventListener("mouseup", this.handleMouseUp);
        window.addEventListener("mousemove", this.handleMouseMove);
        window.addEventListener("wheel", this.handleWheel, { passive: true });
        window.addEventListener("contextmenu", this.handleContextMenu);
        window.addEventListener("blur", this.handleBlur);
    }

    isHeld(action: InputAction): boolean {
        return (this.heldCounts.get(action) ?? 0) > 0;
    }

    axis(negative: KeyAction, positive: KeyAction): number {
        return Number(this.isHeld(positive)) - Number(this.isHeld(negative));
    }

    consumePress(action: InputAction): boolean {
        return this.pendingPresses.delete(action);
    }

    discardPresses(): void {
        this.pendingPresses.clear();
        this.wheelSteps = 0;
    }

    consumeWheel(): number {
        const steps = this.wheelSteps;
        this.wheelSteps = 0;
        return steps;
    }

    consumeMouseDelta(target: { x: number; y: number }): void {
        target.x = this.mouseDeltaX;
        target.y = this.mouseDeltaY;
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
    }

    dispose(): void {
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
        window.removeEventListener("mousedown", this.handleMouseDown);
        window.removeEventListener("mouseup", this.handleMouseUp);
        window.removeEventListener("mousemove", this.handleMouseMove);
        window.removeEventListener("wheel", this.handleWheel);
        window.removeEventListener("contextmenu", this.handleContextMenu);
        window.removeEventListener("blur", this.handleBlur);
    }

    private press(action: InputAction): void {
        const count = (this.heldCounts.get(action) ?? 0) + 1;
        this.heldCounts.set(action, count);
        if (count > 1) return;

        this.pendingPresses.add(action);
    }

    private release(action: InputAction): void {
        const count = this.heldCounts.get(action) ?? 0;
        if (count === 0) return;

        this.heldCounts.set(action, count - 1);
    }
}

export class PlayerController {
    private readonly commands: IPlayerCommands = {
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
        draw: false,
        toggleLock: false,
        cycleLock: 0,
    };

    private readonly input = new PlayerInput();

    read(): IPlayerCommands {
        const commands = this.commands;
        const input = this.input;

        commands.moveForward = input.axis("backward", "forward");
        commands.moveRight = input.axis("left", "right");
        commands.dodge = input.consumePress("dodge");
        commands.wantsSprint = input.isHeld("sprint");
        commands.crouchPressed = input.consumePress("crouch");
        commands.jump = input.consumePress("jump");
        commands.light = input.consumePress("light");
        commands.heavy = input.consumePress("heavy");
        commands.heavyHeld = input.isHeld("heavy");
        commands.parry = input.consumePress("parry");
        commands.finisher = input.consumePress("finisher");
        commands.draw = input.consumePress("draw");
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

function isKeyAction(value: string): value is KeyAction {
    return value in INPUT_BINDINGS;
}

function isPointerAction(value: string): value is PointerAction {
    return value in MOUSE_BINDINGS;
}

for (const [action, codes] of Object.entries(INPUT_BINDINGS))
    if (isKeyAction(action)) for (const code of codes) ACTION_BY_KEY_CODE.set(code, action);

for (const [action, button] of Object.entries(MOUSE_BINDINGS))
    if (isPointerAction(action)) ACTION_BY_MOUSE_BUTTON.set(button, action);
