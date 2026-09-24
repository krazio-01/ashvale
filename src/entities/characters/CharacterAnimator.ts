import { AnimationMixer, LinearInterpolant, Matrix3, Matrix4, Vector3 } from "three";
import type { AnimationAction, AnimationClip, Interpolant, KeyframeTrack, Object3D } from "three";
import { angleDelta, clamp, lerp, smoothstep } from "@/lib/helpers";

export interface IGaitClip {
    clip: string;
    speed: number;
}

export interface IDirectionalClip {
    clip: string;
    angle: number;
}

export interface IFreeLocomotion {
    kind: "free";
    idle: string;
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
    driven: boolean;
    rate: number;
}

interface ILocomotionChannel {
    action: AnimationAction;
    weight: number;
    referenceSpeed: number;
    angle: number;
    synced: boolean;
}

interface IRetiredChannel {
    action: AnimationAction;
    weight: number;
}

const LOCOMOTION = "locomotion";

type BlendSource = AnimationAction | typeof LOCOMOTION;
const PLAYBACK_RATE_RANGE: [number, number] = [0.6, 1.8];
const IDLE_BLEND_FRACTION = 0.35;
const MOVING_EPSILON = 0.05;
const WEIGHT_EPSILON = 1e-4;
const LOCOMOTION_SWAP_SECONDS = 0.2;
const UP = new Vector3(0, 1, 0);

const scratchRootStart = new Vector3();
const scratchRootEnd = new Vector3();
const scratchSpaceMatrix = new Matrix4();

function accumulate(
    totals: Map<AnimationAction, number>,
    action: AnimationAction,
    weight: number
): void {
    if (weight > 0) totals.set(action, (totals.get(action) ?? 0) + weight);
}

export class CharacterAnimator {
    private readonly root: Object3D;
    private readonly mixer: AnimationMixer;
    private readonly clipsByName = new Map<string, AnimationClip>();
    private readonly slotsByName = new Map<string, AnimationAction[]>();
    private readonly allActions: AnimationAction[] = [];
    private readonly rootTracks: ReadonlyMap<string, KeyframeTrack>;
    private readonly rootInterpolants = new Map<string, Interpolant>();
    private readonly rootToBody = new Matrix3();
    private readonly hasRootSpace: boolean;
    private readonly warnedClips = new Set<string>();
    private readonly channels: ILocomotionChannel[] = [];
    private readonly retiredChannels: IRetiredChannel[] = [];
    private readonly snapshot = new Map<BlendSource, number>();
    private readonly blendShares = new Map<BlendSource, number>();
    private readonly totals = new Map<AnimationAction, number>();
    private locomotion: LocomotionDefinition | null = null;
    private swapProgress = 1;
    private incoming: BlendSource = LOCOMOTION;
    private blendProgress = 1;
    private blendSeconds = 0;
    private syncedPhase = 0;
    private oneShot: AnimationAction | null = null;
    private oneShotLoops = false;
    private oneShotDriven = false;
    private oneShotRate = 1;
    private drivenFromSeconds = 0;
    private drivenToSeconds = 0;
    private inputRight = 0;
    private inputForward = 0;
    private inputSpeed = 0;

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
            scratchSpaceMatrix
                .copy(root.matrixWorld)
                .invert()
                .multiply(rootSpace.matrixWorld)
                .premultiply(root.matrix);
            this.rootToBody.setFromMatrix4(scratchSpaceMatrix);
        }

        for (const clip of clips) this.clipsByName.set(clip.name, clip);
    }

    get oneShotTime(): number {
        return this.oneShot?.time ?? 0;
    }

    get weightSum(): number {
        let sum = 0;
        for (const action of this.allActions) sum += action.getEffectiveWeight();
        return sum;
    }

    durationOf(clip: string): number {
        return this.clipFor(clip)?.duration ?? 0;
    }

    setLocomotion(definition: LocomotionDefinition): void {
        if (definition === this.locomotion) return;

        this.retireChannels();
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
        const action = this.slotFor(clip);
        if (!action) return;

        this.oneShot = action;
        this.oneShotLoops = options.loop;
        this.oneShotDriven = options.driven;
        this.oneShotRate = options.rate;
        action.time = 0;
        this.drivenFromSeconds = 0;
        this.drivenToSeconds = 0;
        this.startBlend(action, options.fadeSeconds);
    }

    driveOneShot(clipSeconds: number): void {
        this.drivenFromSeconds = this.drivenToSeconds;
        this.drivenToSeconds = clipSeconds;
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

        const start = interpolant.evaluate(fromSeconds);
        scratchRootStart.set(start[0] ?? 0, start[1] ?? 0, start[2] ?? 0);
        const end = interpolant.evaluate(toSeconds);
        scratchRootEnd.set(end[0] ?? 0, end[1] ?? 0, end[2] ?? 0);

        out.subVectors(scratchRootEnd, scratchRootStart).applyMatrix3(this.rootToBody);
        return out.applyAxisAngle(UP, yaw);
    }

    update(deltaSeconds: number, interpolationAlpha = 1): void {
        if (this.blendProgress < 1)
            this.blendProgress =
                this.blendSeconds > 0
                    ? Math.min(1, this.blendProgress + deltaSeconds / this.blendSeconds)
                    : 1;
        if (this.blendProgress >= 1) this.snapshot.clear();

        if (this.swapProgress < 1)
            this.swapProgress = Math.min(
                1,
                this.swapProgress + deltaSeconds / LOCOMOTION_SWAP_SECONDS
            );
        if (this.swapProgress >= 1) this.retiredChannels.length = 0;

        const oneShot = this.oneShot;
        if (oneShot) {
            if (this.oneShotDriven)
                oneShot.time = lerp(
                    this.drivenFromSeconds,
                    this.drivenToSeconds,
                    interpolationAlpha
                );
            else this.advanceOneShot(oneShot, deltaSeconds);
        }

        this.advanceLocomotion(deltaSeconds);
        this.applyWeights();
        this.mixer.update(deltaSeconds);
    }

    dispose(): void {
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this.root);
        this.slotsByName.clear();
        this.allActions.length = 0;
        this.channels.length = 0;
        this.retiredChannels.length = 0;
        this.snapshot.clear();
        this.totals.clear();
        this.rootInterpolants.clear();
    }

    private blendWeight(): number {
        return smoothstep(0, 1, this.blendProgress);
    }

    private shareOf(source: BlendSource, incomingWeight: number): number {
        const held = (this.snapshot.get(source) ?? 0) * (1 - incomingWeight);
        return source === this.incoming ? held + incomingWeight : held;
    }

    private startBlend(target: BlendSource, fadeSeconds: number): void {
        const incomingWeight = this.blendWeight();
        const shares = this.blendShares;
        shares.clear();
        for (const source of this.snapshot.keys())
            shares.set(source, this.shareOf(source, incomingWeight));
        shares.set(this.incoming, this.shareOf(this.incoming, incomingWeight));

        let keptTotal = 0;
        for (const weight of shares.values()) if (weight > WEIGHT_EPSILON) keptTotal += weight;

        this.snapshot.clear();
        for (const [source, weight] of shares)
            if (weight > WEIGHT_EPSILON) this.snapshot.set(source, weight / keptTotal);

        this.incoming = target;
        this.blendSeconds = fadeSeconds;
        this.blendProgress = fadeSeconds > 0 ? 0 : 1;
    }

    private applyWeights(): void {
        const totals = this.totals;
        totals.clear();
        const incomingWeight = this.blendWeight();
        const locomotionShare = this.shareOf(LOCOMOTION, incomingWeight);

        if (locomotionShare > 0) {
            const swap = this.swapProgress;
            for (const channel of this.channels)
                accumulate(totals, channel.action, channel.weight * locomotionShare * swap);
            for (const retired of this.retiredChannels)
                accumulate(totals, retired.action, retired.weight * locomotionShare * (1 - swap));
        }

        for (const [source, weight] of this.snapshot)
            if (source !== LOCOMOTION) accumulate(totals, source, weight * (1 - incomingWeight));
        if (this.incoming !== LOCOMOTION) accumulate(totals, this.incoming, incomingWeight);

        for (const action of this.allActions) action.setEffectiveWeight(totals.get(action) ?? 0);
    }

    private retireChannels(): void {
        const swap = this.swapProgress;
        for (const retired of this.retiredChannels) retired.weight *= 1 - swap;
        for (const channel of this.channels)
            this.retiredChannels.push({ action: channel.action, weight: channel.weight * swap });

        this.channels.length = 0;
        this.swapProgress = this.retiredChannels.length > 0 ? 0 : 1;
    }

    private advanceOneShot(action: AnimationAction, step: number): void {
        const duration = Math.max(action.getClip().duration, 1e-3);
        const time = action.time + step * this.oneShotRate;
        action.time = this.oneShotLoops ? time % duration : Math.min(time, duration);
    }

    private advanceLocomotion(step: number): void {
        const definition = this.locomotion;
        if (!definition) return;

        this.computeChannelWeights(definition);

        let phaseRate = 0;
        let syncedWeight = 0;

        for (const channel of this.channels) {
            if (!channel.synced || channel.weight <= 0) continue;

            const duration = Math.max(channel.action.getClip().duration, 1e-3);
            const rate = clamp(this.inputSpeed / channel.referenceSpeed, ...PLAYBACK_RATE_RANGE);
            phaseRate += (channel.weight * rate) / duration;
            syncedWeight += channel.weight;
        }

        if (syncedWeight > 0)
            this.syncedPhase = (this.syncedPhase + (phaseRate / syncedWeight) * step) % 1;

        for (const channel of this.channels) {
            const action = channel.action;
            const duration = Math.max(action.getClip().duration, 1e-3);
            action.time = channel.synced
                ? this.syncedPhase * duration
                : (action.time + step) % duration;
        }
    }

    private computeChannelWeights(definition: LocomotionDefinition): void {
        for (const channel of this.channels) channel.weight = 0;

        const idle = this.channels[0];
        if (!idle) return;

        if (this.inputSpeed < MOVING_EPSILON) {
            idle.weight = 1;
            return;
        }

        if (definition.kind === "free") this.weighGaits(idle);
        else this.weighDirections(idle, definition);
    }

    private weighGaits(idle: ILocomotionChannel): void {
        let lower = idle;

        for (let index = 1; index < this.channels.length; index += 1) {
            const channel = this.channels[index];
            if (!channel) continue;

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

    private weighDirections(idle: ILocomotionChannel, definition: IStrafeLocomotion): void {
        const angle = Math.atan2(this.inputRight, this.inputForward);
        let nearest: ILocomotionChannel | null = null;
        let second: ILocomotionChannel | null = null;
        let nearestGap = Number.POSITIVE_INFINITY;
        let secondGap = Number.POSITIVE_INFINITY;

        for (let index = 1; index < this.channels.length; index += 1) {
            const channel = this.channels[index];
            if (!channel) continue;

            const gap = Math.abs(angleDelta(channel.angle, angle));

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
            this.inputSpeed / (definition.speed * IDLE_BLEND_FRACTION),
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

    private slotFor(clip: string): AnimationAction | null {
        const primary = this.actionFor(clip);
        if (!primary) return null;
        if (primary.getEffectiveWeight() <= WEIGHT_EPSILON) return primary;

        const secondary = this.secondaryFor(clip, primary);
        return secondary.getEffectiveWeight() < primary.getEffectiveWeight() ? secondary : primary;
    }

    private secondaryFor(clip: string, primary: AnimationAction): AnimationAction {
        const slots = this.slotsByName.get(clip) ?? [primary];
        const existing = slots[1];
        if (existing) return existing;

        const secondary = this.prepare(this.mixer.clipAction(primary.getClip().clone()));
        slots[1] = secondary;
        this.slotsByName.set(clip, slots);
        return secondary;
    }

    private actionFor(clip: string): AnimationAction | null {
        const existing = this.slotsByName.get(clip)?.[0];
        if (existing) return existing;

        const source = this.clipFor(clip);
        if (!source) return null;

        const action = this.prepare(this.mixer.clipAction(source));
        this.slotsByName.set(clip, [action]);
        return action;
    }

    private prepare(action: AnimationAction): AnimationAction {
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
            console.warn(`no animation clip named "${clip}"`);
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
