import type { Vector3 } from "three";
import type {
    HitShape,
    ICombatant,
    IFinisherDefinition,
    IHitOutcome,
    ImpactTier,
    IStrikeSegment,
    TelegraphDanger,
} from "@/types/combat";

export interface ITelegraphSource extends ICombatant {
    readonly activeMoveId: string | null;
    sampleHitShape(shape: HitShape, segment: IStrikeSegment): boolean;
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
    perfectDodge: { dodger: ICombatant; attacker: ICombatant };
    staggered: { combatant: ICombatant };
    killed: { combatant: ICombatant; killer: ICombatant | null };
    finisherStarted: { attacker: ICombatant; victim: ICombatant; finisher: IFinisherDefinition };
    finisherImpact: { attacker: ICombatant; victim: ICombatant };
    finisherKill: { attacker: ICombatant; victim: ICombatant };
    telegraph: {
        combatant: ITelegraphSource;
        moveId: string;
        danger: TelegraphDanger;
        shape: HitShape;
    };
    noise: { position: Vector3; radius: number };
    alarmRaised: { raiser: ICombatant; position: Vector3 };
}

export function emitHitLanded(
    events: CombatEvents,
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

type Listener<T> = (event: T) => void;
type ListenerSets = { [K in keyof ICombatEventMap]: Set<Listener<ICombatEventMap[K]>> };

export class CombatEvents {
    private readonly listeners: ListenerSets = {
        hitLanded: new Set(),
        parried: new Set(),
        perfectDodge: new Set(),
        staggered: new Set(),
        killed: new Set(),
        finisherStarted: new Set(),
        finisherImpact: new Set(),
        finisherKill: new Set(),
        telegraph: new Set(),
        noise: new Set(),
        alarmRaised: new Set(),
    };

    on<K extends keyof ICombatEventMap>(
        type: K,
        listener: Listener<ICombatEventMap[K]>
    ): () => void {
        const listeners = this.listeners[type];
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    }

    emit<K extends keyof ICombatEventMap>(type: K, event: ICombatEventMap[K]): void {
        for (const listener of this.listeners[type]) listener(event);
    }

    clear(): void {
        for (const listeners of Object.values(this.listeners)) listeners.clear();
    }
}
