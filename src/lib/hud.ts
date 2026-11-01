import { HUD } from "@/constants/ui";
import { roundTo } from "@/lib/helpers";
import type { IHudMeter } from "@/types/ui";

class HudWriter {
    private static readonly TRANSFORM = Symbol("transform");

    private static readonly OPACITY = Symbol("opacity");

    private static readonly TEXT = Symbol("text");

    private readonly written = new WeakMap<HTMLElement, Record<string | symbol, unknown>>();

    scale(element: HTMLElement | null, axis: "X" | "Y", value: number): void {
        if (element && this.hasChanged(element, HudWriter.TRANSFORM, value))
            element.style.transform = `scale${axis}(${value})`;
    }

    transform(element: HTMLElement | null, value: string): void {
        if (element && this.hasChanged(element, HudWriter.TRANSFORM, value))
            element.style.transform = value;
    }

    opacity(element: HTMLElement | null, value: number): void {
        if (element && this.hasChanged(element, HudWriter.OPACITY, value))
            element.style.opacity = `${value}`;
    }

    text(element: HTMLElement | null, value: string | number): void {
        if (element && this.hasChanged(element, HudWriter.TEXT, value))
            element.textContent = `${value}`;
    }

    data(element: HTMLElement | null, name: string, value: string | boolean): void {
        if (element && this.hasChanged(element, name, value)) element.dataset[name] = `${value}`;
    }

    private hasChanged(element: HTMLElement, channel: string | symbol, value: unknown): boolean {
        let values = this.written.get(element);
        if (!values) {
            values = {};
            this.written.set(element, values);
        }
        if (values[channel] === value) return false;

        values[channel] = value;
        return true;
    }
}

export function meterFillRatio(meter: IHudMeter): number {
    return meter.maximum > 0 ? meter.current / meter.maximum : 0;
}

export const roundForCss = (value: number): number => roundTo(value, HUD.styleRoundingSteps);

export function screenPositionTransform(screenX: number, screenY: number, anchor: string): string {
    return `translate3d(${(screenX * 100).toFixed(2)}vw, ${(screenY * 100).toFixed(2)}vh, 0) translate(${anchor})`;
}

export const hudWriter = new HudWriter();
