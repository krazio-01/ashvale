"use client";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
    Bloom,
    BrightnessContrast,
    EffectComposer,
    HueSaturation,
    SMAA,
    ToneMapping,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Vector2 } from "three";
import type { Texture, WebGLRenderer } from "three";
import {
    AtmosphereEffect,
    OutlineEffect,
    FoliageMaskPass,
} from "@/world/postProcessing/PostProcessPasses";
import type { IThemeEnvironment } from "@/types/world";
import { POST_PROCESSING, RENDER } from "@/constants/world";
import { useStoreState } from "@/hooks/useStoreState";
import { store } from "@/store/store";
import { FOLIAGE_OUTLINE_MASK_SCALES } from "@/constants/ui";

const FOLIAGE_MASK_RENDER_PRIORITY = 0;

const MINIMUM_MASK_SCALE = 0.1;

const maskSizeFor = (gl: WebGLRenderer, scale: number): Vector2 =>
    gl
        .getDrawingBufferSize(new Vector2())
        .multiplyScalar(Math.max(scale, MINIMUM_MASK_SCALE))
        .floor();

const useFoliageMaskTexture = (enabled: boolean, scale: number): Texture => {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera);
    const canvasSize = useThree((state) => state.size);

    const [pass] = useState(() => {
        const size = maskSizeFor(gl, scale);
        return new FoliageMaskPass(size.x, size.y);
    });

    useEffect(() => {
        if (!enabled) return;
        const size = maskSizeFor(gl, scale);
        pass.setSize(size.x, size.y);
    }, [gl, pass, canvasSize, enabled, scale]);

    useEffect(() => () => pass.dispose(), [pass]);

    useFrame(() => {
        if (!enabled) return;
        pass.render(gl, scene, camera);
    }, FOLIAGE_MASK_RENDER_PRIORITY);

    return pass.renderTarget.texture;
};

const PostProcessing = ({ environment }: { environment: IThemeEnvironment }) => {
    const {
        bloom,
        antiAliasing,
        outlines,
        atmosphere: atmosphereEnabled,
    } = useStoreState(store, (state) => state.settings.values);
    const camera = useThree((state) => state.camera);

    const foliageMaskScale = FOLIAGE_OUTLINE_MASK_SCALES[outlines];
    const foliageMaskEnabled = foliageMaskScale > 0;
    const foliageMask = useFoliageMaskTexture(foliageMaskEnabled, foliageMaskScale);

    const outline = useMemo(
        () => new OutlineEffect({ camera, foliageMask, outlineColor: environment.outlineColor }),
        [camera, foliageMask, environment.outlineColor]
    );

    const atmosphere = useMemo(
        () =>
            new AtmosphereEffect({
                camera,
                sky: environment.sky,
                fogDensity: environment.fogDensity,
            }),
        [camera, environment.sky, environment.fogDensity]
    );

    useEffect(() => () => outline.dispose(), [outline]);
    useEffect(() => () => atmosphere.dispose(), [atmosphere]);

    const effects: ReactElement[] = [];

    if (outlines !== "off") {
        effects.push(<primitive key="outline" object={outline} dispose={null} />);
    }

    if (atmosphereEnabled) {
        effects.push(<primitive key="atmosphere" object={atmosphere} dispose={null} />);
    }

    if (bloom) {
        effects.push(
            <Bloom
                key="bloom"
                mipmapBlur
                intensity={POST_PROCESSING.bloomIntensity}
                luminanceThreshold={POST_PROCESSING.bloomThreshold}
                luminanceSmoothing={POST_PROCESSING.bloomSmoothing}
                radius={POST_PROCESSING.bloomRadius}
            />
        );
    }

    effects.push(<ToneMapping key="tonemapping" mode={ToneMappingMode.NEUTRAL} />);
    effects.push(<HueSaturation key="huesat" saturation={POST_PROCESSING.saturationBoost} />);
    effects.push(
        <BrightnessContrast
            key="brightcontrast"
            brightness={POST_PROCESSING.brightnessLift}
            contrast={POST_PROCESSING.contrastBoost}
        />
    );

    if (antiAliasing === "smaa") {
        effects.push(<SMAA key="smaa" />);
    }

    return <EffectComposer multisampling={RENDER.multisampling}>{effects}</EffectComposer>;
};

export default PostProcessing;
