"use client";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import type { CanvasProps } from "@react-three/fiber";
import { NoToneMapping } from "three";
import { POST_PROCESSING } from "@/constants/world";
import type { IThemeEnvironment } from "@/types/world";
import { useRenderPixelRatio } from "@/hooks/useRenderPixelRatio";
import { FrameLimiter } from "@/components/FrameLimiter/FrameLimiter";
import { FrameRateMeter } from "@/components/FrameRateMeter/FrameRateMeter";
import SkyDome from "@/components/SkyDome";
import SceneLighting from "@/components/SceneLighting";
import PostProcessing from "@/components/PostProcessing/PostProcessing";
import PerformanceOverlay from "@/components/PerformanceOverlay";

interface IRenderCanvasProps {
    environment: IThemeEnvironment;
    camera: CanvasProps["camera"];
    children: ReactNode;
}

export function RenderCanvas({ environment, camera, children }: IRenderCanvasProps) {
    const pixelRatio = useRenderPixelRatio();

    return (
        <>
            <Canvas
                shadows="percentage"
                frameloop="never"
                dpr={pixelRatio}
                camera={camera}
                gl={{
                    antialias: false,
                    toneMapping: NoToneMapping,
                    toneMappingExposure: POST_PROCESSING.exposure,
                }}
            >
                <FrameLimiter />
                <SkyDome environment={environment} />
                <SceneLighting environment={environment} />
                {children}
                <PostProcessing environment={environment} />
                <PerformanceOverlay />
            </Canvas>
            <FrameRateMeter />
        </>
    );
}
