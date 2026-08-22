import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Uniform, Vector2 } from "three";
import type { Texture, WebGLRenderer } from "three";
import { OUTLINE } from "@/constants/game";

const fragmentShader = `
    uniform sampler2D normalBuffer;
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

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float centerDistance = distanceAt(uv);
        float distanceFade = 1.0 - smoothstep(fadeStartDistance, fadeEndDistance, centerDistance);

        if (distanceFade <= 0.001) {
            outputColor = inputColor;
            return;
        }

        vec2 offset = texelSize * thickness;
        vec3 centerNormal = texture2D(normalBuffer, uv).rgb * 2.0 - 1.0;

        float rightDistance = distanceAt(uv + vec2(offset.x, 0.0));
        float leftDistance = distanceAt(uv - vec2(offset.x, 0.0));
        float upDistance = distanceAt(uv + vec2(0.0, offset.y));
        float downDistance = distanceAt(uv - vec2(0.0, offset.y));

        // Only the nearer surface draws its own outline, which halves line width: testing
        // both sides marks two pixels for every one boundary.
        float nearestGap = max(
            max(rightDistance - centerDistance, leftDistance - centerDistance),
            max(upDistance - centerDistance, downDistance - centerDistance)
        );

        // A surface angled away from the camera changes depth quickly across the screen
        // without being an edge, so its threshold widens by how far it is turned away.
        float facingCamera = max(abs(centerNormal.z), grazingCompensation);
        float scaledDepthThreshold = (depthThreshold * centerDistance) / facingCamera;

        float depthEdge = smoothstep(
            scaledDepthThreshold,
            scaledDepthThreshold * 2.0,
            max(nearestGap, 0.0)
        );

        vec3 rightNormal = texture2D(normalBuffer, uv + vec2(offset.x, 0.0)).rgb * 2.0 - 1.0;
        vec3 leftNormal = texture2D(normalBuffer, uv - vec2(offset.x, 0.0)).rgb * 2.0 - 1.0;
        vec3 upNormal = texture2D(normalBuffer, uv + vec2(0.0, offset.y)).rgb * 2.0 - 1.0;
        vec3 downNormal = texture2D(normalBuffer, uv - vec2(0.0, offset.y)).rgb * 2.0 - 1.0;

        float normalDifference = max(
            max(1.0 - dot(centerNormal, rightNormal), 1.0 - dot(centerNormal, leftNormal)),
            max(1.0 - dot(centerNormal, upNormal), 1.0 - dot(centerNormal, downNormal))
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
    outlineColor: string;
}

export class OutlineEffect extends Effect {
    constructor({ normalBuffer, outlineColor }: IOutlineEffectOptions) {
        const uniforms = new Map<string, Uniform<unknown>>([
            ["normalBuffer", new Uniform(normalBuffer)],
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
