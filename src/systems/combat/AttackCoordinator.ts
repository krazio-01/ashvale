import { ATTACK_COORDINATOR } from "@/constants/enemies";
import { shortestAngleBetween } from "@/lib/helpers";

interface IHeldAttackToken {
    holderId: string;
    cost: number;
    baseReturnsAt: number;
    returnsAt: number;
}

export class AttackCoordinator {
    private readonly pending: IHeldAttackToken[] = [];
    private readonly ringClaims = new Map<string, number>();
    private readonly ringOccupied = new Array<boolean>(ATTACK_COORDINATOR.ringSlotCount).fill(
        false
    );
    private availableTokens = ATTACK_COORDINATOR.maxSimultaneousAttackers;
    private elapsed = 0;

    tick(deltaSeconds: number): void {
        this.elapsed += deltaSeconds;

        for (let index = this.pending.length - 1; index >= 0; index -= 1) {
            const entry = this.pending[index];
            if (entry.returnsAt > this.elapsed) continue;
            this.availableTokens += entry.cost;
            this.pending.splice(index, 1);
        }
    }

    canTakeAttackToken(cost: number, isTargetInFinisher: boolean): boolean {
        return !isTargetInFinisher && cost <= this.availableTokens;
    }

    tryTakeAttackToken(
        holderId: string,
        cost: number,
        extraComboSteps: number,
        isTargetInFinisher: boolean
    ): boolean {
        if (!this.canTakeAttackToken(cost, isTargetInFinisher)) return false;

        this.availableTokens -= cost;
        const baseReturnsAt = this.elapsed + ATTACK_COORDINATOR.holdSeconds;
        this.pending.push({
            holderId,
            cost,
            baseReturnsAt,
            returnsAt: baseReturnsAt + ATTACK_COORDINATOR.comboStepSeconds * extraComboSteps,
        });
        return true;
    }

    dropComboExtension(holderId: string): void {
        for (const entry of this.pending)
            if (entry.holderId === holderId) entry.returnsAt = entry.baseReturnsAt;
    }

    releaseRingSlot(enemyId: string): void {
        const index = this.ringClaims.get(enemyId);
        if (index === undefined) return;

        this.ringClaims.delete(enemyId);
        for (const claimed of this.ringClaims.values()) if (claimed === index) return;
        this.ringOccupied[index] = false;
    }

    claimRingAngle(enemyId: string, bearing: number): number {
        const existing = this.ringClaims.get(enemyId);
        if (existing !== undefined) return this.slotAngle(existing);

        const index = this.nearestSlot(bearing, true) ?? this.nearestSlot(bearing, false) ?? 0;
        this.ringOccupied[index] = true;
        this.ringClaims.set(enemyId, index);
        return this.slotAngle(index);
    }

    private slotAngle(index: number): number {
        return (index / ATTACK_COORDINATOR.ringSlotCount) * Math.PI * 2;
    }

    private nearestSlot(bearing: number, freeOnly: boolean): number | null {
        let nearest: number | null = null;
        let nearestGap = Number.POSITIVE_INFINITY;
        for (let index = 0; index < ATTACK_COORDINATOR.ringSlotCount; index += 1) {
            if (freeOnly && this.ringOccupied[index]) continue;
            const gap = Math.abs(shortestAngleBetween(bearing, this.slotAngle(index)));
            if (gap >= nearestGap) continue;
            nearest = index;
            nearestGap = gap;
        }
        return nearest;
    }
}
