"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { roundForCss, hudWriter } from "@/lib/hud";
import "./targetBar.scss";

export const TargetBar = () => {
    const rootRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);
    const healthRef = useRef<HTMLDivElement>(null);
    const poiseRef = useRef<HTMLDivElement>(null);
    useAnimationFrame(({ hud: { frame } }) => {
        const target = frame.target;

        hudWriter.data(rootRef.current, "visible", target.visible);
        hudWriter.text(labelRef.current, target.label);
        hudWriter.scale(healthRef.current, "X", roundForCss(target.health));
        hudWriter.scale(poiseRef.current, "X", roundForCss(target.poise));
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
