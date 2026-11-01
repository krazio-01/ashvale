import {
    allowsCancel,
    firstStrikeAt,
    hasCrossed,
    isWithin,
    secondsSinceStart,
} from "@/systems/combat/actions/MoveTimeline";
import { COMBAT_TIMING } from "@/constants/combat";
import type {
    DodgeSide,
    IAttackThreat,
    IHitWindow,
    IMoveDefinition,
    IMoveSet,
    IntentKind,
    MoveTag,
    ReactionTier,
    Stance,
    WeaponMount,
} from "@/types/combat";
import { ERRORS } from "@/constants/strings";

type MachineState = "locomotion" | "move" | "reaction" | "staggered" | "finisher" | "dead";

export interface IMoveStateInput {
    deltaSeconds: number;
    realDeltaSeconds: number;
    heavyHeld: boolean;
    isSprinting: boolean;
    isLockedTargetFar: boolean;
    hasDirectionalInput: boolean;
    dodgeSide: DodgeSide | null;
    isGrounded: boolean;
    stance: Stance;
    spendStamina: (cost: number) => boolean;
}

export interface IMoveStateOutput {
    move: IMoveDefinition | null;
    moveStarted: boolean;
    reactionStarted: ReactionTier | null;
    staggerStarted: boolean;
    returnedToLocomotion: boolean;
    previousProgress: number;
    progress: number;
    moveSerial: number;
    moveSeconds: number;
    elapsedSeconds: number;
    moveSecondsDuringWindup: number;
    allowsLocomotion: boolean;
    isInvulnerable: boolean;
    invulnerableSeconds: number;
    isParrying: boolean;
    isArmored: boolean;
    chargeLevel: number;
    mountTarget: WeaponMount | null;
}

interface IQueuedIntent {
    intent: IntentKind;
    ageSeconds: number;
}

class IntentQueue {
    private readonly entries: IQueuedIntent[] = [];

    get size(): number {
        return this.entries.length;
    }

    intentAt(index: number): IntentKind {
        return this.entries[index].intent;
    }

    push(intent: IntentKind): void {
        if (intent === "draw" && this.entries.some((entry) => entry.intent === "draw")) return;
        if (this.entries.length >= COMBAT_TIMING.inputQueueCapacity) this.entries.shift();
        this.entries.push({ intent, ageSeconds: 0 });
    }

    removeAt(index: number): void {
        this.entries.splice(index, 1);
    }

    removeBefore(index: number): void {
        this.entries.splice(0, index);
    }

    removeThrough(index: number): void {
        this.entries.splice(0, index + 1);
    }

    clear(): void {
        this.entries.length = 0;
    }

    tick(realDeltaSeconds: number, frozen: ReadonlySet<IntentKind> | null): void {
        for (let index = this.entries.length - 1; index >= 0; index -= 1) {
            const entry = this.entries[index];
            if (frozen?.has(entry.intent)) continue;

            entry.ageSeconds += realDeltaSeconds;
            if (entry.ageSeconds > COMBAT_TIMING.inputBufferSeconds) this.entries.splice(index, 1);
        }
    }
}

export class MoveStateMachine {
    private static readonly TAG_FOR_INTENT: Record<IntentKind, MoveTag> = {
        light: "light",
        heavy: "heavy",
        dodge: "dodge",
        parry: "parry",
        shoot: "shoot",
        slide: "dodge",
        jump: "jump",
        draw: "stance",
    };

    private static readonly WEAPON_INTENTS: ReadonlySet<IntentKind> = new Set([
        "light",
        "heavy",
        "parry",
    ]);

    private static meetsGroundRequirement(move: IMoveDefinition, isGrounded: boolean): boolean {
        const requirement = move.requires ?? "grounded";
        return requirement === "any" || (requirement === "grounded") === isGrounded;
    }

    private static validateMoveSet(moveSet: IMoveSet): void {
        const references: (string | undefined)[] = [
            ...Object.values(moveSet.entry),
            ...Object.values(moveSet.sprintEntry),
            ...Object.values(moveSet.lockedFarEntry ?? {}),
            ...Object.values(moveSet.sideDodgeEntry ?? {}),
            ...Object.values(moveSet.airEntry),
            moveSet.air?.airborne,
            moveSet.air?.land,
            ...Object.values(moveSet.stanceEntry ?? {}),
        ];
        for (const move of Object.values(moveSet.moves))
            references.push(
                move.followedBy,
                move.onLand,
                move.blockedInto,
                ...Object.values(move.next ?? {})
            );

        for (const id of references)
            if (id !== undefined && !moveSet.moves[id]) throw new Error(ERRORS.unknownMove(id));
    }

    readonly output: IMoveStateOutput = {
        move: null,
        moveStarted: false,
        reactionStarted: null,
        staggerStarted: false,
        returnedToLocomotion: false,
        previousProgress: 0,
        progress: 0,
        moveSerial: 0,
        moveSeconds: 0,
        elapsedSeconds: 0,
        moveSecondsDuringWindup: 0,
        allowsLocomotion: true,
        isInvulnerable: false,
        invulnerableSeconds: 0,
        isParrying: false,
        isArmored: false,
        chargeLevel: 0,
        mountTarget: null,
    };

    private readonly intents = new IntentQueue();
    private readonly moveSet: IMoveSet;
    private readonly clipSeconds: (clip: string) => number;
    private currentMoveSeconds = 0;
    private currentWindupSeconds = 0;
    private currentState: MachineState = "locomotion";
    private currentMove: IMoveDefinition | null = null;
    private currentStrikeAt: number | null = null;
    private isStanceMove = false;
    private progress = 0;
    private previousProgress = 0;
    private charge = 0;
    private moveSerial = 0;
    private stateRemaining = 0;
    private cancelsForcedOpen = false;
    private dodgeAllowedAtRemaining = Number.NEGATIVE_INFINITY;
    private pendingMoveStarted = false;
    private pendingReaction: ReactionTier | null = null;
    private pendingStagger = false;
    private pendingLocomotion = false;
    private pendingMount: WeaponMount | null = null;

    constructor(moveSet: IMoveSet, clipSeconds: (clip: string) => number) {
        this.moveSet = moveSet;
        this.clipSeconds = clipSeconds;
        MoveStateMachine.validateMoveSet(moveSet);
    }

    get state(): MachineState {
        return this.currentState;
    }

    get activeMove(): IMoveDefinition | null {
        return this.currentState === "move" ? this.currentMove : null;
    }

    get activeStrikeAt(): number | null {
        return this.currentState === "move" ? this.currentStrikeAt : null;
    }

    attackThreat(out: IAttackThreat): IAttackThreat | null {
        const move = this.activeMove;
        if (!move) return null;

        const output = this.output;

        let window: IHitWindow | undefined;
        for (let index = 0; index < move.hits.length && !window; index += 1) {
            const hit = move.hits[index];
            if (hit.from > output.progress) window = hit;
        }
        if (!window) return null;

        out.moveSerial = output.moveSerial;
        const windupEnd = Math.min(window.from, this.activeStrikeAt ?? window.from);
        const windupLeft = Math.max(0, windupEnd - output.progress);
        out.secondsUntilHit =
            windupLeft * output.moveSecondsDuringWindup +
            (window.from - output.progress - windupLeft) * output.moveSeconds;
        out.parryable = window.parryable;
        out.dodgeOnly = window.dodgeOnly;
        out.impact = window.impact;
        return out;
    }

    private get isLocked(): boolean {
        return this.currentState === "dead" || this.currentState === "finisher";
    }

    private progressAfter(deltaSeconds: number): number {
        const playbackSeconds = this.currentMoveSeconds;
        const moveSecondsDuringWindup = this.currentWindupSeconds;
        const strikeAt = this.currentStrikeAt;

        if (
            strikeAt === null ||
            moveSecondsDuringWindup === playbackSeconds ||
            this.progress >= strikeAt
        )
            return this.progress + deltaSeconds / playbackSeconds;

        const windupSecondsLeft = (strikeAt - this.progress) * moveSecondsDuringWindup;
        if (deltaSeconds <= windupSecondsLeft)
            return this.progress + deltaSeconds / moveSecondsDuringWindup;
        return strikeAt + (deltaSeconds - windupSecondsLeft) / playbackSeconds;
    }

    queue(intent: IntentKind): void {
        if (this.isLocked) return;
        this.intents.push(intent);
    }

    get currentMoveSerial(): number {
        return this.moveSerial;
    }

    startMove(moveId: string, ignoreCancelWindows = false): boolean {
        if (this.isLocked) return false;
        const move = this.moveById(moveId);
        if (!move || (!ignoreCancelWindows && !this.canStartMove(move))) return false;

        this.beginMove(move);
        return true;
    }

    forceCancelsOpen(): void {
        if (this.currentState === "move") this.cancelsForcedOpen = true;
    }

    react(tier: ReactionTier, seconds: number, reactionDodgeCancelSeconds: number): void {
        if (tier === "none" || this.isLocked) return;

        this.enterTimedState("reaction", seconds);
        this.dodgeAllowedAtRemaining = seconds - reactionDodgeCancelSeconds;
        this.pendingReaction = tier;
    }

    stagger(seconds: number): void {
        if (this.isLocked) return;

        this.enterTimedState("staggered", seconds);
        this.pendingStagger = true;
    }

    enterFinisher(): void {
        if (this.currentState !== "dead") this.lockInto("finisher");
    }

    exitFinisher(): void {
        if (this.currentState === "finisher") this.toLocomotion();
    }

    die(): void {
        this.lockInto("dead");
    }

    revive(): void {
        this.charge = 0;
        this.toLocomotion();
    }

    fall(): boolean {
        const airborne = this.moveById(this.moveSet.air?.airborne);
        if (!airborne) return false;
        if (this.currentState !== "locomotion" && this.currentState !== "move") return false;

        const current = this.currentMove;
        if (current && current.motion === "physics") return false;

        this.beginMove(airborne);
        return true;
    }

    tick(input: IMoveStateInput): IMoveStateOutput {
        this.intents.tick(
            input.realDeltaSeconds,
            this.isStanceMove ? MoveStateMachine.WEAPON_INTENTS : null
        );

        if (this.currentState === "reaction" || this.currentState === "staggered")
            this.tickTimedState(input.deltaSeconds);

        if (this.currentState === "move" && input.isGrounded)
            this.handleLanding(input.hasDirectionalInput);
        if (this.currentState === "move" && this.progress >= 1) this.finishMove();
        if (this.currentState === "move" && this.yieldsToMovement(input)) this.toLocomotion();
        if (this.currentState === "move") this.advanceMove(input);
        if (
            this.currentState === "locomotion" ||
            this.currentState === "move" ||
            this.currentState === "reaction"
        )
            this.tryStartQueued(input);

        return this.writeOutput();
    }

    private yieldsToMovement(input: IMoveStateInput): boolean {
        const move = this.currentMove;
        return (
            move?.yieldsToMovement === true &&
            input.hasDirectionalInput &&
            allowsCancel(move, this.progress, "movement", this.cancelsForcedOpen)
        );
    }

    private advanceMove(input: IMoveStateInput): void {
        const move = this.currentMove;
        if (!move) return;

        this.previousProgress = this.progress;
        let next = this.progressAfter(input.deltaSeconds);
        const holdAt = move.holdAt;

        if (holdAt !== undefined) {
            const isChargingHeld = input.heavyHeld && this.charge < 1;
            const reachesHoldPoint = this.progress <= holdAt && next >= holdAt;
            const isParkedAtHoldPoint = this.progress >= holdAt;

            if (isChargingHeld && reachesHoldPoint) {
                if (isParkedAtHoldPoint)
                    this.charge = Math.min(
                        1,
                        this.charge + input.deltaSeconds / COMBAT_TIMING.maxChargeSeconds
                    );
                next = holdAt;
            }
        }

        this.progress = move.loop ? next % 1 : Math.min(1, next);
        if (hasCrossed(move.mountAt?.fraction, this.previousProgress, this.progress))
            this.pendingMount = move.mountAt?.target ?? null;
    }

    private handleLanding(hasDirectionalInput: boolean): void {
        const move = this.currentMove;
        if (!move || (move.onLand === undefined && move.requires !== "airborne")) return;

        const landingId = move.onLand ?? (hasDirectionalInput ? undefined : this.moveSet.air?.land);
        this.beginOrIdle(this.moveById(landingId));
    }

    private tryStartQueued(input: IMoveStateInput): void {
        const intents = this.intents;

        for (let index = 0; index < intents.size; index += 1) {
            const intent = intents.intentAt(index);

            const target = this.resolveIntent(intent, input);
            if (!target) {
                intents.removeAt(index);
                index -= 1;
                continue;
            }

            const isStanceMove = target.tags.includes("stance");
            const tag = isStanceMove ? "stance" : MoveStateMachine.TAG_FOR_INTENT[intent];
            if (
                !this.allowsMoveTag(tag) ||
                !MoveStateMachine.meetsGroundRequirement(target, input.isGrounded)
            )
                continue;

            if (!input.spendStamina(target.staminaCost)) {
                intents.removeAt(index);
                index -= 1;
                continue;
            }

            if (isStanceMove && intent !== "draw") intents.removeBefore(index);
            else intents.removeThrough(index);
            this.beginMove(target);
            return;
        }
    }

    private canStartMove(move: IMoveDefinition): boolean {
        if (this.currentState === "locomotion") return true;
        const current = this.currentMove;
        if (this.currentState !== "move" || !current) return false;
        if (this.progress >= 1) return true;

        return move.tags.some((tag) =>
            allowsCancel(current, this.progress, tag, this.cancelsForcedOpen)
        );
    }

    private allowsMoveTag(tag: MoveTag): boolean {
        if (this.currentState === "locomotion") return true;
        if (this.currentState === "reaction")
            return tag === "dodge" && this.stateRemaining <= this.dodgeAllowedAtRemaining;

        const move = this.currentMove;
        return (
            move !== null &&
            (this.progress >= 1 || allowsCancel(move, this.progress, tag, this.cancelsForcedOpen))
        );
    }

    private resolveIntent(intent: IntentKind, input: IMoveStateInput): IMoveDefinition | null {
        const move = this.currentMove;
        const stanceEntry = this.moveSet.stanceEntry;
        if (stanceEntry) {
            const mountTarget = this.currentState === "move" ? move?.mountAt?.target : undefined;
            const stanceAfter: Stance = mountTarget
                ? mountTarget === "hand"
                    ? "drawn"
                    : "sheathed"
                : input.stance;
            const stanceId =
                intent === "draw"
                    ? stanceEntry[stanceAfter]
                    : MoveStateMachine.WEAPON_INTENTS.has(intent) && stanceAfter === "sheathed"
                      ? stanceEntry.sheathed
                      : undefined;
            if (stanceId) return this.moveById(stanceId) ?? null;
            if (intent === "draw") return null;
        }

        const nextId = this.currentState === "move" ? move?.next?.[intent] : undefined;
        if (nextId) return this.moveById(nextId) ?? null;

        const entryId =
            (input.isGrounded ? undefined : this.moveSet.airEntry[intent]) ??
            (input.isSprinting ? this.moveSet.sprintEntry[intent] : undefined) ??
            (input.isLockedTargetFar ? this.moveSet.lockedFarEntry?.[intent] : undefined) ??
            (intent === "dodge" && input.dodgeSide
                ? this.moveSet.sideDodgeEntry?.[input.dodgeSide]
                : undefined) ??
            this.moveSet.entry[intent];

        return this.moveById(entryId) ?? null;
    }

    private finishMove(): void {
        this.beginOrIdle(this.moveById(this.currentMove?.followedBy));
    }

    private beginOrIdle(move: IMoveDefinition | undefined): void {
        if (move) this.beginMove(move);
        else this.toLocomotion();
    }

    private moveById(moveId: string | undefined): IMoveDefinition | undefined {
        return moveId ? this.moveSet.moves[moveId] : undefined;
    }

    private beginMove(move: IMoveDefinition): void {
        this.moveSerial += 1;
        this.setCurrentMove(move);
        this.currentState = "move";
        this.progress = 0;
        this.previousProgress = 0;
        this.charge = 0;
        this.cancelsForcedOpen = false;
        this.pendingMoveStarted = true;
    }

    private enterTimedState(state: "reaction" | "staggered", seconds: number): void {
        this.currentState = state;
        this.setCurrentMove(null);
        this.stateRemaining = seconds;
        this.charge = 0;
    }

    private tickTimedState(deltaSeconds: number): void {
        this.stateRemaining -= deltaSeconds;
        if (this.stateRemaining <= 0) this.toLocomotion();
    }

    private toLocomotion(): void {
        this.currentState = "locomotion";
        this.setCurrentMove(null);
        this.progress = 0;
        this.previousProgress = 0;
        this.pendingLocomotion = true;
    }

    private lockInto(state: "finisher" | "dead"): void {
        this.currentState = state;
        this.setCurrentMove(null);
        this.intents.clear();
    }

    private setCurrentMove(move: IMoveDefinition | null): void {
        this.currentMove = move;
        this.currentStrikeAt = move ? firstStrikeAt(move) : null;
        this.isStanceMove = move?.tags.includes("stance") ?? false;
        if (!move) return;

        const strikeAt = this.currentStrikeAt;
        this.currentMoveSeconds =
            move.durationSeconds ?? Math.max(this.clipSeconds(move.clip), 1e-3) / move.playbackRate;
        this.currentWindupSeconds =
            move.minimumWindupSeconds !== undefined && strikeAt !== null && strikeAt > 0
                ? Math.max(this.currentMoveSeconds, move.minimumWindupSeconds / strikeAt)
                : this.currentMoveSeconds;
    }

    private writeOutput(): IMoveStateOutput {
        const output = this.output;
        const move = this.activeMove;

        output.move = move;
        output.moveStarted = this.pendingMoveStarted;
        output.reactionStarted = this.pendingReaction;
        output.staggerStarted = this.pendingStagger;
        output.returnedToLocomotion = this.pendingLocomotion && this.currentState === "locomotion";
        this.pendingMoveStarted = false;
        this.pendingReaction = null;
        this.pendingStagger = false;
        this.pendingLocomotion = false;

        output.previousProgress = move ? this.previousProgress : 0;
        output.progress = move ? this.progress : 0;
        output.moveSerial = this.moveSerial;
        output.moveSeconds = move ? this.currentMoveSeconds : 0;
        output.elapsedSeconds = output.progress * output.moveSeconds;
        output.moveSecondsDuringWindup = move ? this.currentWindupSeconds : 0;
        output.allowsLocomotion =
            this.currentState === "locomotion" ||
            (move !== null &&
                allowsCancel(move, this.progress, "movement", this.cancelsForcedOpen));

        const invulnerable = move?.invulnerable;
        output.isInvulnerable = isWithin(invulnerable, output.progress);
        output.invulnerableSeconds =
            invulnerable && output.isInvulnerable
                ? secondsSinceStart(invulnerable, output.progress, output.moveSeconds)
                : 0;
        output.isParrying =
            move?.parrySeconds !== undefined && output.elapsedSeconds <= move.parrySeconds;
        output.isArmored = isWithin(move?.armor, output.progress);
        output.chargeLevel = this.charge;
        output.mountTarget = this.pendingMount;
        this.pendingMount = null;

        return output;
    }
}
