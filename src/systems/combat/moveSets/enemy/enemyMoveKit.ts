import { CLIP } from "@/constants/characters";
import { TELEGRAPH } from "@/constants/combat";
import { defineMove, SHARED_REACTIONS } from "@/systems/combat/moveSets/moveDefinition";
import type {
    HitShape,
    ICancelWindow,
    IMoveDefinition,
    IMoveSet,
    IMoveWindow,
    ImpactTier,
    IProjectileLaunch,
    IWarpWindow,
} from "@/types/combat";

export const ENEMY_DEFENSE_MOVE_IDS = {
    parry: "enemy_parry",
    dodge: "enemy_dodge",
};

const RECOVERY_CANCEL_AFTER = 0.25;
const LATEST_MOVEMENT_CANCEL = 0.95;
const CHAIN_INTO = ["light", "heavy"] as const;

interface IStrikeSpec {
    id: string;
    clip: string;
    playbackRate?: number;
    window: readonly [number, number];
    shape: HitShape;
    damageScale: number;
    poiseDamage: number;
    impact: ImpactTier;
    knockback: number;
    perilous?: boolean;
    armor?: IMoveWindow;
    chainAt?: number;
    followedBy?: string;
    warp?: IWarpWindow;
}

interface ICastSpec {
    id: string;
    clip: string;
    playbackRate?: number;
    projectile: IProjectileLaunch;
    chainAt?: number;
}

function baseMove(id: string, clip: string, playbackRate: number): IMoveDefinition {
    return defineMove(
        { fadeSeconds: 0.08, requires: "any", minimumWarningSeconds: TELEGRAPH.leadSeconds },
        { id, clip, tags: ["light"], playbackRate }
    );
}

function attackCancels(committedUntil: number, chainAt: number | undefined): ICancelWindow[] {
    const cancels: ICancelWindow[] = [];
    if (chainAt !== undefined) cancels.push({ from: chainAt, to: 1, into: CHAIN_INTO });
    cancels.push({
        from: Math.min(committedUntil + RECOVERY_CANCEL_AFTER, LATEST_MOVEMENT_CANCEL),
        to: 1,
        into: ["movement"],
    });
    return cancels;
}

export function strike(spec: IStrikeSpec): IMoveDefinition {
    const [from, to] = spec.window;
    const perilous = spec.perilous ?? false;
    return {
        ...baseMove(spec.id, spec.clip, spec.playbackRate ?? 1),
        armor: spec.armor,
        warp: spec.warp,
        followedBy: spec.followedBy,
        tracking: { from: 0, to: from, turnRate: 6 },
        hits: [
            {
                from,
                to,
                shape: spec.shape,
                damageScale: spec.damageScale,
                poiseDamage: spec.poiseDamage,
                impact: spec.impact,
                knockback: spec.knockback,
                parryable: !perilous,
                perilous,
            },
        ],
        cancels: attackCancels(to, spec.chainAt),
    };
}

export function strikeWithRecovery(
    spec: Omit<IStrikeSpec, "followedBy">,
    recoveryClip: string
): IMoveDefinition[] {
    const recoveryId = `${spec.id}_recover`;
    return [strike({ ...spec, followedBy: recoveryId }), recovery(recoveryId, recoveryClip)];
}

export function cast(spec: ICastSpec): IMoveDefinition {
    return {
        ...baseMove(spec.id, spec.clip, spec.playbackRate ?? 1),
        tracking: { from: 0, to: spec.projectile.at, turnRate: 6 },
        projectile: spec.projectile,
        cancels: attackCancels(spec.projectile.at, spec.chainAt),
    };
}

function recovery(id: string, clip: string): IMoveDefinition {
    return {
        ...baseMove(id, clip, 1),
        tags: [],
        cancels: [{ from: 0.5, to: 1, into: ["movement", "dodge", "parry"] }],
    };
}

export function enemyMoveSet(moves: readonly IMoveDefinition[], dodgeClip: string): IMoveSet {
    const byId: Record<string, IMoveDefinition> = {
        [ENEMY_DEFENSE_MOVE_IDS.parry]: {
            ...baseMove(ENEMY_DEFENSE_MOVE_IDS.parry, CLIP.parry, 1),
            tags: ["parry"],
            fadeSeconds: 0.03,
            parryWindow: { from: 0, to: 0.4 },
            cancels: [{ from: 0.55, to: 1, into: ["movement"] }],
        },
        [ENEMY_DEFENSE_MOVE_IDS.dodge]: {
            ...baseMove(ENEMY_DEFENSE_MOVE_IDS.dodge, dodgeClip, 1),
            tags: ["dodge"],
            fadeSeconds: 0.04,
            rootMotionScale: 0.5,
            invulnerable: { from: 0.02, to: 0.55 },
            cancels: [{ from: 0.5, to: 1, into: ["movement"] }],
        },
    };
    for (const move of moves) byId[move.id] = move;

    return {
        moves: byId,
        entry: {},
        sprintEntry: {},
        airEntry: {},
        reactions: {
            flinch: [CLIP.reactFlinch],
            knockback: [CLIP.reactKnockback],
            stagger: CLIP.reactStagger,
            ...SHARED_REACTIONS,
        },
    };
}
