"use client";
import { INPUT_BINDINGS, keyLabel } from "@/constants/player";
import { useGameStore } from "@/hooks/useGameStore";
import "./actionPrompt.scss";

export const ActionPrompt = () => {
    const prompt = useGameStore((state) => state.hud.prompt);

    return (
        <div className="action-prompt" data-visible={prompt !== null}>
            <span className="prompt-key">
                {prompt ? keyLabel(INPUT_BINDINGS[prompt.action][0]) : ""}
            </span>
            <span className="prompt-label">{prompt?.label ?? ""}</span>
        </div>
    );
};
