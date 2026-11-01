import { Vector3 } from "three";
import type {
    HitShape,
    ICombatant,
    IFinisherDefinition,
    IHitOutcome,
    IHitPayload,
    ImpactTier,
    ICapsule,
    AttackWarningDanger,
} from "@/types/combat";
import type { GameEvents } from "@/events/EventEmitter";

export interface IAttackWarningSource extends ICombatant {
    readonly activeMoveId: string | null;
    sampleHitShape(shape: HitShape, segment: ICapsule): boolean;
}

export interface ICombatEventMap {
    hitLanded: {
        attacker: ICombatant;
        defender: ICombatant;
        outcome: IHitOutcome;
        impact: ImpactTier;
        point: Vector3;
    };
    parried: { attacker: ICombatant; defender: ICombatant };
    killed: { combatant: ICombatant; killer: ICombatant | null };
    finisherStarted: { attacker: ICombatant; victim: ICombatant; finisher: IFinisherDefinition };
    finisherImpact: { attacker: ICombatant; victim: ICombatant };
    finisherKill: { attacker: ICombatant; victim: ICombatant };
    attackWarning: {
        combatant: IAttackWarningSource;
        moveId: string;
        danger: AttackWarningDanger;
        shape: HitShape;
    };
    noise: { position: Vector3; radius: number };
    alarmRaised: { raiser: ICombatant; position: Vector3 };
}

export function createHitPayload(attacker: ICombatant, isRanged: boolean): IHitPayload {
    return {
        attacker,
        moveId: "",
        damage: 0,
        poiseDamage: 0,
        impact: "light",
        knockback: 0,
        parryable: false,
        dodgeOnly: false,
        ranged: isRanged,
        swing: "side",
        origin: new Vector3(),
    };
}

export function createHitEvent(attacker: ICombatant): ICombatEventMap["hitLanded"] {
    return {
        attacker,
        defender: attacker,
        outcome: { kind: "damaged", reaction: "none", damageDealt: 0 },
        impact: "light",
        point: new Vector3(),
    };
}

export function emitHitLanded(
    events: GameEvents,
    event: ICombatEventMap["hitLanded"],
    defender: ICombatant,
    outcome: IHitOutcome,
    impact: ImpactTier,
    point: Vector3
): void {
    event.defender = defender;
    event.outcome = outcome;
    event.impact = impact;
    event.point.copy(point);
    events.emit("hitLanded", event);
}
