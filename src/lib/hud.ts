import { HUD } from "@/constants/ui";
import { roundTo } from "@/lib/helpers";
import type { IHudMeter } from "@/types/ui";

class WrittenValues {
    transform: string | number | undefined = undefined;
    opacity: number | undefined = undefined;
    text: string | number | undefined = undefined;
    screenX: number | undefined = undefined;
    screenY: number | undefined = undefined;
    anchor: string | undefined = undefined;
    readonly data: Record<string, string | boolean> = {};
}

class HudWriter {
    private readonly written = new WeakMap<HTMLElement, WrittenValues>();

    scale(element: HTMLElement | null, axis: "X" | "Y", value: number): void {
        if (!element) return;
        const written = this.writtenOf(element);
        if (written.transform === value) return;
        written.transform = value;
        element.style.transform = `scale${axis}(${value})`;
    }

    position(element: HTMLElement | null, screenX: number, screenY: number, anchor: string): void {
        if (!element) return;
        const written = this.writtenOf(element);
        if (written.screenX === screenX && written.screenY === screenY && written.anchor === anchor)
            return;
        written.screenX = screenX;
        written.screenY = screenY;
        written.anchor = anchor;
        const value = screenPositionTransform(screenX, screenY, anchor);
        if (written.transform === value) return;
        written.transform = value;
        element.style.transform = value;
    }

    opacity(element: HTMLElement | null, value: number): void {
        if (!element) return;
        const written = this.writtenOf(element);
        if (written.opacity === value) return;
        written.opacity = value;
        element.style.opacity = `${value}`;
    }

    text(element: HTMLElement | null, value: string | number): void {
        if (!element) return;
        const written = this.writtenOf(element);
        if (written.text === value) return;
        written.text = value;
        element.textContent = `${value}`;
    }

    data(element: HTMLElement | null, name: string, value: string | boolean): void {
        if (!element) return;
        const { data } = this.writtenOf(element);
        if (data[name] === value) return;
        data[name] = value;
        element.dataset[name] = `${value}`;
    }

    private writtenOf(element: HTMLElement): WrittenValues {
        let written = this.written.get(element);
        if (!written) {
            written = new WrittenValues();
            this.written.set(element, written);
        }
        return written;
    }
}

export function meterFillRatio(meter: IHudMeter): number {
    return meter.maximum > 0 ? meter.current / meter.maximum : 0;
}

export function roundForCss(value: number): number {
    return roundTo(value, HUD.styleRoundingSteps);
}

function screenPositionTransform(screenX: number, screenY: number, anchor: string): string {
    return `translate3d(${(screenX * 100).toFixed(2)}vw, ${(screenY * 100).toFixed(2)}vh, 0) translate(${anchor})`;
}

export const hudWriter = new HudWriter();
