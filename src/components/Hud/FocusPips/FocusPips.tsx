"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { PLAYER_VITALS } from "@/constants/player";
import { roundForCss, hudWriter } from "@/lib/hud";
import "./focusPips.scss";
import { clamp } from "@/lib/helpers";

export const FocusPips = () => {
    const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);

    useAnimationFrame(({ hud: { frame } }) => {
        for (let index = 0; index < PLAYER_VITALS.maxFocus; index += 1) {
            const fill = clamp(frame.meters.focus.current - index, 0, 1);
            hudWriter.scale(fillRefs.current[index], "Y", roundForCss(fill));
        }
    });

    return (
        <div className="focus-pips">
            {Array.from({ length: PLAYER_VITALS.maxFocus }, (_, index) => (
                <span className="focus-pip" key={index}>
                    <span
                        className="focus-charge"
                        ref={(element) => {
                            fillRefs.current[index] = element;
                        }}
                    />
                </span>
            ))}
        </div>
    );
};
