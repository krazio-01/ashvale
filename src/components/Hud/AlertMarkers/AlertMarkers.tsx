"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/presentation";
import { roundForStyle, screenAnchorTransform } from "@/lib/hud";
import type { AlertMarkerKind } from "@/types/hud";
import "./alertMarkers.scss";

const GLYPHS: Record<AlertMarkerKind, string> = { suspicious: "?", alert: "!" };

export const AlertMarkers = () => {
    const markers = useRef<(HTMLSpanElement | null)[]>([]);
    const glyphs = useRef<(HTMLSpanElement | null)[]>([]);
    const fills = useRef<(HTMLSpanElement | null)[]>([]);
    const shownKinds = useRef<(AlertMarkerKind | null)[]>([]);
    const appliedTransforms = useRef<string[]>([]);
    const appliedFills = useRef<number[]>([]);
    const previousActiveCount = useRef(0);

    useAnimationFrame(({ hud: { frame } }) => {
        const scanCount = Math.max(frame.activeAlertMarkers, previousActiveCount.current);
        previousActiveCount.current = frame.activeAlertMarkers;
        for (let index = 0; index < scanCount; index += 1) {
            const marker = frame.alertMarkers[index];
            const element = markers.current[index];
            if (!marker || !element) continue;

            const kind = marker.active ? marker.kind : null;
            if (shownKinds.current[index] !== kind) {
                shownKinds.current[index] = kind;
                element.dataset.kind = kind ?? "hidden";
                const glyph = glyphs.current[index];
                if (glyph && kind) glyph.textContent = GLYPHS[kind];
            }
            if (!kind) continue;

            const transform = screenAnchorTransform(marker.screenX, marker.screenY, "-50%, -100%");
            if (appliedTransforms.current[index] !== transform) {
                appliedTransforms.current[index] = transform;
                element.style.transform = transform;
            }

            const fill = roundForStyle(marker.fill);
            if (appliedFills.current[index] !== fill) {
                appliedFills.current[index] = fill;
                const fillElement = fills.current[index];
                if (fillElement) fillElement.style.transform = `scaleY(${fill})`;
            }
        }
    });

    return (
        <div className="alert-markers">
            {Array.from({ length: HUD.alertMarkerPool }, (_, index) => (
                <span
                    className="alert-marker"
                    data-kind="hidden"
                    key={index}
                    ref={(element) => {
                        markers.current[index] = element;
                    }}
                >
                    <span
                        className="alert-fill"
                        ref={(element) => {
                            fills.current[index] = element;
                        }}
                    />
                    <span
                        className="alert-glyph"
                        ref={(element) => {
                            glyphs.current[index] = element;
                        }}
                    />
                </span>
            ))}
        </div>
    );
};
