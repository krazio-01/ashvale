"use client";
import { useGameStore } from "@/hooks/useGameStore";
import { VitalBar } from "@/components/Hud/VitalBar/VitalBar";
import { AlertMarkers } from "@/components/Hud/AlertMarkers/AlertMarkers";
import { DamageVignette } from "@/components/Hud/DamageVignette/DamageVignette";
import { DamageNumbers } from "@/components/Hud/DamageNumbers/DamageNumbers";
import { ActionPrompt } from "@/components/Hud/ActionPrompt/ActionPrompt";
import { LoreReader } from "@/components/Hud/LoreReader/LoreReader";
import { FocusPips } from "@/components/Hud/FocusPips/FocusPips";
import { TargetBar } from "@/components/Hud/TargetBar/TargetBar";
import { HUD_VITALS } from "@/constants/ui";
import "./hud.scss";

export const Hud = () => {
    const isPlayerAlive = useGameStore((state) => state.hud.isPlayerAlive);
    const isFadedOut = useGameStore((state) => state.hud.isFadedOut);

    return (
        <>
            <div className="screen-fade" data-shown={isFadedOut} />
            <div className="hud" data-dead={!isPlayerAlive}>
                <DamageVignette />
                <DamageNumbers />
                <AlertMarkers />
                <TargetBar />
                <ActionPrompt />
                <LoreReader />
                <div className="hud-vitals">
                    {HUD_VITALS.map((descriptor) => (
                        <VitalBar key={descriptor.id} descriptor={descriptor} />
                    ))}
                    <FocusPips />
                </div>
            </div>
        </>
    );
};
