"use client";
import { useStore } from "@/hooks/useStore";
import { VitalBar } from "@/components/Hud/VitalBar/VitalBar";
import { AlertMarkers } from "@/components/Hud/AlertMarkers/AlertMarkers";
import { DamageVignette } from "@/components/Hud/DamageVignette/DamageVignette";
import { DamageNumbers } from "@/components/Hud/DamageNumbers/DamageNumbers";
import { FinisherPrompt } from "@/components/Hud/FinisherPrompt/FinisherPrompt";
import { FocusPips } from "@/components/Hud/FocusPips/FocusPips";
import { TargetBar } from "@/components/Hud/TargetBar/TargetBar";
import { HUD_VITALS } from "@/constants/presentation";
import "./hud.scss";

export const Hud = () => {
    const isPlayerAlive = useStore((state) => state.hud.isPlayerAlive);

    return (
        <div className="hud" data-dead={!isPlayerAlive}>
            <DamageVignette />
            <DamageNumbers />
            <AlertMarkers />
            <TargetBar />
            <FinisherPrompt />
            <div className="hud-vitals">
                {HUD_VITALS.map((descriptor) => (
                    <VitalBar key={descriptor.id} descriptor={descriptor} />
                ))}
                <FocusPips />
            </div>
        </div>
    );
};
