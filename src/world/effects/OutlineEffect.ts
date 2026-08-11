import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Uniform, Vector2 } from "three";
import type { Texture, WebGLRenderer } from "three";
import { OUTLINE } from "@/constants/game";

const fragmentShader = `
    uniform sampler2D normalBuffer;
    uniform vec3 outlineColor;
    uniform float normalThreshold;
    uniform float depthThreshold;
    uniform vec2 texelSize;
    uniform float debugView;

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 normalCenter = texture2D(normalBuffer, uv).rgb * 2.0 - 1.0;
        float depthCenter = texture2D(depthBuffer, uv).r;

        vec3 normalRight = texture2D(normalBuffer, uv + vec2(texelSize.x, 0.0)).rgb * 2.0 - 1.0;
        vec3 normalLeft = texture2D(normalBuffer, uv - vec2(texelSize.x, 0.0)).rgb * 2.0 - 1.0;
        vec3 normalUp = texture2D(normalBuffer, uv + vec2(0.0, texelSize.y)).rgb * 2.0 - 1.0;
        vec3 normalDown = texture2D(normalBuffer, uv - vec2(0.0, texelSize.y)).rgb * 2.0 - 1.0;

        float depthRight = texture2D(depthBuffer, uv + vec2(texelSize.x, 0.0)).r;
        float depthLeft = texture2D(depthBuffer, uv - vec2(texelSize.x, 0.0)).r;
        float depthUp = texture2D(depthBuffer, uv + vec2(0.0, texelSize.y)).r;
        float depthDown = texture2D(depthBuffer, uv - vec2(0.0, texelSize.y)).r;

        float normalEdge = max(
            max(1.0 - dot(normalCenter, normalRight), 1.0 - dot(normalCenter, normalLeft)),
            max(1.0 - dot(normalCenter, normalUp), 1.0 - dot(normalCenter, normalDown))
        );

        float depthEdge = max(
            max(abs(depthCenter - depthRight), abs(depthCenter - depthLeft)),
            max(abs(depthCenter - depthUp), abs(depthCenter - depthDown))
        );

        // Raw signal view: red = normal-edge strength, green = depth-edge strength (scaled up, it's tiny)
        if (debugView > 0.5) {
            outputColor = vec4(normalEdge, depthEdge * 200.0, 0.0, 1.0);
            return;
        }

        float isEdge = clamp(
            step(normalThreshold, normalEdge) + step(depthThreshold, depthEdge),
            0.0,
            1.0
        );

        outputColor = vec4(mix(inputColor.rgb, outlineColor, isEdge), inputColor.a);
    }
`;

export interface IOutlineEffectOptions {
    normalBuffer: Texture | null;
}

export class OutlineEffect extends Effect {
    constructor({ normalBuffer }: IOutlineEffectOptions) {
        const uniforms = new Map<string, Uniform<unknown>>([
            ["normalBuffer", new Uniform(normalBuffer)],
            ["outlineColor", new Uniform(new Color(OUTLINE.color))],
            ["normalThreshold", new Uniform(OUTLINE.normalThreshold)],
            ["depthThreshold", new Uniform(OUTLINE.depthThreshold)],
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
