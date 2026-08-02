"use client";

import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";

export default function PostProcessing() {
    return (
        <EffectComposer>
            <Bloom
                intensity={1.1}
                luminanceThreshold={0.95}
                luminanceSmoothing={0.25}
                mipmapBlur
            />
            <Vignette darkness={0.35} offset={0.4} />
        </EffectComposer>
    );
}
