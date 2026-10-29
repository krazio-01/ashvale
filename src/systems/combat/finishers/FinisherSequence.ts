import { Vector3 } from "three";
import { FINISHER_RULES } from "@/constants/combat";
import { yawTowards, angleDelta, horizontalDistance, smoothstep } from "@/lib/helpers";
import type { IFinisherDefinition, ICombatant } from "@/types/combat";
import { CLIP } from "@/constants/characters";
import type { IWorldContext } from "@/types/world";

export type PairedRole = "attacker" | "victim";

export interface IPairedParticipant extends ICombatant {
    readonly yaw: number;
    readonly disposed: boolean;
    beginPaired(role: PairedRole): void;
    playPairedLoop(clip: string, yaw: number): void;
    playPaired(clip: string, yaw: number, blendInSeconds?: number): void;
    drivePaired(clipSeconds: number): void;
    movePaired(delta: Vector3): void;
    setPairedYaw(yaw: number): void;
    endPaired(): void;
    finishOff(killer: ICombatant, deathClip?: string): void;
    clipDuration(clip: string): number;
}

type PairedServices = Pick<IWorldContext, "combatEvents">;

type FinisherPhase = "approach" | "perform";

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

export class PairedAnimationDirector {
    private static readonly APPROACH_TIMEOUT_FACTOR = 1.5;

    private static readonly scratchStep = new Vector3();

    private static readonly scratchSyncTarget = new Vector3();

    private static readonly scratchSyncDelta = new Vector3();

    private static readonly scratchPush = new Vector3();

    private static readonly scratchAttackerShift = new Vector3();

    private readonly services: PairedServices;
    private readonly slot = new PairSlot();
    private readonly victimSyncFrom = new Vector3();
    private readonly victimSyncApplied = new Vector3();
    private readonly attackerLastPosition = new Vector3();
    private attacker: IPairedParticipant | null = null;
    private victim: IPairedParticipant | null = null;
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

    constructor(services: PairedServices) {
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
            this.elapsed >= FINISHER_RULES.recoverAt * this.duration
        );
    }

    pairMidpoint(out: Vector3): Vector3 {
        if (this.attacker && this.victim)
            out.addVectors(
                this.attacker.sceneObject.position,
                this.victim.sceneObject.position
            ).multiplyScalar(0.5);
        return out;
    }

    start(
        attacker: IPairedParticipant,
        victim: IPairedParticipant,
        finisher: IFinisherDefinition
    ): boolean {
        if (
            this.attacker ||
            attacker.isDead ||
            victim.isDead ||
            attacker.isPaired ||
            victim.isPaired
        )
            return false;

        attacker.beginPaired("attacker");
        victim.beginPaired("victim");
        victim.playPairedLoop(
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
        this.centreDistance = pairCentreDistance(
            finisher.distance,
            attacker.bodyRadius,
            victim.bodyRadius
        );

        const travel = approachTravel(
            horizontalDistance(attacker.position, victim.position),
            this.centreDistance
        );
        if (travel > 0) {
            this.phase = "approach";
            this.approachSpeed = Math.max(
                FINISHER_RULES.approachSpeed,
                travel / FINISHER_RULES.approachMaxSeconds
            );
            attacker.playPairedLoop(CLIP.sprint, yawTowards(attacker.position, victim.position));
        } else this.beginPerform(attacker, victim, finisher);

        this.services.combatEvents.emit("finisherStarted", { attacker, victim, finisher });
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
        this.attacker?.endPaired();
        if (this.victim && !this.victim.disposed) this.victim.endPaired();
        this.attacker = null;
        this.victim = null;
        this.finisher = null;
        this.victimClip = null;
    }

    private tickApproach(
        attacker: IPairedParticipant,
        victim: IPairedParticipant,
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
            FINISHER_RULES.approachMaxSeconds * PairedAnimationDirector.APPROACH_TIMEOUT_FACTOR
        ) {
            this.abort();
            return true;
        }

        const heading = yawTowards(attacker.position, victim.position);
        const step = Math.min(remaining, this.approachSpeed * deltaSeconds);
        attacker.movePaired(
            PairedAnimationDirector.scratchStep.set(
                Math.sin(heading) * step,
                0,
                Math.cos(heading) * step
            )
        );
        attacker.setPairedYaw(heading);
        victim.setPairedYaw(heading + finisher.relativeYaw);
        return false;
    }

    private beginPerform(
        attacker: IPairedParticipant,
        victim: IPairedParticipant,
        finisher: IFinisherDefinition
    ): void {
        this.slot.solve(
            attacker.position,
            victim.position,
            finisher,
            attacker.bodyRadius,
            victim.bodyRadius
        );
        this.victimSyncFrom.copy(victim.position);
        this.victimSyncApplied.copy(victim.position);
        this.attackerLastPosition.copy(attacker.position);
        this.attackerSyncFromYaw = attacker.yaw;
        this.victimSyncFromYaw = victim.yaw;

        attacker.playPaired(finisher.attackerClip, attacker.yaw, finisher.blendInSeconds);
        const pairedVictimClip = finisher.pairedVictimClip;
        if (pairedVictimClip) victim.playPaired(pairedVictimClip, victim.yaw);

        this.victimClip = pairedVictimClip;
        this.victimClipDuration = pairedVictimClip ? victim.clipDuration(pairedVictimClip) : 0;
        this.duration = Math.max(attacker.clipDuration(finisher.attackerClip), 0.1);
        this.elapsed = 0;
        this.phase = "perform";
    }

    private tickPerform(
        attacker: IPairedParticipant,
        victim: IPairedParticipant,
        finisher: IFinisherDefinition,
        deltaSeconds: number
    ): boolean {
        this.elapsed += deltaSeconds;

        const attackerShift = PairedAnimationDirector.scratchAttackerShift.subVectors(
            attacker.position,
            this.attackerLastPosition
        );
        if (!this.victimClip && attackerShift.lengthSq() > 0)
            this.slot.victimPosition.add(attackerShift);
        this.attackerLastPosition.copy(attacker.position);

        this.syncPair(attacker, victim);

        const attackerSeconds = Math.min(this.elapsed, this.duration);
        attacker.drivePaired(attackerSeconds);
        if (this.victimClip)
            victim.drivePaired((attackerSeconds / this.duration) * this.victimClipDuration);

        const minimum = attacker.bodyRadius + victim.bodyRadius + FINISHER_RULES.contactGap;
        const push = enforceSeparation(
            attacker.position,
            victim.position,
            minimum,
            PairedAnimationDirector.scratchPush
        );
        if (push.lengthSq() > 0) victim.movePaired(push);

        const nextImpactAt = finisher.impactAt?.[this.impactsFired];
        if (nextImpactAt !== undefined && this.elapsed >= nextImpactAt * this.duration) {
            this.impactsFired += 1;
            this.services.combatEvents.emit("finisherImpact", { attacker, victim });
        }
        if (!this.killed && this.elapsed >= finisher.killAt * this.duration)
            this.kill(attacker, victim);
        if (this.elapsed < this.duration) return false;

        this.abort();
        return true;
    }

    private syncPair(attacker: IPairedParticipant, victim: IPairedParticipant): void {
        const blend = smoothstep(0, FINISHER_RULES.syncSeconds, this.elapsed);
        PairedAnimationDirector.scratchSyncTarget.lerpVectors(
            this.victimSyncFrom,
            this.slot.victimPosition,
            blend
        );
        PairedAnimationDirector.scratchSyncDelta
            .subVectors(PairedAnimationDirector.scratchSyncTarget, this.victimSyncApplied)
            .setY(0);
        if (PairedAnimationDirector.scratchSyncDelta.lengthSq() > 0)
            victim.movePaired(PairedAnimationDirector.scratchSyncDelta);
        this.victimSyncApplied.copy(PairedAnimationDirector.scratchSyncTarget);

        attacker.setPairedYaw(
            this.attackerSyncFromYaw +
                angleDelta(this.attackerSyncFromYaw, this.slot.attackerYaw) * blend
        );
        victim.setPairedYaw(
            this.victimSyncFromYaw + angleDelta(this.victimSyncFromYaw, this.slot.victimYaw) * blend
        );
    }

    private kill(attacker: IPairedParticipant, victim: IPairedParticipant): void {
        this.killed = true;
        victim.finishOff(attacker, this.finisher?.victimDeath);
        this.services.combatEvents.emit("finisherKill", { attacker, victim });
    }
}

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
