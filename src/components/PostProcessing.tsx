"use client";
import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
    Bloom,
    BrightnessContrast,
    EffectComposer,
    HueSaturation,
    ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Vector2 } from "three";
import type { Texture } from "three";
import OutlinePass from "@/components/OutlinePass";
import { FoliageMaskPass } from "@/world/effects/FoliageMaskPass";
import { POST_PROCESSING, RENDER } from "@/constants/game";

const FOLIAGE_MASK_RENDER_PRIORITY = 0;

const useFoliageMaskTexture = (): Texture => {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera);
    const canvasSize = useThree((state) => state.size);

    const [pass] = useState(() => {
        const bufferSize = gl.getDrawingBufferSize(new Vector2());
        return new FoliageMaskPass(bufferSize.x, bufferSize.y);
    });

    useEffect(() => {
        const bufferSize = gl.getDrawingBufferSize(new Vector2());
        pass.setSize(bufferSize.x, bufferSize.y);
    }, [gl, pass, canvasSize]);

    useEffect(() => () => pass.dispose(), [pass]);

    useFrame(() => pass.render(gl, scene, camera), FOLIAGE_MASK_RENDER_PRIORITY);

    return pass.renderTarget.texture;
};

const PostProcessing = ({ outlineColor }: { outlineColor: string }) => {
    const foliageMask = useFoliageMaskTexture();

    return (
        <EffectComposer enableNormalPass multisampling={RENDER.multisampling}>
            <OutlinePass outlineColor={outlineColor} foliageMask={foliageMask} />

            <Bloom
                mipmapBlur
                intensity={POST_PROCESSING.bloomIntensity}
                luminanceThreshold={POST_PROCESSING.bloomThreshold}
                luminanceSmoothing={POST_PROCESSING.bloomSmoothing}
                radius={POST_PROCESSING.bloomRadius}
            />

            <ToneMapping mode={ToneMappingMode.NEUTRAL} />

            <HueSaturation saturation={POST_PROCESSING.saturationBoost} />

            <BrightnessContrast
                brightness={POST_PROCESSING.brightnessLift}
                contrast={POST_PROCESSING.contrastBoost}
            />
        </EffectComposer>
    );
};

export default PostProcessing;
