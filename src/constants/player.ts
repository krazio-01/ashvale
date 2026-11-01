import { degreesToRadians, keyLabel, metresToUnits, vec3, range } from "@/lib/helpers";
import { GAIT_SPEED_PER_HEIGHT } from "@/constants/characters";
import { WEAPONS } from "@/constants/combat";
import { VIEW_DISTANCE } from "@/constants/world";
import type { WeaponDefinition, ImpactTier, ReactionTier } from "@/types/combat";
import type { MotorTuning } from "@/types/physics";
import type { IControlGroup } from "@/types/ui";
import { CONTROL_TEXT } from "@/constants/strings";

const PLAYER_HEIGHT = metresToUnits(2.1);

export const PLAYER = {
    height: PLAYER_HEIGHT,
    radius: PLAYER_HEIGHT * 0.24,
    walkSpeed: PLAYER_HEIGHT * GAIT_SPEED_PER_HEIGHT.walk,
    sprintSpeed: PLAYER_HEIGHT * 5,
    jumpForce: 11,
    unarmedDamage: 5,
    strafeSpeed: PLAYER_HEIGHT * GAIT_SPEED_PER_HEIGHT.strafe,
    crouchSpeed: PLAYER_HEIGHT * 1.0,
    crouchSprintSpeed: PLAYER_HEIGHT * 1.8,
    slidePoseReach: PLAYER_HEIGHT * 0.33,
    turnSmoothing: 15,
};

export const PLAYER_MOTOR_TUNING: MotorTuning = {
    colliderOffset: 0.02,
    maxSlopeClimbAngle: degreesToRadians(45),
    minSlopeSlideAngle: degreesToRadians(38),
    autostepMaxHeight: PLAYER_HEIGHT * 0.26,
    autostepMinWidth: PLAYER_HEIGHT * 0.12,
    snapToGroundDistance: PLAYER_HEIGHT * 0.3,
    terminalVelocity: -45,
    groundAcceleration: 34,
    airAcceleration: 14,
};

export const DODGE = {
    durationSeconds: 0.55,
    minSideAngle: degreesToRadians(45),
    maxSideAngle: degreesToRadians(135),
    targetTravelMetres: 0.9,
    leftClipTravelMetres: 0.28,
    rightClipTravelMetres: 0.31,
};

export const ATTACK = {
    animationSpeedScale: 0.75,
};

export const STAMINA = {
    sprintPerSecond: 14,
    sprintResumeFraction: 0.3,
};

export const PLAYER_REACTIONS: {
    inputLockSeconds: Partial<Record<ReactionTier, number>>;
    ignored: readonly ReactionTier[];
    dodgeCancelSeconds: number;
} = {
    inputLockSeconds: { knockback: 0.55, knockdown: 1 },
    ignored: ["flinch"],
    dodgeCancelSeconds: 0.1,
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

export const PLAYER_STARTING_WEAPON: WeaponDefinition = WEAPONS.sword;

export const CAMERA = {
    near: 0.1,
    far: VIEW_DISTANCE,
    startPosition: vec3(0, 5, 10),
    targetFollowDistance: PLAYER.height * 2.3,
    sprintFollowDistance: PLAYER.height * 2.4,
    minimumFollowDistance: PLAYER.height * 0.6,
    collisionPadding: metresToUnits(0.125),
    pullOutSmoothing: 4,
    pivotHeight: PLAYER.height * 0.7,
    shoulderOffset: metresToUnits(0.35),
    pivotSmoothing: 12,
    sprintFovBoost: 2,
    sprintBlendSmoothing: 6,
    hitPunchFov: 3.5,
    hitPunchDecay: 16,
    mouseSensitivity: 0.0023,
    pitchRange: range(-0.45, 1.25),
    startPitch: 0.21,
};

export const CAMERA_SHAKE = {
    maxOffset: metresToUnits(0.18),
    maxRoll: 0.04,
    decay: 1.8,
    frequency: 24,
    shakeByImpact: { light: 0.2, heavy: 0.38, finisher: 0.6 } satisfies Record<ImpactTier, number>,
};

export const CHARGE_SHAKE = {
    shakeScale: 0.6,
};

export const LOCK_CAMERA = {
    yawSmoothing: 8,
    pitch: 0.28,
    pitchSmoothing: 5,
};

export const KILL_CAMERA = {
    blendInSeconds: 0.35,
    blendOutSeconds: 0.6,
    baseDistance: metresToUnits(2.8),
    focusLift: metresToUnits(0.15),
    occlusionPullInSmoothing: 18,
    fallbackPitch: 0.2,
    cameraAngles: [
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
    draw: ["KeyR"],
};

export const MOUSE_BINDINGS = {
    light: 0,
    lock: 1,
    heavy: 2,
};

const keyEntry = <T extends object>(binding: keyof typeof INPUT_BINDINGS, text: T) => ({
    keys: [keyLabel(INPUT_BINDINGS[binding][0])],
    ...text,
});

const mouseEntry = <T extends object>(button: keyof typeof MOUSE_BINDINGS, text: T) => ({
    keys: [CONTROL_TEXT.mouseButtons[MOUSE_BINDINGS[button]]],
    ...text,
});

export const CONTROL_REFERENCE: readonly IControlGroup[] = [
    {
        title: CONTROL_TEXT.groups.movement,
        entries: [
            {
                keys: [
                    keyLabel(INPUT_BINDINGS.forward[0]),
                    keyLabel(INPUT_BINDINGS.left[0]),
                    keyLabel(INPUT_BINDINGS.backward[0]),
                    keyLabel(INPUT_BINDINGS.right[0]),
                ],
                ...CONTROL_TEXT.move,
            },
            keyEntry("jump", CONTROL_TEXT.jump),
            keyEntry("sprint", CONTROL_TEXT.sprint),
            keyEntry("dodge", CONTROL_TEXT.dodge),
            keyEntry("crouch", CONTROL_TEXT.crouch),
            keyEntry("crouch", CONTROL_TEXT.slide),
        ],
    },
    {
        title: CONTROL_TEXT.groups.combat,
        entries: [
            mouseEntry("light", CONTROL_TEXT.lightAttack),
            mouseEntry("heavy", CONTROL_TEXT.heavyAttack),
            keyEntry("parry", CONTROL_TEXT.parry),
            keyEntry("draw", CONTROL_TEXT.draw),
            keyEntry("finisher", CONTROL_TEXT.finisher),
        ],
    },
    {
        title: CONTROL_TEXT.groups.camera,
        entries: [
            { keys: [CONTROL_TEXT.mouse], ...CONTROL_TEXT.look },
            mouseEntry("lock", CONTROL_TEXT.lockOn),
            {
                keys: [CONTROL_TEXT.scroll],
                ...CONTROL_TEXT.cycleTarget,
            },
        ],
    },
];
