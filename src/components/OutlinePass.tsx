"use client";
import { forwardRef, useContext, useMemo } from "react";
import { EffectComposerContext } from "@react-three/postprocessing";
import { OutlineEffect } from "@/world/effects/OutlineEffect";

const OutlinePass = forwardRef<OutlineEffect>((_, ref) => {
    const composerContext = useContext(EffectComposerContext);
    const normalBuffer = composerContext?.normalPass?.texture ?? null;

    const effect = useMemo(() => new OutlineEffect({ normalBuffer }), [normalBuffer]);

    return <primitive ref={ref} object={effect} dispose={null} />;
});

OutlinePass.displayName = "OutlinePass";

export default OutlinePass;
