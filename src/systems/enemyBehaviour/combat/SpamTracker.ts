import { SPAM_TRACKER } from "@/constants/enemies";
export class SpamTracker {
    private readonly hitTimes: number[] = [];
    private elapsed = 0;

    tick(deltaSeconds: number): void {
        this.elapsed += deltaSeconds;
        const cutoff = this.elapsed - SPAM_TRACKER.windowSeconds;
        while ((this.hitTimes[0] ?? Number.POSITIVE_INFINITY) < cutoff) this.hitTimes.shift();
    }

    notifyLightHitLanded(): void {
        this.hitTimes.push(this.elapsed);
    }

    parryBonus(): number {
        return Math.min(SPAM_TRACKER.maxBonus, this.hitTimes.length * SPAM_TRACKER.bonusPerHit);
    }
}
