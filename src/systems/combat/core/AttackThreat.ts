import type { IMachineOutput } from "@/systems/combat/actions/ActionMachine";
import { firstStrikeAt } from "@/systems/combat/actions/MoveTimeline";
import type { IAttackThreat, IHitWindow, IMoveDefinition } from "@/types/combat";

export function attackThreatFor(
    move: IMoveDefinition | null,
    output: IMachineOutput,
    out: IAttackThreat
): IAttackThreat | null {
    if (!move) return null;

    let window: IHitWindow | undefined;
    for (let index = 0; index < move.hits.length && !window; index += 1) {
        const hit = move.hits[index];
        if (hit && hit.from > output.time) window = hit;
    }
    if (!window) return null;

    out.moveSerial = output.moveSerial;
    const windupEnd = Math.min(window.from, firstStrikeAt(move) ?? window.from);
    const windupLeft = Math.max(0, windupEnd - output.time);
    out.secondsUntilHit =
        windupLeft * output.windupUnitSeconds +
        (window.from - output.time - windupLeft) * output.moveSeconds;
    out.parryable = window.parryable;
    out.perilous = window.perilous;
    out.impact = window.impact;
    return out;
}
