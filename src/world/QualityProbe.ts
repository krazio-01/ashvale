import { Vector3 } from "three";
import type { Camera, Quaternion, WebGLRenderer } from "three";
import { QUALITY_PRESETS, QUALITY_PROBE } from "@/constants/ui";
import { FULL_TURN, keysOf, median } from "@/lib/helpers";
import type { IFrameCost, IQualityReport, IQualityTierResult, PresetQuality } from "@/types/ui";

export class QualityProbe {
    private static readonly pixelScratch = new Uint8Array(4);

    private static readonly worldUp = new Vector3(0, 1, 0);

    private static sampleFrames(
        frameCount: number,
        signal: AbortSignal,
        sample: (intervalMs: number) => void
    ): Promise<boolean> {
        if (signal.aborted || document.hidden) return Promise.resolve(false);
        return new Promise((resolve, reject) => {
            let previous: number | undefined;
            let sampledFrames = 0;
            let frameId: number;
            let active = true;
            const cleanup = () => {
                active = false;
                cancelAnimationFrame(frameId);
                document.removeEventListener("visibilitychange", onVisibility);
                signal.removeEventListener("abort", cancel);
            };
            const cancel = () => {
                cleanup();
                resolve(false);
            };
            const onVisibility = () => {
                if (document.hidden) cancel();
            };
            const onFrame = (timestamp: number) => {
                queueMicrotask(() => {
                    if (!active) return;
                    if (signal.aborted || document.hidden) {
                        cancel();
                        return;
                    }
                    try {
                        if (previous !== undefined) {
                            sample(timestamp - previous);
                            if (!active) return;
                            sampledFrames += 1;
                        }
                        if (sampledFrames === frameCount) {
                            cleanup();
                            resolve(true);
                            return;
                        }
                        previous = timestamp;
                        frameId = requestAnimationFrame(onFrame);
                    } catch (error) {
                        cleanup();
                        reject(error);
                    }
                });
            };
            frameId = requestAnimationFrame(onFrame);
            document.addEventListener("visibilitychange", onVisibility);
            signal.addEventListener("abort", cancel);
        });
    }

    constructor(
        private readonly renderer: WebGLRenderer,
        private readonly camera: Camera,
        private readonly advanceFrame: (deltaSeconds: number) => void,
        private readonly applyTier: (tier: PresetQuality) => void
    ) {}

    async run(frameRateLimit: number, signal: AbortSignal): Promise<IQualityReport | null> {
        const refreshIntervals: number[] = [];
        const refreshed = await QualityProbe.sampleFrames(
            QUALITY_PROBE.refreshSampleFrames,
            signal,
            (intervalMs) => refreshIntervals.push(intervalMs)
        );
        if (!refreshed) return null;

        const refreshMs = median(refreshIntervals);
        const budgetMs = Math.max(refreshMs, 1000 / frameRateLimit) * (1 - QUALITY_PROBE.headroom);
        const tiers = keysOf(QUALITY_PRESETS).reverse();
        const startRotation: Quaternion = this.camera.quaternion.clone();
        const results: IQualityTierResult[] = [];
        let picked = tiers[tiers.length - 1];

        try {
            for (const tier of tiers) {
                this.applyTier(tier);
                const cost = await this.measureFrames(signal);
                if (!cost) return null;

                results.push({ tier, ...cost });
                if (cost.medianMs > budgetMs) continue;

                picked = tier;
                break;
            }
        } finally {
            this.camera.quaternion.copy(startRotation);
            this.camera.updateMatrixWorld();
        }

        return { refreshMs, budgetMs, results, picked };
    }

    private async measureFrames(signal: AbortSignal): Promise<IFrameCost | null> {
        const info = this.renderer.info;
        const context = this.renderer.getContext();
        const drawCalls: number[] = [];
        const triangles: number[] = [];
        const resetsEachRender = info.autoReset;
        info.autoReset = false;

        try {
            const warmed = await QualityProbe.sampleFrames(
                QUALITY_PROBE.warmupFrames,
                signal,
                (intervalMs) => this.renderMeasuredFrame(intervalMs, context)
            );
            if (!warmed) return null;

            const costs: number[] = [];
            const measured = await QualityProbe.sampleFrames(
                QUALITY_PROBE.measuredFrames,
                signal,
                (intervalMs) => {
                    costs.push(this.renderMeasuredFrame(intervalMs, context));
                    drawCalls.push(info.render.calls);
                    triangles.push(info.render.triangles);
                }
            );
            if (!measured) return null;

            return {
                medianMs: median(costs),
                drawCalls: median(drawCalls),
                triangles: median(triangles),
            };
        } finally {
            info.autoReset = resetsEachRender;
        }
    }

    private renderMeasuredFrame(intervalMs: number, context: WebGLRenderingContext): number {
        this.camera.rotateOnWorldAxis(
            QualityProbe.worldUp,
            FULL_TURN / QUALITY_PROBE.measuredFrames
        );
        this.camera.updateMatrixWorld();

        this.renderer.info.reset();
        const startMs = performance.now();
        this.advanceFrame(intervalMs / 1000);
        context.readPixels(
            0,
            0,
            1,
            1,
            context.RGBA,
            context.UNSIGNED_BYTE,
            QualityProbe.pixelScratch
        );

        return performance.now() - startMs;
    }
}
