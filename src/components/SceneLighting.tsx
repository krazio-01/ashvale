"use client";
import { useMemo } from "react";
import type { Vector3Tuple } from "three";
import { sunDirectionOf } from "@/themes/themeManifests";
import type { IThemeEnvironment } from "@/types/theme";
import { LIGHT } from "@/constants/game";

const SceneLighting = ({ environment }: { environment: IThemeEnvironment }) => {
    const { sky, lighting } = environment;

    const [keyPosition, rimPosition] = useMemo<[Vector3Tuple, Vector3Tuple]>(() => {
        const sunDirection = sunDirectionOf(sky);

        return [
            [
                sunDirection.x * LIGHT.keyDistance,
                sunDirection.y * LIGHT.keyDistance,
                sunDirection.z * LIGHT.keyDistance,
            ],
            [
                -sunDirection.x * LIGHT.rimDistance,
                LIGHT.rimElevation * LIGHT.rimDistance,
                -sunDirection.z * LIGHT.rimDistance,
            ],
        ];
    }, [sky]);

    return (
        <>
            <color attach="background" args={[sky.abyss]} />
            <fogExp2 attach="fog" args={[environment.fogColor, environment.fogDensity]} />

            <hemisphereLight
                args={[lighting.skyFill, lighting.groundFill, lighting.hemisphereIntensity]}
            />

            <directionalLight
                castShadow
                color={lighting.keyColor}
                intensity={lighting.keyIntensity}
                position={keyPosition}
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
                color={lighting.rimColor}
                intensity={lighting.rimIntensity}
                position={rimPosition}
            />
        </>
    );
};

export default SceneLighting;
