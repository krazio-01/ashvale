import { CLIP } from "@/constants/characters";
import { PARRY_CLIP_MARKS } from "@/constants/combat";
import type { IClipMarks } from "@/constants/combat";
import type { HitShape, IMoveDefinition, IReactionClips, ParriedReactions } from "@/types/combat";

export const WEAPON_HIT_SHAPE: HitShape = { kind: "weapon" };

export const SHARED_REACTIONS: Pick<IReactionClips, "knockdown" | "finisherDeath" | "deaths"> = {
    knockdown: [CLIP.reactKnockdown],
    finisherDeath: CLIP.deathForward,
    deaths: [CLIP.deathCollapse, CLIP.deathKnockback],
};

export const uniformParried = (clip: string): ParriedReactions => ({
    parry: { high: clip, side: clip },
    perfect: { high: clip, side: clip },
});

function marksOf(clip: string): IClipMarks {
    const marks = PARRY_CLIP_MARKS[clip];
    if (!marks) throw new Error(`no clip marks for "${clip}" in PARRY_CLIP_MARKS`);
    return marks;
}

export function clipMark(clip: string, name: string): number {
    const time = marksOf(clip).marks[name];
    if (time === undefined) throw new Error(`clip "${clip}" has no mark "${name}"`);
    return time;
}

export function clipGripWindow(clip: string): { from: number; to: number } {
    const grip = marksOf(clip).grip;
    if (!grip) throw new Error(`clip "${clip}" has no baked grip window`);
    return grip;
}

export type MoveSpec = Pick<IMoveDefinition, "id" | "clip" | "tags"> & Partial<IMoveDefinition>;

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
