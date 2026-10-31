"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/ui";
import { roundForCss, screenPositionTransform, hudWriter } from "@/lib/hud";
import type { AlertMarkerKind } from "@/types/ui";
import "./alertMarkers.scss";

const GLYPHS: Record<AlertMarkerKind, string> = { suspicious: "?", alert: "!" };

export const AlertMarkers = () => {
    const markers = useRef<(HTMLSpanElement | null)[]>([]);
    const glyphs = useRef<(HTMLSpanElement | null)[]>([]);
    const fills = useRef<(HTMLSpanElement | null)[]>([]);
    const previousActiveCount = useRef(0);

    useAnimationFrame(({ hud: { frame } }) => {
        const scanCount = Math.max(frame.activeAlertMarkers, previousActiveCount.current);
        previousActiveCount.current = frame.activeAlertMarkers;
        for (let index = 0; index < scanCount; index += 1) {
            const marker = frame.alertMarkers[index];
            const element = markers.current[index];
            if (!element) continue;

            const kind = marker.active ? marker.kind : null;
            hudWriter.data(element, "kind", kind ?? "hidden");
            if (!kind) continue;

            hudWriter.text(glyphs.current[index], GLYPHS[kind]);
            hudWriter.transform(
                element,
                screenPositionTransform(marker.screenX, marker.screenY, "-50%, -100%")
            );
            hudWriter.scale(fills.current[index], "Y", roundForCss(marker.fill));
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
