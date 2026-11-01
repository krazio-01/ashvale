import { lerp, smoothstep, moveTowards, countDownTimers } from "@/lib/helpers";
import { HITSTOP } from "@/constants/combat";
import type { ISlowMotionProfile } from "@/types/combat";

export class TimeDilation {
    private slowScale = 1;
    private holdRemaining = 0;
    private slowMotionBlend = 0;
    private rampInSeconds = 0;
    private rampOutSeconds = 0;
    private readonly hitstopRemaining = new Map<object, number>();

    get slowMotionTimeScale(): number {
        return lerp(1, this.slowScale, smoothstep(0, 1, this.slowMotionBlend));
    }

    requestSlowMotion(profile: ISlowMotionProfile): void {
        const isActive = this.holdRemaining > 0 || this.slowMotionBlend > 0;
        this.slowScale = isActive ? Math.min(this.slowScale, profile.scale) : profile.scale;
        this.holdRemaining = Math.max(this.holdRemaining, profile.seconds);
        this.rampInSeconds = profile.rampInSeconds;
        this.rampOutSeconds = isActive
            ? Math.max(this.rampOutSeconds, profile.rampOutSeconds)
            : profile.rampOutSeconds;
        if (profile.rampInSeconds <= 0) this.slowMotionBlend = 1;
    }

    hitstop(owner: object, frames: number): void {
        if (frames <= 0) return;

        const seconds = frames * HITSTOP.frameSeconds;
        this.hitstopRemaining.set(owner, Math.max(this.hitstopRemaining.get(owner) ?? 0, seconds));
    }

    hitstopTimeScale(owner: object): number {
        return this.hitstopRemaining.has(owner) ? HITSTOP.timeScale : 1;
    }

    clearHitstop(owner: object): void {
        this.hitstopRemaining.delete(owner);
    }

    tick(realDeltaSeconds: number): void {
        this.holdRemaining = Math.max(0, this.holdRemaining - realDeltaSeconds);
        const isHolding = this.holdRemaining > 0;
        const rampSeconds = isHolding ? this.rampInSeconds : this.rampOutSeconds;
        const target = isHolding ? 1 : 0;
        this.slowMotionBlend =
            rampSeconds > 0
                ? moveTowards(this.slowMotionBlend, target, realDeltaSeconds / rampSeconds)
                : target;
        if (!isHolding && this.slowMotionBlend === 0) this.slowScale = 1;

        countDownTimers(this.hitstopRemaining, realDeltaSeconds);
    }
}
