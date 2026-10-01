import { CLIP } from "@/constants/characters";
import type { HitShape, IMoveDefinition, IReactionClips } from "@/types/combat";

export const WEAPON_HIT_SHAPE: HitShape = { kind: "weapon" };

export const SHARED_REACTIONS: Pick<
    IReactionClips,
    "knockdown" | "parried" | "finisherDeath" | "deaths"
> = {
    knockdown: [CLIP.reactKnockdown],
    parried: CLIP.reactParried,
    finisherDeath: CLIP.deathForward,
    deaths: [CLIP.deathCollapse, CLIP.deathKnockback],
};

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
