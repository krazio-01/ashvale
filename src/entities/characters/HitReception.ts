import type { IMoveStateOutput, MoveStateMachine } from "@/systems/combat/actions/MoveStateMachine";
import { reactionFor } from "@/systems/combat/hit/HitResolver";
import type { IDefenderSnapshot } from "@/systems/combat/hit/HitResolver";
import type { CharacterAnimator, IOneShotOptions } from "@/entities/characters/CharacterAnimator";
import type { IHitPayload, IMoveSet, ReactionTier } from "@/types/combat";
import { COMBAT_TIMING } from "@/constants/combat";
import { pickRandom } from "@/lib/helpers";

interface IHitReceptionSpec {
    moveSet: IMoveSet;
    reactionLockout?: Partial<Record<ReactionTier, number>>;
    ignoredReactions?: readonly ReactionTier[];
    reactionDodgeCancelSeconds?: number;
}

export class HitReception {
    private static readonly STAGGER_PLAYBACK: IOneShotOptions = {
        fadeSeconds: 0.08,
        loop: true,
        timeSetByCaller: false,
    };

    private static readonly PARRIED_PLAYBACK: IOneShotOptions = {
        ...HitReception.STAGGER_PLAYBACK,
        fadeSeconds: 0.03,
    };

    private static readonly REACTION_PLAYBACK: IOneShotOptions = {
        fadeSeconds: COMBAT_TIMING.reactionFade,
        loop: false,
        timeSetByCaller: false,
    };

    private readonly machine: MoveStateMachine;
    private readonly animator: CharacterAnimator;
    private readonly staggerClip: string;
    private readonly clipsByTier: Record<ReactionTier, readonly string[]>;
    private readonly lockout: Partial<Record<ReactionTier, number>>;
    private readonly ignored: readonly ReactionTier[];
    private readonly dodgeCancelSeconds: number;
    private readonly defender: IDefenderSnapshot = {
        isDead: false,
        isUntouchable: false,
        isInvulnerable: false,
        isDodging: false,
        invulnerableSeconds: 0,
        isParrying: false,
        isArmored: false,
        isStaggered: false,
    };
    private pendingReactionClip = "";
    private pendingStaggerClip: string | null = null;

    constructor(spec: IHitReceptionSpec, machine: MoveStateMachine, animator: CharacterAnimator) {
        const reactions = spec.moveSet.reactions;
        this.machine = machine;
        this.animator = animator;
        this.staggerClip = reactions.stagger;
        this.clipsByTier = {
            none: reactions.flinch,
            flinch: reactions.flinch,
            knockback: reactions.knockback,
            knockdown: reactions.knockdown,
            stagger: [reactions.stagger],
        };
        this.lockout = spec.reactionLockout ?? {};
        this.ignored = spec.ignoredReactions ?? [];
        this.dodgeCancelSeconds = spec.reactionDodgeCancelSeconds ?? Number.POSITIVE_INFINITY;
    }

    snapshot(isDead: boolean): IDefenderSnapshot {
        const machine = this.machine;
        const output = machine.output;
        const state = machine.state;
        const inMove = state === "move";
        const defender = this.defender;
        defender.isDead = isDead;
        defender.isUntouchable = state === "finisher";
        defender.isInvulnerable = inMove && output.isInvulnerable;
        defender.isDodging = inMove && output.move !== null && output.move.tags.includes("dodge");
        defender.invulnerableSeconds = output.invulnerableSeconds;
        defender.isParrying = inMove && output.isParrying;
        defender.isArmored = inMove && output.isArmored;
        defender.isStaggered = state === "staggered";
        return defender;
    }

    react(impact: IHitPayload["impact"]): ReactionTier {
        const rawReaction = reactionFor(impact, this.defender);
        const reaction = this.ignored.includes(rawReaction) ? "none" : rawReaction;
        if (reaction === "none") return reaction;

        const clips = this.clipsByTier[reaction];
        this.pendingReactionClip = clips.length > 0 ? pickRandom(clips) : this.staggerClip;
        const clipSeconds = this.animator.durationOf(this.pendingReactionClip);
        this.machine.react(
            reaction,
            Math.min(clipSeconds, this.lockout[reaction] ?? clipSeconds),
            this.dodgeCancelSeconds
        );
        return reaction;
    }

    queueParriedStagger(clip: string, staggerSeconds: number): void {
        this.pendingStaggerClip = clip;
        this.machine.stagger(staggerSeconds);
    }

    playStarted(output: IMoveStateOutput): void {
        if (output.reactionStarted)
            this.animator.playOneShot(this.pendingReactionClip, HitReception.REACTION_PLAYBACK);

        if (!output.staggerStarted) return;
        this.animator.playOneShot(
            this.pendingStaggerClip ?? this.staggerClip,
            this.pendingStaggerClip !== null
                ? HitReception.PARRIED_PLAYBACK
                : HitReception.STAGGER_PLAYBACK
        );
        this.pendingStaggerClip = null;
    }
}
