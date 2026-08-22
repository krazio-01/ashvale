"use client";
import { forwardRef, useContext, useMemo } from "react";
import type { Texture } from "three";
import { EffectComposerContext } from "@react-three/postprocessing";
import { OutlineEffect } from "@/world/effects/OutlineEffect";

interface IOutlinePassProps {
    outlineColor: string;
    foliageMask: Texture;
}

const OutlinePass = forwardRef<OutlineEffect, IOutlinePassProps>(
    ({ outlineColor, foliageMask }, ref) => {
        const composerContext = useContext(EffectComposerContext);
        const normalBuffer = composerContext?.normalPass?.texture ?? null;

        const effect = useMemo(
            () => new OutlineEffect({ normalBuffer, foliageMask, outlineColor }),
            [normalBuffer, foliageMask, outlineColor]
        );

        return <primitive ref={ref} object={effect} dispose={null} />;
    }
);

OutlinePass.displayName = "OutlinePass";

export default OutlinePass;
