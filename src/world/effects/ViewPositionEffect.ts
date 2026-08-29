import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Matrix4, Uniform } from "three";
import type { Camera, WebGLRenderer } from "three";

const VIEW_POSITION_FUNCTION = /* glsl */ `
    uniform mat4 inverseProjectionMatrix;

    vec3 viewPositionAt(const in vec2 uv) {
        vec4 unprojected = inverseProjectionMatrix * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
        vec3 ray = unprojected.xyz / unprojected.w;

        return ray * (getViewZ(readDepth(uv)) / ray.z);
    }
`;

export abstract class ViewPositionEffect extends Effect {
    protected readonly camera: Camera;
    private readonly inverseProjectionMatrix: Uniform<Matrix4>;

    protected constructor(
        name: string,
        fragmentShader: string,
        uniforms: Map<string, Uniform<unknown>>,
        camera: Camera
    ) {
        uniforms.set("inverseProjectionMatrix", new Uniform(new Matrix4()));

        super(name, VIEW_POSITION_FUNCTION + fragmentShader, {
            blendFunction: BlendFunction.NORMAL,
            attributes: EffectAttribute.DEPTH,
            uniforms,
        });

        this.camera = camera;
        this.inverseProjectionMatrix = uniforms.get("inverseProjectionMatrix") as Uniform<Matrix4>;
    }

    override update(_renderer: WebGLRenderer): void {
        this.inverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    }
}
