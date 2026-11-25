"use client";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import type { CanvasProps } from "@react-three/fiber";
import { NoToneMapping } from "three";
import { STYLE } from "@/constants/world";
import type { IThemeEnvironment } from "@/types/themes";
import { useRenderPixelRatio } from "@/hooks/useRenderPixelRatio";
import { FrameLimiter } from "@/components/FrameLimiter/FrameLimiter";
import { FrameRateMeter } from "@/components/FrameRateMeter/FrameRateMeter";
import SkyDome from "@/components/SkyDome/SkyDome";
import SceneLighting from "@/components/SceneLighting/SceneLighting";
import PostProcessing from "@/components/PostProcessing/PostProcessing";
import PerformanceOverlay from "@/components/PerformanceOverlay/PerformanceOverlay";

const RENDERER_OPTIONS: CanvasProps["gl"] = {
    antialias: false,
    toneMapping: NoToneMapping,
    toneMappingExposure: STYLE.toneMappingExposure,
};

interface IRenderCanvasProps {
    environment: IThemeEnvironment;
    camera: CanvasProps["camera"];
    rendersOnlyWhilePlaying?: boolean;
    children: ReactNode;
}

export function RenderCanvas({
    environment,
    camera,
    rendersOnlyWhilePlaying = false,
    children,
}: IRenderCanvasProps) {
    const pixelRatio = useRenderPixelRatio();

    return (
        <>
            <Canvas
                shadows="percentage"
                frameloop="never"
                dpr={pixelRatio}
                camera={camera}
                gl={RENDERER_OPTIONS}
            >
                <FrameLimiter rendersOnlyWhilePlaying={rendersOnlyWhilePlaying} />
                <SkyDome environment={environment} />
                <SceneLighting environment={environment} />
                {children}
                <PostProcessing />
                <PerformanceOverlay />
            </Canvas>
            <FrameRateMeter rendersOnlyWhilePlaying={rendersOnlyWhilePlaying} />
        </>
    );
}
