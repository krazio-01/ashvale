"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/presentation";
import { roundForStyle, screenAnchorTransform } from "@/lib/hud";
import "./damageNumbers.scss";

export const DamageNumbers = () => {
    const elements = useRef<(HTMLSpanElement | null)[]>([]);
    const serials = useRef<number[]>([]);
    const visible = useRef<boolean[]>([]);
    const visibleCount = useRef(0);

    useAnimationFrame(({ hud: { frame } }) => {
        if (frame.activeDamageNumbers === 0 && visibleCount.current === 0) return;

        const numbers = frame.damageNumbers;
        for (let index = 0; index < numbers.length; index += 1) {
            const number = numbers[index];
            const element = elements.current[index];
            if (!number || !element) continue;

            if (!number.active || !number.onScreen) {
                if (visible.current[index]) {
                    visible.current[index] = false;
                    visibleCount.current -= 1;
                    element.style.opacity = "0";
                }
                continue;
            }

            if (!visible.current[index]) {
                visible.current[index] = true;
                visibleCount.current += 1;
            }

            if (serials.current[index] !== number.serial) {
                serials.current[index] = number.serial;
                element.textContent = `${number.value}`;
                element.dataset.emphasis = `${number.emphasis}`;
            }

            const fade = 1 - number.age / HUD.damageNumberSeconds;
            element.style.opacity = `${roundForStyle(Math.max(0, fade))}`;
            element.style.transform = screenAnchorTransform(
                number.screenX,
                number.screenY,
                "-50%, -50%"
            );
        }
    });

    return (
        <div className="damage-numbers">
            {Array.from({ length: HUD.damageNumberPool }, (_, index) => (
                <span
                    className="damage-number"
                    key={index}
                    ref={(element) => {
                        elements.current[index] = element;
                    }}
                />
            ))}
        </div>
    );
};
