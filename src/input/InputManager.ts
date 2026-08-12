export type InputAction = "forward" | "backward" | "left" | "right" | "jump" | "sprint";

const KEY_BINDINGS: Record<InputAction, string[]> = {
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    jump: ["Space"],
    sprint: ["ShiftLeft"],
};

export class InputManager {
    private readonly pressedKeys = new Set<string>();

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        this.pressedKeys.add(event.code);
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        this.pressedKeys.delete(event.code);
    };

    constructor() {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
    }

    isPressed(action: InputAction): boolean {
        return KEY_BINDINGS[action].some((code) => this.pressedKeys.has(code));
    }

    axis(negative: InputAction, positive: InputAction): number {
        return Number(this.isPressed(positive)) - Number(this.isPressed(negative));
    }

    dispose(): void {
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
    }
}
