import { degrees, metres, vec3, pair } from "@/lib/helpers";
import { STRIDE } from "@/constants/characters";
import { WEAPONS } from "@/constants/combat";
import { VIEW_DISTANCE } from "@/constants/world";
import type { WeaponDefinition } from "@/types/weapons";
import type { ImpactTier } from "@/types/combat";

const PLAYER_HEIGHT = metres(2.1);

export const PLAYER = {
    height: PLAYER_HEIGHT,
    radius: PLAYER_HEIGHT * 0.24,
    walkSpeed: PLAYER_HEIGHT * STRIDE.walk,
    sprintSpeed: PLAYER_HEIGHT * 5,
    jumpForce: 11,
    maxHealth: 100,
    unarmedDamage: 5,
    strafeSpeed: PLAYER_HEIGHT * STRIDE.strafe,
    crouchSpeed: PLAYER_HEIGHT * 1.0,
    crouchSprintSpeed: PLAYER_HEIGHT * 1.8,
    turnSmoothing: 15,
    groundAcceleration: 34,
    airAcceleration: 14,
    movingSpeedThreshold: PLAYER_HEIGHT * 0.12,
    airborneGraceSeconds: 0.12,
    spawnPosition: vec3(0, 2, 6),
    colliderOffset: 0.02,
    maxSlopeClimbAngle: (45 * Math.PI) / 180,
    minSlopeSlideAngle: (38 * Math.PI) / 180,
    autostepMaxHeight: PLAYER_HEIGHT * 0.26,
    autostepMinWidth: PLAYER_HEIGHT * 0.12,
    snapToGroundDistance: PLAYER_HEIGHT * 0.3,
    terminalVelocity: -45,
};

export const DODGE = {
    durationSeconds: 0.55,
    minSideAngle: degrees(45),
    maxSideAngle: degrees(135),
    targetTravelMetres: 0.9,
    leftClipTravelMetres: 0.28,
    rightClipTravelMetres: 0.31,
};

export const STAMINA = {
    sprintPerSecond: 14,
};

export const PLAYER_REACTION_LOCKOUT = {
    flinch: 0.3,
    knockback: 0.55,
    knockdown: 1,
};

export const PLAYER_VITALS = {
    maxHealth: 100,
    maxPoise: 60,
    maxStamina: 100,
    maxFocus: 3,
    poiseRegenDelay: 2,
    poiseRegenRate: 25,
    staminaRegenDelay: 0.6,
    staminaRegenRate: 38,
    staggerSeconds: 0.6,
};

export const PLAYER_STARTING_WEAPON: WeaponDefinition = WEAPONS.longsword;

export const CAMERA = {
    near: 0.1,
    far: VIEW_DISTANCE,
    startPosition: vec3(0, 5, 10),
    targetFollowDistance: PLAYER.height * 2.3,
    sprintFollowDistance: PLAYER.height * 2.4,
    minimumFollowDistance: PLAYER.height * 0.6,
    collisionPadding: metres(0.125),
    pullOutSmoothing: 4,
    pivotHeight: PLAYER.height * 0.7,
    shoulderOffset: metres(0.35),
    pivotSmoothing: 12,
    sprintFovBoost: 2,
    speedBlendSmoothing: 6,
    hitPunchFov: 3.5,
    hitPunchDecay: 16,
    mouseSensitivity: 0.0023,
    pitchRange: pair(-0.45, 1.25),
    startPitch: 0.21,
};

export const CAMERA_SHAKE = {
    maxOffset: metres(0.18),
    maxRoll: 0.04,
    decay: 1.8,
    frequency: 24,
    trauma: { light: 0.2, heavy: 0.38, finisher: 0.6 } satisfies Record<ImpactTier, number>,
};

export const CHARGE_CUE = {
    traumaScale: 0.6,
};

export const LOCK_CAMERA = {
    yawSmoothing: 8,
    pitch: 0.28,
    pitchSmoothing: 5,
};

export const KILL_CAMERA = {
    blendInSeconds: 0.35,
    blendOutSeconds: 0.6,
    baseDistance: metres(2.8),
    focusLift: metres(0.15),
    occlusionPullInSmoothing: 18,
    fallbackPitch: 0.2,
    candidates: [
        { yawOffset: Math.PI * 0.75, pitch: 0.2, distanceScale: 0.9, penalty: 0 },
        { yawOffset: -Math.PI * 0.75, pitch: 0.2, distanceScale: 0.9, penalty: 0 },
        { yawOffset: Math.PI / 2, pitch: 0.12, distanceScale: 1.15, penalty: 0.35 },
        { yawOffset: -Math.PI / 2, pitch: 0.12, distanceScale: 1.15, penalty: 0.35 },
    ],
};

export const INPUT_BINDINGS = {
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    jump: ["Space"],
    sprint: ["ShiftLeft"],
    dodge: ["KeyV"],
    crouch: ["KeyC"],
    parry: ["KeyQ"],
    shoot: ["KeyF"],
    finisher: ["KeyE"],
};

export const MOUSE_BINDINGS = {
    light: 0,
    lock: 1,
    heavy: 2,
};

const KEY_LABELS: Record<string, string> = {
    ShiftLeft: "Shift",
};

const MOUSE_BUTTON_LABELS = ["LMB", "MMB", "RMB"];

export function keyLabel(code: string): string {
    return KEY_LABELS[code] ?? code.replace(/^(Key|Digit)/, "");
}

interface IControlEntry {
    keys: readonly string[];
    action: string;
    description: string;
}

interface IControlGroup {
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
                keys: [keyLabel(INPUT_BINDINGS.sprint[0])],
                action: "Sprint",
                description: "Hold to sprint",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.dodge[0])],
                action: "Dodge",
                description: "Sidestep when moving left or right, otherwise step back",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.crouch[0])],
                action: "Crouch",
                description: "Crouch and move quietly",
            },
            {
                keys: [keyLabel(INPUT_BINDINGS.crouch[0])],
                action: "Slide",
                description: "Press while sprinting to slide forward",
            },
        ],
    },
    {
        title: "Combat",
        entries: [
            {
                keys: [MOUSE_BUTTON_LABELS[MOUSE_BINDINGS.light]],
                action: "Light attack",
                description: "Fast strike, chains into a combo",
            },
            {
                keys: [MOUSE_BUTTON_LABELS[MOUSE_BINDINGS.heavy]],
                action: "Heavy attack",
                description: "Slow, powerful strike",
            },
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
                keys: [MOUSE_BUTTON_LABELS[MOUSE_BINDINGS.lock]],
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
