"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/presentation";
import { roundForStyle, vitalFraction } from "@/lib/hud";
import type { CSSProperties } from "react";
import type { IHudVitalDescriptor } from "@/types/hud";
import "./vitalBar.scss";

const GLASS_BLUR: CSSProperties = {
    backdropFilter: "blur(14px) saturate(115%)",
    WebkitBackdropFilter: "blur(14px) saturate(115%)",
};

export const VitalBar = ({ descriptor }: { descriptor: IHudVitalDescriptor }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLDivElement>(null);
    const chaseRef = useRef<HTMLDivElement>(null);
    const readoutRef = useRef<HTMLSpanElement>(null);

    const appliedFraction = useRef(-1);
    const chaseFraction = useRef(-1);
    const appliedCurrent = useRef(-1);
    const appliedIsLow = useRef<boolean | null>(null);

    useAnimationFrame(({ hud: { frame } }, deltaSeconds) => {
        const vital = frame.vitals[descriptor.id];
        const fraction = roundForStyle(vitalFraction(vital));

        if (fraction !== appliedFraction.current) {
            appliedFraction.current = fraction;
            if (fillRef.current) fillRef.current.style.transform = `scaleX(${fraction})`;

            const isLow = fraction <= descriptor.lowFraction;
            if (isLow !== appliedIsLow.current) {
                appliedIsLow.current = isLow;
                if (rootRef.current) rootRef.current.dataset.low = `${isLow}`;
            }
        }

        if (vital.current !== appliedCurrent.current) {
            appliedCurrent.current = vital.current;
            if (readoutRef.current) readoutRef.current.textContent = `${Math.ceil(vital.current)}`;
        }

        if (chaseFraction.current < 0) {
            chaseFraction.current = fraction;
            if (chaseRef.current) chaseRef.current.style.transform = `scaleX(${fraction})`;
        } else if (chaseFraction.current !== fraction) {
            const delta = fraction - chaseFraction.current;
            chaseFraction.current =
                delta > 0 || Math.abs(delta) < HUD.chaseSnapThreshold
                    ? fraction
                    : chaseFraction.current +
                      delta * (1 - Math.exp(-HUD.chaseCatchUpPerSecond * deltaSeconds));

            if (chaseRef.current)
                chaseRef.current.style.transform = `scaleX(${chaseFraction.current})`;
        }
    });

    return (
        <div className="vital-bar" ref={rootRef}>
            <div className="vital-frame" style={GLASS_BLUR}>
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
