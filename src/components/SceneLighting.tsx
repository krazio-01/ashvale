"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight } from "three";
import type { Vector3Tuple } from "three";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import { SCENE_LIGHT_LAYERS } from "@/world/effects/FoliageMaskPass";
import type { IThemeEnvironment } from "@/types/theme";
import { LIGHT } from "@/constants/rendering";
import { useSettings } from "@/settings/SettingsStore";
import { SHADOW_MAP_SIZES } from "@/settings/QualityPresets";

const SceneLighting = ({ environment }: { environment: IThemeEnvironment }) => {
    const { sky, lighting } = environment;
    const { shadows } = useSettings();
    const shadowsEnabled = shadows !== "off";
    const shadowMapResolution = shadowsEnabled ? SHADOW_MAP_SIZES[shadows] : LIGHT.shadowMapSize;
    const shadowTexelSize = (LIGHT.shadowExtent * 2) / shadowMapResolution;
    const keyLightRef = useRef<DirectionalLight>(null);

    // three.js allocates the shadow render target once and ignores later mapSize
    // changes; disposing it forces reallocation, and also releases the depth
    // target when shadows are switched off entirely. The render target isn't an
    // Object3D, so R3F's automatic disposal on unmount doesn't reach it either.
    useEffect(() => {
        const shadow = keyLightRef.current?.shadow;
        if (shadow?.map) {
            shadow.map.dispose();
            shadow.map = null;
        }

        return () => {
            if (shadow?.map) {
                shadow.map.dispose();
                shadow.map = null;
            }
        };
    }, [shadows]);

    const [keyDirection, rimPosition] = useMemo<[Vector3Tuple, Vector3Tuple]>(() => {
        const sunDirection = sunDirectionOf(sky);

        return [
            [sunDirection.x, sunDirection.y, sunDirection.z],
            [
                -sunDirection.x * LIGHT.rimDistance,
                LIGHT.rimElevation * LIGHT.rimDistance,
                -sunDirection.z * LIGHT.rimDistance,
            ],
        ];
    }, [sky]);

    useFrame(({ camera }) => {
        const keyLight = keyLightRef.current;
        if (!keyLight) return;

        const anchorX = Math.round(camera.position.x / shadowTexelSize) * shadowTexelSize;
        const anchorZ = Math.round(camera.position.z / shadowTexelSize) * shadowTexelSize;

        keyLight.position.set(
            anchorX + keyDirection[0] * LIGHT.keyDistance,
            keyDirection[1] * LIGHT.keyDistance,
            anchorZ + keyDirection[2] * LIGHT.keyDistance
        );
        keyLight.target.position.set(anchorX, 0, anchorZ);
        keyLight.target.updateMatrixWorld();
    });

    return (
        <>
            <color attach="background" args={[sky.abyss]} />

            <hemisphereLight
                layers={SCENE_LIGHT_LAYERS}
                args={[lighting.skyFill, lighting.groundFill, lighting.hemisphereIntensity]}
            />

            <directionalLight
                ref={keyLightRef}
                castShadow={shadowsEnabled}
                layers={SCENE_LIGHT_LAYERS}
                color={lighting.keyColor}
                intensity={lighting.keyIntensity}
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
