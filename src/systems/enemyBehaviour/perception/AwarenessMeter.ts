import { Vector3 } from "three";
import { AWARENESS } from "@/constants/enemies";
import { clamp } from "@/lib/helpers";
import type { AlertPhase, AwarenessState } from "@/types/combat";

export class AwarenessMeter {
    readonly lastKnownPosition = new Vector3();
    private currentPhase: AlertPhase = "unaware";
    private currentLevel = 0;
    private phaseSeconds = 0;
    private quietSeconds = 0;
    private unseenSeconds = 0;
    private searchRemaining = 0;
    private alarmPending = false;

    get phase(): AlertPhase {
        return this.currentPhase;
    }

    get level(): number {
        return this.currentLevel;
    }

    get state(): AwarenessState {
        return STATE_FOR_PHASE[this.currentPhase];
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

        this.accumulate(deltaSeconds, stimulus, isSeen || isHeard);
        if (this.currentLevel >= 1) {
            this.becomeAlert(true);
            return;
        }

        if (this.currentPhase === "searching") {
            this.searchRemaining -= deltaSeconds;
            if (this.searchRemaining <= 0) this.enterPhase("returning", 0);
            return;
        }

        if (this.currentLevel >= AWARENESS.suspiciousThreshold) {
            if (this.currentPhase !== "suspicious")
                this.enterPhase("suspicious", this.currentLevel);
        } else if (this.currentPhase === "suspicious" && this.currentLevel === 0) {
            this.enterPhase("returning", 0);
        }
    }

    alarm(position: Vector3, spreads: boolean): void {
        this.lastKnownPosition.copy(position);
        if (this.currentPhase === "alert") {
            this.unseenSeconds = 0;
            return;
        }

        this.becomeAlert(spreads);
    }

    consumeAlarm(): boolean {
        const pending = this.alarmPending;
        this.alarmPending = false;
        return pending;
    }

    settle(): void {
        if (this.currentPhase === "returning") this.enterPhase("unaware", this.currentLevel);
    }

    standDown(): void {
        if (this.currentPhase === "unaware" || this.currentPhase === "returning") return;

        this.alarmPending = false;
        this.enterPhase("returning", 0);
    }

    private accumulate(
        deltaSeconds: number,
        stimulus: IAwarenessStimulus,
        isStimulated: boolean
    ): void {
        const primedMultiplier =
            this.currentPhase === "searching" ? AWARENESS.primedGainMultiplier : 1;
        this.currentLevel +=
            stimulus.sightStrength *
                AWARENESS.sightGainPerSecond *
                primedMultiplier *
                deltaSeconds +
            stimulus.heardLoudness * AWARENESS.noiseImpulse;

        this.quietSeconds = isStimulated ? 0 : this.quietSeconds + deltaSeconds;
        const isForgetting =
            this.quietSeconds >= AWARENESS.forgetDelaySeconds && this.currentPhase !== "searching";
        if (isForgetting) this.currentLevel -= AWARENESS.decayPerSecond * deltaSeconds;

        this.currentLevel = clamp(this.currentLevel, 0, 1);
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
        this.currentLevel = level;
        this.phaseSeconds = 0;
        this.quietSeconds = 0;
    }
}

export interface IAwarenessStimulus {
    sightStrength: number;
    readonly sightPosition: Vector3;
    heardLoudness: number;
    readonly heardPosition: Vector3;
}

const STATE_FOR_PHASE: Record<AlertPhase, AwarenessState> = {
    unaware: "unaware",
    suspicious: "suspicious",
    alert: "alert",
    searching: "suspicious",
    returning: "unaware",
};
