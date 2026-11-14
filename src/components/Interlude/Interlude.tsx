"use client";
import { InlineLoader } from "generative-loaders";
import { INTERLUDE_TEXT } from "@/constants/strings";
import type { SessionPhase } from "@/types/store";
import "./interlude.scss";

const HINT_BY_PHASE: Partial<Record<SessionPhase, string>> = {
    ready: INTERLUDE_TEXT.continueHint,
    ended: INTERLUDE_TEXT.returnHint,
};

interface IInterludeProps {
    title: string;
    paragraphs: readonly string[];
    stageLabel: string | null;
    phase: SessionPhase;
    onContinue: () => void;
}

export const Interlude = ({
    title,
    paragraphs,
    stageLabel,
    phase,
    onContinue,
}: IInterludeProps) => {
    const hint = HINT_BY_PHASE[phase];

    return (
        <div
            className={hint ? "interlude interlude-waiting" : "interlude"}
            onClick={hint ? onContinue : undefined}
        >
            <h2 className="interlude-title">{title}</h2>
            {paragraphs.map((paragraph, index) => (
                <p key={index} className="interlude-paragraph">
                    {paragraph}
                </p>
            ))}
            {!hint && (
                <div className="interlude-stage">
                    <InlineLoader variant="matrix" size={24} color="#fff" />
                    <span>{stageLabel}</span>
                </div>
            )}
            {hint && <p className="interlude-hint">{hint}</p>}
        </div>
    );
};
