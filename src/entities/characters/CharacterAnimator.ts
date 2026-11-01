import { AnimationMixer, LinearInterpolant, Matrix3, Matrix4, Vector3 } from "three";
import type { AnimationAction, AnimationClip, Interpolant, KeyframeTrack, Object3D } from "three";
import { BoneMath } from "@/lib/boneMath";
import {
    shortestAngleBetween,
    clamp,
    lerp,
    smoothstep,
    moveTowards,
    yawFromDirection,
} from "@/lib/helpers";
import { LOG_MESSAGES } from "@/constants/strings";

const LOCOMOTION = "locomotion";

interface IGaitClip {
    clip: string;
    speed: number;
}

export interface IDirectionalClip {
    clip: string;
    angle: number;
}

interface IIdleVariation {
    clips: readonly string[];
    afterSeconds: number;
    weaponGazeClips?: readonly string[];
}

export interface IFreeLocomotion {
    kind: "free";
    idle: string;
    idleVariation?: IIdleVariation;
    gaits: readonly IGaitClip[];
}

export interface IStrafeLocomotion {
    kind: "strafe";
    idle: string;
    directions: readonly IDirectionalClip[];
    speed: number;
}

export type LocomotionDefinition = IFreeLocomotion | IStrafeLocomotion;

export interface IOneShotOptions {
    fadeSeconds: number;
    loop: boolean;
    timeSetByCaller: boolean;
}

interface ILocomotionChannel {
    action: AnimationAction;
    weight: number;
    referenceSpeed: number;
    angle: number;
    synced: boolean;
}

interface IFadingLocomotionChannel {
    action: AnimationAction;
    weight: number;
}

type BlendSource = AnimationAction | typeof LOCOMOTION;

export class CharacterAnimator {
    private static readonly MIN_PLAYBACK_RATE = 0.6;

    private static readonly MAX_PLAYBACK_RATE = 1.8;

    private static readonly STRAFE_FULL_WEIGHT_SPEED_FRACTION = 0.35;

    private static readonly MOVING_EPSILON = 0.05;

    private static readonly WEIGHT_EPSILON = 1e-4;

    private static readonly LOCOMOTION_SWAP_SECONDS = 0.2;

    private static readonly IDLE_VARIANT_FADE_SECONDS = 0.5;

    private static readonly scratchRootStart = new Vector3();

    private static readonly scratchRootEnd = new Vector3();

    private static readonly scratchSpaceMatrix = new Matrix4();

    private static addActionWeight(
        totals: Map<AnimationAction, number>,
        action: AnimationAction,
        weight: number
    ): void {
        if (weight > 0) totals.set(action, (totals.get(action) ?? 0) + weight);
    }

    private static safeDurationOf(action: AnimationAction): number {
        return Math.max(action.getClip().duration, 1e-3);
    }

    private readonly root: Object3D;
    private readonly mixer: AnimationMixer;
    private readonly clipsByName = new Map<string, AnimationClip>();
    private readonly actionsByClipName = new Map<string, AnimationAction[]>();
    private readonly allActions: AnimationAction[] = [];
    private readonly rootTracks: ReadonlyMap<string, KeyframeTrack>;
    private readonly rootInterpolants = new Map<string, Interpolant>();
    private readonly rootToBody = new Matrix3();
    private readonly hasRootSpace: boolean;
    private readonly warnedClips = new Set<string>();
    private readonly channels: ILocomotionChannel[] = [];
    private readonly fadingLocomotionChannels: IFadingLocomotionChannel[] = [];
    private readonly weightsBeforeBlend = new Map<BlendSource, number>();
    private readonly weightsAtBlendStart = new Map<BlendSource, number>();
    private readonly weightByAction = new Map<AnimationAction, number>();
    private locomotion: LocomotionDefinition | null = null;
    private locomotionSwapProgress = 1;
    private blendTarget: BlendSource = LOCOMOTION;
    private blendProgress = 1;
    private blendSeconds = 0;
    private gaitCyclePhase = 0;
    private oneShot: AnimationAction | null = null;
    private oneShotLoops = false;
    private isOneShotTimeSetByCaller = false;
    private callerTimeFrom = 0;
    private callerTimeTo = 0;
    private inputRight = 0;
    private inputForward = 0;
    private inputSpeed = 0;
    private idleVariant: AnimationAction | null = null;
    private idleVariantBlend = 0;
    private isIdleVariantWeaponGaze = false;
    private idleVariantCount = 0;
    private standingSeconds = 0;

    constructor(
        root: Object3D,
        clips: readonly AnimationClip[],
        rootTracks: ReadonlyMap<string, KeyframeTrack>
    ) {
        this.root = root;
        this.mixer = new AnimationMixer(root);
        this.rootTracks = rootTracks;

        const rootSpace = root.getObjectByName("root")?.parent ?? null;
        this.hasRootSpace = rootSpace !== null;
        if (rootSpace) {
            root.updateWorldMatrix(true, true);
            CharacterAnimator.scratchSpaceMatrix
                .copy(root.matrixWorld)
                .invert()
                .multiply(rootSpace.matrixWorld)
                .premultiply(root.matrix);
            this.rootToBody.setFromMatrix4(CharacterAnimator.scratchSpaceMatrix);
        }

        for (const clip of clips) this.clipsByName.set(clip.name, clip);
    }

    durationOf(clip: string): number {
        return this.clipFor(clip)?.duration ?? 0;
    }

    setLocomotion(definition: LocomotionDefinition): void {
        if (definition === this.locomotion) return;

        this.fadeOutLocomotionChannels();
        this.locomotion = definition;
        this.addChannel(definition.idle, 0, 0, false);

        if (definition.kind === "free") {
            for (const gait of definition.gaits) this.addChannel(gait.clip, gait.speed, 0, true);
            return;
        }

        for (const direction of definition.directions)
            this.addChannel(direction.clip, definition.speed, direction.angle, true);
    }

    setLocomotionInput(localRight: number, localForward: number, speed: number): void {
        this.inputRight = localRight;
        this.inputForward = localForward;
        this.inputSpeed = speed;
    }

    playOneShot(clip: string, options: IOneShotOptions): void {
        const action = this.leastUsedActionFor(clip);
        if (!action) return;

        this.oneShot = action;
        this.oneShotLoops = options.loop;
        this.isOneShotTimeSetByCaller = options.timeSetByCaller;
        action.time = 0;
        this.callerTimeFrom = 0;
        this.callerTimeTo = 0;
        this.startBlend(action, options.fadeSeconds);
    }

    setOneShotTime(clipSeconds: number): void {
        this.callerTimeFrom = this.callerTimeTo;
        this.callerTimeTo = clipSeconds;
    }

    returnToLocomotion(fadeSeconds: number): void {
        this.oneShot = null;
        this.startBlend(LOCOMOTION, fadeSeconds);
    }

    sampleRootMotion(
        clip: string,
        fromSeconds: number,
        toSeconds: number,
        yaw: number,
        out: Vector3
    ): Vector3 {
        out.set(0, 0, 0);

        const interpolant = this.rootInterpolantFor(clip);
        if (!interpolant || !this.hasRootSpace || toSeconds <= fromSeconds) return out;

        CharacterAnimator.scratchRootStart.fromArray(interpolant.evaluate(fromSeconds));
        CharacterAnimator.scratchRootEnd.fromArray(interpolant.evaluate(toSeconds));

        out.subVectors(
            CharacterAnimator.scratchRootEnd,
            CharacterAnimator.scratchRootStart
        ).applyMatrix3(this.rootToBody);
        return out.applyAxisAngle(BoneMath.UP, yaw);
    }

    update(deltaSeconds: number, interpolationAlpha: number): void {
        if (this.blendProgress < 1)
            this.blendProgress =
                this.blendSeconds > 0
                    ? moveTowards(this.blendProgress, 1, deltaSeconds / this.blendSeconds)
                    : 1;
        if (this.blendProgress >= 1 && this.weightsBeforeBlend.size > 0)
            this.weightsBeforeBlend.clear();

        if (this.locomotionSwapProgress < 1)
            this.locomotionSwapProgress = moveTowards(
                this.locomotionSwapProgress,
                1,
                deltaSeconds / CharacterAnimator.LOCOMOTION_SWAP_SECONDS
            );
        if (this.locomotionSwapProgress >= 1) this.fadingLocomotionChannels.length = 0;

        const oneShot = this.oneShot;
        if (oneShot) {
            if (this.isOneShotTimeSetByCaller)
                oneShot.time = lerp(this.callerTimeFrom, this.callerTimeTo, interpolationAlpha);
            else this.advanceOneShot(oneShot, deltaSeconds);
        }

        this.advanceLocomotion(deltaSeconds);
        this.applyWeights();
        this.mixer.update(deltaSeconds);
    }

    dispose(): void {
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this.root);
    }

    private incomingBlendWeight(): number {
        return smoothstep(0, 1, this.blendProgress);
    }

    private currentWeightOf(source: BlendSource, incomingWeight: number): number {
        const held = (this.weightsBeforeBlend.get(source) ?? 0) * (1 - incomingWeight);
        return source === this.blendTarget ? held + incomingWeight : held;
    }

    private startBlend(target: BlendSource, fadeSeconds: number): void {
        const incomingWeight = this.incomingBlendWeight();
        const shares = this.weightsAtBlendStart;
        shares.clear();
        for (const source of this.weightsBeforeBlend.keys())
            shares.set(source, this.currentWeightOf(source, incomingWeight));
        shares.set(this.blendTarget, this.currentWeightOf(this.blendTarget, incomingWeight));

        let keptTotal = 0;
        for (const weight of shares.values())
            if (weight > CharacterAnimator.WEIGHT_EPSILON) keptTotal += weight;

        this.weightsBeforeBlend.clear();
        for (const [source, weight] of shares)
            if (weight > CharacterAnimator.WEIGHT_EPSILON)
                this.weightsBeforeBlend.set(source, weight / keptTotal);

        this.blendTarget = target;
        this.blendSeconds = fadeSeconds;
        this.blendProgress = fadeSeconds > 0 ? 0 : 1;
    }

    private applyWeights(): void {
        const totals = this.weightByAction;
        totals.clear();
        const incomingWeight = this.incomingBlendWeight();
        const locomotionShare = this.currentWeightOf(LOCOMOTION, incomingWeight);

        if (locomotionShare > 0) {
            const swap = this.locomotionSwapProgress;
            for (let index = 0; index < this.channels.length; index += 1) {
                const channel = this.channels[index];
                const variantShare = index === 0 && this.idleVariant ? this.idleVariantBlend : 0;
                const weight = channel.weight * locomotionShare * swap;
                CharacterAnimator.addActionWeight(
                    totals,
                    channel.action,
                    weight * (1 - variantShare)
                );
                if (variantShare > 0)
                    CharacterAnimator.addActionWeight(
                        totals,
                        this.idleVariant!,
                        weight * variantShare
                    );
            }
            for (const retired of this.fadingLocomotionChannels)
                CharacterAnimator.addActionWeight(
                    totals,
                    retired.action,
                    retired.weight * locomotionShare * (1 - swap)
                );
        }

        this.weightsBeforeBlend.forEach((weight, source) => {
            if (source !== LOCOMOTION)
                CharacterAnimator.addActionWeight(totals, source, weight * (1 - incomingWeight));
        });
        if (this.blendTarget !== LOCOMOTION)
            CharacterAnimator.addActionWeight(totals, this.blendTarget, incomingWeight);

        for (const action of this.allActions) action.setEffectiveWeight(totals.get(action) ?? 0);
    }

    private fadeOutLocomotionChannels(): void {
        const swap = this.locomotionSwapProgress;
        const fading = this.fadingLocomotionChannels;
        let hasFadingChannels = fading.length > 0;
        let keptCount = 0;
        for (let index = 0; index < fading.length; index += 1) {
            const channel = fading[index];
            channel.weight *= 1 - swap;
            if (channel.weight > 0) fading[keptCount++] = channel;
        }
        fading.length = keptCount;

        const variantShare = this.idleVariant ? this.idleVariantBlend : 0;
        for (let index = 0; index < this.channels.length; index += 1) {
            const channel = this.channels[index];
            const share = index === 0 ? 1 - variantShare : 1;
            hasFadingChannels = true;
            this.addFadingChannel(channel.action, channel.weight * share * swap);
        }
        const idleWeight = this.channels[0]?.weight ?? 0;
        if (variantShare > 0) {
            hasFadingChannels = true;
            this.addFadingChannel(this.idleVariant!, idleWeight * variantShare * swap);
        }

        this.idleVariant = null;
        this.idleVariantBlend = 0;
        this.standingSeconds = 0;
        this.channels.length = 0;
        this.locomotionSwapProgress = hasFadingChannels ? 0 : 1;
    }

    private addFadingChannel(action: AnimationAction, weight: number): void {
        if (weight > 0) this.fadingLocomotionChannels.push({ action, weight });
    }

    private advanceOneShot(action: AnimationAction, step: number): void {
        const duration = CharacterAnimator.safeDurationOf(action);
        const time = action.time + step;
        action.time = this.oneShotLoops ? time % duration : Math.min(time, duration);
    }

    private advanceLocomotion(step: number): void {
        const definition = this.locomotion;
        if (!definition) return;

        this.computeChannelWeights(definition);
        this.advanceIdleVariation(definition, step);

        let phaseRate = 0;
        let syncedWeight = 0;

        for (const channel of this.channels) {
            if (!channel.synced || channel.weight <= 0) continue;

            const duration = CharacterAnimator.safeDurationOf(channel.action);
            const rate = clamp(
                this.inputSpeed / channel.referenceSpeed,
                CharacterAnimator.MIN_PLAYBACK_RATE,
                CharacterAnimator.MAX_PLAYBACK_RATE
            );
            phaseRate += (channel.weight * rate) / duration;
            syncedWeight += channel.weight;
        }

        if (syncedWeight > 0)
            this.gaitCyclePhase = (this.gaitCyclePhase + (phaseRate / syncedWeight) * step) % 1;

        for (const channel of this.channels) {
            const action = channel.action;
            const duration = CharacterAnimator.safeDurationOf(action);
            action.time = channel.synced
                ? this.gaitCyclePhase * duration
                : (action.time + step) % duration;
        }
    }

    get isLookingAtWeapon(): boolean {
        return (
            this.idleVariant !== null && this.idleVariantBlend > 0 && this.isIdleVariantWeaponGaze
        );
    }

    private advanceIdleVariation(definition: LocomotionDefinition, step: number): void {
        const variation = definition.kind === "free" ? definition.idleVariation : undefined;
        if (!variation) return;

        const standing =
            this.inputSpeed < CharacterAnimator.MOVING_EPSILON && this.blendTarget === LOCOMOTION;
        const variant = this.idleVariant;

        if (!variant) {
            this.standingSeconds = standing ? this.standingSeconds + step : 0;
            if (this.standingSeconds < variation.afterSeconds) return;

            this.standingSeconds = 0;
            const clip = variation.clips[this.idleVariantCount % variation.clips.length];
            this.idleVariantCount += 1;
            const action = this.actionFor(clip);
            if (!action) return;

            action.time = 0;
            this.idleVariant = action;
            this.idleVariantBlend = 0;
            this.isIdleVariantWeaponGaze = variation.weaponGazeClips?.includes(clip) === true;
            return;
        }

        const duration = variant.getClip().duration;
        variant.time = Math.min(variant.time + step, duration);
        const fadeStep = step / CharacterAnimator.IDLE_VARIANT_FADE_SECONDS;
        const fadingOut =
            !standing || duration - variant.time <= CharacterAnimator.IDLE_VARIANT_FADE_SECONDS;
        this.idleVariantBlend = moveTowards(this.idleVariantBlend, fadingOut ? 0 : 1, fadeStep);
        if (fadingOut && this.idleVariantBlend === 0) this.idleVariant = null;
    }

    private computeChannelWeights(definition: LocomotionDefinition): void {
        for (const channel of this.channels) channel.weight = 0;

        const idle = this.channels[0];
        if (!idle) return;

        if (this.inputSpeed < CharacterAnimator.MOVING_EPSILON) {
            idle.weight = 1;
            return;
        }

        if (definition.kind === "free") this.setGaitWeights(idle);
        else this.setDirectionWeights(idle, definition);
    }

    private setGaitWeights(idle: ILocomotionChannel): void {
        let lower = idle;

        for (let index = 1; index < this.channels.length; index += 1) {
            const channel = this.channels[index];

            if (this.inputSpeed <= channel.referenceSpeed) {
                const span = channel.referenceSpeed - lower.referenceSpeed;
                const blend = span > 0 ? (this.inputSpeed - lower.referenceSpeed) / span : 1;
                lower.weight = 1 - blend;
                channel.weight = blend;
                return;
            }

            lower = channel;
        }

        lower.weight = 1;
    }

    private setDirectionWeights(idle: ILocomotionChannel, definition: IStrafeLocomotion): void {
        const angle = yawFromDirection(this.inputRight, this.inputForward);
        let nearest: ILocomotionChannel | null = null;
        let second: ILocomotionChannel | null = null;
        let nearestGap = Number.POSITIVE_INFINITY;
        let secondGap = Number.POSITIVE_INFINITY;

        for (let index = 1; index < this.channels.length; index += 1) {
            const channel = this.channels[index];

            const gap = Math.abs(shortestAngleBetween(channel.angle, angle));

            if (gap < nearestGap) {
                second = nearest;
                secondGap = nearestGap;
                nearest = channel;
                nearestGap = gap;
            } else if (gap < secondGap) {
                second = channel;
                secondGap = gap;
            }
        }

        if (!nearest) {
            idle.weight = 1;
            return;
        }

        const movingWeight = clamp(
            this.inputSpeed /
                (definition.speed * CharacterAnimator.STRAFE_FULL_WEIGHT_SPEED_FRACTION),
            0,
            1
        );
        const totalGap = nearestGap + secondGap;

        if (!second || totalGap < 1e-5) {
            nearest.weight = movingWeight;
        } else {
            nearest.weight = movingWeight * (secondGap / totalGap);
            second.weight = movingWeight * (nearestGap / totalGap);
        }

        idle.weight = 1 - movingWeight;
    }

    private addChannel(clip: string, referenceSpeed: number, angle: number, synced: boolean): void {
        const action = this.actionFor(clip);
        if (!action) return;

        this.channels.push({ action, weight: 0, referenceSpeed, angle, synced });
    }

    private leastUsedActionFor(clip: string): AnimationAction | null {
        const primary = this.actionFor(clip);
        if (!primary) return null;
        if (primary.getEffectiveWeight() <= CharacterAnimator.WEIGHT_EPSILON) return primary;

        const secondary = this.duplicateActionFor(clip, primary);
        return secondary.getEffectiveWeight() < primary.getEffectiveWeight() ? secondary : primary;
    }

    private duplicateActionFor(clip: string, primary: AnimationAction): AnimationAction {
        const slots = this.actionsByClipName.get(clip)!;
        const existing = slots[1];
        if (existing) return existing;

        const secondary = this.registerManuallyTimedAction(
            this.mixer.clipAction(primary.getClip().clone())
        );
        slots[1] = secondary;
        return secondary;
    }

    private actionFor(clip: string): AnimationAction | null {
        const existing = this.actionsByClipName.get(clip)?.[0];
        if (existing) return existing;

        const source = this.clipFor(clip);
        if (!source) return null;

        const action = this.registerManuallyTimedAction(this.mixer.clipAction(source));
        this.actionsByClipName.set(clip, [action]);
        return action;
    }

    private registerManuallyTimedAction(action: AnimationAction): AnimationAction {
        action.timeScale = 0;
        action.setEffectiveWeight(0);
        action.play();
        this.allActions.push(action);
        return action;
    }

    private clipFor(clip: string): AnimationClip | null {
        const found = this.clipsByName.get(clip);

        if (!found && !this.warnedClips.has(clip)) {
            this.warnedClips.add(clip);
            console.warn(LOG_MESSAGES.missingAnimationClip(clip));
        }

        return found ?? null;
    }

    private rootInterpolantFor(clip: string): Interpolant | null {
        const cached = this.rootInterpolants.get(clip);
        if (cached) return cached;

        const track = this.rootTracks.get(clip);
        if (!track) return null;

        const valueSize = track.getValueSize();
        const interpolant = new LinearInterpolant(
            track.times,
            track.values,
            valueSize,
            new Float32Array(valueSize)
        );
        this.rootInterpolants.set(clip, interpolant);
        return interpolant;
    }
}
