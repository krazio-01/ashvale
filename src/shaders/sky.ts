import { ATMOSPHERE } from "@/constants/world";
import { SHARED_GLSL, glslFloat } from "@/shaders/sharedGlsl";

const CLOUDS = ATMOSPHERE.clouds;

const SILHOUETTES = ATMOSPHERE.silhouettes;

const HIGHEST_PEAK_ALTITUDE =
    Math.max(...SILHOUETTES.ranges.map(({ peakAltitude }) => peakAltitude)) *
    SILHOUETTES.octaveWeights.reduce((total, weight) => total + weight, 0);

export const SKY_VERTEX_SHADER = `
    varying vec3 vWorldPosition;

    void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
    }
`;

export const SKY_FRAGMENT_SHADER = `
    uniform vec3 abyssColor;
    uniform vec3 glowColor;
    uniform vec3 sunColor;
    uniform vec3 sunDirection;
    uniform vec2 sunDiscEdges;
    uniform vec3 rangeShade;
    uniform float glowFalloff;
    uniform float hazeStrength;
    uniform float ditherStrength;
    uniform sampler2D cloudNoise;
    uniform vec3 cloudLitColor;
    uniform vec3 cloudShadeColor;
    uniform float cloudCover;
    uniform float cloudSoftness;
    uniform vec2 cloudOffset;

    varying vec3 vWorldPosition;
    ${SHARED_GLSL.maths}
    ${SHARED_GLSL.sky}

    float cloudField(vec2 uv) {
        return ${CLOUDS.octaves
            .map(
                ({ weight, scale, offset }, index) =>
                    `texture2D(cloudNoise, uv * ${glslFloat(scale)} + ${glslFloat(offset)}).${"rgb"[index]} * ${glslFloat(weight)}`
            )
            .join(" + ")};
    }

    float ridgeHeight(float azimuth, float phase, ${SILHOUETTES.octaveWeights.map((_, index) => `float frequency${index}`).join(", ")}) {
        return ${SILHOUETTES.octaveWeights
            .map(
                (weight, index) =>
                    `(1.0 - abs(sin(azimuth * frequency${index} + phase * ${glslFloat(index + 1)}))) * ${glslFloat(weight)}`
            )
            .join(" + ")};
    }

    void main() {
        vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
        float altitude = viewDirection.y;

        vec3 skyColor;

        if (altitude >= 0.0) {
            skyColor = skyGradientAt(viewDirection);
        } else {
            skyColor = mix(skyHorizonColor, abyssColor, smoothstep(0.0, -0.35, altitude));
        }

        if (altitude >= 0.0 && altitude < ${glslFloat(HIGHEST_PEAK_ALTITUDE)}) {
            float azimuth = atan(viewDirection.z, viewDirection.x);
            ${SILHOUETTES.ranges
                .map(
                    ({ peakAltitude, haze, phase, frequencies }) => `{
                float peak = ${glslFloat(peakAltitude)} * ridgeHeight(azimuth, ${glslFloat(phase)}, ${frequencies.map(glslFloat).join(", ")});
                if (altitude < peak) {
                    float foot = smoothstep(0.0, peak * ${glslFloat(SILHOUETTES.footHazeShare)}, altitude);
                    skyColor = mix(skyHorizonColor, mix(rangeShade, skyHorizonColor, ${glslFloat(haze)}), foot);
                }
            }`
                )
                .join("\n")}
        }

        float sunAlignment = dot(viewDirection, sunDirection);
        float glow = pow(max(sunAlignment, 0.0), glowFalloff);
        float lowAltitudeFalloff = exp(-abs(altitude) * hazeStrength);

        skyColor += glowColor * glow * lowAltitudeFalloff;
        skyColor += sunColor * smoothstep(sunDiscEdges.x, sunDiscEdges.y, sunAlignment);

        if (cloudCover > 0.0 && altitude > 0.0) {
            vec2 uv = viewDirection.xz / (altitude + ${glslFloat(CLOUDS.horizonLift)})
                * ${glslFloat(CLOUDS.projectionScale)} + cloudOffset;
            float field = cloudField(uv);
            float cover = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + cloudSoftness, field);
            float towardSun = cloudField(uv + sunDirection.xz * ${glslFloat(CLOUDS.sunProbe)});
            float lit = clamp(
                ${glslFloat(CLOUDS.litBase)} + (field - towardSun) * ${glslFloat(CLOUDS.litContrast)},
                0.0,
                1.0
            );
            vec3 cloud = mix(cloudShadeColor, cloudLitColor, lit)
                + glowColor * pow(max(sunAlignment, 0.0), ${glslFloat(CLOUDS.sunGlowFocus)})
                    * ${glslFloat(CLOUDS.sunGlowStrength)};
            cover *= smoothstep(0.0, ${glslFloat(CLOUDS.horizonFade)}, altitude);
            skyColor = mix(skyColor, cloud, cover * ${glslFloat(CLOUDS.opacity)});
        }

        float dither = hashScalar(gl_FragCoord.xy);
        skyColor += (dither - 0.5) * ditherStrength / 255.0;

        gl_FragColor = vec4(skyColor, 1.0);
    }
`;
