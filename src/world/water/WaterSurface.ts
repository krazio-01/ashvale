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
import { Entity } from "@/entities/Entity";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { shoreAllowanceAt } from "@/world/water/WaterChannel";
import type { IWaterCourse, IWaterPoint } from "@/world/water/WaterCourse";
import { WATER_CHANNEL, WATER_SURFACE, WATER_WADER } from "@/constants/world";
import { catmullRomAt, lerp, smoothstep } from "@/lib/helpers";

export class WaterSurface extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly material: ShaderMaterial;
    private readonly centerX: number;
    private readonly centerZ: number;
    private readonly courseX: Float32Array;
    private readonly courseZ: Float32Array;
    private readonly courseWaterline: Float32Array;
    private readonly courseHalfWidth: Float32Array;
    private readonly waderPosition = new Vector3();
    private readonly previousWaderPosition = new Vector3();
    private waderMotion = 0;
    private hasPreviousWaderPosition = false;
    private wader: IWaderTarget | null = null;
    private elapsedSeconds = 0;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        input: IWaterCourse | IWaterCourse[],
        heightMap: TerrainSampleGrid
    ) {
        super("water-surface");

        this.centerX = center[0];
        this.centerZ = center[2];

        const courses = Array.isArray(input) ? input : [input];
        const allSmoothedPoints: IWaterPoint[][] = [];
        let totalSmoothedCount = 0;

        for (const course of courses) {
            const smoothed = resampleCoursePoints(course.points, WATER_SURFACE.splineResampleStep);
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
        const geometries: BufferGeometry[] = [];

        for (const smoothed of allSmoothedPoints) {
            for (let i = 0; i < smoothed.length; i += 1) {
                const pt = smoothed[i]!;
                this.courseX[pointCursor] = pt.x;
                this.courseZ[pointCursor] = pt.z;
                this.courseWaterline[pointCursor] = pt.waterlineElevation;
                this.courseHalfWidth[pointCursor] = pt.halfWidth;
                pointCursor += 1;
            }

            geometries.push(buildWaterRibbon(smoothed, heightMap));
        }

        this.material = new ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: surfaceUniforms(context),
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });

        const combinedGeometry = combineGeometries(geometries);
        this.sceneObject = new Mesh(combinedGeometry, this.material);
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.renderOrder = 1;
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;
    }

    follow(target: Object3D, feetOffset: number): void {
        this.wader = { target, feetOffset };
    }

    update(deltaSeconds: number): void {
        this.elapsedSeconds += deltaSeconds;
        this.material.uniforms.time!.value = this.elapsedSeconds;

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
        let nearestDistSq = Infinity;
        let nearestPoint = -1;
        const count = this.courseX.length;

        for (let point = 0; point < count; point += 1) {
            const dx = localX - (this.courseX[point] ?? 0);
            const dz = localZ - (this.courseZ[point] ?? 0);
            const distSq = dx * dx + dz * dz;

            if (distSq >= nearestDistSq) continue;

            nearestDistSq = distSq;
            nearestPoint = point;
        }

        if (nearestPoint < 0) return 0;

        const nearestDistance = Math.sqrt(nearestDistSq);
        const halfWidth = this.courseHalfWidth[nearestPoint] ?? 0;
        const withinChannel =
            1 - smoothstep(halfWidth, halfWidth + WATER_WADER.channelGrace, nearestDistance);
        if (withinChannel <= 0) return 0;

        const standingDepth = (this.courseWaterline[nearestPoint] ?? 0) - feetElevation;

        return withinChannel * smoothstep(-0.1, WATER_WADER.immersionDepth, standingDepth);
    }
}

function resampleCoursePoints(points: IWaterCourse["points"], targetStep: number): IWaterPoint[] {
    if (points.length < 2) return [...points];

    const resampled: IWaterPoint[] = [];

    for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[Math.max(0, i - 1)]!;
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const p3 = points[Math.min(points.length - 1, i + 2)]!;

        const segmentLength = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const steps = Math.max(1, Math.ceil(segmentLength / targetStep));

        for (let step = 0; step < steps; step += 1) {
            const t = step / steps;
            resampled.push({
                x: catmullRomAt(p0.x, p1.x, p2.x, p3.x, t),
                z: catmullRomAt(p0.z, p1.z, p2.z, p3.z, t),
                waterlineElevation: lerp(p1.waterlineElevation, p2.waterlineElevation, t),
                halfWidth: lerp(p1.halfWidth, p2.halfWidth, t),
                bedRatio: lerp(p1.bedRatio, p2.bedRatio, t),
            });
        }
    }

    const last = points[points.length - 1];
    if (last) resampled.push({ ...last });

    return resampled;
}

function buildWaterRibbon(points: IWaterPoint[], heightMap: TerrainSampleGrid): BufferGeometry {
    const widestReach = maximumHalfWidthOf(points) + WATER_CHANNEL.shoreReach;
    const columnsPerSide = Math.max(Math.ceil(widestReach / WATER_SURFACE.lateralStep), 1);
    const columnCount = columnsPerSide * 2 + 1;
    const vertexCount = points.length * columnCount;

    const positions = new Float32Array(vertexCount * 3);
    const waterDepths = new Float32Array(vertexCount);
    const flowDirections = new Float32Array(vertexCount * 2);
    const streamCoords = new Float32Array(vertexCount * 2);

    let accumulatedDistance = 0;

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) continue;

        const previous = points[index - 1] ?? point;
        const next = points[index + 1] ?? point;
        const travelX = next.x - previous.x;
        const travelZ = next.z - previous.z;
        const travelLength = Math.hypot(travelX, travelZ) || 1;
        const downstreamX = travelX / travelLength;
        const downstreamZ = travelZ / travelLength;

        if (index > 0) {
            accumulatedDistance += Math.hypot(point.x - previous.x, point.z - previous.z);
        }

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

            const surfaceElev = heightMap.surfaceElevationAt(localX, localZ);
            const dropBelowWater = point.waterlineElevation - surfaceElev;

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

    const geometry = new BufferGeometry();

    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("waterDepth", new BufferAttribute(waterDepths, 1));
    geometry.setAttribute("flowDirection", new BufferAttribute(flowDirections, 2));
    geometry.setAttribute("streamCoord", new BufferAttribute(streamCoords, 2));
    geometry.setIndex(
        new BufferAttribute(buildWetIndices(points.length, columnCount, waterDepths), 1)
    );
    geometry.computeBoundingSphere();

    return geometry;
}

function combineGeometries(geometries: BufferGeometry[]): BufferGeometry {
    if (geometries.length === 0) return new BufferGeometry();
    if (geometries.length === 1) return geometries[0]!;

    let totalPositions = 0;
    let totalIndices = 0;

    for (const geom of geometries) {
        totalPositions += geom.getAttribute("position")?.count ?? 0;
        totalIndices += geom.getIndex()?.count ?? 0;
    }

    const positions = new Float32Array(totalPositions * 3);
    const waterDepths = new Float32Array(totalPositions);
    const flowDirections = new Float32Array(totalPositions * 2);
    const streamCoords = new Float32Array(totalPositions * 2);
    const indices = new Uint32Array(totalIndices);

    let posOffset = 0;
    let vertexOffset = 0;
    let indexOffset = 0;

    for (const geom of geometries) {
        const posAttr = geom.getAttribute("position");
        if (!posAttr) continue;

        const count = posAttr.count;
        const pos = posAttr.array as Float32Array;
        const depth = geom.getAttribute("waterDepth").array as Float32Array;
        const flow = geom.getAttribute("flowDirection").array as Float32Array;
        const stream = geom.getAttribute("streamCoord").array as Float32Array;
        const idx = geom.getIndex()?.array as Uint32Array;

        positions.set(pos, posOffset * 3);
        waterDepths.set(depth, posOffset);
        flowDirections.set(flow, posOffset * 2);
        streamCoords.set(stream, posOffset * 2);

        if (idx) {
            for (let i = 0; i < idx.length; i += 1) {
                indices[indexOffset + i] = (idx[i] ?? 0) + vertexOffset;
            }
            indexOffset += idx.length;
        }

        posOffset += count;
        vertexOffset += count;
    }

    const combined = new BufferGeometry();
    combined.setAttribute("position", new BufferAttribute(positions, 3));
    combined.setAttribute("waterDepth", new BufferAttribute(waterDepths, 1));
    combined.setAttribute("flowDirection", new BufferAttribute(flowDirections, 2));
    combined.setAttribute("streamCoord", new BufferAttribute(streamCoords, 2));
    combined.setIndex(new BufferAttribute(indices, 1));
    combined.computeBoundingSphere();

    return combined;
}

function buildWetIndices(
    pointCount: number,
    columnCount: number,
    waterDepths: Float32Array
): Uint32Array {
    const indices: number[] = [];
    const margin = -WATER_SURFACE.wetQuadMargin;

    for (let index = 0; index < pointCount - 1; index += 1) {
        for (let column = 0; column < columnCount - 1; column += 1) {
            const nearLeft = index * columnCount + column;
            const nearRight = nearLeft + 1;
            const farLeft = nearLeft + columnCount;
            const farRight = farLeft + 1;

            const d1 = waterDepths[nearLeft] ?? 0;
            const d2 = waterDepths[nearRight] ?? 0;
            const d3 = waterDepths[farLeft] ?? 0;
            const d4 = waterDepths[farRight] ?? 0;

            if (d1 < -0.5 || d2 < -0.5 || d3 < -0.5 || d4 < -0.5) continue;

            const holdsWater = d1 > margin || d2 > margin || d3 > margin || d4 > margin;
            if (!holdsWater) continue;

            indices.push(nearLeft, farLeft, nearRight, nearRight, farLeft, farRight);
        }
    }

    return new Uint32Array(indices);
}

function maximumHalfWidthOf(points: IWaterPoint[]): number {
    let widest = 0;
    for (const point of points) widest = Math.max(widest, point.halfWidth);
    return widest;
}

const VERTEX_SHADER = /* glsl */ `
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

    void main() {
        float centerWeight = 1.0 - smoothstep(0.0, 1.0, abs(streamCoord.x));
        float localFlow = flowSpeed * (0.8 + 0.35 * centerWeight);

        float phaseA = (streamCoord.y * 0.38 + streamCoord.x * 0.95) - time * localFlow * 1.25;
        float phaseB = (streamCoord.y * 0.65 - streamCoord.x * 1.15) - time * localFlow * 1.65 + 1.4;
        float phaseC = (streamCoord.y * 0.22 + streamCoord.x * streamCoord.x * 0.65) - time * localFlow * 0.85 + 2.8;
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

const FRAGMENT_SHADER = /* glsl */ `
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

    vec3 surfaceNormalAt(vec2 surfacePosition, vec2 downstream, vec2 acrossStream) {
        vec2 slope = vec2(0.0);

        float centerWeight = 1.0 - smoothstep(0.0, 1.0, abs(vStreamCoord.x));
        float localFlow = flowSpeed * (0.8 + 0.35 * centerWeight);
        float phaseA = (vStreamCoord.y * 0.38 + vStreamCoord.x * 0.95) - time * localFlow * 1.25;
        float phaseB = (vStreamCoord.y * 0.65 - vStreamCoord.x * 1.15) - time * localFlow * 1.65 + 1.4;
        float phaseC = (vStreamCoord.y * 0.22 + vStreamCoord.x * vStreamCoord.x * 0.65) - time * localFlow * 0.85 + 2.8;

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

function surfaceUniforms(context: IWorldContext) {
    const { environment } = context;
    const { water, sky, lighting } = environment;

    return {
        shallowColor: { value: new Color(water.shallowColor) },
        deepColor: { value: new Color(water.deepColor) },
        sunColor: { value: new Color(lighting.keyColor) },
        sunDirection: { value: sunDirectionOf(sky) },
        skyColor: { value: new Color(sky.middle) },

        time: { value: 0 },
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
        waderRingWavelength: { value: WATER_WADER.ringWavelength },
        waderRingSpeed: { value: WATER_WADER.ringSpeed },
        waderRingFalloff: { value: WATER_WADER.ringFalloff },
        waderRingAmplitude: { value: WATER_WADER.ringAmplitude },
        waderContactFoamStrength: { value: WATER_WADER.contactFoamStrength },
    };
}

interface IWaderTarget {
    target: Object3D;
    feetOffset: number;
}
