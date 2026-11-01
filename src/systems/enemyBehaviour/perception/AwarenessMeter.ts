import { Vector3 } from "three";
import { AWARENESS } from "@/constants/enemies";
import { clamp } from "@/lib/helpers";
import type { AlertPhase, AwarenessState } from "@/types/combat";

export interface IAwarenessStimulus {
    sightStrength: number;
    readonly sightPosition: Vector3;
    heardLoudness: number;
    readonly heardPosition: Vector3;
}

export class AwarenessMeter {
    private static readonly STATE_FOR_PHASE: Record<AlertPhase, AwarenessState> = {
        unaware: "unaware",
        suspicious: "suspicious",
        alert: "alert",
        searching: "suspicious",
        returning: "unaware",
    };

    readonly lastKnownPosition = new Vector3();
    private currentPhase: AlertPhase = "unaware";
    private currentAwarenessLevel = 0;
    private phaseSeconds = 0;
    private quietSeconds = 0;
    private unseenSeconds = 0;
    private searchRemaining = 0;
    private alarmPending = false;

    get phase(): AlertPhase {
        return this.currentPhase;
    }

    get awarenessLevel(): number {
        return this.currentAwarenessLevel;
    }

    get state(): AwarenessState {
        return AwarenessMeter.STATE_FOR_PHASE[this.currentPhase];
    }

    get secondsInPhase(): number {
        return this.phaseSeconds;
    }

    tick(deltaSeconds: number, stimulus: IAwarenessStimulus): void {
        this.phaseSeconds += deltaSeconds;
        const isSeen = stimulus.sightStrength > 0;
        const isHeard = stimulus.heardLoudness > 0;

        if (isSeen) this.lastKnownPosition.copy(stimulus.sightPosition);
        else if (isHeard && this.currentPhase !== "alert")
            this.lastKnownPosition.copy(stimulus.heardPosition);

        if (this.currentPhase === "alert") {
            this.tickAlert(deltaSeconds, isSeen);
            return;
        }

        if (stimulus.heardLoudness >= AWARENESS.alarmLoudness) {
            this.becomeAlert(true);
            return;
        }

        this.updateAwarenessLevel(deltaSeconds, stimulus, isSeen || isHeard);
        if (this.currentAwarenessLevel >= 1) {
            this.becomeAlert(true);
            return;
        }

        if (this.currentPhase === "searching") {
            this.searchRemaining -= deltaSeconds;
            if (this.searchRemaining <= 0) this.enterPhase("returning", 0);
            return;
        }

        if (this.currentAwarenessLevel >= AWARENESS.suspiciousThreshold) {
            if (this.currentPhase !== "suspicious")
                this.enterPhase("suspicious", this.currentAwarenessLevel);
        } else if (this.currentPhase === "suspicious" && this.currentAwarenessLevel === 0) {
            this.enterPhase("returning", 0);
        }
    }

    raiseAlarm(position: Vector3, shouldAlertOthers: boolean): void {
        this.lastKnownPosition.copy(position);
        if (this.currentPhase === "alert") {
            this.unseenSeconds = 0;
            return;
        }

        this.becomeAlert(shouldAlertOthers);
    }

    consumeAlarm(): boolean {
        const pending = this.alarmPending;
        this.alarmPending = false;
        return pending;
    }

    finishReturningHome(): void {
        if (this.currentPhase === "returning")
            this.enterPhase("unaware", this.currentAwarenessLevel);
    }

    forceReturnHome(): void {
        if (this.currentPhase === "unaware" || this.currentPhase === "returning") return;

        this.alarmPending = false;
        this.enterPhase("returning", 0);
    }

    private updateAwarenessLevel(
        deltaSeconds: number,
        stimulus: IAwarenessStimulus,
        isStimulated: boolean
    ): void {
        const primedMultiplier =
            this.currentPhase === "searching" ? AWARENESS.searchingSightGainMultiplier : 1;
        this.currentAwarenessLevel +=
            stimulus.sightStrength *
                AWARENESS.sightGainPerSecond *
                primedMultiplier *
                deltaSeconds +
            stimulus.heardLoudness * AWARENESS.noiseImpulse;

        this.quietSeconds = isStimulated ? 0 : this.quietSeconds + deltaSeconds;
        const isForgetting =
            this.quietSeconds >= AWARENESS.forgetDelaySeconds && this.currentPhase !== "searching";
        if (isForgetting) this.currentAwarenessLevel -= AWARENESS.decayPerSecond * deltaSeconds;

        this.currentAwarenessLevel = clamp(this.currentAwarenessLevel, 0, 1);
    }

    private tickAlert(deltaSeconds: number, isSeen: boolean): void {
        if (isSeen) {
            this.unseenSeconds = 0;
            return;
        }

        this.unseenSeconds += deltaSeconds;
        if (this.unseenSeconds < AWARENESS.loseTrackSeconds) return;

        this.searchRemaining = AWARENESS.searchSeconds;
        this.enterPhase("searching", AWARENESS.suspiciousThreshold);
    }

    private becomeAlert(spreads: boolean): void {
        this.unseenSeconds = 0;
        this.enterPhase("alert", 1);
        if (spreads) this.alarmPending = true;
    }

    private enterPhase(phase: AlertPhase, level: number): void {
        this.currentPhase = phase;
        this.currentAwarenessLevel = level;
        this.phaseSeconds = 0;
        this.quietSeconds = 0;
    }
}
