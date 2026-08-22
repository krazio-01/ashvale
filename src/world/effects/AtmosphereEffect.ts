import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Matrix4, Uniform } from "three";
import type { Camera } from "three";
import { sunDirectionOf } from "@/themes/themeManifests";
import type { ISkyGradient } from "@/types/theme";
import { ATMOSPHERE } from "@/constants/game";

const fragmentShader = `
    uniform mat4 inverseProjectionMatrix;
    uniform mat4 cameraWorldMatrix;
    uniform vec3 horizonColor;
    uniform vec3 sunGlowColor;
    uniform vec3 sunDirection;
    uniform float density;
    uniform float baseHeight;
    uniform float heightFadeRate;
    uniform float heightInfluence;
    uniform float sunGlowStrength;
    uniform float sunGlowFalloff;

    vec3 viewPositionAt(const in vec2 uv, const in float viewZ) {
        vec4 unprojected = inverseProjectionMatrix * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
        vec3 ray = unprojected.xyz / unprojected.w;

        return ray * (viewZ / ray.z);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float depth = readDepth(uv);

        // The sky dome writes no depth, so untouched pixels stay at the clear value and are
        // left alone: the gradient shader already paints its own haze into the horizon.
        if (depth >= 1.0) {
            outputColor = inputColor;
            return;
        }

        vec3 viewPosition = viewPositionAt(uv, getViewZ(depth));
        vec3 worldPosition = (cameraWorldMatrix * vec4(viewPosition, 1.0)).xyz;
        vec3 cameraWorldPosition = cameraWorldMatrix[3].xyz;

        // Sampling height at the surface rather than integrating along the ray is the cheap
        // approximation, and it happens to give the silhouette we want: valleys fill with
        // haze while peaks stay legible above it.
        float heightFade = exp(-max(worldPosition.y - baseHeight, 0.0) * heightFadeRate);
        float distanceFog = 1.0 - exp(-length(viewPosition) * density);
        float hazeAmount = clamp(distanceFog * mix(1.0, heightFade, heightInfluence), 0.0, 1.0);

        vec3 viewDirection = normalize(worldPosition - cameraWorldPosition);
        float sunAlignment = max(dot(viewDirection, sunDirection), 0.0);
        float sunInfluence = pow(sunAlignment, sunGlowFalloff) * sunGlowStrength;

        vec3 hazeColor = mix(horizonColor, sunGlowColor, sunInfluence);

        outputColor = vec4(mix(inputColor.rgb, hazeColor, hazeAmount), inputColor.a);
    }
`;

export interface IAtmosphereEffectOptions {
    camera: Camera;
    sky: ISkyGradient;
    fogDensity: number;
}

export class AtmosphereEffect extends Effect {
    private readonly camera: Camera;

    constructor({ camera, sky, fogDensity }: IAtmosphereEffectOptions) {
        const uniforms = new Map<string, Uniform<unknown>>([
            ["inverseProjectionMatrix", new Uniform(new Matrix4())],
            ["cameraWorldMatrix", new Uniform(new Matrix4())],
            ["horizonColor", new Uniform(new Color(sky.horizon))],
            ["sunGlowColor", new Uniform(new Color(sky.glow))],
            ["sunDirection", new Uniform(sunDirectionOf(sky))],
            ["density", new Uniform(fogDensity)],
            ["baseHeight", new Uniform(ATMOSPHERE.hazeBaseHeight)],
            ["heightFadeRate", new Uniform(ATMOSPHERE.hazeHeightFadeRate)],
            ["heightInfluence", new Uniform(ATMOSPHERE.hazeHeightInfluence)],
            ["sunGlowStrength", new Uniform(ATMOSPHERE.sunGlowStrength)],
            ["sunGlowFalloff", new Uniform(ATMOSPHERE.sunGlowFalloff)],
        ]);

        super("AtmosphereEffect", fragmentShader, {
            blendFunction: BlendFunction.NORMAL,
            attributes: EffectAttribute.DEPTH,
            uniforms,
        });

        this.camera = camera;
    }

    override update(): void {
        const inverseProjection = this.uniforms.get("inverseProjectionMatrix");
        const cameraWorld = this.uniforms.get("cameraWorldMatrix");
        if (!inverseProjection || !cameraWorld) return;

        inverseProjection.value.copy(this.camera.projectionMatrixInverse);
        cameraWorld.value.copy(this.camera.matrixWorld);
    }
}
