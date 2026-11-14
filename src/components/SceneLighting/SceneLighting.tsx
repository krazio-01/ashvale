"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight, Vector3Tuple } from "three";
import { sunDirectionFromSky } from "@/themes/Themes";
import type { IThemeEnvironment } from "@/types/themes";
import { LIGHT } from "@/constants/world";
import { useGameStore } from "@/hooks/useGameStore";
import { SHADOW_MAP_SIZES } from "@/constants/ui";
import { worldTierOf } from "@/store/settingsSlice";

const SceneLighting = ({ environment }: { environment: IThemeEnvironment }) => {
    const { sky, lighting } = environment;
    const settings = useGameStore((state) => state.settings.values);
    const { shadows } = settings;
    const { shadowRange } = worldTierOf(settings);
    const shadowsEnabled = shadows !== "off";
    const shadowMapResolution = shadowsEnabled ? SHADOW_MAP_SIZES[shadows] : LIGHT.shadowMapSize;
    const shadowTexelSize = (shadowRange * 2) / shadowMapResolution;
    const keyLightRef = useRef<DirectionalLight>(null);

    useEffect(() => {
        const shadow = keyLightRef.current?.shadow;
        shadow?.camera.updateProjectionMatrix();
        return () => {
            if (shadow?.map) {
                shadow.map.dispose();
                shadow.map = null;
            }
        };
    }, [shadows, shadowRange]);

    const [keyDirection, rimPosition] = useMemo<[Vector3Tuple, Vector3Tuple]>(() => {
        const sunDirection = sunDirectionFromSky(sky);

        return [
            [sunDirection.x, sunDirection.y, sunDirection.z],
            [
                -sunDirection.x * LIGHT.backLightDistance,
                LIGHT.rimElevation * LIGHT.backLightDistance,
                -sunDirection.z * LIGHT.backLightDistance,
            ],
        ];
    }, [sky]);

    useFrame(({ camera }) => {
        const keyLight = keyLightRef.current;
        if (!keyLight) return;

        const anchorX = Math.round(camera.position.x / shadowTexelSize) * shadowTexelSize;
        const anchorZ = Math.round(camera.position.z / shadowTexelSize) * shadowTexelSize;

        keyLight.position.set(
            anchorX + keyDirection[0] * LIGHT.sunLightDistance,
            keyDirection[1] * LIGHT.sunLightDistance,
            anchorZ + keyDirection[2] * LIGHT.sunLightDistance
        );
        keyLight.target.position.set(anchorX, 0, anchorZ);
        keyLight.target.updateMatrixWorld();
    });

    return (
        <>
            <color attach="background" args={[sky.belowHorizonColor]} />

            <hemisphereLight
                args={[
                    lighting.hemisphereSkyColor,
                    lighting.hemisphereGroundColor,
                    lighting.hemisphereIntensity,
                ]}
            />

            <directionalLight
                ref={keyLightRef}
                castShadow={shadowsEnabled}
                color={lighting.sunLightColor}
                intensity={lighting.sunLightIntensity}
                shadow-bias={LIGHT.shadowBias}
                shadow-normalBias={LIGHT.shadowNormalBias}
                shadow-radius={LIGHT.shadowRadius}
                shadow-mapSize-width={shadowMapResolution}
                shadow-mapSize-height={shadowMapResolution}
                shadow-camera-left={-shadowRange}
                shadow-camera-right={shadowRange}
                shadow-camera-top={shadowRange}
                shadow-camera-bottom={-shadowRange}
                shadow-camera-far={LIGHT.shadowFar}
            />

            {lighting.rim && (
                <directionalLight
                    color={lighting.rim.color}
                    intensity={lighting.rim.intensity}
                    position={rimPosition}
                />
            )}
        </>
    );
};

export default SceneLighting;
