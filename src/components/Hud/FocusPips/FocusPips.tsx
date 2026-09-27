"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { PLAYER_VITALS } from "@/constants/player";
import { roundForStyle } from "@/lib/hud";
import "./focusPips.scss";

export const FocusPips = () => {
    const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const applied = useRef<number[]>([]);

    useAnimationFrame(({ hud: { frame } }) => {
        for (let index = 0; index < PLAYER_VITALS.maxFocus; index += 1) {
            const fill = Math.min(1, Math.max(0, frame.focus.current - index));
            const rounded = roundForStyle(fill);
            if (applied.current[index] === rounded) continue;

            applied.current[index] = rounded;
            const element = fillRefs.current[index];
            if (element) element.style.transform = `scaleY(${rounded})`;
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
