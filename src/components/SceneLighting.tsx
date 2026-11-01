"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight, Vector3Tuple } from "three";
import { sunDirectionFromSky } from "@/themes/Themes";
import { SCENE_LIGHT_LAYERS } from "@/world/postProcessing/PostProcessPasses";
import type { IThemeEnvironment } from "@/types/world";
import { LIGHT } from "@/constants/world";
import { useStoreState } from "@/hooks/useStoreState";
import { store } from "@/store/store";
import { SHADOW_MAP_SIZES } from "@/constants/ui";

const SceneLighting = ({ environment }: { environment: IThemeEnvironment }) => {
    const { sky, lighting } = environment;
    const { shadows } = useStoreState(store, (state) => state.settings.values);
    const shadowsEnabled = shadows !== "off";
    const shadowMapResolution = shadowsEnabled ? SHADOW_MAP_SIZES[shadows] : LIGHT.shadowMapSize;
    const shadowTexelSize = (LIGHT.shadowExtent * 2) / shadowMapResolution;
    const keyLightRef = useRef<DirectionalLight>(null);

    useEffect(() => {
        const shadow = keyLightRef.current?.shadow;
        return () => {
            if (shadow?.map) {
                shadow.map.dispose();
                shadow.map = null;
            }
        };
    }, [shadows]);

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
                layers={SCENE_LIGHT_LAYERS}
                args={[
                    lighting.hemisphereSkyColor,
                    lighting.hemisphereGroundColor,
                    lighting.hemisphereIntensity,
                ]}
            />

            <directionalLight
                ref={keyLightRef}
                castShadow={shadowsEnabled}
                layers={SCENE_LIGHT_LAYERS}
                color={lighting.sunLightColor}
                intensity={lighting.sunLightIntensity}
                shadow-bias={LIGHT.shadowBias}
                shadow-mapSize-width={shadowMapResolution}
                shadow-mapSize-height={shadowMapResolution}
                shadow-camera-left={-LIGHT.shadowExtent}
                shadow-camera-right={LIGHT.shadowExtent}
                shadow-camera-top={LIGHT.shadowExtent}
                shadow-camera-bottom={-LIGHT.shadowExtent}
                shadow-camera-far={LIGHT.shadowFar}
            />

            <directionalLight
                layers={SCENE_LIGHT_LAYERS}
                color={lighting.rimColor}
                intensity={lighting.rimIntensity}
                position={rimPosition}
            />
        </>
    );
};

export default SceneLighting;
