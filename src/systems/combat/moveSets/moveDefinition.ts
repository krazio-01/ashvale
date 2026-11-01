import { CLIP } from "@/constants/characters";
import { CLIP_MARKS } from "@/constants/combat";
import type {
    IClipMarks,
    HitShape,
    IHitWindow,
    IMoveDefinition,
    IReactionClips,
} from "@/types/combat";
import { ERRORS } from "@/constants/strings";

export const WEAPON_HIT_SHAPE: HitShape = { kind: "weapon" };

export const SHARED_REACTIONS: Pick<IReactionClips, "knockdown" | "finisherDeath" | "deaths"> = {
    knockdown: [CLIP.reactKnockdown],
    finisherDeath: CLIP.deathForward,
    deaths: [CLIP.deathCollapse, CLIP.deathKnockback],
};

export type MoveSpec = Pick<IMoveDefinition, "id" | "clip" | "tags"> & Partial<IMoveDefinition>;

function marksOf(clip: string): IClipMarks {
    const marks = CLIP_MARKS[clip];
    if (!marks) throw new Error(ERRORS.missingClipMarks(clip));
    return marks;
}

export function clipMark(clip: string, name: string): number {
    const time = marksOf(clip).marks[name];
    if (time === undefined) throw new Error(ERRORS.missingClipMark(clip, name));
    return time;
}

export function clipGripWindow(clip: string): { from: number; to: number } {
    const grip = marksOf(clip).grip;
    if (!grip) throw new Error(ERRORS.missingGripWindow(clip));
    return grip;
}

export function hitWindow(
    from: number,
    to: number,
    overrides: Partial<IHitWindow> = {}
): IHitWindow {
    return {
        from,
        to,
        shape: WEAPON_HIT_SHAPE,
        damageScale: 1,
        poiseDamage: 12,
        impact: "light",
        knockback: 3,
        parryable: true,
        dodgeOnly: false,
        swing: "side",
        ...overrides,
    };
}

export function defineMove(
    defaults: Pick<IMoveDefinition, "fadeSeconds" | "requires" | "minimumWindupSeconds">,
    spec: MoveSpec
): IMoveDefinition {
    return {
        playbackRate: 1,
        staminaCost: 0,
        focusGain: 0,
        spendsFocus: false,
        rootMotionScale: 1,
        motion: "rootMotion",
        hits: [],
        cancels: [],
        ...defaults,
        ...spec,
    };
}
