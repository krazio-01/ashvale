import { ATTACK_COORDINATOR } from "@/constants/enemies";
import { angleDelta } from "@/lib/helpers";

interface IPendingRelease {
    holderId: string;
    cost: number;
    baseResumesAt: number;
    resumesAt: number;
}

export class AttackCoordinator {
    private readonly ringSlotCount: number;
    private readonly pending: IPendingRelease[] = [];
    private readonly ringClaims = new Map<string, number>();
    private readonly ringOccupied: boolean[];
    private available: number;
    private elapsed = 0;

    constructor(
        capacity = ATTACK_COORDINATOR.tokenCapacity,
        ringSlotCount = ATTACK_COORDINATOR.ringSlotCount
    ) {
        this.available = capacity;
        this.ringSlotCount = ringSlotCount;
        this.ringOccupied = new Array<boolean>(ringSlotCount).fill(false);
    }

    tick(deltaSeconds: number): void {
        this.elapsed += deltaSeconds;

        for (let index = this.pending.length - 1; index >= 0; index -= 1) {
            const entry = this.pending[index];
            if (!entry || entry.resumesAt > this.elapsed) continue;
            this.available += entry.cost;
            this.pending.splice(index, 1);
        }
    }

    canAcquire(cost: number, targetPaired: boolean): boolean {
        return !targetPaired && cost <= this.available;
    }

    tryAcquire(
        holderId: string,
        cost: number,
        extraComboSteps: number,
        targetPaired: boolean
    ): boolean {
        if (!this.canAcquire(cost, targetPaired)) return false;

        this.available -= cost;
        const baseResumesAt = this.elapsed + ATTACK_COORDINATOR.holdSeconds;
        this.pending.push({
            holderId,
            cost,
            baseResumesAt,
            resumesAt: baseResumesAt + ATTACK_COORDINATOR.comboStepSeconds * extraComboSteps,
        });
        return true;
    }

    dropExtension(holderId: string): void {
        for (const entry of this.pending)
            if (entry.holderId === holderId) entry.resumesAt = entry.baseResumesAt;
    }

    private claimRingSlot(enemyId: string, bearing = 0): number {
        const existing = this.ringClaims.get(enemyId);
        if (existing !== undefined) return existing;

        const index = this.nearestSlot(bearing, true) ?? this.nearestSlot(bearing, false) ?? 0;
        this.ringOccupied[index] = true;
        this.ringClaims.set(enemyId, index);
        return index;
    }

    releaseRingSlot(enemyId: string): void {
        const index = this.ringClaims.get(enemyId);
        if (index === undefined) return;

        this.ringClaims.delete(enemyId);
        for (const claimed of this.ringClaims.values()) if (claimed === index) return;
        this.ringOccupied[index] = false;
    }

    claimRingAngle(enemyId: string, bearing = 0): number {
        return this.slotAngle(this.claimRingSlot(enemyId, bearing));
    }

    private slotAngle(index: number): number {
        return (index / this.ringSlotCount) * Math.PI * 2;
    }

    private nearestSlot(bearing: number, freeOnly: boolean): number | null {
        let nearest: number | null = null;
        let nearestGap = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.ringSlotCount; index += 1) {
            if (freeOnly && this.ringOccupied[index]) continue;
            const gap = Math.abs(angleDelta(bearing, this.slotAngle(index)));
            if (gap >= nearestGap) continue;
            nearest = index;
            nearestGap = gap;
        }
        return nearest;
    }
}
