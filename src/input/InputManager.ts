export type InputAction = "forward" | "backward" | "left" | "right" | "jump" | "sprint";

const KEY_BINDINGS: Record<InputAction, string[]> = {
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    jump: ["Space"],
    sprint: ["ShiftLeft"],
};

const ACTIONS_BY_KEY = new Map<string, InputAction>();
for (const [action, codes] of Object.entries(KEY_BINDINGS) as [InputAction, string[]][])
    for (const code of codes) ACTIONS_BY_KEY.set(code, action);

export class InputManager {
    private readonly heldCounts: Record<InputAction, number> = {
        forward: 0,
        backward: 0,
        left: 0,
        right: 0,
        jump: 0,
        sprint: 0,
    };

    private jumpQueued = false;
    private mouseDeltaX = 0;
    private mouseDeltaY = 0;

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.repeat) return;

        const action = ACTIONS_BY_KEY.get(event.code);
        if (!action) return;

        this.heldCounts[action] += 1;
        if (action === "jump") this.jumpQueued = true;
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        const action = ACTIONS_BY_KEY.get(event.code);
        if (!action) return;

        this.heldCounts[action] = Math.max(0, this.heldCounts[action] - 1);
    };

    private readonly handleWindowBlur = (): void => {
        for (const action of Object.keys(this.heldCounts) as InputAction[])
            this.heldCounts[action] = 0;

        this.jumpQueued = false;
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
    };

    private readonly handleMouseMove = (event: MouseEvent): void => {
        if (!document.pointerLockElement) return;

        this.mouseDeltaX += event.movementX;
        this.mouseDeltaY += event.movementY;
    };

    constructor() {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
        window.addEventListener("blur", this.handleWindowBlur);
        window.addEventListener("mousemove", this.handleMouseMove);
    }

    isPressed(action: InputAction): boolean {
        return this.heldCounts[action] > 0;
    }

    axis(negative: InputAction, positive: InputAction): number {
        return Number(this.isPressed(positive)) - Number(this.isPressed(negative));
    }

    consumeJump(): boolean {
        const wasQueued = this.jumpQueued;
        this.jumpQueued = false;

        return wasQueued;
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
        window.removeEventListener("blur", this.handleWindowBlur);
        window.removeEventListener("mousemove", this.handleMouseMove);
    }
}
