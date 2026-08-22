import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Uniform, Vector2 } from "three";
import type { Texture, WebGLRenderer } from "three";
import { OUTLINE } from "@/constants/game";

const fragmentShader = `
    uniform sampler2D normalBuffer;
    uniform sampler2D foliageMask;
    uniform vec3 outlineColor;
    uniform float normalThreshold;
    uniform float depthThreshold;
    uniform float grazingCompensation;
    uniform float fadeStartDistance;
    uniform float fadeEndDistance;
    uniform float opacity;
    uniform float thickness;
    uniform vec2 texelSize;
    uniform float debugView;

    float distanceAt(const in vec2 uv) {
        return -getViewZ(readDepth(uv));
    }

    bool isFoliage(const in vec2 uv) {
        return texture2D(foliageMask, uv).r > 0.5;
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float centerDistance = distanceAt(uv);
        float distanceFade = 1.0 - smoothstep(fadeStartDistance, fadeEndDistance, centerDistance);

        if (distanceFade <= 0.001) {
            outputColor = inputColor;
            return;
        }

        vec2 offset = texelSize * thickness;
        vec3 centerNormal = texture2D(normalBuffer, uv).rgb * 2.0 - 1.0;
        bool centerIsFoliage = isFoliage(uv);

        vec2 rightUv = uv + vec2(offset.x, 0.0);
        vec2 leftUv = uv - vec2(offset.x, 0.0);
        vec2 upUv = uv + vec2(0.0, offset.y);
        vec2 downUv = uv - vec2(0.0, offset.y);

        // Leaf cards inside the same canopy overlap constantly, which reads as noise rather
        // than a real edge. A direction is only skipped when both sides are foliage, so the
        // canopy's outer silhouette against sky or ground still draws normally.
        bool skipRight = centerIsFoliage && isFoliage(rightUv);
        bool skipLeft = centerIsFoliage && isFoliage(leftUv);
        bool skipUp = centerIsFoliage && isFoliage(upUv);
        bool skipDown = centerIsFoliage && isFoliage(downUv);

        // Only the nearer surface draws its own outline, which halves line width: testing
        // both sides marks two pixels for every one boundary.
        float rightGap = skipRight ? 0.0 : distanceAt(rightUv) - centerDistance;
        float leftGap = skipLeft ? 0.0 : distanceAt(leftUv) - centerDistance;
        float upGap = skipUp ? 0.0 : distanceAt(upUv) - centerDistance;
        float downGap = skipDown ? 0.0 : distanceAt(downUv) - centerDistance;

        float nearestGap = max(max(rightGap, leftGap), max(upGap, downGap));

        // A surface angled away from the camera changes depth quickly across the screen
        // without being an edge, so its threshold widens by how far it is turned away.
        float facingCamera = max(abs(centerNormal.z), grazingCompensation);
        float scaledDepthThreshold = (depthThreshold * centerDistance) / facingCamera;

        float depthEdge = smoothstep(
            scaledDepthThreshold,
            scaledDepthThreshold * 2.0,
            max(nearestGap, 0.0)
        );

        vec3 rightNormal = texture2D(normalBuffer, rightUv).rgb * 2.0 - 1.0;
        vec3 leftNormal = texture2D(normalBuffer, leftUv).rgb * 2.0 - 1.0;
        vec3 upNormal = texture2D(normalBuffer, upUv).rgb * 2.0 - 1.0;
        vec3 downNormal = texture2D(normalBuffer, downUv).rgb * 2.0 - 1.0;

        float rightNormalDiff = skipRight ? 0.0 : 1.0 - dot(centerNormal, rightNormal);
        float leftNormalDiff = skipLeft ? 0.0 : 1.0 - dot(centerNormal, leftNormal);
        float upNormalDiff = skipUp ? 0.0 : 1.0 - dot(centerNormal, upNormal);
        float downNormalDiff = skipDown ? 0.0 : 1.0 - dot(centerNormal, downNormal);

        float normalDifference = max(
            max(rightNormalDiff, leftNormalDiff),
            max(upNormalDiff, downNormalDiff)
        );

        float normalEdge = smoothstep(
            normalThreshold,
            normalThreshold * 1.6,
            normalDifference
        );

        if (debugView > 0.5) {
            outputColor = vec4(normalEdge, depthEdge, 0.0, 1.0);
            return;
        }

        float edgeStrength = max(normalEdge, depthEdge) * distanceFade * opacity;

        outputColor = vec4(mix(inputColor.rgb, outlineColor, edgeStrength), inputColor.a);
    }
`;

export interface IOutlineEffectOptions {
    normalBuffer: Texture | null;
    foliageMask: Texture | null;
    outlineColor: string;
}

export class OutlineEffect extends Effect {
    constructor({ normalBuffer, foliageMask, outlineColor }: IOutlineEffectOptions) {
        const uniforms = new Map<string, Uniform<unknown>>([
            ["normalBuffer", new Uniform(normalBuffer)],
            ["foliageMask", new Uniform(foliageMask)],
            ["outlineColor", new Uniform(new Color(outlineColor))],
            ["normalThreshold", new Uniform(OUTLINE.normalThreshold)],
            ["depthThreshold", new Uniform(OUTLINE.depthThreshold)],
            ["grazingCompensation", new Uniform(OUTLINE.grazingCompensation)],
            ["fadeStartDistance", new Uniform(OUTLINE.fadeStartDistance)],
            ["fadeEndDistance", new Uniform(OUTLINE.fadeEndDistance)],
            ["opacity", new Uniform(OUTLINE.opacity)],
            ["thickness", new Uniform(OUTLINE.thickness)],
            ["texelSize", new Uniform(new Vector2())],
            ["debugView", new Uniform(OUTLINE.debugView ? 1 : 0)],
        ]);

        super("OutlineEffect", fragmentShader, {
            blendFunction: BlendFunction.NORMAL,
            attributes: EffectAttribute.DEPTH,
            uniforms,
        });
    }

    override update(renderer: WebGLRenderer): void {
        const texelSizeUniform = this.uniforms.get("texelSize");
        if (!texelSizeUniform) return;

        const bufferSize = renderer.getDrawingBufferSize(new Vector2());
        texelSizeUniform.value.set(1 / bufferSize.x, 1 / bufferSize.y);
    }
}
