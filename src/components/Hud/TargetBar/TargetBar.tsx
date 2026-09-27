"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { roundForStyle } from "@/lib/hud";
import "./targetBar.scss";

export const TargetBar = () => {
    const rootRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);
    const healthRef = useRef<HTMLDivElement>(null);
    const poiseRef = useRef<HTMLDivElement>(null);
    const applied = useRef({ visible: false, label: "", health: -1, poise: -1 });

    useAnimationFrame(({ hud: { frame } }) => {
        const target = frame.target;
        const current = applied.current;

        if (target.visible !== current.visible) {
            current.visible = target.visible;
            if (rootRef.current) rootRef.current.dataset.visible = `${target.visible}`;
        }

        if (target.label !== current.label) {
            current.label = target.label;
            if (labelRef.current) labelRef.current.textContent = target.label;
        }

        const health = roundForStyle(target.health);
        if (health !== current.health) {
            current.health = health;
            if (healthRef.current) healthRef.current.style.transform = `scaleX(${health})`;
        }

        const poise = roundForStyle(target.poise);
        if (poise !== current.poise) {
            current.poise = poise;
            if (poiseRef.current) poiseRef.current.style.transform = `scaleX(${poise})`;
        }
    });

    return (
        <div className="target-bar" ref={rootRef}>
            <span className="target-name" ref={labelRef} />
            <div className="health-frame">
                <div className="health-track">
                    <div className="health-fill" ref={healthRef} />
                </div>
            </div>
            <div className="poise-frame">
                <div className="poise-track">
                    <div className="poise-fill" ref={poiseRef} />
                </div>
            </div>
        </div>
    );
};
