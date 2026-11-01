import { Vector3 } from "three";
import { CLIP } from "@/constants/characters";
import { COMBAT_TIMING, FINISHER_RULES } from "@/constants/combat";
import {
    horizontalDistance,
    horizontalDirection,
    pointAtYaw,
    smoothstep,
    yawTowards,
    lerpAngle,
    forwardFromYaw,
} from "@/lib/helpers";
import type { ICombatant, IFinisherDefinition } from "@/types/combat";
import type { IWorldContext } from "@/types/world";

export type FinisherRole = "attacker" | "victim";

export interface IFinisherParticipant extends ICombatant {
    readonly yaw: number;
    readonly disposed: boolean;
    beginFinisher(role: FinisherRole): void;
    playFinisherLoop(clip: string, yaw: number): void;
    playFinisherClip(clip: string, yaw: number, blendInSeconds?: number): void;
    setFinisherClipTime(clipSeconds: number): void;
    moveInFinisher(delta: Vector3): void;
    setFinisherYaw(yaw: number): void;
    endFinisher(): void;
    finishOff(killer: ICombatant, deathClip?: string): void;
    clipDuration(clip: string): number;
}

type FinisherServices = Pick<IWorldContext, "events">;

type FinisherPhase = "approach" | "perform";

export class FinisherSequence {
    private static readonly APPROACH_TIMEOUT_FACTOR = 1.5;

    private static readonly scratchStep = new Vector3();

    private static readonly scratchSyncTarget = new Vector3();

    private static readonly scratchSyncDelta = new Vector3();

    private static readonly scratchPush = new Vector3();

    private static readonly scratchAttackerShift = new Vector3();

    private readonly services: FinisherServices;
    private readonly placementVictimPosition = new Vector3();
    private placementAttackerYaw = 0;
    private placementVictimYaw = 0;
    private readonly victimSyncFrom = new Vector3();
    private readonly victimSyncApplied = new Vector3();
    private readonly attackerLastPosition = new Vector3();
    private attacker: IFinisherParticipant | null = null;
    private victim: IFinisherParticipant | null = null;
    private finisher: IFinisherDefinition | null = null;
    private phase: FinisherPhase = "approach";
    private centreDistance = 0;
    private approachSpeed = 0;
    private approachElapsed = 0;
    private victimClip: string | null = null;
    private victimClipDuration = 0;
    private attackerSyncFromYaw = 0;
    private victimSyncFromYaw = 0;
    private elapsed = 0;
    private duration = 0;
    private killed = false;
    private impactsFired = 0;

    constructor(services: FinisherServices) {
        this.services = services;
    }

    get isActive(): boolean {
        return this.attacker !== null;
    }

    get hasKilled(): boolean {
        return this.killed;
    }

    get isRecovering(): boolean {
        return (
            this.attacker !== null &&
            this.phase === "perform" &&
            this.elapsed >= FINISHER_RULES.recoverAtFraction * this.duration
        );
    }

    finisherMidpoint(out: Vector3): Vector3 {
        if (this.attacker && this.victim)
            out.addVectors(
                this.attacker.sceneObject.position,
                this.victim.sceneObject.position
            ).multiplyScalar(0.5);
        return out;
    }

    start(
        attacker: IFinisherParticipant,
        victim: IFinisherParticipant,
        finisher: IFinisherDefinition
    ): boolean {
        if (
            this.attacker ||
            attacker.isDead ||
            victim.isDead ||
            attacker.isInFinisher ||
            victim.isInFinisher
        )
            return false;

        attacker.beginFinisher("attacker");
        victim.beginFinisher("victim");
        victim.playFinisherLoop(
            CLIP.reactStagger,
            yawTowards(attacker.position, victim.position) + finisher.relativeYaw
        );

        this.attacker = attacker;
        this.victim = victim;
        this.finisher = finisher;
        this.killed = false;
        this.impactsFired = 0;
        this.elapsed = 0;
        this.approachElapsed = 0;
        this.victimClip = null;
        this.centreDistance = finisherCentreDistance(
            finisher.distance,
            attacker.bodyRadius,
            victim.bodyRadius
        );

        const travel = horizontalDistance(attacker.position, victim.position) - this.centreDistance;
        if (travel > FINISHER_RULES.syncMaxShift) {
            this.phase = "approach";
            this.approachSpeed = Math.max(
                FINISHER_RULES.approachSpeed,
                travel / FINISHER_RULES.approachMaxSeconds
            );
            attacker.playFinisherLoop(CLIP.sprint, yawTowards(attacker.position, victim.position));
        } else this.beginPerform(attacker, victim, finisher);

        this.services.events.emit("finisherStarted", { attacker, victim, finisher });
        return true;
    }

    tick(deltaSeconds: number): boolean {
        const attacker = this.attacker;
        const victim = this.victim;
        const finisher = this.finisher;
        if (!attacker || !victim || !finisher) return false;

        if (victim.disposed || attacker.isDead) {
            this.abort();
            return true;
        }

        return this.phase === "approach"
            ? this.tickApproach(attacker, victim, finisher, deltaSeconds)
            : this.tickPerform(attacker, victim, finisher, deltaSeconds);
    }

    abort(): void {
        this.attacker?.endFinisher();
        if (this.victim && !this.victim.disposed) this.victim.endFinisher();
        this.attacker = null;
        this.victim = null;
        this.finisher = null;
        this.victimClip = null;
    }

    private tickApproach(
        attacker: IFinisherParticipant,
        victim: IFinisherParticipant,
        finisher: IFinisherDefinition,
        deltaSeconds: number
    ): boolean {
        const remaining =
            horizontalDistance(attacker.position, victim.position) - this.centreDistance;
        if (remaining <= FINISHER_RULES.syncMaxShift * 0.5) {
            this.beginPerform(attacker, victim, finisher);
            return false;
        }

        this.approachElapsed += deltaSeconds;
        if (
            this.approachElapsed >
            FINISHER_RULES.approachMaxSeconds * FinisherSequence.APPROACH_TIMEOUT_FACTOR
        ) {
            this.abort();
            return true;
        }

        const heading = yawTowards(attacker.position, victim.position);
        const step = Math.min(remaining, this.approachSpeed * deltaSeconds);
        attacker.moveInFinisher(forwardFromYaw(heading, FinisherSequence.scratchStep, step));
        attacker.setFinisherYaw(heading);
        victim.setFinisherYaw(heading + finisher.relativeYaw);
        return false;
    }

    private beginPerform(
        attacker: IFinisherParticipant,
        victim: IFinisherParticipant,
        finisher: IFinisherDefinition
    ): void {
        const towardVictim = yawTowards(attacker.position, victim.position);
        const centreDistance = finisherCentreDistance(
            finisher.distance,
            attacker.bodyRadius,
            victim.bodyRadius
        );
        this.placementAttackerYaw = towardVictim - finisher.bearing;
        this.placementVictimYaw = this.placementAttackerYaw + finisher.relativeYaw;
        pointAtYaw(
            attacker.position,
            towardVictim,
            centreDistance,
            this.placementVictimPosition,
            victim.position.y
        );
        this.victimSyncFrom.copy(victim.position);
        this.victimSyncApplied.copy(victim.position);
        this.attackerLastPosition.copy(attacker.position);
        this.attackerSyncFromYaw = attacker.yaw;
        this.victimSyncFromYaw = victim.yaw;

        attacker.playFinisherClip(finisher.attackerClip, attacker.yaw, finisher.blendInSeconds);
        const finisherVictimClip = finisher.finisherVictimClip;
        if (finisherVictimClip) victim.playFinisherClip(finisherVictimClip, victim.yaw);

        this.victimClip = finisherVictimClip;
        this.victimClipDuration = finisherVictimClip ? victim.clipDuration(finisherVictimClip) : 0;
        this.duration = Math.max(attacker.clipDuration(finisher.attackerClip), 0.1);
        this.elapsed = 0;
        this.phase = "perform";
    }

    private tickPerform(
        attacker: IFinisherParticipant,
        victim: IFinisherParticipant,
        finisher: IFinisherDefinition,
        deltaSeconds: number
    ): boolean {
        this.elapsed += deltaSeconds;

        const attackerShift = FinisherSequence.scratchAttackerShift.subVectors(
            attacker.position,
            this.attackerLastPosition
        );
        if (!this.victimClip && attackerShift.lengthSq() > 0)
            this.placementVictimPosition.add(attackerShift);
        this.attackerLastPosition.copy(attacker.position);

        this.blendIntoFinisherPlacement(attacker, victim);

        const attackerSeconds = Math.min(this.elapsed, this.duration);
        attacker.setFinisherClipTime(attackerSeconds);
        if (this.victimClip)
            victim.setFinisherClipTime((attackerSeconds / this.duration) * this.victimClipDuration);

        const minimum = contactDistance(attacker.bodyRadius, victim.bodyRadius);
        const distance = horizontalDirection(
            attacker.position,
            victim.position,
            FinisherSequence.scratchPush
        );
        if (distance < minimum)
            victim.moveInFinisher(
                distance < 1e-6
                    ? FinisherSequence.scratchPush.set(0, 0, minimum)
                    : FinisherSequence.scratchPush.multiplyScalar(minimum - distance)
            );

        const nextImpactAt = finisher.impactAt?.[this.impactsFired];
        if (nextImpactAt !== undefined && this.elapsed >= nextImpactAt * this.duration) {
            this.impactsFired += 1;
            this.services.events.emit("finisherImpact", { attacker, victim });
        }
        if (!this.killed && this.elapsed >= finisher.killAt * this.duration)
            this.kill(attacker, victim);
        if (this.elapsed < this.duration) return false;

        this.abort();
        return true;
    }

    private blendIntoFinisherPlacement(
        attacker: IFinisherParticipant,
        victim: IFinisherParticipant
    ): void {
        const blend = smoothstep(0, FINISHER_RULES.syncSeconds, this.elapsed);
        FinisherSequence.scratchSyncTarget.lerpVectors(
            this.victimSyncFrom,
            this.placementVictimPosition,
            blend
        );
        FinisherSequence.scratchSyncDelta
            .subVectors(FinisherSequence.scratchSyncTarget, this.victimSyncApplied)
            .setY(0);
        if (FinisherSequence.scratchSyncDelta.lengthSq() > 0)
            victim.moveInFinisher(FinisherSequence.scratchSyncDelta);
        this.victimSyncApplied.copy(FinisherSequence.scratchSyncTarget);

        attacker.setFinisherYaw(
            lerpAngle(this.attackerSyncFromYaw, this.placementAttackerYaw, blend)
        );
        victim.setFinisherYaw(lerpAngle(this.victimSyncFromYaw, this.placementVictimYaw, blend));
    }

    private kill(attacker: IFinisherParticipant, victim: IFinisherParticipant): void {
        this.killed = true;
        victim.finishOff(attacker, this.finisher?.victimDeath);
        this.services.events.emit("finisherKill", { attacker, victim });
    }
}

export class FinisherWindows {
    private requestRemaining = 0;
    private chainKillRemaining = 0;

    get isRequested(): boolean {
        return this.requestRemaining > 0;
    }

    get inChainKillWindow(): boolean {
        return this.chainKillRemaining > 0;
    }

    press(): void {
        this.requestRemaining = COMBAT_TIMING.inputBufferSeconds;
    }

    openChainKillWindow(): void {
        this.chainKillRemaining = COMBAT_TIMING.chainKillWindowSeconds;
    }

    reset(): void {
        this.requestRemaining = 0;
        this.chainKillRemaining = 0;
    }

    tick(deltaSeconds: number): void {
        this.requestRemaining = Math.max(0, this.requestRemaining - deltaSeconds);
        this.chainKillRemaining = Math.max(0, this.chainKillRemaining - deltaSeconds);
    }
}

function contactDistance(attackerRadius: number, victimRadius: number): number {
    return attackerRadius + victimRadius + FINISHER_RULES.contactGap;
}

export function finisherCentreDistance(
    authoredDistance: number,
    attackerRadius: number,
    victimRadius: number
): number {
    return Math.max(authoredDistance, contactDistance(attackerRadius, victimRadius));
}
