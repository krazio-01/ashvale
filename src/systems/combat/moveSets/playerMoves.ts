import { CLIP } from "@/constants/clips";
import { PLAYER } from "@/constants/characters";
import { WORLD } from "@/constants/world";
import { metres } from "@/lib/helpers";
import type {
    HitShape,
    ICancelWindow,
    IHitWindow,
    IMomentum,
    IMoveDefinition,
    IMoveSet,
    MoveTag,
} from "@/types/combat";

const WEAPON: HitShape = { kind: "weapon" };
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
const SLIDE_MOMENTUM: IMomentum = { deceleration: PLAYER.height * 4.5 };
const SLIDE_FOLLOW_UP = { light: "sword_dash_attack" };
const JUMP_RISE_SECONDS = PLAYER.jumpForce / Math.abs(WORLD.gravity);
const LAND_SECONDS = 0.4;

function bladeHit(from: number, to: number, overrides: Partial<IHitWindow> = {}): IHitWindow {
    return {
        from,
        to,
        shape: WEAPON,
        damageScale: 1,
        poiseDamage: 12,
        impact: "light",
        knockback: 3,
        parryable: false,
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

function move(
    definition: Pick<IMoveDefinition, "id" | "clip" | "tags"> & Partial<IMoveDefinition>
): IMoveDefinition {
    return {
        playbackRate: 1,
        fadeSeconds: 0.06,
        staminaCost: 0,
        focusGain: 0,
        spendsFocus: false,
        rootMotionScale: 1,
        motion: "rootMotion",
        hits: [],
        cancels: [],
        ...definition,
    };
}

export const PLAYER_MOVE_IDS = {
    counter: "sword_counter",
};

export const PLAYER_MOVES: IMoveSet = {
    moves: {
        sword_light_1: move({
            id: "sword_light_1",
            clip: CLIP.swordLight1,
            tags: ["light"],
            playbackRate: 1.1,
            focusGain: 0.18,
            hits: [bladeHit(0.3, 0.48)],
            cancels: comboCancels(0.52, 0.42, 0.8),
            tracking: { from: 0, to: 0.3, turnRate: 14 },
            warp: { from: 0.04, to: 0.3, ...SWORD_WARP },
            next: { light: "sword_light_2", heavy: "sword_heavy_finisher" },
        }),
        sword_light_2: move({
            id: "sword_light_2",
            clip: CLIP.swordLight2,
            tags: ["light"],
            playbackRate: 1.1,
            focusGain: 0.18,
            hits: [bladeHit(0.36, 0.56)],
            cancels: comboCancels(0.58, 0.46, 0.82),
            tracking: { from: 0, to: 0.36, turnRate: 14 },
            warp: { from: 0.04, to: 0.36, ...SWORD_WARP },
            next: { light: "sword_light_3", heavy: "sword_heavy_finisher" },
        }),
        sword_light_3: move({
            id: "sword_light_3",
            clip: CLIP.swordLight3,
            tags: ["light"],
            playbackRate: 1.1,
            focusGain: 0.2,
            hits: [bladeHit(0.5, 0.66, { poiseDamage: 14 })],
            cancels: comboCancels(0.68, 0.56, 0.86),
            tracking: { from: 0, to: 0.48, turnRate: 14 },
            warp: { from: 0.1, to: 0.48, ...SWORD_WARP },
            next: { light: "sword_light_4", heavy: "sword_heavy_finisher" },
        }),
        sword_light_4: move({
            id: "sword_light_4",
            clip: CLIP.swordLight4,
            tags: ["light"],
            focusGain: 0.3,
            hits: [
                bladeHit(0.2, 0.42, {
                    damageScale: 1.6,
                    poiseDamage: 26,
                    impact: "heavy",
                    knockback: 6,
                }),
            ],
            cancels: comboCancels(0.55, 0.45, 0.8),
            tracking: { from: 0, to: 0.2, turnRate: 12 },
            warp: { from: 0, to: 0.2, ...SWORD_WARP },
            next: { light: "sword_light_1" },
        }),
        sword_heavy: move({
            id: "sword_heavy",
            clip: CLIP.swordHeavy,
            tags: ["heavy"],
            staminaCost: 12,
            spendsFocus: true,
            holdAt: 0.27,
            armor: { from: 0.1, to: 0.55 },
            hits: [
                bladeHit(0.42, 0.58, {
                    damageScale: 2.2,
                    poiseDamage: 38,
                    impact: "heavy",
                    knockback: 7,
                }),
            ],
            cancels: comboCancels(0.72, 0.6, 0.86),
            tracking: { from: 0, to: 0.42, turnRate: 10 },
            warp: { from: 0.28, to: 0.44, maxDistance: metres(4), strikeDistance: metres(0.5) },
        }),
        sword_heavy_finisher: move({
            id: "sword_heavy_finisher",
            clip: CLIP.swordHeavyFinisher,
            tags: ["heavy"],
            staminaCost: 14,
            spendsFocus: true,
            armor: { from: 0.1, to: 0.62 },
            hits: [
                bladeHit(0.5, 0.66, {
                    damageScale: 2.6,
                    poiseDamage: 46,
                    impact: "heavy",
                    knockback: 8,
                }),
            ],
            cancels: comboCancels(0.78, 0.68, 0.9),
            tracking: { from: 0, to: 0.48, turnRate: 10 },
            warp: { from: 0.1, to: 0.48, ...SWORD_WARP },
        }),
        sword_dash_attack: move({
            id: "sword_dash_attack",
            clip: CLIP.swordLight3,
            tags: ["light"],
            playbackRate: 1.25,
            staminaCost: 8,
            focusGain: 0.2,
            hits: [bladeHit(0.5, 0.66, { damageScale: 1.3, poiseDamage: 20 })],
            cancels: comboCancels(0.68, 0.56, 0.86),
            warp: { from: 0, to: 0.5, maxDistance: metres(7), strikeDistance: metres(0.45) },
            next: { light: "sword_light_4", heavy: "sword_heavy_finisher" },
        }),
        sword_counter: move({
            id: "sword_counter",
            clip: CLIP.swordCounter,
            tags: ["light"],
            fadeSeconds: 0.03,
            focusGain: 0.3,
            invulnerable: { from: 0, to: 0.6 },
            hits: [
                bladeHit(0.25, 0.45, {
                    damageScale: 1.8,
                    poiseDamage: 60,
                    impact: "heavy",
                    knockback: 7,
                }),
            ],
            cancels: comboCancels(0.6, 0.5, 0.8),
            tracking: { from: 0, to: 0.25, turnRate: 20 },
            warp: { from: 0, to: 0.25, maxDistance: metres(3), strikeDistance: metres(0.45) },
            next: { light: "sword_light_2" },
        }),
        dodge_roll: move({
            id: "dodge_roll",
            clip: CLIP.dodgeRoll,
            tags: ["dodge"],
            playbackRate: 1.5,
            rootMotionScale: 0.8,
            staminaCost: 22,
            fadeSeconds: 0.04,
            invulnerable: { from: 0.05, to: 0.37 },
            cancels: [
                { from: 0.4, to: 1, into: ["light"] },
                { from: 0.5, to: 1, into: ["jump"] },
                { from: 0.6, to: 1, into: EVERYTHING },
            ],
            next: { light: "sword_dash_attack" },
        }),
        dodge_backstep: move({
            id: "dodge_backstep",
            clip: CLIP.dodgeBackstep,
            tags: ["dodge"],
            rootMotionScale: 0.5,
            staminaCost: 16,
            fadeSeconds: 0.04,
            invulnerable: { from: 0.02, to: 0.55 },
            cancels: [{ from: 0.5, to: 1, into: EVERYTHING }],
        }),
        slide_start: move({
            id: "slide_start",
            motion: "momentum",
            clip: CLIP.slideStart,
            tags: ["dodge"],
            playbackRate: 1.2,
            staminaCost: 12,
            fadeSeconds: 0.08,
            momentum: SLIDE_MOMENTUM,
            invulnerable: { from: 0.35, to: 0.7 },
            cancels: [
                { from: 0, to: 1, into: ["jump"] },
                { from: 0.55, to: 1, into: ["light"] },
            ],
            next: SLIDE_FOLLOW_UP,
            followedBy: "slide_hold",
        }),
        slide_hold: move({
            id: "slide_hold",
            motion: "momentum",
            clip: CLIP.slideHold,
            tags: ["dodge"],
            fadeSeconds: 0.1,
            momentum: SLIDE_MOMENTUM,
            cancels: [{ from: 0, to: 1, into: ["light", "dodge", "jump"] }],
            next: SLIDE_FOLLOW_UP,
            followedBy: "slide_exit",
        }),
        slide_exit: move({
            id: "slide_exit",
            motion: "momentum",
            clip: CLIP.slideExit,
            tags: ["dodge"],
            fadeSeconds: 0.1,
            momentum: SLIDE_MOMENTUM,
            cancels: [
                { from: 0, to: 1, into: ["jump"] },
                { from: 0.35, to: 1, into: EVERYTHING },
            ],
            next: SLIDE_FOLLOW_UP,
        }),
        jump_start: move({
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
        airborne: move({
            id: "airborne",
            clip: CLIP.jumpLoop,
            tags: ["jump"],
            motion: "physics",
            requires: "airborne",
            loop: true,
            fadeSeconds: 0.12,
            onLand: "land",
            cancels: [{ from: 0, to: 1, into: ["light"] }],
        }),
        land: move({
            id: "land",
            clip: CLIP.jumpLand,
            tags: ["jump"],
            motion: "physics",
            durationSeconds: LAND_SECONDS,
            fadeSeconds: 0.05,
            cancels: [
                { from: 0, to: 1, into: ["light", "heavy", "dodge", "parry", "shoot", "jump"] },
                { from: 0.25, to: 1, into: ["movement"] },
            ],
        }),
        air_slash: move({
            id: "air_slash",
            clip: CLIP.swordLight1,
            tags: ["light"],
            motion: "physics",
            requires: "airborne",
            playbackRate: 1.2,
            focusGain: 0.15,
            hits: [bladeHit(0.3, 0.48)],
            tracking: { from: 0, to: 0.3, turnRate: 14 },
            onLand: "air_slash_land",
            followedBy: "airborne",
        }),
        air_slash_land: move({
            id: "air_slash_land",
            clip: CLIP.swordHeavyFinisher,
            tags: ["heavy"],
            hits: [
                bladeHit(0.5, 0.66, {
                    damageScale: 1.8,
                    poiseDamage: 30,
                    impact: "heavy",
                    knockback: 6,
                }),
            ],
            cancels: comboCancels(0.78, 0.68, 0.9),
        }),
        parry: move({
            id: "parry",
            clip: CLIP.parry,
            tags: ["parry"],
            fadeSeconds: 0.03,
            parryWindow: { from: 0, to: 0.4 },
            cancels: [{ from: 0.55, to: 1, into: EVERYTHING }],
        }),
    },
    entry: {
        light: "sword_light_1",
        heavy: "sword_heavy",
        dodge: "dodge_roll",
        parry: "parry",
        slide: "slide_start",
        jump: "jump_start",
    },
    sprintEntry: { light: "sword_dash_attack" },
    stationaryEntry: { dodge: "dodge_backstep" },
    airEntry: { light: "air_slash" },
    air: { airborne: "airborne", land: "land" },
    reactions: {
        flinch: CLIP.reactFlinch,
        knockback: CLIP.reactKnockback,
        knockdown: CLIP.reactKnockdown,
        stagger: CLIP.reactStagger,
        parried: CLIP.reactParried,
        finisherDeath: CLIP.deathForward,
        deaths: [CLIP.deathForward, CLIP.deathBackward],
    },
};
