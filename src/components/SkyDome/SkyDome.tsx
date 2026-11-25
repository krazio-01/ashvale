"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BackSide, Color, Mesh, ShaderMaterial, Vector2, Vector3 } from "three";
import type { CanvasTexture } from "three";
import { sunDirectionFromSky } from "@/themes/Environment";
import type { ISkyGradient, IThemeEnvironment } from "@/types/themes";
import { ATMOSPHERE } from "@/constants/world";
import { SkyColors, WorldEnvironment } from "@/world/assets/MaterialLibrary";
import { buildTileableNoiseTexture } from "@/lib/noise";
import { SKY_FRAGMENT_SHADER, SKY_VERTEX_SHADER } from "@/shaders/sky";

let sharedCloudNoise: CanvasTexture | null = null;

function cloudNoiseTexture(): CanvasTexture {
    sharedCloudNoise ??= buildTileableNoiseTexture(
        ATMOSPHERE.clouds.noise,
        ATMOSPHERE.clouds.noiseSeed
    );
    return sharedCloudNoise;
}

class SkyMaterial extends ShaderMaterial {
    private readonly skyColors: SkyColors;
    private readonly cloudDrift = WorldEnvironment.WIND_DIRECTION.clone().multiplyScalar(
        ATMOSPHERE.clouds.driftSpeed
    );

    constructor() {
        const skyColors = new SkyColors();
        super({
            vertexShader: SKY_VERTEX_SHADER,
            fragmentShader: SKY_FRAGMENT_SHADER,
            uniforms: {
                ...skyColors.uniforms,
                abyssColor: { value: new Color() },
                glowColor: { value: new Color() },
                sunColor: { value: new Color() },
                sunDirection: { value: new Vector3() },
                sunDiscEdges: { value: new Vector2() },
                rangeShade: { value: new Color() },
                glowFalloff: { value: 0 },
                hazeStrength: { value: 0 },
                ditherStrength: { value: ATMOSPHERE.skyDitherStrength },
                cloudNoise: { value: cloudNoiseTexture() },
                cloudLitColor: { value: new Color() },
                cloudShadeColor: { value: new Color() },
                cloudCover: { value: 0 },
                cloudSoftness: { value: 0 },
                cloudOffset: { value: new Vector2() },
            },
            side: BackSide,
            depthWrite: false,
            fog: false,
        });
        this.skyColors = skyColors;
    }

    drift(deltaSeconds: number): void {
        this.uniforms.cloudOffset.value.addScaledVector(this.cloudDrift, deltaSeconds);
    }

    applySky(sky: ISkyGradient): void {
        const { uniforms } = this;
        const { silhouettes } = ATMOSPHERE;
        this.skyColors.apply(sky);
        uniforms.abyssColor.value.set(sky.belowHorizonColor);
        uniforms.glowColor.value.set(sky.glow);
        uniforms.sunColor.value.set(sky.sun);
        uniforms.sunDirection.value.copy(sunDirectionFromSky(sky));
        uniforms.sunDiscEdges.value.set(Math.cos(sky.sunSize * 2), Math.cos(sky.sunSize));
        uniforms.rangeShade.value
            .copy(this.skyColors.uniforms.skyHorizonColor.value)
            .lerp(this.skyColors.uniforms.skyMiddleColor.value, silhouettes.middleShare)
            .multiplyScalar(silhouettes.shadeOfSky);
        uniforms.glowFalloff.value = sky.glowFalloff;
        uniforms.hazeStrength.value = sky.hazeStrength;
        uniforms.cloudLitColor.value.set(sky.cloudLit);
        uniforms.cloudShadeColor.value.set(sky.cloudShade);
        uniforms.cloudCover.value = sky.cloudCover;
        uniforms.cloudSoftness.value = sky.cloudSoftness;
    }
}

const SkyDome = ({ environment }: { environment: IThemeEnvironment }) => {
    const domeRef = useRef<Mesh>(null);
    const material = useMemo(() => new SkyMaterial(), []);

    useEffect(() => material.applySky(environment.sky), [environment, material]);

    useEffect(
        () => () => {
            material.dispose();
            sharedCloudNoise?.dispose();
        },
        [material]
    );

    useFrame(({ camera }, deltaSeconds) => {
        domeRef.current?.position.copy(camera.position);
        material.drift(deltaSeconds);
    });

    return (
        <mesh
            ref={domeRef}
            material={material}
            frustumCulled={false}
            renderOrder={Number.MAX_SAFE_INTEGER}
        >
            <sphereGeometry args={[ATMOSPHERE.skyRadius, 32, 16]} />
        </mesh>
    );
};

export default SkyDome;
