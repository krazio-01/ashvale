import { CLIP } from "@/constants/characters";
import { TARGETING } from "@/constants/combat";
import { DODGE, PLAYER } from "@/constants/player";
import { WORLD } from "@/constants/world";
import { metres } from "@/lib/helpers";
import {
    defineMove,
    SHARED_REACTIONS,
    WEAPON_HIT_SHAPE,
    type MoveSpec,
} from "@/systems/combat/moveSets/moveDefinition";
import type {
    ICancelWindow,
    IHitWindow,
    IMomentum,
    IMoveDefinition,
    IMoveSet,
    IWarpWindow,
    MoveTag,
} from "@/types/combat";

const EVERYTHING: readonly MoveTag[] = [
    "light",
    "heavy",
    "dodge",
    "parry",
    "shoot",
    "movement",
    "jump",
];
const SWORD_WARP = { maxDistance: metres(5), strikeDistance: metres(0.45) };
const SLIDE_GLIDE: IMomentum = { deceleration: PLAYER.height, poseReach: PLAYER.slidePoseReach };
const SLIDE_BRAKE: IMomentum = { ...SLIDE_GLIDE, deceleration: PLAYER.height * 3 };
const SLIDE_FOLLOW_UP = { light: "sword_dash_attack" };
const JUMP_RISE_SECONDS = PLAYER.jumpForce / Math.abs(WORLD.gravity);
const LAND_SECONDS = 0.4;

function bladeHit(from: number, to: number, overrides: Partial<IHitWindow> = {}): IHitWindow {
    return {
        from,
        to,
        shape: WEAPON_HIT_SHAPE,
        damageScale: 1,
        poiseDamage: 12,
        impact: "light",
        knockback: 3,
        parryable: true,
        perilous: false,
        ...overrides,
    };
}

function comboCancels(chain: number, defensive: number, movement: number): ICancelWindow[] {
    return [
        { from: chain, to: 1, into: ["light", "heavy", "shoot"] },
        { from: defensive, to: 1, into: ["dodge", "parry", "jump"] },
        { from: movement, to: 1, into: ["movement"] },
    ];
}

function move(spec: MoveSpec): IMoveDefinition {
    return defineMove({ fadeSeconds: 0.06 }, spec);
}

function trackedStrike(
    spec: MoveSpec,
    hit: IHitWindow,
    turnRate: number,
    warp: Omit<IWarpWindow, "to">
): IMoveDefinition {
    return move({
        ...spec,
        hits: [hit],
        tracking: { from: 0, to: hit.from, turnRate },
        warp: { ...warp, to: hit.from },
    });
}

export const PLAYER_MOVE_IDS = {
    counter: "sword_counter",
};

export const PLAYER_MOVES: IMoveSet = {
    moves: Object.fromEntries(
        [
            trackedStrike(
                {
                    id: "sword_light_1",
                    clip: CLIP.swordLight1,
                    tags: ["light"],
                    playbackRate: 2,
                    focusGain: 0.18,
                    cancels: comboCancels(0.63, 0.53, 0.84),
                    next: { light: "sword_light_2", heavy: "sword_heavy_finisher" },
                },
                bladeHit(0.37, 0.59),
                14,
                { from: 0.04, ...SWORD_WARP }
            ),
            trackedStrike(
                {
                    id: "sword_light_2",
                    clip: CLIP.swordLight2,
                    tags: ["light"],
                    playbackRate: 1.85,
                    focusGain: 0.18,
                    cancels: comboCancels(0.62, 0.52, 0.83),
                    next: { light: "sword_light_3", heavy: "sword_heavy_finisher" },
                },
                bladeHit(0.33, 0.58),
                14,
                { from: 0.04, ...SWORD_WARP }
            ),
            trackedStrike(
                {
                    id: "sword_light_3",
                    clip: CLIP.swordLight3,
                    tags: ["light"],
                    playbackRate: 2,
                    focusGain: 0.2,
                    cancels: comboCancels(0.78, 0.68, 0.95),
                    next: { light: "sword_light_4", heavy: "sword_heavy_finisher" },
                },
                bladeHit(0.41, 0.74, { poiseDamage: 14 }),
                14,
                { from: 0.1, ...SWORD_WARP }
            ),
            trackedStrike(
                {
                    id: "sword_light_4",
                    clip: CLIP.swordLight4,
                    tags: ["light"],
                    playbackRate: 1.85,
                    focusGain: 0.3,
                    cancels: comboCancels(0.46, 0.36, 0.8),
                    next: { light: "sword_light_1" },
                },
                bladeHit(0.21, 0.42, {
                    damageScale: 1.6,
                    poiseDamage: 26,
                    impact: "heavy",
                    knockback: 6,
                }),
                12,
                { from: 0, ...SWORD_WARP }
            ),
            trackedStrike(
                {
                    id: "sword_heavy",
                    clip: CLIP.swordHeavy,
                    tags: ["heavy"],
                    playbackRate: 2.9,
                    staminaCost: 12,
                    spendsFocus: true,
                    holdAt: 0.44,
                    armor: { from: 0.05, to: 0.74 },
                    cancels: comboCancels(0.8, 0.74, 0.9),
                },
                bladeHit(0.51, 0.72, {
                    damageScale: 2.2,
                    poiseDamage: 38,
                    impact: "heavy",
                    knockback: 7,
                    parryable: false,
                }),
                10,
                { from: 0.3, maxDistance: metres(4), strikeDistance: 0 }
            ),
            trackedStrike(
                {
                    id: "sword_heavy_finisher",
                    clip: CLIP.swordHeavyFinisher,
                    tags: ["heavy"],
                    playbackRate: 2.8,
                    staminaCost: 14,
                    spendsFocus: true,
                    armor: { from: 0.1, to: 0.9 },
                    cancels: comboCancels(0.94, 0.84, 0.97),
                },
                bladeHit(0.86, 0.9, {
                    damageScale: 2.6,
                    poiseDamage: 46,
                    impact: "heavy",
                    knockback: 8,
                    parryable: false,
                }),
                10,
                { from: 0.55, ...SWORD_WARP }
            ),
            move({
                id: "sword_dash_attack",
                clip: CLIP.swordLight3,
                tags: ["light"],
                playbackRate: 2,
                staminaCost: 8,
                focusGain: 0.2,
                hits: [
                    bladeHit(0.41, 0.74, { damageScale: 1.3, poiseDamage: 20, parryable: false }),
                ],
                cancels: comboCancels(0.78, 0.68, 0.95),
                warp: { from: 0, to: 0.41, maxDistance: metres(7), strikeDistance: metres(0.45) },
                next: { light: "sword_light_4", heavy: "sword_heavy_finisher" },
            }),
            move({
                id: "sword_gap_closer",
                clip: CLIP.swordDash,
                tags: ["light"],
                staminaCost: 12,
                focusGain: 0.2,
                hits: [bladeHit(0.17, 0.26, { damageScale: 1.2, poiseDamage: 18, knockback: 5 })],
                cancels: comboCancels(0.4, 0.3, 0.8),
                tracking: { from: 0, to: 0.17, turnRate: 20 },
                warp: {
                    from: 0,
                    to: 0.17,
                    maxDistance: TARGETING.gapCloseMaxDistance,
                    strikeDistance: SWORD_WARP.strikeDistance,
                },
                next: { light: "sword_light_2", heavy: "sword_heavy_finisher" },
            }),
            move({
                id: "sword_counter",
                clip: CLIP.swordCounter,
                tags: ["light"],
                fadeSeconds: 0.03,
                focusGain: 0.3,
                invulnerable: { from: 0, to: 0.6 },
                hits: [
                    bladeHit(0.15, 0.33, {
                        damageScale: 1.8,
                        poiseDamage: 60,
                        impact: "heavy",
                        knockback: 7,
                        parryable: false,
                    }),
                ],
                cancels: comboCancels(0.37, 0.27, 0.8),
                tracking: { from: 0, to: 0.25, turnRate: 20 },
                warp: { from: 0, to: 0.25, maxDistance: metres(3), strikeDistance: metres(0.45) },
                next: { light: "sword_light_2" },
            }),
            move({
                id: "dodge_backstep",
                clip: CLIP.dodgeBackstep,
                durationSeconds: DODGE.durationSeconds,
                tags: ["dodge"],
                staminaCost: 16,
                fadeSeconds: 0.04,
                invulnerable: { from: 0.05, to: 0.75 },
                cancels: [{ from: 0.5, to: 1, into: EVERYTHING }],
            }),
            move({
                id: "dodge_left",
                clip: CLIP.dodgeLeft,
                durationSeconds: DODGE.durationSeconds,
                tags: ["dodge"],
                rootMotionScale: DODGE.targetTravelMetres / DODGE.leftClipTravelMetres,
                staminaCost: 16,
                fadeSeconds: 0.04,
                invulnerable: { from: 0.1, to: 0.8 },
                cancels: [{ from: 0.5, to: 1, into: EVERYTHING }],
            }),
            move({
                id: "dodge_right",
                clip: CLIP.dodgeRight,
                durationSeconds: DODGE.durationSeconds,
                tags: ["dodge"],
                rootMotionScale: DODGE.targetTravelMetres / DODGE.rightClipTravelMetres,
                staminaCost: 16,
                fadeSeconds: 0.04,
                invulnerable: { from: 0.12, to: 0.8 },
                cancels: [{ from: 0.5, to: 1, into: EVERYTHING }],
            }),
            move({
                id: "slide_start",
                motion: "momentum",
                clip: CLIP.slideStart,
                tags: ["dodge"],
                playbackRate: 1.2,
                staminaCost: 12,
                fadeSeconds: 0.08,
                momentum: SLIDE_GLIDE,
                blockedInto: "slide_exit",
                invulnerable: { from: 0.35, to: 0.7 },
                cancels: [
                    { from: 0, to: 1, into: ["jump"] },
                    { from: 0.55, to: 1, into: ["light"] },
                ],
                next: SLIDE_FOLLOW_UP,
                followedBy: "slide_hold",
            }),
            move({
                id: "slide_hold",
                motion: "momentum",
                clip: CLIP.slideHold,
                tags: ["dodge"],
                fadeSeconds: 0.1,
                momentum: SLIDE_GLIDE,
                blockedInto: "slide_exit",
                cancels: [{ from: 0, to: 1, into: ["light", "dodge", "jump"] }],
                next: SLIDE_FOLLOW_UP,
                followedBy: "slide_exit",
            }),
            move({
                id: "slide_exit",
                motion: "momentum",
                clip: CLIP.slideExit,
                tags: ["dodge"],
                fadeSeconds: 0.1,
                momentum: SLIDE_BRAKE,
                cancels: [
                    { from: 0, to: 1, into: ["jump"] },
                    { from: 0.35, to: 1, into: EVERYTHING },
                ],
                next: SLIDE_FOLLOW_UP,
            }),
            move({
                id: "jump_start",
                clip: CLIP.jumpStart,
                tags: ["jump"],
                motion: "physics",
                launch: PLAYER.jumpForce,
                durationSeconds: JUMP_RISE_SECONDS,
                fadeSeconds: 0.03,
                cancels: [{ from: 0.3, to: 1, into: ["light"] }],
                followedBy: "airborne",
            }),
            move({
                id: "airborne",
                clip: CLIP.jumpLoop,
                tags: ["jump"],
                motion: "physics",
                requires: "airborne",
                loop: true,
                fadeSeconds: 0.12,
                cancels: [{ from: 0, to: 1, into: ["light"] }],
            }),
            move({
                id: "land",
                clip: CLIP.jumpAbsorb,
                tags: ["jump"],
                motion: "physics",
                durationSeconds: LAND_SECONDS,
                fadeSeconds: 0.05,
                cancels: [
                    { from: 0, to: 1, into: ["light", "heavy", "dodge", "parry", "shoot", "jump"] },
                    { from: 0.25, to: 1, into: ["movement"] },
                ],
            }),
            move({
                id: "air_slash",
                clip: CLIP.swordLight1,
                tags: ["light"],
                motion: "physics",
                requires: "airborne",
                playbackRate: 1.2,
                focusGain: 0.15,
                hits: [bladeHit(0.37, 0.59)],
                tracking: { from: 0, to: 0.37, turnRate: 14 },
                onLand: "air_slash_land",
                followedBy: "airborne",
            }),
            move({
                id: "air_slash_land",
                clip: CLIP.swordHeavyFinisher,
                tags: ["heavy"],
                hits: [
                    bladeHit(0.55, 0.69, {
                        damageScale: 1.8,
                        poiseDamage: 30,
                        impact: "heavy",
                        knockback: 6,
                        parryable: false,
                    }),
                ],
                cancels: comboCancels(0.73, 0.63, 0.94),
            }),
            move({
                id: "parry",
                clip: CLIP.parry,
                tags: ["parry"],
                fadeSeconds: 0.03,
                parryWindow: { from: 0, to: 0.4 },
                cancels: [{ from: 0.55, to: 1, into: EVERYTHING }],
            }),
        ].map((definition) => [definition.id, definition])
    ),
    entry: {
        light: "sword_light_1",
        heavy: "sword_heavy",
        dodge: "dodge_backstep",
        parry: "parry",
        slide: "slide_start",
        jump: "jump_start",
    },
    sprintEntry: { light: "sword_dash_attack" },
    lockedFarEntry: { light: "sword_gap_closer" },
    sideDodgeEntry: { left: "dodge_left", right: "dodge_right" },
    airEntry: { light: "air_slash" },
    air: { airborne: "airborne", land: "land" },
    reactions: {
        flinch: [CLIP.reactFlinch, CLIP.reactHitHead],
        knockback: [CLIP.reactCombatDamage],
        stagger: CLIP.reactCombatDamage,
        ...SHARED_REACTIONS,
    },
};
