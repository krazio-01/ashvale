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
    lightAttack: boolean;
    heavyAttack: boolean;
    heavyAttackHeld: boolean;
    dodge: boolean;
    parry: boolean;
    finisher: boolean;
    drawOrSheathe: boolean;
    toggleLock: boolean;
    cycleLock: number;
}

export class PlayerInput {
    private readonly heldCounts = new Map<InputAction, number>();
    private readonly pendingPresses = new Set<InputAction>();
    private mouseDeltaX = 0;
    private mouseDeltaY = 0;
    private wheelSteps = 0;
    private readonly listeners = new AbortController();
    private readonly commands: IPlayerCommands = {
        moveForward: 0,
        moveRight: 0,
        wantsSprint: false,
        crouchPressed: false,
        jump: false,
        lightAttack: false,
        heavyAttack: false,
        heavyAttackHeld: false,
        dodge: false,
        parry: false,
        finisher: false,
        drawOrSheathe: false,
        toggleLock: false,
        cycleLock: 0,
    };

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
        this.discardPresses();
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
    };

    constructor() {
        const signal = this.listeners.signal;
        window.addEventListener("keydown", this.handleKeyDown, { signal });
        window.addEventListener("keyup", this.handleKeyUp, { signal });
        window.addEventListener("mousedown", this.handleMouseDown, { signal });
        window.addEventListener("mouseup", this.handleMouseUp, { signal });
        window.addEventListener("mousemove", this.handleMouseMove, { signal });
        window.addEventListener("wheel", this.handleWheel, { passive: true, signal });
        window.addEventListener("contextmenu", this.handleContextMenu, { signal });
        window.addEventListener("blur", this.handleBlur, { signal });
    }

    read(): IPlayerCommands {
        const commands = this.commands;

        commands.moveForward = this.axis("backward", "forward");
        commands.moveRight = this.axis("left", "right");
        commands.dodge = this.consumePress("dodge");
        commands.wantsSprint = this.isHeld("sprint");
        commands.crouchPressed = this.consumePress("crouch");
        commands.jump = this.consumePress("jump");
        commands.lightAttack = this.consumePress("light");
        commands.heavyAttack = this.consumePress("heavy");
        commands.heavyAttackHeld = this.isHeld("heavy");
        commands.parry = this.consumePress("parry");
        commands.finisher = this.consumePress("finisher");
        commands.drawOrSheathe = this.consumePress("draw");
        commands.toggleLock = this.consumePress("lock");
        commands.cycleLock = this.consumeWheel();

        return commands;
    }

    private isHeld(action: InputAction): boolean {
        return (this.heldCounts.get(action) ?? 0) > 0;
    }

    private axis(negative: KeyAction, positive: KeyAction): number {
        return Number(this.isHeld(positive)) - Number(this.isHeld(negative));
    }

    private consumePress(action: InputAction): boolean {
        return this.pendingPresses.delete(action);
    }

    discardPresses(): void {
        this.pendingPresses.clear();
        this.wheelSteps = 0;
    }

    private consumeWheel(): number {
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
        this.listeners.abort();
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

for (const action of Object.keys(INPUT_BINDINGS) as KeyAction[])
    for (const code of INPUT_BINDINGS[action]) ACTION_BY_KEY_CODE.set(code, action);

for (const action of Object.keys(MOUSE_BINDINGS) as PointerAction[])
    ACTION_BY_MOUSE_BUTTON.set(MOUSE_BINDINGS[action], action);
