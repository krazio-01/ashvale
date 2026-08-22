"use client";
import { forwardRef, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { AtmosphereEffect } from "@/world/effects/AtmosphereEffect";
import type { ISkyGradient } from "@/types/theme";

interface IAtmospherePassProps {
    sky: ISkyGradient;
    fogDensity: number;
}

const AtmospherePass = forwardRef<AtmosphereEffect, IAtmospherePassProps>(
    ({ sky, fogDensity }, ref) => {
        const camera = useThree((state) => state.camera);

        const effect = useMemo(
            () => new AtmosphereEffect({ camera, sky, fogDensity }),
            [camera, sky, fogDensity]
        );

        return <primitive ref={ref} object={effect} dispose={null} />;
    }
);

AtmospherePass.displayName = "AtmospherePass";

export default AtmospherePass;
