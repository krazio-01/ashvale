import { Color, Uniform, Vector2 } from "three";
import type { Camera, Texture, WebGLRenderer } from "three";
import { ViewPositionEffect } from "@/world/effects/ViewPositionEffect";
import { OUTLINE } from "@/constants/rendering";

const fragmentShader = `
    uniform sampler2D foliageMask;
    uniform vec3 outlineColor;
    uniform float edgeThreshold;
    uniform float fadeStartDistance;
    uniform float fadeEndDistance;
    uniform float opacity;
    uniform float thickness;
    uniform vec2 texelSize;
    uniform float debugView;

    bool isFoliage(const in vec2 uv) {
        return texture2D(foliageMask, uv).r > 0.5;
    }

    float gapBehindPlane(const in vec3 neighbour, const in vec3 center, const in vec3 normal) {
        return -dot(neighbour - center, normal);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 center = viewPositionAt(uv);
        float centerDistance = length(center);
        float distanceFade = 1.0 - smoothstep(fadeStartDistance, fadeEndDistance, centerDistance);

        if (distanceFade <= 0.001) {
            outputColor = inputColor;
            return;
        }

        vec2 offset = texelSize * thickness;
        vec2 rightUv = uv + vec2(offset.x, 0.0);
        vec2 leftUv = uv - vec2(offset.x, 0.0);
        vec2 upUv = uv + vec2(0.0, offset.y);
        vec2 downUv = uv - vec2(0.0, offset.y);

        if (
            isFoliage(uv) && isFoliage(rightUv) && isFoliage(leftUv)
                && isFoliage(upUv) && isFoliage(downUv)
        ) {
            outputColor = inputColor;
            return;
        }

        vec3 right = viewPositionAt(rightUv);
        vec3 left = viewPositionAt(leftUv);
        vec3 up = viewPositionAt(upUv);
        vec3 down = viewPositionAt(downUv);

        vec3 horizontal = abs(right.z - center.z) < abs(center.z - left.z)
            ? right - center
            : center - left;
        vec3 vertical = abs(up.z - center.z) < abs(center.z - down.z) ? up - center : center - down;
        vec3 surfaceNormal = normalize(cross(horizontal, vertical));

        float widestGap = max(
            max(
                gapBehindPlane(right, center, surfaceNormal),
                gapBehindPlane(left, center, surfaceNormal)
            ),
            max(
                gapBehindPlane(up, center, surfaceNormal),
                gapBehindPlane(down, center, surfaceNormal)
            )
        );

        float scaledThreshold = edgeThreshold * centerDistance;
        float edge = smoothstep(scaledThreshold, scaledThreshold * 2.0, max(widestGap, 0.0));

        if (debugView > 0.5) {
            outputColor = vec4(edge, edge, edge, 1.0);
            return;
        }

        float edgeStrength = edge * distanceFade * opacity;

        outputColor = vec4(mix(inputColor.rgb, outlineColor, edgeStrength), inputColor.a);
    }
`;

export interface IOutlineEffectOptions {
    camera: Camera;
    foliageMask: Texture | null;
    outlineColor: string;
}

export class OutlineEffect extends ViewPositionEffect {
    private readonly texelSize: Uniform<Vector2>;
    private readonly scratchBufferSize = new Vector2();

    constructor({ camera, foliageMask, outlineColor }: IOutlineEffectOptions) {
        const texelSizeUniform = new Uniform(new Vector2());
        const uniforms = new Map<string, Uniform<unknown>>([
            ["foliageMask", new Uniform(foliageMask)],
            ["outlineColor", new Uniform(new Color(outlineColor))],
            ["edgeThreshold", new Uniform(OUTLINE.edgeThreshold)],
            ["fadeStartDistance", new Uniform(OUTLINE.fadeStartDistance)],
            ["fadeEndDistance", new Uniform(OUTLINE.fadeEndDistance)],
            ["opacity", new Uniform(OUTLINE.opacity)],
            ["thickness", new Uniform(OUTLINE.thickness)],
            ["texelSize", texelSizeUniform],
            ["debugView", new Uniform(OUTLINE.debugView ? 1 : 0)],
        ]);

        super("OutlineEffect", fragmentShader, uniforms, camera);
        this.texelSize = texelSizeUniform;
    }

    override update(renderer: WebGLRenderer): void {
        super.update(renderer);

        renderer.getDrawingBufferSize(this.scratchBufferSize);
        this.texelSize.value.set(1 / this.scratchBufferSize.x, 1 / this.scratchBufferSize.y);
    }
}
