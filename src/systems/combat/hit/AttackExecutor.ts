import { Vector3 } from "three";
import type { IMachineOutput } from "@/systems/combat/actions/ActionMachine";
import type { ICombatEventMap } from "@/systems/combat/services/CombatEvents";
import { WeaponSweep } from "@/systems/combat/hit/WeaponSweep";
import { overlapsInterval } from "@/systems/combat/actions/MoveTimeline";
import { COMBAT_TIMING, FOCUS, HITSTOP, MOVEMENT } from "@/constants/combat";
import { clamp } from "@/lib/helpers";
import type {
    HitShape,
    ICombatant,
    IHitOutcome,
    IHitPayload,
    IHitWindow,
    IMoveDefinition,
    IStrikeSegment,
} from "@/types/combat";
import type { IWorldContext } from "@/types/world";

export class AttackExecutor {
    isWeaponStriking = false;

    private readonly owner: IAttackOwner;
    private readonly context: CombatServices;
    private readonly sweeps: WeaponSweep[] = [];
    private readonly struck: ICombatant[] = [];
    private readonly payload: IHitPayload;
    private readonly hitEvent: ICombatEventMap["hitLanded"];
    private warpTarget: ICombatant | null = null;
    private focusPips = 0;

    constructor(owner: IAttackOwner, context: CombatServices) {
        this.owner = owner;
        this.context = context;
        this.payload = {
            attacker: owner,
            moveId: "",
            damage: 0,
            poiseDamage: 0,
            impact: "light",
            knockback: 0,
            parryable: false,
            origin: new Vector3(),
        };
        this.hitEvent = {
            attacker: owner,
            defender: owner,
            outcome: { kind: "damaged", reaction: "none", damageDealt: 0 },
            impact: "light",
            point: new Vector3(),
        };
    }

    begin(move: IMoveDefinition, target: ICombatant | null, focusPips: number): void {
        while (this.sweeps.length < move.hits.length) this.sweeps.push(new WeaponSweep());
        for (const sweep of this.sweeps) sweep.begin();

        this.focusPips = focusPips;
        this.warpTarget = move.warp && target && !target.isDead ? target : null;
        this.isWeaponStriking = false;
    }

    applyWarp(
        move: IMoveDefinition,
        previousTime: number,
        time: number,
        displacement: Vector3,
        deltaSeconds: number
    ): void {
        const warp = move.warp;
        const target = this.warpTarget;
        if (!warp || !target || target.isDead) return;

        const from = Math.max(previousTime, warp.from);
        const to = Math.min(time, warp.to);
        if (to <= from) return;

        const targetPosition = target.position ?? target.sceneObject.position;
        const toTarget = scratchToTarget.subVectors(targetPosition, this.owner.position);
        toTarget.y = 0;
        const centreDistance = toTarget.length();
        const gap = centreDistance - (target.hurtboxes[0]?.radius ?? 0) - this.owner.bodyRadius;
        if (centreDistance < 1e-6 || gap > warp.maxDistance) return;

        toTarget.divideScalar(centreDistance);
        const shortfall = gap - warp.strikeDistance;
        const frameShare = (to - from) / (warp.to - from);
        const clipTravelThisFrame = Math.max(0, displacement.dot(toTarget));
        const correction = clamp(
            shortfall * frameShare - clipTravelThisFrame,
            -clipTravelThisFrame,
            MOVEMENT.warpMaxSpeed * deltaSeconds
        );
        displacement.addScaledVector(toTarget, correction);
    }

    process(move: IMoveDefinition, output: IMachineOutput): void {
        this.isWeaponStriking = false;

        for (let index = 0; index < move.hits.length; index += 1) {
            const window = move.hits[index];
            const sweep = this.sweeps[index];
            if (!window || !sweep || !overlapsInterval(window, output.previousTime, output.time))
                continue;

            if (window.shape.kind === "weapon") this.isWeaponStriking = true;
            if (!this.owner.sampleHitShape(window.shape, scratchSegment)) continue;

            const count = sweep.sweep(
                scratchSegment.start,
                scratchSegment.end,
                scratchSegment.radius,
                this.owner.team,
                this.context.combatRegistry,
                this.struck
            );

            for (let hit = 0; hit < count; hit += 1) {
                const defender = this.struck[hit];
                if (defender) this.strike(defender, window, move, output.chargeLevel);
            }
        }
    }

    private strike(
        defender: ICombatant,
        window: IHitWindow,
        move: IMoveDefinition,
        chargeLevel: number
    ): void {
        const chargeMultiplier = 1 + chargeLevel * COMBAT_TIMING.chargeDamageBonus;
        const payload = this.payload;

        payload.moveId = move.id;
        payload.damage =
            this.owner.attackPower *
            window.damageScale *
            chargeMultiplier *
            (1 + this.focusPips * FOCUS.damagePerPip);
        payload.poiseDamage =
            window.poiseDamage * chargeMultiplier * (1 + this.focusPips * FOCUS.poisePerPip);
        payload.impact = window.impact;
        payload.knockback = window.knockback;
        payload.parryable = window.parryable;
        payload.origin.copy(this.owner.position);

        const outcome = defender.receiveHit(payload);

        if (outcome.kind === "parried") {
            this.owner.onAttackParried(defender);
            return;
        }

        if (outcome.kind !== "damaged" && outcome.kind !== "staggered" && outcome.kind !== "killed")
            return;

        const hitstopFrames = HITSTOP.frames[window.impact];
        this.context.timeDilation.hitstop(this.owner, hitstopFrames.attacker);
        this.context.timeDilation.hitstop(defender, hitstopFrames.defender);

        const event = this.hitEvent;
        event.defender = defender;
        event.outcome = outcome;
        event.impact = window.impact;
        event.point.copy(scratchSegment.end).lerp(defender.sceneObject.position, 0.35);
        this.context.combatEvents.emit("hitLanded", event);

        this.owner.onHitConfirmed(defender, outcome, move);
    }
}

export type CombatServices = Pick<
    IWorldContext,
    "combatRegistry" | "combatEvents" | "timeDilation"
>;

export interface IAttackOwner extends ICombatant {
    readonly attackPower: number;
    readonly bodyRadius: number;
    readonly position: Vector3;
    sampleHitShape(shape: HitShape, segment: IStrikeSegment): boolean;
    onHitConfirmed(defender: ICombatant, outcome: IHitOutcome, move: IMoveDefinition): void;
    onAttackParried(defender: ICombatant): void;
}

const scratchSegment: IStrikeSegment = { start: new Vector3(), end: new Vector3(), radius: 0 };
const scratchToTarget = new Vector3();
