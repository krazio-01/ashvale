"use client";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BackSide, Color, Mesh, ShaderMaterial } from "three";
import { sunDirectionOf } from "@/themes/themeManifests";
import type { IThemeEnvironment } from "@/types/theme";
import { ATMOSPHERE } from "@/constants/game";

const VERTEX_SHADER = /* glsl */ `
    varying vec3 vWorldPosition;

    void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 zenithColor;
    uniform vec3 middleColor;
    uniform vec3 horizonColor;
    uniform vec3 abyssColor;
    uniform vec3 glowColor;
    uniform vec3 sunColor;
    uniform vec3 sunDirection;
    uniform float middleAltitude;
    uniform float sunSize;
    uniform float glowFalloff;
    uniform float hazeStrength;
    uniform float ditherStrength;

    varying vec3 vWorldPosition;

    void main() {
        vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
        float altitude = viewDirection.y;

        vec3 skyColor;

        if (altitude >= 0.0) {
            float toMiddle = smoothstep(0.0, middleAltitude, altitude);
            float toZenith = smoothstep(middleAltitude, 1.0, altitude);
            skyColor = mix(mix(horizonColor, middleColor, toMiddle), zenithColor, toZenith);
        } else {
            skyColor = mix(horizonColor, abyssColor, smoothstep(0.0, -0.35, altitude));
        }

        float sunAlignment = dot(viewDirection, sunDirection);
        float glow = pow(max(sunAlignment, 0.0), glowFalloff);
        float lowAltitudeFalloff = exp(-abs(altitude) * hazeStrength);

        skyColor += glowColor * glow * lowAltitudeFalloff;
        skyColor += sunColor * smoothstep(cos(sunSize * 2.0), cos(sunSize), sunAlignment);

        float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        skyColor += (dither - 0.5) * ditherStrength / 255.0;

        gl_FragColor = vec4(skyColor, 1.0);
    }
`;

const SkyDome = ({ environment }: { environment: IThemeEnvironment }) => {
    const domeRef = useRef<Mesh>(null);

    const material = useMemo(() => {
        const { sky } = environment;

        return new ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: {
                zenithColor: { value: new Color(sky.zenith) },
                middleColor: { value: new Color(sky.middle) },
                horizonColor: { value: new Color(sky.horizon) },
                abyssColor: { value: new Color(sky.abyss) },
                glowColor: { value: new Color(sky.glow) },
                sunColor: { value: new Color(sky.sun) },
                sunDirection: { value: sunDirectionOf(sky) },
                middleAltitude: { value: ATMOSPHERE.middleAltitude },
                sunSize: { value: sky.sunSize },
                glowFalloff: { value: sky.glowFalloff },
                hazeStrength: { value: sky.hazeStrength },
                ditherStrength: { value: ATMOSPHERE.skyDitherStrength },
            },
            side: BackSide,
            depthWrite: false,
            fog: false,
        });
    }, [environment]);

    useFrame(({ camera }) => {
        domeRef.current?.position.copy(camera.position);
    });

    return (
        <mesh ref={domeRef} material={material} frustumCulled={false} renderOrder={-1}>
            <sphereGeometry args={[ATMOSPHERE.skyRadius, 32, 16]} />
        </mesh>
    );
};

export default SkyDome;
