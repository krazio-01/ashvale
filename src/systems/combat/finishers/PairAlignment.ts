import { Vector3 } from "three";
import { FINISHER_RULES } from "@/constants/combat";
import { yawTowards } from "@/lib/helpers";
import type { IFinisherDefinition } from "@/types/combat";

export function pairCentreDistance(
    authoredDistance: number,
    attackerRadius: number,
    victimRadius: number
): number {
    return Math.max(authoredDistance, attackerRadius + victimRadius + FINISHER_RULES.contactGap);
}

export function approachTravel(currentCentreDistance: number, slotCentreDistance: number): number {
    const excess = currentCentreDistance - slotCentreDistance;
    return excess > FINISHER_RULES.syncMaxShift ? excess : 0;
}

export function enforceSeparation(
    attacker: Vector3,
    victim: Vector3,
    minimumCentreDistance: number,
    out: Vector3
): Vector3 {
    const offsetX = victim.x - attacker.x;
    const offsetZ = victim.z - attacker.z;
    const distance = Math.hypot(offsetX, offsetZ);
    if (distance >= minimumCentreDistance) return out.set(0, 0, 0);
    if (distance < 1e-6) return out.set(0, 0, minimumCentreDistance);

    const shortfall = minimumCentreDistance - distance;
    return out.set((offsetX / distance) * shortfall, 0, (offsetZ / distance) * shortfall);
}

export class PairSlot {
    attackerYaw = 0;
    victimYaw = 0;
    readonly victimPosition = new Vector3();

    solve(
        attacker: Vector3,
        victim: Vector3,
        finisher: IFinisherDefinition,
        attackerRadius: number,
        victimRadius: number
    ): void {
        const towardVictim = yawTowards(attacker, victim);
        const centreDistance = pairCentreDistance(finisher.distance, attackerRadius, victimRadius);
        this.attackerYaw = towardVictim - finisher.bearing;
        this.victimYaw = this.attackerYaw + finisher.relativeYaw;
        this.victimPosition.set(
            attacker.x + Math.sin(towardVictim) * centreDistance,
            victim.y,
            attacker.z + Math.cos(towardVictim) * centreDistance
        );
    }
}
