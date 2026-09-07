import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Mesh,
    ShaderMaterial,
    Vector3,
    Vector4,
    type Object3D,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import type { ISkyGradient, IWaterProfile } from "@/types/theme";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { shoreAllowanceAt } from "@/world/water/WaterChannel";
import type { IWaterCourse } from "@/world/water/WaterCourse";
import { ATMOSPHERE } from "@/constants/rendering";
import { WATER_CHANNEL, WATER_SURFACE, WATER_WADER } from "@/constants/world";
import { clamp, lerp, smoothstep } from "@/lib/helpers";

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
    private readonly lastWaderPosition = new Vector3();
    private wader: IWaderTarget | null = null;
    private waderSpeed = 0;
    private elapsedSeconds = 0;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        course: IWaterCourse,
        heightMap: TerrainHeightMap
    ) {
        super("water-surface");

        this.centerX = center[0];
        this.centerZ = center[2];
        this.courseX = Float32Array.from(course.points, (point) => point.x);
        this.courseZ = Float32Array.from(course.points, (point) => point.z);
        this.courseWaterline = Float32Array.from(
            course.points,
            (point) => point.waterlineElevation
        );
        this.courseHalfWidth = Float32Array.from(course.points, (point) => point.halfWidth);

        this.material = new ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: surfaceUniforms(context.environment.water, context.environment.sky),
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });

        this.sceneObject = new Mesh(buildWaterRibbon(course, heightMap), this.material);
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.renderOrder = 1;
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;
    }

    follow(target: Object3D, feetOffset: number): void {
        this.wader = { target, feetOffset };
        this.lastWaderPosition.copy(target.position);
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

        const travelled = this.waderPosition.distanceTo(this.lastWaderPosition);
        this.lastWaderPosition.copy(this.waderPosition);

        const paceRatio = clamp(
            deltaSeconds > 0 ? travelled / deltaSeconds / WATER_WADER.speedReference : 0,
            0,
            1
        );

        this.waderSpeed = lerp(
            this.waderSpeed,
            paceRatio,
            clamp(deltaSeconds * WATER_WADER.speedSmoothing, 0, 1)
        );

        uniforms.waderPosition!.value.copy(this.waderPosition);
        uniforms.waderSpeed!.value = this.waderSpeed;
        uniforms.waderStrength!.value = this.immersionOf(
            this.waderPosition.x - this.centerX,
            this.waderPosition.z - this.centerZ,
            this.waderPosition.y - wader.feetOffset
        );
    }

    private immersionOf(localX: number, localZ: number, feetElevation: number): number {
        let nearestDistance = Infinity;
        let nearestPoint = -1;

        for (let point = 0; point < this.courseX.length; point += 1) {
            const distance = Math.hypot(
                localX - (this.courseX[point] ?? 0),
                localZ - (this.courseZ[point] ?? 0)
            );

            if (distance >= nearestDistance) continue;

            nearestDistance = distance;
            nearestPoint = point;
        }

        if (nearestPoint < 0) return 0;

        const halfWidth = this.courseHalfWidth[nearestPoint] ?? 0;
        const withinChannel =
            1 - smoothstep(halfWidth, halfWidth + WATER_WADER.channelGrace, nearestDistance);
        if (withinChannel <= 0) return 0;

        const standingDepth = (this.courseWaterline[nearestPoint] ?? 0) - feetElevation;

        return withinChannel * smoothstep(0, WATER_WADER.immersionDepth, standingDepth);
    }
}

function buildWaterRibbon(course: IWaterCourse, heightMap: TerrainHeightMap): BufferGeometry {
    const points = course.points;
    const widestReach = maximumHalfWidthOf(points) + WATER_CHANNEL.shoreReach;
    const columnsPerSide = Math.max(Math.ceil(widestReach / WATER_SURFACE.lateralStep), 1);
    const columnCount = columnsPerSide * 2 + 1;
    const vertexCount = points.length * columnCount;

    const positions = new Float32Array(vertexCount * 3);
    const waterDepths = new Float32Array(vertexCount);
    const flowDirections = new Float32Array(vertexCount * 2);

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

        const reach = point.halfWidth + WATER_CHANNEL.shoreReach;

        for (let column = 0; column < columnCount; column += 1) {
            const offset = ((column - columnsPerSide) / columnsPerSide) * reach;
            const localX = point.x + downstreamZ * offset;
            const localZ = point.z - downstreamX * offset;
            const vertex = index * columnCount + column;

            positions[vertex * 3] = localX;
            positions[vertex * 3 + 1] = point.waterlineElevation;
            positions[vertex * 3 + 2] = localZ;

            waterDepths[vertex] = Math.min(
                point.waterlineElevation - heightMap.surfaceElevationAt(localX, localZ),
                shoreAllowanceAt(Math.abs(offset), point.halfWidth)
            );
            flowDirections[vertex * 2] = downstreamX;
            flowDirections[vertex * 2 + 1] = downstreamZ;
        }
    }

    const geometry = new BufferGeometry();

    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("waterDepth", new BufferAttribute(waterDepths, 1));
    geometry.setAttribute("flowDirection", new BufferAttribute(flowDirections, 2));
    geometry.setIndex(
        new BufferAttribute(buildWetIndices(points.length, columnCount, waterDepths), 1)
    );
    geometry.computeBoundingSphere();

    return geometry;
}

function buildWetIndices(
    pointCount: number,
    columnCount: number,
    waterDepths: Float32Array
): Uint32Array {
    const indices: number[] = [];

    for (let index = 0; index < pointCount - 1; index += 1)
        for (let column = 0; column < columnCount - 1; column += 1) {
            const nearLeft = index * columnCount + column;
            const nearRight = nearLeft + 1;
            const farLeft = nearLeft + columnCount;
            const farRight = farLeft + 1;

            const holdsWater = [nearLeft, nearRight, farLeft, farRight].some(
                (corner) => (waterDepths[corner] ?? 0) > -WATER_SURFACE.wetQuadMargin
            );
            if (!holdsWater) continue;

            indices.push(nearLeft, farLeft, nearRight, nearRight, farLeft, farRight);
        }

    return new Uint32Array(indices);
}

function maximumHalfWidthOf(points: IWaterCourse["points"]): number {
    let widest = 0;

    for (const point of points) widest = Math.max(widest, point.halfWidth);

    return widest;
}

const VERTEX_SHADER = /* glsl */ `
    attribute float waterDepth;
    attribute vec2 flowDirection;

    varying float vWaterDepth;
    varying vec2 vFlowDirection;
    varying vec3 vWorldPosition;

    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);

        vWaterDepth = waterDepth;
        vFlowDirection = flowDirection;
        vWorldPosition = worldPosition.xyz;

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 shallowColor;
    uniform vec3 deepColor;
    uniform vec3 foamColor;
    uniform vec3 skyZenithColor;
    uniform vec3 skyMiddleColor;
    uniform vec3 skyHorizonColor;
    uniform vec3 sunColor;
    uniform vec3 sunDirection;
    uniform float skyMiddleAltitude;

    uniform float time;
    uniform float depthFadeRange;
    uniform float shallowAlpha;
    uniform float deepAlpha;
    uniform float flowSpeed;

    uniform vec4 rippleWavelengths;
    uniform vec4 rippleAmplitudes;
    uniform vec4 rippleDrifts;

    uniform float reflectivityAtNormal;
    uniform float grazingCurve;
    uniform float specularSharpness;
    uniform float specularStrength;
    uniform float glitterThreshold;
    uniform float glitterGrain;
    uniform float causticWavelength;
    uniform float causticStrength;
    uniform float causticDepthReach;

    uniform float foamDepth;
    uniform float foamSoftness;
    uniform float foamBreakupScale;
    uniform float foamBreakupStrength;
    uniform float foamColorMix;
    uniform float foamAlpha;

    uniform vec3 waderPosition;
    uniform float waderStrength;
    uniform float waderSpeed;
    uniform float waderRingWavelength;
    uniform float waderRingSpeed;
    uniform float waderRingFalloff;
    uniform float waderRingAmplitude;
    uniform float waderCollarRadius;
    uniform float waderCollarSoftness;
    uniform float waderCollarStrength;

    varying float vWaterDepth;
    varying vec2 vFlowDirection;
    varying vec3 vWorldPosition;

    /* one directional ripple. the slope is the analytic derivative of the wave, so a lively normal
       costs four cosines and not a single texture fetch */
    vec2 rippleSlopeOf(
        vec2 surfacePosition,
        vec2 downstream,
        vec2 rippleDirection,
        float wavelength,
        float amplitude,
        float drift
    ) {
        vec2 driftedPosition = surfacePosition - downstream * (time * flowSpeed * drift);

        return rippleDirection * cos(dot(driftedPosition, rippleDirection) / wavelength) * amplitude;
    }

    vec2 waderSlopeAt(vec2 surfacePosition) {
        vec2 fromWader = surfacePosition - waderPosition.xz;
        float waderDistance = length(fromWader) + 1e-4;

        float fade = exp(-waderDistance / waderRingFalloff) * waderStrength;
        if (fade < 0.001) return vec2(0.0);

        float ring = cos(waderDistance / waderRingWavelength - time * waderRingSpeed);

        return (fromWader / waderDistance) * ring * waderRingAmplitude * fade;
    }

    vec3 surfaceNormalAt(vec2 surfacePosition, vec2 downstream, vec2 acrossStream) {
        vec2 slope = vec2(0.0);

        slope += rippleSlopeOf(surfacePosition, downstream, downstream,
            rippleWavelengths.x, rippleAmplitudes.x, rippleDrifts.x);
        slope += rippleSlopeOf(surfacePosition, downstream, acrossStream,
            rippleWavelengths.y, rippleAmplitudes.y, rippleDrifts.y);
        slope += rippleSlopeOf(surfacePosition, downstream, normalize(downstream + acrossStream),
            rippleWavelengths.z, rippleAmplitudes.z, rippleDrifts.z);
        slope += rippleSlopeOf(surfacePosition, downstream, normalize(downstream - acrossStream),
            rippleWavelengths.w, rippleAmplitudes.w, rippleDrifts.w);
        slope += waderSlopeAt(surfacePosition);

        return normalize(vec3(-slope.x, 1.0, -slope.y));
    }

    vec3 reflectedSkyAt(vec3 reflectedDirection) {
        float altitude = reflectedDirection.y;

        if (altitude < 0.0) return skyHorizonColor;

        return mix(
            mix(skyHorizonColor, skyMiddleColor, smoothstep(0.0, skyMiddleAltitude, altitude)),
            skyZenithColor,
            smoothstep(skyMiddleAltitude, 1.0, altitude)
        );
    }

    float fresnelReflectanceOf(float viewAlignment) {
        return reflectivityAtNormal +
            (1.0 - reflectivityAtNormal) * pow(1.0 - viewAlignment, grazingCurve);
    }

    float causticWebAt(vec2 surfacePosition, vec2 downstream) {
        vec2 drifted = surfacePosition / causticWavelength - downstream * (time * flowSpeed * 0.7);
        float web = sin(drifted.x + sin(drifted.y * 0.7)) * sin(drifted.y + sin(drifted.x * 0.7));

        return pow(max(web, 0.0), 3.0);
    }

    float hashOf(vec2 seed) {
        return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
    }

    float foamCoverageAt(vec2 surfacePosition) {
        float breakup =
            hashOf(floor(surfacePosition / foamBreakupScale)) * foamBreakupStrength;

        return 1.0 - smoothstep(
            foamDepth - foamSoftness,
            foamDepth + foamSoftness + breakup * foamSoftness,
            vWaterDepth
        );
    }

    void main() {
        if (vWaterDepth <= 0.0) discard;

        vec2 surfacePosition = vWorldPosition.xz;
        vec2 downstream = normalize(vFlowDirection + vec2(1e-5, 0.0));
        vec2 acrossStream = vec2(-downstream.y, downstream.x);

        vec3 surfaceNormal = surfaceNormalAt(surfacePosition, downstream, acrossStream);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float viewAlignment = max(dot(surfaceNormal, viewDirection), 0.0);

        float depthRatio = smoothstep(0.0, depthFadeRange, vWaterDepth);

        vec3 body = mix(shallowColor, deepColor, depthRatio);
        body += causticWebAt(surfacePosition, downstream) *
            (1.0 - smoothstep(0.0, causticDepthReach, vWaterDepth)) *
            causticStrength;

        vec3 reflectedDirection = reflect(-viewDirection, surfaceNormal);
        float fresnel = fresnelReflectanceOf(viewAlignment);

        vec3 halfway = normalize(sunDirection + viewDirection);
        float sheen = pow(max(dot(surfaceNormal, halfway), 0.0), specularSharpness);
        float grain = hashOf(floor(surfacePosition * glitterGrain));
        float glitter = smoothstep(glitterThreshold, 1.0, sheen * grain);

        float foam = foamCoverageAt(surfacePosition);
        float collar =
            (1.0 - smoothstep(
                waderCollarRadius * waderCollarSoftness,
                waderCollarRadius,
                length(surfacePosition - waderPosition.xz)
            )) * waderStrength * waderCollarStrength * mix(0.3, 1.0, waderSpeed);
        foam = clamp(foam + collar, 0.0, 1.0);

        vec3 surfaceColor = mix(body, reflectedSkyAt(reflectedDirection), fresnel);
        surfaceColor += sunColor * glitter * specularStrength;
        surfaceColor = mix(surfaceColor, foamColor, foam * foamColorMix);

        float bodyAlpha = max(mix(shallowAlpha, deepAlpha, depthRatio), fresnel);

        gl_FragColor = vec4(surfaceColor, max(bodyAlpha, foam * foamAlpha));
    }
`;

function surfaceUniforms(water: IWaterProfile, sky: ISkyGradient) {
    return {
        shallowColor: { value: new Color(water.shallowColor) },
        deepColor: { value: new Color(water.deepColor) },
        foamColor: { value: new Color(water.foamColor) },
        skyZenithColor: { value: new Color(sky.zenith) },
        skyMiddleColor: { value: new Color(sky.middle) },
        skyHorizonColor: { value: new Color(sky.horizon) },
        sunColor: { value: new Color(sky.sun) },
        sunDirection: { value: sunDirectionOf(sky) },
        skyMiddleAltitude: { value: ATMOSPHERE.middleAltitude },

        time: { value: 0 },
        depthFadeRange: { value: WATER_SURFACE.depthFadeRange },
        shallowAlpha: { value: WATER_SURFACE.shallowAlpha },
        deepAlpha: { value: WATER_SURFACE.deepAlpha },
        flowSpeed: { value: WATER_SURFACE.flowSpeed },

        rippleWavelengths: { value: new Vector4(...WATER_SURFACE.rippleWavelengths) },
        rippleAmplitudes: { value: new Vector4(...WATER_SURFACE.rippleAmplitudes) },
        rippleDrifts: { value: new Vector4(...WATER_SURFACE.rippleDrifts) },

        reflectivityAtNormal: { value: WATER_SURFACE.reflectivityAtNormal },
        grazingCurve: { value: WATER_SURFACE.grazingCurve },
        specularSharpness: { value: WATER_SURFACE.specularSharpness },
        specularStrength: { value: WATER_SURFACE.specularStrength },
        glitterThreshold: { value: WATER_SURFACE.glitterThreshold },
        glitterGrain: { value: WATER_SURFACE.glitterGrain },
        causticWavelength: { value: WATER_SURFACE.causticWavelength },
        causticStrength: { value: WATER_SURFACE.causticStrength },
        causticDepthReach: { value: WATER_SURFACE.causticDepthReach },

        foamDepth: { value: WATER_SURFACE.foamDepth },
        foamSoftness: { value: WATER_SURFACE.foamSoftness },
        foamBreakupScale: { value: WATER_SURFACE.foamBreakupScale },
        foamBreakupStrength: { value: WATER_SURFACE.foamBreakupStrength },
        foamColorMix: { value: WATER_SURFACE.foamColorMix },
        foamAlpha: { value: WATER_SURFACE.foamAlpha },

        waderPosition: { value: new Vector3() },
        waderStrength: { value: 0 },
        waderSpeed: { value: 0 },
        waderRingWavelength: { value: WATER_WADER.ringWavelength },
        waderRingSpeed: { value: WATER_WADER.ringSpeed },
        waderRingFalloff: { value: WATER_WADER.ringFalloff },
        waderRingAmplitude: { value: WATER_WADER.ringAmplitude },
        waderCollarRadius: { value: WATER_WADER.collarRadius },
        waderCollarSoftness: { value: WATER_WADER.collarSoftness },
        waderCollarStrength: { value: WATER_WADER.collarStrength },
    };
}

interface IWaderTarget {
    target: Object3D;
    feetOffset: number;
}
