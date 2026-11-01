import { Vector3 } from "three";
import type { IMoveStateOutput } from "@/systems/combat/actions/MoveStateMachine";
import { createHitEvent, createHitPayload, emitHitLanded } from "@/events/CombatEvents";
import type { ICombatEventMap } from "@/events/CombatEvents";
import { isConnected } from "@/systems/combat/hit/HitResolver";
import { SweptHitDetector } from "@/systems/combat/hit/SweptHitDetector";
import { overlapsInterval } from "@/systems/combat/actions/MoveTimeline";
import { COMBAT_TIMING, FOCUS, HITSTOP, COMBAT_MOVEMENT } from "@/constants/combat";
import { clamp, horizontalDirection } from "@/lib/helpers";
import type {
    HitShape,
    ICombatant,
    IHitOutcome,
    IHitPayload,
    IHitWindow,
    IMoveDefinition,
    IParryResult,
    ICapsule,
    SwingDirection,
} from "@/types/combat";
import type { IWorldContext } from "@/types/world";

type CombatServices = Pick<IWorldContext, "combatRegistry" | "events" | "timeDilation">;

export interface IAttackOwner extends ICombatant {
    readonly attackPower: number;
    sampleHitShape(shape: HitShape, segment: ICapsule): boolean;
    onHitConfirmed(defender: ICombatant, outcome: IHitOutcome, move: IMoveDefinition): void;
    onAttackParried(defender: ICombatant, parry: IParryResult, swing: SwingDirection): void;
}

export class AttackExecutor {
    private static readonly scratchSegment: ICapsule = {
        start: new Vector3(),
        end: new Vector3(),
        radius: 0,
    };

    private static readonly scratchToTarget = new Vector3();

    private static readonly scratchHitPoint = new Vector3();

    isWeaponStriking = false;

    private readonly owner: IAttackOwner;
    private readonly context: CombatServices;
    private readonly sweeps: SweptHitDetector[] = [];
    private readonly hitDefenders: ICombatant[] = [];
    private readonly payload: IHitPayload;
    private readonly hitEvent: ICombatEventMap["hitLanded"];
    private gapCloseTarget: ICombatant | null = null;
    private focusPips = 0;

    constructor(owner: IAttackOwner, context: CombatServices) {
        this.owner = owner;
        this.context = context;
        this.payload = createHitPayload(owner, false);
        this.hitEvent = createHitEvent(owner);
    }

    begin(move: IMoveDefinition, target: ICombatant | null, focusPips: number): void {
        while (this.sweeps.length < move.hits.length) this.sweeps.push(new SweptHitDetector());
        for (const sweep of this.sweeps) sweep.begin();

        this.focusPips = focusPips;
        this.gapCloseTarget = move.gapClose && target && !target.isDead ? target : null;
        this.isWeaponStriking = false;
    }

    applyGapClose(
        move: IMoveDefinition,
        previousProgress: number,
        progress: number,
        displacement: Vector3,
        deltaSeconds: number
    ): void {
        const gapClose = move.gapClose;
        const target = this.gapCloseTarget;
        if (!gapClose || !target || target.isDead) return;

        const from = Math.max(previousProgress, gapClose.from);
        const to = Math.min(progress, gapClose.to);
        if (to <= from) return;

        const centreDistance = horizontalDirection(
            this.owner.position,
            target.position,
            AttackExecutor.scratchToTarget
        );
        const gap = centreDistance - target.bodyRadius - this.owner.bodyRadius;
        if (centreDistance < 1e-6 || gap > gapClose.maxDistance) return;

        const shortfall = gap - gapClose.strikeDistance;
        const frameShare = (to - from) / (gapClose.to - from);
        const clipTravelThisFrame = Math.max(0, displacement.dot(AttackExecutor.scratchToTarget));
        const correction = clamp(
            shortfall * frameShare - clipTravelThisFrame,
            -clipTravelThisFrame,
            COMBAT_MOVEMENT.gapCloseMaxSpeed * deltaSeconds
        );
        displacement.addScaledVector(AttackExecutor.scratchToTarget, correction);
    }

    checkHitWindows(move: IMoveDefinition, output: IMoveStateOutput): void {
        this.isWeaponStriking = false;

        for (let index = 0; index < move.hits.length; index += 1) {
            const window = move.hits[index];
            const sweep = this.sweeps[index];
            if (!sweep || !overlapsInterval(window, output.previousProgress, output.progress))
                continue;

            if (window.shape.kind === "weapon") this.isWeaponStriking = true;
            if (!this.owner.sampleHitShape(window.shape, AttackExecutor.scratchSegment)) continue;

            const count = sweep.sweep(
                AttackExecutor.scratchSegment.start,
                AttackExecutor.scratchSegment.end,
                AttackExecutor.scratchSegment.radius,
                this.owner.team,
                this.context.combatRegistry,
                this.hitDefenders
            );

            for (let hit = 0; hit < count; hit += 1) {
                const defender = this.hitDefenders[hit];
                if (this.applyHitTo(defender, window, move, output.chargeLevel)) {
                    this.isWeaponStriking = false;
                    return;
                }
            }
        }
    }

    private applyHitTo(
        defender: ICombatant,
        window: IHitWindow,
        move: IMoveDefinition,
        chargeLevel: number
    ): boolean {
        const chargeMultiplier = 1 + chargeLevel * COMBAT_TIMING.chargeDamageBonus;
        const payload = this.payload;

        payload.moveId = move.id;
        payload.damage =
            this.owner.attackPower *
            window.damageScale *
            chargeMultiplier *
            (1 + this.focusPips * FOCUS.damagePerFocusPoint);
        payload.poiseDamage =
            window.poiseDamage * chargeMultiplier * (1 + this.focusPips * FOCUS.poisePerFocusPoint);
        payload.impact = window.impact;
        payload.knockback = window.knockback;
        payload.parryable = window.parryable;
        payload.dodgeOnly = window.dodgeOnly;
        payload.swing = window.swing;
        payload.origin.copy(this.owner.position);

        const outcome = defender.receiveHit(payload);

        if (outcome.kind === "parried") {
            this.owner.onAttackParried(defender, outcome.parry, payload.swing);
            return true;
        }

        if (!isConnected(outcome)) return false;

        const hitstopFrames = HITSTOP.frames[window.impact];
        this.context.timeDilation.hitstop(this.owner, hitstopFrames.attacker);
        this.context.timeDilation.hitstop(defender, hitstopFrames.defender);

        AttackExecutor.scratchHitPoint
            .copy(AttackExecutor.scratchSegment.end)
            .lerp(defender.sceneObject.position, 0.35);
        emitHitLanded(
            this.context.events,
            this.hitEvent,
            defender,
            outcome,
            window.impact,
            AttackExecutor.scratchHitPoint
        );

        this.owner.onHitConfirmed(defender, outcome, move);
        return false;
    }
}
