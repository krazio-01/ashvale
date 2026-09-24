import { smoothstep } from "@/lib/helpers";
import { HITSTOP } from "@/constants/combat";
import type { ISlowMotionProfile } from "@/types/combat";

function approachLevel(
    level: number,
    target: number,
    deltaSeconds: number,
    rampSeconds: number
): number {
    if (rampSeconds <= 0) return target;

    const step = deltaSeconds / rampSeconds;
    return target > level ? Math.min(target, level + step) : Math.max(target, level - step);
}

export class TimeDilation {
    private slowScale = 1;
    private holdRemaining = 0;
    private level = 0;
    private rampInSeconds = 0;
    private rampOutSeconds = 0;
    private readonly hitstopRemaining = new Map<object, number>();

    get globalScale(): number {
        return 1 + (this.slowScale - 1) * smoothstep(0, 1, this.level);
    }

    requestSlowMotion(profile: ISlowMotionProfile): void {
        const isActive = this.holdRemaining > 0 || this.level > 0;
        this.slowScale = isActive ? Math.min(this.slowScale, profile.scale) : profile.scale;
        this.holdRemaining = Math.max(this.holdRemaining, profile.seconds);
        this.rampInSeconds = profile.rampInSeconds;
        this.rampOutSeconds = isActive
            ? Math.max(this.rampOutSeconds, profile.rampOutSeconds)
            : profile.rampOutSeconds;
        if (profile.rampInSeconds <= 0) this.level = 1;
    }

    hitstop(owner: object, frames: number): void {
        if (frames <= 0) return;

        const seconds = frames * HITSTOP.frameSeconds;
        this.hitstopRemaining.set(owner, Math.max(this.hitstopRemaining.get(owner) ?? 0, seconds));
    }

    isInHitstop(owner: object): boolean {
        return this.hitstopRemaining.has(owner);
    }

    localScale(owner: object): number {
        return this.hitstopRemaining.has(owner) ? HITSTOP.timeScale : 1;
    }

    release(owner: object): void {
        this.hitstopRemaining.delete(owner);
    }

    tick(realDeltaSeconds: number): void {
        this.holdRemaining = Math.max(0, this.holdRemaining - realDeltaSeconds);
        const isHolding = this.holdRemaining > 0;
        this.level = approachLevel(
            this.level,
            isHolding ? 1 : 0,
            realDeltaSeconds,
            isHolding ? this.rampInSeconds : this.rampOutSeconds
        );
        if (!isHolding && this.level === 0) this.slowScale = 1;

        if (this.hitstopRemaining.size === 0) return;

        for (const [owner, remaining] of this.hitstopRemaining) {
            const left = remaining - realDeltaSeconds;
            if (left <= 0) this.hitstopRemaining.delete(owner);
            else this.hitstopRemaining.set(owner, left);
        }
    }

    clear(): void {
        this.holdRemaining = 0;
        this.level = 0;
        this.slowScale = 1;
        this.hitstopRemaining.clear();
    }
}
