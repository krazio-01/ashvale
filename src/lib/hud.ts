import { HUD } from "@/constants/presentation";
import type { IHudVital } from "@/types/hud";

export function vitalFraction(vital: IHudVital): number {
    return vital.maximum > 0 ? vital.current / vital.maximum : 0;
}

export function roundForStyle(value: number): number {
    return Math.round(value * HUD.styleRoundingSteps) / HUD.styleRoundingSteps;
}

export function screenAnchorTransform(screenX: number, screenY: number, anchor: string): string {
    return `translate3d(${(screenX * 100).toFixed(2)}vw, ${(screenY * 100).toFixed(2)}vh, 0) translate(${anchor})`;
}
