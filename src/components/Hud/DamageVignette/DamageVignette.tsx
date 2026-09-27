"use client";
import { useEffect, useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/presentation";
import { roundForStyle, vitalFraction } from "@/lib/hud";
import "./damageVignette.scss";

export const DamageVignette = () => {
    const vignetteRef = useRef<HTMLDivElement>(null);
    const previousFraction = useRef(-1);
    const intensity = useRef(0);
    const appliedOpacity = useRef(-1);
    const prefersReducedMotion = useRef(false);

    useEffect(() => {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const syncPreference = () => {
            prefersReducedMotion.current = query.matches;
        };
        syncPreference();
        query.addEventListener("change", syncPreference);
        return () => query.removeEventListener("change", syncPreference);
    }, []);

    useAnimationFrame(({ hud: { frame } }, deltaSeconds) => {
        const vital = frame.vitals.health;
        const fraction = vitalFraction(vital);

        if (previousFraction.current < 0) previousFraction.current = fraction;

        const lost = previousFraction.current - fraction;
        previousFraction.current = fraction;

        if (prefersReducedMotion.current) intensity.current = 0;
        else if (lost > 0)
            intensity.current = Math.min(1, intensity.current + lost * HUD.vignetteHitGain);
        else intensity.current *= Math.exp(-HUD.vignetteDecayPerSecond * deltaSeconds);

        const lowPressure =
            vital.maximum > 0 && fraction < HUD.vignetteLowFraction
                ? (HUD.vignetteLowFraction - fraction) / HUD.vignetteLowFraction
                : 0;

        const opacity = Math.min(1, intensity.current + lowPressure * HUD.vignetteLowStrength);
        const rounded = roundForStyle(opacity);

        if (rounded !== appliedOpacity.current) {
            appliedOpacity.current = rounded;
            if (vignetteRef.current) vignetteRef.current.style.opacity = `${rounded}`;
        }
    });

    return <div className="damage-vignette" ref={vignetteRef} />;
};
