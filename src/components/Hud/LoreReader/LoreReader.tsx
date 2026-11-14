"use client";
import { useGameStore } from "@/hooks/useGameStore";
import { LORE_TEXT } from "@/constants/strings";
import "./loreReader.scss";

export const LoreReader = () => {
    const entry = useGameStore((state) => state.hud.reading);

    return (
        <section className="lore-reader" data-visible={entry !== null} aria-live="polite">
            {entry && (
                <>
                    <h2 className="lore-title">{entry.title}</h2>
                    {entry.lines.map((line, index) => (
                        <p key={index} className="lore-line">
                            {line}
                        </p>
                    ))}
                    <span className="lore-dismiss">{LORE_TEXT.dismiss}</span>
                </>
            )}
        </section>
    );
};
