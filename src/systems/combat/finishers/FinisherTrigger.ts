import { COMBAT_TIMING } from "@/constants/combat";
export class FinisherTrigger {
    private requestRemaining = 0;
    private streakRemaining = 0;

    get isRequested(): boolean {
        return this.requestRemaining > 0;
    }

    get inStreak(): boolean {
        return this.streakRemaining > 0;
    }

    press(): void {
        this.requestRemaining = COMBAT_TIMING.inputBufferSeconds;
    }

    openStreak(): void {
        this.streakRemaining = COMBAT_TIMING.streakWindowSeconds;
    }

    reset(): void {
        this.requestRemaining = 0;
        this.streakRemaining = 0;
    }

    tick(deltaSeconds: number): void {
        this.requestRemaining = Math.max(0, this.requestRemaining - deltaSeconds);
        this.streakRemaining = Math.max(0, this.streakRemaining - deltaSeconds);
    }
}
