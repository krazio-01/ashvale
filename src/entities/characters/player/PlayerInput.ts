import { INPUT_BINDINGS, MOUSE_BINDINGS } from "@/constants/combat";

export type KeyAction = keyof typeof INPUT_BINDINGS;
export type PointerAction = keyof typeof MOUSE_BINDINGS;
export type InputAction = KeyAction | PointerAction;

function isKeyAction(value: string): value is KeyAction {
    return value in INPUT_BINDINGS;
}

function isPointerAction(value: string): value is PointerAction {
    return value in MOUSE_BINDINGS;
}

const KEY_ACTIONS = new Map<string, KeyAction>();
for (const [action, codes] of Object.entries(INPUT_BINDINGS))
    if (isKeyAction(action)) for (const code of codes) KEY_ACTIONS.set(code, action);

const POINTER_ACTIONS = new Map<number, PointerAction>();
for (const [action, button] of Object.entries(MOUSE_BINDINGS))
    if (isPointerAction(action)) POINTER_ACTIONS.set(button, action);

export class PlayerInput {
    private readonly heldCounts = new Map<InputAction, number>();
    private readonly pressedAt = new Map<InputAction, number>();
    private readonly pressed = new Set<InputAction>();
    private mouseDeltaX = 0;
    private mouseDeltaY = 0;
    private wheelSteps = 0;

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.repeat) return;
        const action = KEY_ACTIONS.get(event.code);
        if (action) this.press(action);
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        const action = KEY_ACTIONS.get(event.code);
        if (action) this.release(action);
    };

    private readonly handleMouseDown = (event: MouseEvent): void => {
        if (!document.pointerLockElement) return;
        const action = POINTER_ACTIONS.get(event.button);
        if (action) this.press(action);
    };

    private readonly handleMouseUp = (event: MouseEvent): void => {
        const action = POINTER_ACTIONS.get(event.button);
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
        this.pressedAt.clear();
        this.pressed.clear();
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

    heldSeconds(action: InputAction): number {
        const since = this.pressedAt.get(action);
        return this.isHeld(action) && since !== undefined ? (performance.now() - since) / 1000 : 0;
    }

    axis(negative: KeyAction, positive: KeyAction): number {
        return Number(this.isHeld(positive)) - Number(this.isHeld(negative));
    }

    consumePress(action: InputAction): boolean {
        return this.pressed.delete(action);
    }

    discardPresses(): void {
        this.pressed.clear();
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

        this.pressedAt.set(action, performance.now());
        this.pressed.add(action);
    }

    private release(action: InputAction): void {
        const count = this.heldCounts.get(action) ?? 0;
        if (count === 0) return;

        this.heldCounts.set(action, count - 1);
    }
}
