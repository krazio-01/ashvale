"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/ui";
import { roundForCss, meterFillRatio, hudWriter } from "@/lib/hud";
import type { IHudVitalDescriptor } from "@/types/ui";
import { smoothingFactor } from "@/lib/helpers";
import "./vitalBar.scss";

export const VitalBar = ({ descriptor }: { descriptor: IHudVitalDescriptor }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLDivElement>(null);
    const chaseRef = useRef<HTMLDivElement>(null);
    const readoutRef = useRef<HTMLSpanElement>(null);

    const chaseFraction = useRef(-1);

    useAnimationFrame(({ hud: { frame } }, deltaSeconds) => {
        const vital = frame.meters[descriptor.id];
        const fraction = roundForCss(meterFillRatio(vital));

        hudWriter.scale(fillRef.current, "X", fraction);
        hudWriter.data(rootRef.current, "low", fraction <= descriptor.lowFraction);
        hudWriter.text(readoutRef.current, Math.ceil(vital.current));

        if (chaseFraction.current < 0) {
            chaseFraction.current = fraction;
        } else if (chaseFraction.current !== fraction) {
            const delta = fraction - chaseFraction.current;
            chaseFraction.current =
                delta > 0 || Math.abs(delta) < HUD.chaseSnapThreshold
                    ? fraction
                    : chaseFraction.current +
                      delta * smoothingFactor(HUD.chaseCatchUpPerSecond, deltaSeconds);
        }
        hudWriter.scale(chaseRef.current, "X", chaseFraction.current);
    });

    return (
        <div className="vital-bar" ref={rootRef}>
            <div className="vital-frame">
                <div className="vital-track">
                    <div className="vital-chase" ref={chaseRef} />
                    <div className="vital-fill" ref={fillRef} />
                </div>
            </div>
            <div className="vital-details">
                <span className="vital-label">{descriptor.label}</span>
                <span className="vital-readout" ref={readoutRef} />
            </div>
        </div>
    );
};
