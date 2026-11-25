import { SHARED_GLSL, glslFloat } from "@/shaders/sharedGlsl";
import { WATER_SURFACE } from "@/constants/world";

const WATER_FLOW_PHASES_GLSL = `
    vec3 flowPhasesAt(vec2 streamCoord) {
        float centerWeight = 1.0 - smoothstep(0.0, 1.0, abs(streamCoord.x));
        float localFlow = flowSpeed * (0.8 + 0.35 * centerWeight);
        return vec3(
            (streamCoord.y * 0.38 + streamCoord.x * 0.95) - time * localFlow * 1.25,
            (streamCoord.y * 0.65 - streamCoord.x * 1.15) - time * localFlow * 1.65 + 1.4,
            (streamCoord.y * 0.22 + streamCoord.x * streamCoord.x * 0.65) - time * localFlow * 0.85 + 2.8
        );
    }
`;

export const WATER_VERTEX_SHADER = `
    uniform float time;
    uniform float flowSpeed;
    uniform vec3 waderPosition;
    uniform float waderStrength;
    uniform float waderMotion;

    attribute float waterDepth;
    attribute vec2 flowDirection;
    attribute vec2 streamCoord;

    varying float vWaterDepth;
    varying vec2 vFlowDirection;
    varying vec2 vStreamCoord;
    varying vec3 vWorldPosition;

    ${WATER_FLOW_PHASES_GLSL}

    void main() {
        vec3 phases = flowPhasesAt(streamCoord);
        float phaseA = phases.x;
        float phaseB = phases.y;
        float phaseC = phases.z;
        float fluidWave = sin(phaseA) * 0.024 + sin(phaseB) * 0.016 + sin(phaseC) * 0.018;

        if (streamCoord.y < 5.0) {
            float springDist = length(vec2(streamCoord.x * 3.5, streamCoord.y));
            float springMound = (sin(springDist * 4.0 - time * 3.6) * 0.018 + 0.015) * exp(-springDist * 0.7);
            fluidWave += springMound;
        }

        float shoreDampener = smoothstep(0.04, 0.40, waterDepth);
        vec3 displacedPos = position;
        displacedPos.y += fluidWave * shoreDampener;

        if (waderStrength > 0.01) {
            vec2 localWader = vec2(waderPosition.x - modelMatrix[3].x, waderPosition.z - modelMatrix[3].z);
            vec2 deltaWader = displacedPos.xz - localWader;
            float wDistSq = dot(deltaWader, deltaWader);
            if (wDistSq < 20.25) {
                float wDist = sqrt(wDistSq);
                float waderDisplacement = (sin(wDist * 4.5 - time * 6.0) * 0.035 - 0.02) * exp(-wDist * 1.3) * waderStrength * (0.35 + 0.65 * waderMotion);
                displacedPos.y += waderDisplacement;
            }
        }

        vec4 worldPosition = modelMatrix * vec4(displacedPos, 1.0);

        vWaterDepth = waterDepth;
        vFlowDirection = flowDirection;
        vStreamCoord = streamCoord;
        vWorldPosition = worldPosition.xyz;

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

export const WATER_FRAGMENT_SHADER = `
    uniform vec3 shallowColor;
    uniform vec3 deepColor;

    uniform float time;
    uniform float depthFadeRange;
    uniform float depthColorCurve;
    uniform float shallowAlpha;
    uniform float deepAlpha;
    uniform float flowSpeed;

    uniform vec4 rippleWavelengths;
    uniform vec4 rippleAmplitudes;
    uniform vec4 rippleDrifts;

    uniform float reflectivityAtNormal;
    uniform float grazingCurve;

    uniform float shoreFoamStrength;

    uniform float causticScale;
    uniform float causticSpeed;
    uniform float causticIntensity;

    uniform float sunSpecularShininess;
    uniform float sunSpecularIntensity;

    uniform vec3 waderPosition;
    uniform float waderStrength;
    uniform float waderRingWavelength;
    uniform float waderRingSpeed;
    uniform float waderRingFalloff;
    uniform float waderRingAmplitude;
    uniform float waderContactFoamStrength;
    uniform float waderMotion;

    varying float vWaterDepth;
    varying vec2 vFlowDirection;
    varying vec2 vStreamCoord;
    varying vec3 vWorldPosition;

    ${SHARED_GLSL.maths}
    ${SHARED_GLSL.light}
    ${SHARED_GLSL.skyFog}

    float voronoi2D(vec2 p) {
        vec2 n = floor(p);
        vec2 f = fract(p);
        float md = 8.0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = hashPair(n + g);
                o = 0.5 + 0.35 * sin(time * 1.5 + 6.2831 * o);
                vec2 r = g + o - f;
                float d = dot(r, r);
                if (d < md) md = d;
            }
        }
        return sqrt(md);
    }

    vec2 waderSlopeAt(vec2 surfacePosition) {
        if (waderStrength < 0.01) return vec2(0.0);

        vec2 fromWader = surfacePosition - waderPosition.xz;
        float distSq = dot(fromWader, fromWader);
        if (distSq > 20.25) return vec2(0.0);

        float waderDistance = sqrt(distSq) + 1e-4;
        vec2 dir = fromWader / waderDistance;

        float motionFactor = smoothstep(0.02, 0.35, waderMotion);
        float meniscus = exp(-waderDistance * 3.5) * 0.08;
        float ringPhase = waderDistance / waderRingWavelength - time * waderRingSpeed;
        float rippleWave = cos(ringPhase);
        float rippleEnvelope = exp(-waderDistance / waderRingFalloff) * smoothstep(0.12, 0.45, waderDistance);
        float dynamicRipple = rippleWave * rippleEnvelope * (0.25 + 0.75 * motionFactor) * waderRingAmplitude;

        return dir * (meniscus + dynamicRipple) * waderStrength;
    }

    ${WATER_FLOW_PHASES_GLSL}

    vec3 surfaceNormalAt(vec2 surfacePosition, vec2 downstream, vec2 acrossStream) {
        vec2 slope = vec2(0.0);

        vec3 phases = flowPhasesAt(vStreamCoord);
        float phaseA = phases.x;
        float phaseB = phases.y;
        float phaseC = phases.z;

        float dAdStream = 0.38 * cos(phaseA);
        float dAdCross  = 0.95 * cos(phaseA);
        float dBdStream = 0.65 * cos(phaseB);
        float dBdCross  =-1.15 * cos(phaseB);
        float dCdStream = 0.22 * cos(phaseC);
        float dCdCross  = 1.30 * vStreamCoord.x * cos(phaseC);

        float gradDownstream = (dAdStream * 0.015 + dBdStream * 0.010 + dCdStream * 0.012) * smoothstep(0.04, 0.40, vWaterDepth);
        float gradAcross     = (dAdCross * 0.008 + dBdCross * 0.006 + dCdCross * 0.008) * smoothstep(0.04, 0.40, vWaterDepth);

        if (vStreamCoord.y < 4.0) {
            float springDist = length(vec2(vStreamCoord.x * 3.5, vStreamCoord.y));
            if (springDist < 4.0) {
                float springPulse = cos(springDist * 4.2 - time * 3.6) * exp(-springDist * 0.8) * 0.035;
                vec2 springDir = normalize(vec2(vStreamCoord.x * 3.5, vStreamCoord.y) + 1e-4);
                gradDownstream += springDir.y * springPulse;
                gradAcross += springDir.x * springPulse;
            }
        }

        slope += downstream * gradDownstream + acrossStream * gradAcross;

        float waveDown1 = cos((vStreamCoord.y - time * flowSpeed * rippleDrifts.x) / rippleWavelengths.x) * rippleAmplitudes.x;
        float waveDown4 = cos((vStreamCoord.y - time * flowSpeed * rippleDrifts.w) / rippleWavelengths.w) * rippleAmplitudes.w;
        slope += downstream * (waveDown1 + waveDown4);

        vec2 dirAngled1 = (downstream + acrossStream * 0.28) * 0.9629;
        vec2 dirAngled2 = (downstream - acrossStream * 0.22) * 0.9767;
        vec2 driftedPos2 = surfacePosition - downstream * (time * flowSpeed * rippleDrifts.y);
        vec2 driftedPos3 = surfacePosition - downstream * (time * flowSpeed * rippleDrifts.z);
        slope += dirAngled1 * (cos(dot(driftedPos2, dirAngled1) / rippleWavelengths.y) * rippleAmplitudes.y);
        slope += dirAngled2 * (cos(dot(driftedPos3, dirAngled2) / rippleWavelengths.z) * rippleAmplitudes.z);

        slope += waderSlopeAt(surfacePosition);

        return normalize(vec3(-slope.x, 1.0, -slope.y));
    }

    float fresnelReflectanceOf(float viewAlignment) {
        return reflectivityAtNormal +
            (1.0 - reflectivityAtNormal) * pow(1.0 - viewAlignment, grazingCurve);
    }

    void main() {
        if (vWaterDepth <= 0.0 || vStreamCoord.y <= 0.0) discard;

        vec2 surfacePosition = vWorldPosition.xz;
        vec2 downstream = normalize(vFlowDirection + vec2(1e-5, 0.0));
        vec2 acrossStream = vec2(downstream.y, -downstream.x);

        vec3 surfaceNormal = surfaceNormalAt(surfacePosition, downstream, acrossStream);
        if (!gl_FrontFacing) {
            surfaceNormal = -surfaceNormal;
        }
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float viewAlignment = clamp(abs(dot(surfaceNormal, viewDirection)), 0.0, 1.0);
        float fresnel = fresnelReflectanceOf(viewAlignment);

        float depthRatio = clamp(vWaterDepth / depthFadeRange, 0.0, 1.0);
        vec3 waterBody = mix(shallowColor, deepColor, pow(depthRatio, depthColorCurve));

        float causticFade = smoothstep(0.08, 0.30, vWaterDepth) * (1.0 - smoothstep(1.0, depthFadeRange * 1.5, vWaterDepth) * 0.5);
        float causticVal = 0.0;
        if (causticFade > 0.01 && causticIntensity > 0.0) {
            vec2 causticUv1 = vec2(
                vStreamCoord.x * 4.0,
                vStreamCoord.y * causticScale - time * flowSpeed * causticSpeed
            );
            vec2 causticUv2 = vec2(
                vStreamCoord.x * 5.6 + 2.1,
                vStreamCoord.y * causticScale * 1.4 - time * flowSpeed * causticSpeed * 1.2
            );
            float v1 = voronoi2D(causticUv1);
            float v2 = voronoi2D(causticUv2);
            float edge1 = 1.0 - clamp(v1, 0.0, 1.0);
            float edge2 = 1.0 - clamp(v2, 0.0, 1.0);
            float c1 = edge1 * edge1 * edge1;
            float c2 = edge2 * edge2 * edge2;
            causticVal = max(c1, c2 * 0.6) * causticIntensity;
        }

        float shoreEdge = smoothstep(0.01, 0.06, vWaterDepth) * (1.0 - smoothstep(0.06, 0.20, vWaterDepth));
        float shoreSheen = shoreEdge * shoreFoamStrength;

        float waderFoam = 0.0;
        if (waderStrength > 0.01) {
            float waderDist = length(vWorldPosition.xz - waderPosition.xz);
            if (waderDist < 4.5) {
                float footSplash = smoothstep(0.65, 0.15, waderDist) * (0.35 + 0.85 * smoothstep(0.04, 0.45, waderMotion));
                float ringPhase = waderDist / waderRingWavelength - time * waderRingSpeed;
                float ringCrest = smoothstep(0.35, 0.85, sin(ringPhase));
                float wakeSpread = exp(-waderDist / (waderRingFalloff * 0.8)) * smoothstep(0.2, 0.5, waderDist);
                float ringFoam = ringCrest * wakeSpread * (0.35 + 0.95 * smoothstep(0.04, 0.45, waderMotion));
                waderFoam = (footSplash + ringFoam) * waderStrength * waderContactFoamStrength;
            }
        }

        vec3 halfVec = normalize(viewDirection + styleSunDirection);
        float NdotH = max(dot(surfaceNormal, halfVec), 0.0);
        float sunSpec = pow(NdotH, sunSpecularShininess);
        float specCrisp = smoothstep(0.88, 0.985, sunSpec) * sunSpecularIntensity;
        #ifdef STYLE_SPECULAR
        vec3 specularLight = styleSunColor / max(max(styleSunColor.r, styleSunColor.g), max(styleSunColor.b, 0.001)) * specCrisp * styleSpecularWeight(dot(surfaceNormal, styleSunDirection));
        #else
        vec3 specularLight = vec3(0.0);
        #endif

        vec3 waterLight = styleSkyLight(dot(surfaceNormal, styleSunDirection));
        vec3 surfaceColor = waterBody * waterLight;
        surfaceColor += shallowColor * waterLight * (causticVal * causticFade);
        surfaceColor += specularLight;

        float totalFoam = clamp(shoreSheen + waderFoam, 0.0, 1.0);
        vec3 foamColor = mix(shallowColor, vec3(0.98, 1.0, 1.0), ${glslFloat(WATER_SURFACE.foamWhiteShare)}) * waterLight;
        surfaceColor = mix(surfaceColor, foamColor, totalFoam * ${glslFloat(WATER_SURFACE.foamCoverShare)});

        float bodyAlpha = mix(shallowAlpha, deepAlpha, smoothstep(0.0, depthFadeRange, vWaterDepth));
        float finalAlpha = max(bodyAlpha, fresnel * ${glslFloat(WATER_SURFACE.fresnelAlpha)});
        finalAlpha = mix(finalAlpha, min(finalAlpha + ${glslFloat(WATER_SURFACE.foamAlphaGain)}, 0.95), totalFoam);

        float shoreFade = smoothstep(0.0, 0.12, vWaterDepth);
        finalAlpha *= shoreFade;

        float headwatersFade = smoothstep(0.0, 2.2, vStreamCoord.y);
        finalAlpha *= headwatersFade;

        if (finalAlpha <= 0.002) discard;

        gl_FragColor = vec4(styleFog(surfaceColor, vWorldPosition), finalAlpha);
    }
`;
