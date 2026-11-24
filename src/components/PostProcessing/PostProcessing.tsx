"use client";
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { Bloom, EffectComposer, SMAA, ToneMapping } from "@react-three/postprocessing";
import { EffectPass, ToneMappingMode } from "postprocessing";
import type { EffectComposer as PostEffectComposer } from "postprocessing";
import { createColourEffects } from "@/world/postProcessing/PostProcessPasses";
import { STYLE } from "@/constants/world";
import { ANTI_ALIASING_MODES } from "@/constants/ui";
import { useGameStore } from "@/hooks/useGameStore";

const TONE_MAPPING_MODE = ToneMappingMode.NEUTRAL;

const PostProcessing = () => {
    const bloom = useGameStore((state) => state.settings.values.bloom);
    const antiAliasing = useGameStore((state) => state.settings.values.antiAliasing);
    const colour = useMemo(() => createColourEffects(), []);
    const composer = useRef<PostEffectComposer>(null);

    useEffect(
        () => () => {
            for (const effect of Object.values(colour)) effect.dispose();
        },
        [colour]
    );

    const effects = useMemo(() => {
        const list: ReactElement[] = [];
        if (bloom)
            list.push(
                <Bloom
                    key="bloom"
                    mipmapBlur
                    intensity={STYLE.bloom.intensity}
                    luminanceThreshold={STYLE.bloom.threshold}
                    luminanceSmoothing={STYLE.bloom.smoothing}
                    radius={STYLE.bloom.radius}
                />
            );
        list.push(<primitive key="grade" object={colour.grade} dispose={null} />);
        list.push(<ToneMapping key="tonemapping" mode={TONE_MAPPING_MODE} />);
        list.push(<primitive key="punch" object={colour.punch} dispose={null} />);
        if (ANTI_ALIASING_MODES[antiAliasing].smaa) list.push(<SMAA key="smaa" />);
        return list;
    }, [bloom, antiAliasing, colour]);

    useEffect(() => {
        const effectPasses = (composer.current?.passes ?? []).filter(
            (pass): pass is EffectPass => pass instanceof EffectPass
        );
        for (const pass of effectPasses) pass.dithering = pass === effectPasses.at(-1);
    }, [effects]);

    return (
        <EffectComposer ref={composer} multisampling={ANTI_ALIASING_MODES[antiAliasing].samples}>
            {effects}
        </EffectComposer>
    );
};

export default memo(PostProcessing);
