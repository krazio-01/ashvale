import { CLIP, IDLE_VARIATION, STRIDE } from "@/constants/characters";
import { PLAYER } from "@/constants/player";
import type {
    IDirectionalClip,
    IFreeLocomotion,
    IStrafeLocomotion,
} from "@/entities/characters/CharacterAnimator";

const EIGHTH_TURN = Math.PI / 4;

const PLAYER_RELAXED_FIDGETS = [CLIP.idleFidgetSwordInspect, CLIP.idleFidgetSwordRoll];
const ENEMY_RELAXED_FIDGETS = [CLIP.idleFidgetScratchArm, CLIP.idleFidgetLookAround];

const STRAFE_DIRECTIONS: readonly IDirectionalClip[] = [
    { clip: CLIP.strafeForward, angle: 0 },
    { clip: CLIP.strafeForwardRight, angle: EIGHTH_TURN },
    { clip: CLIP.strafeRight, angle: EIGHTH_TURN * 2 },
    { clip: CLIP.strafeBackRight, angle: EIGHTH_TURN * 3 },
    { clip: CLIP.strafeBack, angle: Math.PI },
    { clip: CLIP.strafeBackLeft, angle: -EIGHTH_TURN * 3 },
    { clip: CLIP.strafeLeft, angle: -EIGHTH_TURN * 2 },
    { clip: CLIP.strafeForwardLeft, angle: -EIGHTH_TURN },
];

export const PLAYER_FREE_LOCOMOTION: IFreeLocomotion = {
    kind: "free",
    idle: CLIP.idle,
    idleVariation: {
        clips: PLAYER_RELAXED_FIDGETS,
        afterSeconds: IDLE_VARIATION.relaxedDelaySeconds,
    },
    gaits: [
        { clip: CLIP.walk, speed: PLAYER.walkSpeed },
        { clip: CLIP.sprint, speed: PLAYER.sprintSpeed },
    ],
};

export const PLAYER_CROUCH_LOCOMOTION: IFreeLocomotion = {
    kind: "free",
    idle: CLIP.crouchIdle,
    gaits: [{ clip: CLIP.crouchWalk, speed: PLAYER.crouchSpeed }],
};

export const PLAYER_STRAFE_LOCOMOTION: IStrafeLocomotion = {
    kind: "strafe",
    idle: CLIP.combatIdle,
    speed: PLAYER.strafeSpeed,
    directions: STRAFE_DIRECTIONS,
};

export function enemyRelaxedLocomotion(height: number, idleDelaySeconds: number): IFreeLocomotion {
    return {
        kind: "free",
        idle: CLIP.idle,
        idleVariation: { clips: ENEMY_RELAXED_FIDGETS, afterSeconds: idleDelaySeconds },
        gaits: [{ clip: CLIP.walk, speed: height * STRIDE.walk }],
    };
}

export function enemyCombatLocomotion(height: number): IStrafeLocomotion {
    return {
        kind: "strafe",
        idle: CLIP.combatIdle,
        speed: height * STRIDE.strafe,
        directions: STRAFE_DIRECTIONS,
    };
}
