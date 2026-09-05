"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight } from "three";
import type { Vector3Tuple } from "three";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import { SCENE_LIGHT_LAYERS } from "@/world/effects/FoliageMaskPass";
import type { IThemeEnvironment } from "@/types/theme";
import { LIGHT } from "@/constants/rendering";

const shadowTexelSize = (LIGHT.shadowExtent * 2) / LIGHT.shadowMapSize;

const snapToShadowTexel = (value: number): number =>
    Math.round(value / shadowTexelSize) * shadowTexelSize;

const SceneLighting = ({ environment }: { environment: IThemeEnvironment }) => {
    const { sky, lighting } = environment;
    const keyLightRef = useRef<DirectionalLight>(null);

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

        const anchorX = snapToShadowTexel(camera.position.x);
        const anchorZ = snapToShadowTexel(camera.position.z);

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
                castShadow
                layers={SCENE_LIGHT_LAYERS}
                color={lighting.keyColor}
                intensity={lighting.keyIntensity}
                shadow-bias={LIGHT.shadowBias}
                shadow-mapSize-width={LIGHT.shadowMapSize}
                shadow-mapSize-height={LIGHT.shadowMapSize}
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
