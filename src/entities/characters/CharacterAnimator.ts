import { AnimationClip, AnimationMixer, LoopOnce } from "three";
import type { AnimationAction, Object3D } from "three";
import { CHARACTER, CharacterMotion, MOTION_CLIPS } from "@/constants/characters";
import type { IMotionClip, MotionPlayback } from "@/constants/characters";
import { clamp } from "@/lib/helpers";

export class CharacterAnimator {
    private readonly root: Object3D;
    private readonly mixer: AnimationMixer;
    private readonly actionsByMotion = new Map<CharacterMotion, AnimationAction>();
    private activeMotion: CharacterMotion | null = null;

    constructor(root: Object3D, clips: AnimationClip[]) {
        this.root = root;
        this.mixer = new AnimationMixer(root);

        const motionEntries = Object.entries(MOTION_CLIPS) as [CharacterMotion, IMotionClip][];

        for (const [motion, { clipName, loops }] of motionEntries) {
            const clip = AnimationClip.findByName(clips, clipName);

            if (!clip) {
                console.warn(`no animation clip named "${clipName}" for motion "${motion}"`);
                continue;
            }

            const action = this.mixer.clipAction(clip);
            if (!loops) action.setLoop(LoopOnce, 1).clampWhenFinished = true;

            this.actionsByMotion.set(motion, action);
        }
    }

    durationOf(motion: CharacterMotion): number {
        return this.actionsByMotion.get(motion)?.getClip().duration ?? 0;
    }

    setMotion(motion: CharacterMotion, groundSpeed: number): void {
        const nextAction = this.actionsByMotion.get(motion);
        if (!nextAction) return;

        const clip = MOTION_CLIPS[motion];
        nextAction.timeScale = playbackRateFor(
            clip.playback,
            nextAction.getClip().duration,
            groundSpeed
        );
        if (motion === this.activeMotion) return;

        const previousAction =
            this.activeMotion === null ? null : this.actionsByMotion.get(this.activeMotion);

        nextAction.reset().play();
        if (previousAction) nextAction.crossFadeFrom(previousAction, clip.fadeSeconds, false);

        this.activeMotion = motion;
    }

    update(deltaSeconds: number): void {
        this.mixer.update(deltaSeconds);
    }

    dispose(): void {
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this.root);
        this.actionsByMotion.clear();
    }
}

function playbackRateFor(
    playback: MotionPlayback,
    clipDuration: number,
    groundSpeed: number
): number {
    if (playback.mode === "fitDuration") return clipDuration / playback.seconds;
    if (playback.mode === "fixed") return 1;

    return clamp(groundSpeed / playback.strideSpeed, ...CHARACTER.playbackRateRange);
}
