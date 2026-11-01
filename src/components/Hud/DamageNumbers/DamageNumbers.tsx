"use client";
import { useRef } from "react";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { HUD } from "@/constants/ui";
import { roundForCss, screenPositionTransform, hudWriter } from "@/lib/hud";
import "./damageNumbers.scss";

export const DamageNumbers = () => {
    const elements = useRef<(HTMLSpanElement | null)[]>([]);
    const previousActiveCount = useRef(0);

    useAnimationFrame(({ hud: { frame } }) => {
        if (frame.activeDamageNumbers === 0 && previousActiveCount.current === 0) return;
        previousActiveCount.current = frame.activeDamageNumbers;

        const numbers = frame.damageNumbers;
        for (let index = 0; index < numbers.length; index += 1) {
            const number = numbers[index];
            const element = elements.current[index];
            if (!element) continue;

            const isShown = number.active && number.onScreen;
            const fade = 1 - number.age / HUD.damageNumberSeconds;
            hudWriter.opacity(element, isShown ? roundForCss(Math.max(0, fade)) : 0);
            if (!isShown) continue;

            hudWriter.text(element, number.value);
            hudWriter.data(element, "emphasis", number.emphasis);
            hudWriter.transform(
                element,
                screenPositionTransform(number.screenX, number.screenY, "-50%, -50%")
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
