import { IntentQueue } from "@/systems/combat/actions/IntentQueue";
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
    IMoveDefinition,
    IMoveSet,
    IntentKind,
    MoveTag,
    ReactionTier,
    Stance,
} from "@/types/combat";
import type { WeaponMount } from "@/types/weapons";

type MachineState = "locomotion" | "move" | "reaction" | "staggered" | "paired" | "dead";

export interface IMachineInput {
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

export interface IMachineOutput {
    state: MachineState;
    move: IMoveDefinition | null;
    moveStarted: boolean;
    reactionStarted: ReactionTier | null;
    staggerStarted: boolean;
    returnedToLocomotion: boolean;
    previousTime: number;
    time: number;
    moveSerial: number;
    moveSeconds: number;
    elapsedSeconds: number;
    windupUnitSeconds: number;
    allowsLocomotion: boolean;
    isInvulnerable: boolean;
    invulnerableSeconds: number;
    isParrying: boolean;
    isArmored: boolean;
    chargeLevel: number;
    mountTarget: WeaponMount | null;
}

const TAG_FOR_INTENT: Record<IntentKind, MoveTag> = {
    light: "light",
    heavy: "heavy",
    dodge: "dodge",
    parry: "parry",
    shoot: "shoot",
    slide: "dodge",
    jump: "jump",
    draw: "stance",
};

const WEAPON_INTENTS: ReadonlySet<IntentKind> = new Set(["light", "heavy", "parry"]);

function meetsGround(move: IMoveDefinition, isGrounded: boolean): boolean {
    const requirement = move.requires ?? "grounded";
    return requirement === "any" || (requirement === "grounded") === isGrounded;
}

function validateMoveSet(moveSet: IMoveSet): void {
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
        if (id !== undefined && !moveSet.moves[id]) throw new Error(`unknown move id "${id}"`);
}

export class ActionMachine {
    readonly output: IMachineOutput = {
        state: "locomotion",
        move: null,
        moveStarted: false,
        reactionStarted: null,
        staggerStarted: false,
        returnedToLocomotion: false,
        previousTime: 0,
        time: 0,
        moveSerial: 0,
        moveSeconds: 0,
        elapsedSeconds: 0,
        windupUnitSeconds: 0,
        allowsLocomotion: true,
        isInvulnerable: false,
        invulnerableSeconds: 0,
        isParrying: false,
        isArmored: false,
        chargeLevel: 0,
        mountTarget: null,
    };

    private readonly intents = new IntentQueue(
        COMBAT_TIMING.inputBufferSeconds,
        COMBAT_TIMING.inputQueueCapacity
    );
    private readonly moveSet: IMoveSet;
    private readonly clipSeconds: (clip: string) => number;
    private readonly secondsByMove = new Map<string, number>();
    private readonly windupUnitSecondsByMove = new Map<string, number>();
    private currentState: MachineState = "locomotion";
    private currentMove: IMoveDefinition | null = null;
    private time = 0;
    private previousTime = 0;
    private charge = 0;
    private moveSerial = 0;
    private stateRemaining = 0;
    private cancelsOpen = false;
    private dodgeCancelOpensAtRemaining = Number.NEGATIVE_INFINITY;
    private pendingMoveStarted = false;
    private pendingReaction: ReactionTier | null = null;
    private pendingStagger = false;
    private pendingLocomotion = false;
    private pendingMount: WeaponMount | null = null;

    constructor(moveSet: IMoveSet, clipSeconds: (clip: string) => number) {
        this.moveSet = moveSet;
        this.clipSeconds = clipSeconds;
        validateMoveSet(moveSet);
    }

    get state(): MachineState {
        return this.currentState;
    }

    get activeMove(): IMoveDefinition | null {
        return this.currentState === "move" ? this.currentMove : null;
    }

    private get isLocked(): boolean {
        return this.currentState === "dead" || this.currentState === "paired";
    }

    private secondsFor(move: IMoveDefinition): number {
        const cached = this.secondsByMove.get(move.id);
        if (cached !== undefined) return cached;

        const seconds =
            move.durationSeconds ?? Math.max(this.clipSeconds(move.clip), 1e-3) / move.playbackRate;
        this.secondsByMove.set(move.id, seconds);
        return seconds;
    }

    private windupUnitSecondsFor(move: IMoveDefinition): number {
        const cached = this.windupUnitSecondsByMove.get(move.id);
        if (cached !== undefined) return cached;

        const playbackSeconds = this.secondsFor(move);
        const strikeAt = firstStrikeAt(move);
        const windupUnitSeconds =
            move.minimumWindupSeconds !== undefined && strikeAt !== null && strikeAt > 0
                ? Math.max(playbackSeconds, move.minimumWindupSeconds / strikeAt)
                : playbackSeconds;
        this.windupUnitSecondsByMove.set(move.id, windupUnitSeconds);
        return windupUnitSeconds;
    }

    private advancedTime(move: IMoveDefinition, deltaSeconds: number): number {
        const playbackSeconds = this.secondsFor(move);
        const windupUnitSeconds = this.windupUnitSecondsFor(move);
        const strikeAt = firstStrikeAt(move);

        if (strikeAt === null || windupUnitSeconds === playbackSeconds || this.time >= strikeAt)
            return this.time + deltaSeconds / playbackSeconds;

        const windupSecondsLeft = (strikeAt - this.time) * windupUnitSeconds;
        if (deltaSeconds <= windupSecondsLeft) return this.time + deltaSeconds / windupUnitSeconds;
        return strikeAt + (deltaSeconds - windupSecondsLeft) / playbackSeconds;
    }

    queue(intent: IntentKind): void {
        if (this.isLocked) return;
        this.intents.push(intent);
    }

    get currentMoveSerial(): number {
        return this.moveSerial;
    }

    forceMove(moveId: string): boolean {
        if (this.isLocked) return false;
        const move = this.moveSet.moves[moveId];
        if (!move) return false;

        this.beginMove(move);
        return true;
    }

    startMove(moveId: string): boolean {
        if (this.isLocked) return false;
        const move = this.moveSet.moves[moveId];
        if (!move || !this.canStartMove(move)) return false;

        this.beginMove(move);
        return true;
    }

    openCancels(): void {
        if (this.currentState === "move") this.cancelsOpen = true;
    }

    react(tier: ReactionTier, seconds: number, reactionDodgeCancelSeconds: number): void {
        if (tier === "none" || this.isLocked) return;

        this.enterTimedState("reaction", seconds);
        this.dodgeCancelOpensAtRemaining = seconds - reactionDodgeCancelSeconds;
        this.pendingReaction = tier;
    }

    stagger(seconds: number): void {
        if (this.isLocked) return;

        this.enterTimedState("staggered", seconds);
        this.pendingStagger = true;
    }

    enterPaired(): void {
        if (this.currentState === "dead") return;

        this.currentState = "paired";
        this.currentMove = null;
        this.intents.clear();
    }

    exitPaired(): void {
        if (this.currentState === "paired") this.toLocomotion();
    }

    die(): void {
        this.currentState = "dead";
        this.currentMove = null;
        this.intents.clear();
    }

    revive(): void {
        this.charge = 0;
        this.toLocomotion();
    }

    fall(): boolean {
        const airborneId = this.moveSet.air?.airborne;
        const airborne = airborneId ? this.moveSet.moves[airborneId] : undefined;
        if (!airborne) return false;
        if (this.currentState !== "locomotion" && this.currentState !== "move") return false;

        const current = this.currentMove;
        if (current && current.motion === "physics") return false;

        this.beginMove(airborne);
        return true;
    }

    tick(input: IMachineInput): IMachineOutput {
        this.intents.tick(
            input.realDeltaSeconds,
            this.currentMove?.tags.includes("stance") ? WEAPON_INTENTS : null
        );

        if (this.currentState === "reaction" || this.currentState === "staggered")
            this.tickTimedState(input.deltaSeconds);

        if (this.currentState === "move" && input.isGrounded) this.land(input.hasDirectionalInput);
        if (this.currentState === "move" && this.time >= 1) this.finishMove();
        if (this.currentState === "move" && this.yieldsToMovement(input)) this.toLocomotion();
        if (this.currentState === "move") this.advanceMove(input);
        if (
            this.currentState === "locomotion" ||
            this.currentState === "move" ||
            this.currentState === "reaction"
        )
            this.tryStartQueued(input);

        return this.publish();
    }

    private yieldsToMovement(input: IMachineInput): boolean {
        const move = this.currentMove;
        return (
            move?.yieldsToMovement === true &&
            input.hasDirectionalInput &&
            allowsCancel(move, this.time, "movement", this.cancelsOpen)
        );
    }

    private advanceMove(input: IMachineInput): void {
        const move = this.currentMove;
        if (!move) return;

        this.previousTime = this.time;
        let next = this.advancedTime(move, input.deltaSeconds);
        const holdAt = move.holdAt;

        if (holdAt !== undefined) {
            const isChargingHeld = input.heavyHeld && this.charge < 1;
            const reachesHoldPoint = this.time <= holdAt && next >= holdAt;
            const isParkedAtHoldPoint = this.time >= holdAt;

            if (isChargingHeld && reachesHoldPoint) {
                if (isParkedAtHoldPoint)
                    this.charge = Math.min(
                        1,
                        this.charge + input.deltaSeconds / COMBAT_TIMING.maxChargeSeconds
                    );
                next = holdAt;
            }
        }

        this.time = move.loop ? next % 1 : Math.min(1, next);
        if (hasCrossed(move.mountAt?.fraction, this.previousTime, this.time))
            this.pendingMount = move.mountAt?.target ?? null;
    }

    private land(isSteering: boolean): void {
        const move = this.currentMove;
        if (!move || (move.onLand === undefined && move.requires !== "airborne")) return;

        const landingId = move.onLand ?? (isSteering ? undefined : this.moveSet.air?.land);
        const landing = landingId ? this.moveSet.moves[landingId] : undefined;
        if (landing) this.beginMove(landing);
        else this.toLocomotion();
    }

    private tryStartQueued(input: IMachineInput): void {
        const intents = this.intents;

        for (let index = 0; index < intents.size; index += 1) {
            const intent = intents.intentAt(index);
            if (intent === null) continue;

            const target = this.resolveIntent(intent, input);
            if (!target) {
                intents.removeAt(index);
                index -= 1;
                continue;
            }

            const isStanceMove = target.tags.includes("stance");
            const tag = isStanceMove ? "stance" : TAG_FOR_INTENT[intent];
            if (!this.permits(tag) || !meetsGround(target, input.isGrounded)) continue;

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
        if (this.time >= 1) return true;

        return move.tags.some((tag) => allowsCancel(current, this.time, tag, this.cancelsOpen));
    }

    private permits(tag: MoveTag): boolean {
        if (this.currentState === "locomotion") return true;
        if (this.currentState === "reaction")
            return tag === "dodge" && this.stateRemaining <= this.dodgeCancelOpensAtRemaining;

        const move = this.currentMove;
        return (
            move !== null &&
            (this.time >= 1 || allowsCancel(move, this.time, tag, this.cancelsOpen))
        );
    }

    private resolveIntent(intent: IntentKind, input: IMachineInput): IMoveDefinition | null {
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
                    : WEAPON_INTENTS.has(intent) && stanceAfter === "sheathed"
                      ? stanceEntry.sheathed
                      : undefined;
            if (stanceId) return this.moveSet.moves[stanceId] ?? null;
            if (intent === "draw") return null;
        }

        const nextId = this.currentState === "move" ? move?.next?.[intent] : undefined;
        if (nextId) return this.moveSet.moves[nextId] ?? null;

        const entryId =
            (input.isGrounded ? undefined : this.moveSet.airEntry[intent]) ??
            (input.isSprinting ? this.moveSet.sprintEntry[intent] : undefined) ??
            (input.isLockedTargetFar ? this.moveSet.lockedFarEntry?.[intent] : undefined) ??
            (intent === "dodge" && input.dodgeSide
                ? this.moveSet.sideDodgeEntry?.[input.dodgeSide]
                : undefined) ??
            this.moveSet.entry[intent];

        return entryId ? (this.moveSet.moves[entryId] ?? null) : null;
    }

    private finishMove(): void {
        const followUpId = this.currentMove?.followedBy;
        const followUp = followUpId ? this.moveSet.moves[followUpId] : undefined;
        if (followUp) this.beginMove(followUp);
        else this.toLocomotion();
    }

    private beginMove(move: IMoveDefinition): void {
        this.moveSerial += 1;
        this.currentMove = move;
        this.currentState = "move";
        this.time = 0;
        this.previousTime = 0;
        this.charge = 0;
        this.cancelsOpen = false;
        this.pendingMoveStarted = true;
    }

    private enterTimedState(state: "reaction" | "staggered", seconds: number): void {
        this.currentState = state;
        this.currentMove = null;
        this.stateRemaining = seconds;
        this.charge = 0;
    }

    private tickTimedState(deltaSeconds: number): void {
        this.stateRemaining -= deltaSeconds;
        if (this.stateRemaining <= 0) this.toLocomotion();
    }

    private toLocomotion(): void {
        this.currentState = "locomotion";
        this.currentMove = null;
        this.time = 0;
        this.previousTime = 0;
        this.pendingLocomotion = true;
    }

    private publish(): IMachineOutput {
        const output = this.output;
        const move = this.activeMove;

        output.state = this.currentState;
        output.move = move;
        output.moveStarted = this.pendingMoveStarted;
        output.reactionStarted = this.pendingReaction;
        output.staggerStarted = this.pendingStagger;
        output.returnedToLocomotion = this.pendingLocomotion && this.currentState === "locomotion";
        this.pendingMoveStarted = false;
        this.pendingReaction = null;
        this.pendingStagger = false;
        this.pendingLocomotion = false;

        output.previousTime = move ? this.previousTime : 0;
        output.time = move ? this.time : 0;
        output.moveSerial = this.moveSerial;
        output.moveSeconds = move ? this.secondsFor(move) : 0;
        output.elapsedSeconds = output.time * output.moveSeconds;
        output.windupUnitSeconds = move ? this.windupUnitSecondsFor(move) : 0;
        output.allowsLocomotion =
            this.currentState === "locomotion" ||
            (move !== null && allowsCancel(move, this.time, "movement", this.cancelsOpen));

        const invulnerable = move?.invulnerable;
        output.isInvulnerable = isWithin(invulnerable, output.time);
        output.invulnerableSeconds =
            invulnerable && output.isInvulnerable
                ? secondsSinceStart(invulnerable, output.time, output.moveSeconds)
                : 0;
        output.isParrying =
            move?.parrySeconds !== undefined && output.elapsedSeconds <= move.parrySeconds;
        output.isArmored = isWithin(move?.armor, output.time);
        output.chargeLevel = this.charge;
        output.mountTarget = this.pendingMount;
        this.pendingMount = null;

        return output;
    }
}
