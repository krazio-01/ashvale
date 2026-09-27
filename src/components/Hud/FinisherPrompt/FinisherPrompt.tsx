"use client";
import { INPUT_BINDINGS, keyLabel } from "@/constants/player";
import { useStore } from "@/hooks/useStore";
import "./finisherPrompt.scss";

const FINISHER_KEY_LABEL = keyLabel(INPUT_BINDINGS.finisher[0]);

export const FinisherPrompt = () => {
    const label = useStore((state) => state.hud.prompt);

    return (
        <div className="finisher-prompt" data-visible={label !== null}>
            <span className="prompt-key">{FINISHER_KEY_LABEL}</span>
            <span className="prompt-label">{label ?? ""}</span>
        </div>
    );
};
