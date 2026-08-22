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
    }

    override update(_renderer: WebGLRenderer): void {
        const inverseProjection = this.uniforms.get("inverseProjectionMatrix");
        if (inverseProjection) inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    }
}
