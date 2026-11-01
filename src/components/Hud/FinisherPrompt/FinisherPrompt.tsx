"use client";
import { INPUT_BINDINGS } from "@/constants/player";
import { keyLabel } from "@/lib/helpers";
import { useStoreState } from "@/hooks/useStoreState";
import { store } from "@/store/store";
import "./finisherPrompt.scss";

const FINISHER_KEY_LABEL = keyLabel(INPUT_BINDINGS.finisher[0]);

export const FinisherPrompt = () => {
    const label = useStoreState(store, (state) => state.hud.prompt);

    return (
        <div className="finisher-prompt" data-visible={label !== null}>
            <span className="prompt-key">{FINISHER_KEY_LABEL}</span>
            <span className="prompt-label">{label ?? ""}</span>
        </div>
    );
};
