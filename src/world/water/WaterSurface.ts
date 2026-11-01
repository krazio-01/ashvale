import {
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    Mesh,
    ShaderMaterial,
    Vector3,
    Vector4,
    type Object3D,
    type Vector3Tuple,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { IWorldContext, IWorldEntity, IWaterCourse, IWaterPoint } from "@/types/world";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { shoreAllowanceAt, CellIndex } from "@/world/water/WaterCourse";
import { WATER_CHANNEL, WATER_SURFACE, WADING_RIPPLES } from "@/constants/world";
import {
    lerp,
    smoothstep,
    resampleSmoothPath,
    pathDirectionAt,
    freezeTransform,
    gridQuadIndices,
    accumulatePathLengths,
} from "@/lib/helpers";
import type { IPlanarPoint } from "@/lib/helpers";

const RIBBON_ATTRIBUTES = [
    ["position", 3],
    ["waterDepth", 1],
    ["flowDirection", 2],
    ["streamCoord", 2],
] as const;

type RibbonArrays = Record<(typeof RIBBON_ATTRIBUTES)[number][0], Float32Array>;

interface IWaderTarget {
    target: Object3D;
    feetOffset: number;
}

export class WaterSurface implements IWorldEntity {
    private static readonly scratchDirection: IPlanarPoint = { x: 0, z: 0 };

    private static ribbonGeometry(arrays: RibbonArrays, indices: Uint32Array): BufferGeometry {
        const geometry = new BufferGeometry();
        for (const [name, itemSize] of RIBBON_ATTRIBUTES)
            geometry.setAttribute(name, new BufferAttribute(arrays[name], itemSize));
        geometry.setIndex(new BufferAttribute(indices, 1));
        return geometry;
    }

    private static buildWetIndices(
        pointCount: number,
        columnCount: number,
        waterDepths: Float32Array
    ): Uint32Array {
        const margin = -WATER_SURFACE.wetQuadMargin;

        return gridQuadIndices(
            pointCount - 1,
            columnCount - 1,
            (row, column) => row * columnCount + column,
            (nearLeft, nearRight, farLeft, farRight) => {
                const nearLeftDepth = waterDepths[nearLeft];
                const nearRightDepth = waterDepths[nearRight];
                const farLeftDepth = waterDepths[farLeft];
                const farRightDepth = waterDepths[farRight];

                if (
                    nearLeftDepth < -0.5 ||
                    nearRightDepth < -0.5 ||
                    farLeftDepth < -0.5 ||
                    farRightDepth < -0.5
                )
                    return false;

                return (
                    nearLeftDepth > margin ||
                    nearRightDepth > margin ||
                    farLeftDepth > margin ||
                    farRightDepth > margin
                );
            }
        );
    }

    private static maximumHalfWidthOf(points: IWaterPoint[]): number {
        let widest = 0;
        for (const point of points) widest = Math.max(widest, point.halfWidth);
        return widest;
    }

    private static readonly FLOW_PHASES_GLSL = `
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

    private static resampleCoursePoints(
        points: IWaterCourse["points"],
        targetStep: number
    ): IWaterPoint[] {
        return resampleSmoothPath(
            points,
            targetStep,
            (x, z, start, end, travelRatio) => ({
                x,
                z,
                waterlineElevation: lerp(
                    start.waterlineElevation,
                    end.waterlineElevation,
                    travelRatio
                ),
                halfWidth: lerp(start.halfWidth, end.halfWidth, travelRatio),
                bedRatio: lerp(start.bedRatio, end.bedRatio, travelRatio),
            }),
            (last) => ({ ...last })
        );
    }

    private static buildWaterRibbon(
        points: IWaterPoint[],
        sampleGrid: TerrainSampleGrid
    ): BufferGeometry {
        const widestReach = WaterSurface.maximumHalfWidthOf(points) + WATER_CHANNEL.shoreReach;
        const columnsPerSide = Math.max(Math.ceil(widestReach / WATER_SURFACE.lateralStep), 1);
        const columnCount = columnsPerSide * 2 + 1;
        const vertexCount = points.length * columnCount;

        const positions = new Float32Array(vertexCount * 3);
        const waterDepths = new Float32Array(vertexCount);
        const flowDirections = new Float32Array(vertexCount * 2);
        const streamCoords = new Float32Array(vertexCount * 2);

        const accumulatedDistances = new Float64Array(points.length);
        accumulatePathLengths(points, accumulatedDistances);

        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];

            const { x: downstreamX, z: downstreamZ } = pathDirectionAt(
                points,
                index,
                WaterSurface.scratchDirection
            );

            const accumulatedDistance = accumulatedDistances[index];

            const reach = point.halfWidth + WATER_CHANNEL.shoreReach;

            for (let column = 0; column < columnCount; column += 1) {
                const normalizedCross = (column - columnsPerSide) / columnsPerSide;
                const offset = normalizedCross * reach;
                let localX = point.x + downstreamZ * offset;
                let localZ = point.z - downstreamX * offset;

                if (index < 3) {
                    const headCurvature = (1 - normalizedCross * normalizedCross) * (reach * 0.65);
                    const rowInfluence = (3 - index) / 3;
                    localX -= downstreamX * headCurvature * rowInfluence;
                    localZ -= downstreamZ * headCurvature * rowInfluence;
                }

                const vertex = index * columnCount + column;

                positions[vertex * 3] = localX;
                positions[vertex * 3 + 1] = point.waterlineElevation;
                positions[vertex * 3 + 2] = localZ;

                const surfaceElevation = sampleGrid.surfaceElevationAt(localX, localZ);
                const dropBelowWater = point.waterlineElevation - surfaceElevation;

                if (dropBelowWater > WATER_CHANNEL.bedDepth + 2.0) {
                    waterDepths[vertex] = -1.0;
                } else {
                    waterDepths[vertex] = Math.min(
                        dropBelowWater,
                        shoreAllowanceAt(Math.abs(offset), point.halfWidth)
                    );
                }
                flowDirections[vertex * 2] = downstreamX;
                flowDirections[vertex * 2 + 1] = downstreamZ;
                streamCoords[vertex * 2] = normalizedCross;
                streamCoords[vertex * 2 + 1] = accumulatedDistance;
            }
        }

        return WaterSurface.ribbonGeometry(
            {
                position: positions,
                waterDepth: waterDepths,
                flowDirection: flowDirections,
                streamCoord: streamCoords,
            },
            WaterSurface.buildWetIndices(points.length, columnCount, waterDepths)
        );
    }

    private static mergeRibbonGeometries(geometries: BufferGeometry[]): BufferGeometry {
        if (geometries.length === 0) return new BufferGeometry();
        const combined = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
        combined.computeBoundingSphere();
        return combined;
    }

    private static readonly VERTEX_SHADER = `
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

    ${WaterSurface.FLOW_PHASES_GLSL}

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

    private static readonly FRAGMENT_SHADER = `
    uniform vec3 shallowColor;
    uniform vec3 deepColor;
    uniform vec3 sunColor;
    uniform vec3 sunDirection;
    uniform vec3 skyColor;

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
    uniform float skyReflectionStrength;

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

    vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
    }

    float voronoi2D(vec2 p) {
        vec2 n = floor(p);
        vec2 f = fract(p);
        float md = 8.0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = hash22(n + g);
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

    ${WaterSurface.FLOW_PHASES_GLSL}

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
        if (vWaterDepth < -0.06) discard;

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
            float c1 = pow(1.0 - clamp(v1, 0.0, 1.0), 3.0);
            float c2 = pow(1.0 - clamp(v2, 0.0, 1.0), 3.0);
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

        vec3 halfVec = normalize(viewDirection + normalize(sunDirection));
        float NdotH = max(dot(surfaceNormal, halfVec), 0.0);
        float sunSpec = pow(NdotH, sunSpecularShininess);
        float specCrisp = smoothstep(0.88, 0.985, sunSpec) * sunSpecularIntensity;
        vec3 specularLight = sunColor * specCrisp;

        vec3 surfaceColor = waterBody;
        surfaceColor += shallowColor * (causticVal * causticFade);
        surfaceColor = mix(surfaceColor, skyColor, fresnel * skyReflectionStrength);
        surfaceColor += specularLight;

        float totalFoam = clamp(shoreSheen + waderFoam, 0.0, 1.0);
        vec3 foamColor = mix(shallowColor, vec3(0.98, 1.0, 1.0), 0.92);
        surfaceColor = mix(surfaceColor, foamColor, totalFoam * 0.92);

        float bodyAlpha = mix(shallowAlpha, deepAlpha, smoothstep(0.0, depthFadeRange, vWaterDepth));
        float finalAlpha = max(bodyAlpha, fresnel * 0.35);
        finalAlpha = mix(finalAlpha, min(finalAlpha + 0.35, 0.95), totalFoam);

        float shoreFade = smoothstep(0.0, 0.12, vWaterDepth);
        finalAlpha *= shoreFade;

        float headwatersFade = smoothstep(0.0, 2.2, vStreamCoord.y);
        finalAlpha *= headwatersFade;

        if (finalAlpha <= 0.002) discard;

        gl_FragColor = vec4(surfaceColor, finalAlpha);
    }
`;

    private static surfaceUniforms(context: IWorldContext) {
        const { environment } = context;
        const { water, sky, lighting } = environment;

        return {
            shallowColor: { value: new Color(water.shallowColor) },
            deepColor: { value: new Color(water.deepColor) },
            sunColor: { value: new Color(lighting.sunLightColor) },
            sunDirection: context.worldEnvironment.uniforms.sunDirection,
            skyColor: { value: new Color(sky.middle) },

            time: context.worldEnvironment.uniforms.time,
            depthFadeRange: { value: WATER_SURFACE.depthFadeRange },
            depthColorCurve: { value: WATER_SURFACE.depthColorCurve },
            shallowAlpha: { value: WATER_SURFACE.shallowAlpha },
            deepAlpha: { value: WATER_SURFACE.deepAlpha },
            flowSpeed: { value: WATER_SURFACE.flowSpeed },

            rippleWavelengths: { value: new Vector4(...WATER_SURFACE.rippleWavelengths) },
            rippleAmplitudes: { value: new Vector4(...WATER_SURFACE.rippleAmplitudes) },
            rippleDrifts: { value: new Vector4(...WATER_SURFACE.rippleDrifts) },

            reflectivityAtNormal: { value: WATER_SURFACE.reflectivityAtNormal },
            grazingCurve: { value: WATER_SURFACE.grazingCurve },

            shoreFoamStrength: { value: WATER_SURFACE.shoreFoamStrength },

            causticScale: { value: WATER_SURFACE.causticScale },
            causticSpeed: { value: WATER_SURFACE.causticSpeed },
            causticIntensity: { value: WATER_SURFACE.causticIntensity },

            sunSpecularShininess: { value: WATER_SURFACE.sunSpecularShininess },
            sunSpecularIntensity: { value: WATER_SURFACE.sunSpecularIntensity },
            skyReflectionStrength: { value: WATER_SURFACE.skyReflectionStrength },

            waderPosition: { value: new Vector3() },
            waderStrength: { value: 0 },
            waderMotion: { value: 0 },
            waderRingWavelength: { value: WADING_RIPPLES.ringWavelength },
            waderRingSpeed: { value: WADING_RIPPLES.ringSpeed },
            waderRingFalloff: { value: WADING_RIPPLES.ringFalloff },
            waderRingAmplitude: { value: WADING_RIPPLES.ringAmplitude },
            waderContactFoamStrength: { value: WADING_RIPPLES.contactFoamStrength },
        };
    }

    readonly sceneObject: Mesh;

    private readonly material: ShaderMaterial;
    private readonly centerX: number;
    private readonly centerZ: number;
    private readonly courseX: Float32Array;
    private readonly courseZ: Float32Array;
    private readonly courseWaterline: Float32Array;
    private readonly courseHalfWidth: Float32Array;
    private readonly courseCells: CellIndex;
    private readonly wadingReach: number;
    private readonly waderPosition = new Vector3();
    private readonly previousWaderPosition = new Vector3();
    private waderMotion = 0;
    private hasPreviousWaderPosition = false;
    private wader: IWaderTarget | null = null;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        courses: IWaterCourse[],
        sampleGrid: TerrainSampleGrid
    ) {
        this.centerX = center[0];
        this.centerZ = center[2];

        const allSmoothedPoints: IWaterPoint[][] = [];
        let totalSmoothedCount = 0;

        for (const course of courses) {
            const smoothed = WaterSurface.resampleCoursePoints(
                course.points,
                WATER_SURFACE.splineResampleStep
            );
            if (smoothed.length >= 2) {
                allSmoothedPoints.push(smoothed);
                totalSmoothedCount += smoothed.length;
            }
        }

        this.courseX = new Float32Array(totalSmoothedCount);
        this.courseZ = new Float32Array(totalSmoothedCount);
        this.courseWaterline = new Float32Array(totalSmoothedCount);
        this.courseHalfWidth = new Float32Array(totalSmoothedCount);

        let pointCursor = 0;
        let widestHalfWidth = 0;
        let smallestX = Infinity;
        let smallestZ = Infinity;
        let largestX = -Infinity;
        let largestZ = -Infinity;
        const geometries: BufferGeometry[] = [];

        for (const smoothed of allSmoothedPoints) {
            for (const point of smoothed) {
                this.courseX[pointCursor] = point.x;
                this.courseZ[pointCursor] = point.z;
                this.courseWaterline[pointCursor] = point.waterlineElevation;
                this.courseHalfWidth[pointCursor] = point.halfWidth;
                widestHalfWidth = Math.max(widestHalfWidth, this.courseHalfWidth[pointCursor]);
                smallestX = Math.min(smallestX, this.courseX[pointCursor]);
                smallestZ = Math.min(smallestZ, this.courseZ[pointCursor]);
                largestX = Math.max(largestX, this.courseX[pointCursor]);
                largestZ = Math.max(largestZ, this.courseZ[pointCursor]);
                pointCursor += 1;
            }

            geometries.push(WaterSurface.buildWaterRibbon(smoothed, sampleGrid));
        }

        this.wadingReach = widestHalfWidth + WADING_RIPPLES.channelGrace;
        const boxReach = this.wadingReach * 2;
        this.courseCells = new CellIndex(
            this.wadingReach,
            { minX: smallestX, minZ: smallestZ, maxX: largestX, maxZ: largestZ },
            totalSmoothedCount,
            (point, box) => {
                box.minX = this.courseX[point] - boxReach;
                box.maxX = this.courseX[point] + boxReach;
                box.minZ = this.courseZ[point] - boxReach;
                box.maxZ = this.courseZ[point] + boxReach;
            }
        );

        this.material = new ShaderMaterial({
            vertexShader: WaterSurface.VERTEX_SHADER,
            fragmentShader: WaterSurface.FRAGMENT_SHADER,
            uniforms: WaterSurface.surfaceUniforms(context),
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });

        const combinedGeometry = WaterSurface.mergeRibbonGeometries(geometries);
        this.sceneObject = new Mesh(combinedGeometry, this.material);
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.renderOrder = 1;
        freezeTransform(this.sceneObject);
    }

    follow(target: Object3D, feetOffset: number): void {
        this.wader = { target, feetOffset };
    }

    update(deltaSeconds: number): void {
        this.updateWader(deltaSeconds);
    }

    dispose(): void {
        this.sceneObject.geometry.dispose();
        this.material.dispose();
    }

    private updateWader(deltaSeconds: number): void {
        const uniforms = this.material.uniforms;
        const wader = this.wader;
        if (!wader) return;

        this.waderPosition.copy(wader.target.position);

        let currentSpeed = 0;
        if (this.hasPreviousWaderPosition && deltaSeconds > 0) {
            const dx = this.waderPosition.x - this.previousWaderPosition.x;
            const dz = this.waderPosition.z - this.previousWaderPosition.z;
            currentSpeed = Math.hypot(dx, dz) / deltaSeconds;
        } else {
            this.hasPreviousWaderPosition = true;
        }
        this.previousWaderPosition.copy(this.waderPosition);

        const targetMotion = Math.min(currentSpeed / 2.0, 1.0);
        this.waderMotion = lerp(this.waderMotion, targetMotion, Math.min(1.0, deltaSeconds * 10.0));

        uniforms.waderPosition!.value.copy(this.waderPosition);
        uniforms.waderMotion!.value = this.waderMotion;
        uniforms.waderStrength!.value = this.immersionOf(
            this.waderPosition.x - this.centerX,
            this.waderPosition.z - this.centerZ,
            this.waderPosition.y - wader.feetOffset
        );
    }

    private immersionOf(localX: number, localZ: number, feetElevation: number): number {
        const cells = this.courseCells;
        const cell = cells.cellAt(localX, localZ);
        if (cell < 0) return 0;

        let nearestDistanceSquared = Infinity;
        let nearestPoint = -1;
        const cellEnd = cells.endOf(cell);

        for (let cursor = cells.startOf(cell); cursor < cellEnd; cursor += 1) {
            const point = cells.itemAt(cursor);
            const offsetX = localX - this.courseX[point];
            const offsetZ = localZ - this.courseZ[point];
            const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

            if (distanceSquared >= nearestDistanceSquared) continue;

            nearestDistanceSquared = distanceSquared;
            nearestPoint = point;
        }

        if (nearestPoint < 0) return 0;

        const nearestDistance = Math.sqrt(nearestDistanceSquared);
        if (nearestDistance > this.wadingReach) return 0;
        const halfWidth = this.courseHalfWidth[nearestPoint];
        const withinChannel =
            1 - smoothstep(halfWidth, halfWidth + WADING_RIPPLES.channelGrace, nearestDistance);
        if (withinChannel <= 0) return 0;

        const standingDepth = this.courseWaterline[nearestPoint] - feetElevation;

        return withinChannel * smoothstep(-0.1, WADING_RIPPLES.immersionDepth, standingDepth);
    }
}
