import { INPUT_BINDINGS } from "@/constants/combat";

const KEY_LABELS: Record<string, string> = {
    KeyW: "W",
    KeyA: "A",
    KeyS: "S",
    KeyD: "D",
    KeyQ: "Q",
    KeyE: "E",
    KeyF: "F",
    Space: "Space",
    ShiftLeft: "Shift",
    ControlLeft: "Ctrl",
};

function keyLabel(code: string): string {
    return KEY_LABELS[code] ?? code;
}

export interface IControlEntry {
    keys: readonly string[];
    action: string;
    description: string;
}

export interface IControlGroup {
    title: string;
    entries: readonly IControlEntry[];
}

export const CONTROL_REFERENCE: readonly IControlGroup[] = [
    {
        title: "Movement",
        entries: [
            {
                keys: [
                    keyLabel(INPUT_BINDINGS.forward[0]),
                    keyLabel(INPUT_BINDINGS.left[0]),
                    keyLabel(INPUT_BINDINGS.backward[0]),
                    keyLabel(INPUT_BINDINGS.right[0]),
                ],
                action: "Move",
                description: "Walk in any direction",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.jump[0])],
                action: "Jump",
                description: "Leap over obstacles",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.evade[0])],
                action: "Sprint / Dodge",
                description: "Press to dodge-roll, keep holding to sprint",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.crouch[0])],
                action: "Crouch",
                description: "Crouch and move quietly",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.crouch[0]), keyLabel(INPUT_BINDINGS.evade[0])],
                action: "Slide",
                description: "Press while sprinting to slide forward",
            },
        ],
    },
    {
        title: "Combat",
        entries: [
            {
                keys: ["LMB"],
                action: "Light attack",
                description: "Fast strike, chains into a combo",
            },
            { keys: ["RMB"], action: "Heavy attack", description: "Slow, powerful strike" },
            {
                keys: [keyLabel(INPUT_BINDINGS.parry[0])],
                action: "Parry",
                description: "Deflect an incoming attack and open it up for a counter-kill",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.finisher[0])],
                action: "Finisher",
                description: "Execute, backstab or counter-kill a vulnerable enemy",
            },
        ],
    },
    {
        title: "Camera & Targeting",
        entries: [
            { keys: ["Mouse"], action: "Look", description: "Aim the camera" },
            {
                keys: ["MMB"],
                action: "Lock-on",
                description: "Lock the camera onto the nearest enemy",
            },
            {
                keys: ["Scroll"],
                action: "Cycle target",
                description: "Switch between nearby enemies while locked on",
            },
        ],
    },
] as const;
