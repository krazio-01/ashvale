"use client";
import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
    Bloom,
    BrightnessContrast,
    EffectComposer,
    HueSaturation,
    N8AO,
    SMAA,
    ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Vector2 } from "three";
import type { Texture, WebGLRenderer } from "three";
import OutlinePass from "@/components/OutlinePass";
import AtmospherePass from "@/components/AtmospherePass";
import { FoliageMaskPass } from "@/world/effects/FoliageMaskPass";
import type { IThemeEnvironment } from "@/types/theme";
import { AMBIENT_OCCLUSION, POST_PROCESSING, RENDER } from "@/constants/game";

const FOLIAGE_MASK_RENDER_PRIORITY = 0;

const maskSizeFor = (gl: WebGLRenderer): Vector2 =>
    gl.getDrawingBufferSize(new Vector2()).multiplyScalar(RENDER.foliageMaskScale).floor();

const useFoliageMaskTexture = (): Texture => {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera);
    const canvasSize = useThree((state) => state.size);

    const [pass] = useState(() => {
        const size = maskSizeFor(gl);
        return new FoliageMaskPass(size.x, size.y);
    });

    useEffect(() => {
        const size = maskSizeFor(gl);
        pass.setSize(size.x, size.y);
    }, [gl, pass, canvasSize]);

    useEffect(() => () => pass.dispose(), [pass]);

    useFrame(() => pass.render(gl, scene, camera), FOLIAGE_MASK_RENDER_PRIORITY);

    return pass.renderTarget.texture;
};

const PostProcessing = ({ environment }: { environment: IThemeEnvironment }) => {
    const foliageMask = useFoliageMaskTexture();

    return (
        <EffectComposer multisampling={RENDER.multisampling}>
            <N8AO
                halfRes={AMBIENT_OCCLUSION.halfResolution}
                aoRadius={AMBIENT_OCCLUSION.radius}
                distanceFalloff={AMBIENT_OCCLUSION.distanceFalloff}
                intensity={AMBIENT_OCCLUSION.intensity}
                aoSamples={AMBIENT_OCCLUSION.samples}
                denoiseSamples={AMBIENT_OCCLUSION.denoiseSamples}
                denoiseRadius={AMBIENT_OCCLUSION.denoiseRadius}
            />

            <OutlinePass outlineColor={environment.outlineColor} foliageMask={foliageMask} />

            <AtmospherePass sky={environment.sky} fogDensity={environment.fogDensity} />

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

            <SMAA />
        </EffectComposer>
    );
};

export default PostProcessing;
