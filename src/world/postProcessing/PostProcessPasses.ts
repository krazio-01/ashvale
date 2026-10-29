import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import {
    Matrix4,
    Uniform,
    Camera,
    WebGLRenderer,
    Layers,
    MeshBasicMaterial,
    Scene,
    WebGLRenderTarget,
    Color,
    Vector2,
} from "three";
import type { Texture } from "three";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import type { ISkyGradient } from "@/types/world";
import { ATMOSPHERE, OUTLINE } from "@/constants/world";

const VIEW_POSITION_FUNCTION = `
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

export const FOLIAGE_LAYER = 1;

const maskLayers = new Layers();
maskLayers.set(FOLIAGE_LAYER);

export const SCENE_LIGHT_LAYERS = new Layers();
SCENE_LIGHT_LAYERS.enable(FOLIAGE_LAYER);

export class FoliageMaskPass {
    readonly renderTarget: WebGLRenderTarget;

    private readonly maskMaterial = new MeshBasicMaterial({ color: 0xffffff });

    constructor(width: number, height: number) {
        this.renderTarget = new WebGLRenderTarget(width, height);
    }

    setSize(width: number, height: number): void {
        this.renderTarget.setSize(width, height);
    }

    render(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
        const previousCameraLayerMask = camera.layers.mask;
        const previousOverrideMaterial = scene.overrideMaterial;
        const previousRenderTarget = renderer.getRenderTarget();
        const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;

        renderer.shadowMap.autoUpdate = false;
        camera.layers.mask = maskLayers.mask;
        scene.overrideMaterial = this.maskMaterial;

        renderer.setRenderTarget(this.renderTarget);
        renderer.clear();
        renderer.render(scene, camera);

        renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
        camera.layers.mask = previousCameraLayerMask;
        scene.overrideMaterial = previousOverrideMaterial;
        renderer.setRenderTarget(previousRenderTarget);
    }

    dispose(): void {
        this.renderTarget.dispose();
        this.maskMaterial.dispose();
    }
}

const atmosphereEffectFragmentShader = `
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

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float depth = readDepth(uv);

        if (depth >= 1.0) {
            outputColor = inputColor;
            return;
        }

        vec3 viewPosition = viewPositionAt(uv);
        vec3 worldPosition = (cameraWorldMatrix * vec4(viewPosition, 1.0)).xyz;
        vec3 cameraWorldPosition = cameraWorldMatrix[3].xyz;

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

interface IAtmosphereEffectOptions {
    camera: Camera;
    sky: ISkyGradient;
    fogDensity: number;
}

export class AtmosphereEffect extends ViewPositionEffect {
    private readonly cameraWorldMatrix: Uniform<Matrix4>;

    constructor({ camera, sky, fogDensity }: IAtmosphereEffectOptions) {
        const cameraWorldMatrixUniform = new Uniform(new Matrix4());
        const uniforms = new Map<string, Uniform<unknown>>([
            ["cameraWorldMatrix", cameraWorldMatrixUniform],
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

        super("AtmosphereEffect", atmosphereEffectFragmentShader, uniforms, camera);
        this.cameraWorldMatrix = cameraWorldMatrixUniform;
    }

    override update(renderer: WebGLRenderer): void {
        super.update(renderer);

        this.cameraWorldMatrix.value.copy(this.camera.matrixWorld);
    }
}

const outlineEffectFragmentShader = `
    uniform sampler2D foliageMask;
    uniform vec3 outlineColor;
    uniform float edgeThreshold;
    uniform float fadeStartDistance;
    uniform float fadeEndDistance;
    uniform float foliageFadeStartDistance;
    uniform float foliageFadeEndDistance;
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

        bool centerIsFoliage = isFoliage(uv);

        if (
            centerIsFoliage && isFoliage(rightUv) && isFoliage(leftUv)
                && isFoliage(upUv) && isFoliage(downUv)
        ) {
            outputColor = inputColor;
            return;
        }

        float foliageFade = centerIsFoliage
            ? smoothstep(foliageFadeStartDistance, foliageFadeEndDistance, centerDistance)
            : 1.0;

        if (foliageFade <= 0.001) {
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

        float edgeStrength = edge * distanceFade * foliageFade * opacity;

        outputColor = vec4(mix(inputColor.rgb, outlineColor, edgeStrength), inputColor.a);
    }
`;

interface IOutlineEffectOptions {
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
            ["foliageFadeStartDistance", new Uniform(OUTLINE.foliageFadeStartDistance)],
            ["foliageFadeEndDistance", new Uniform(OUTLINE.foliageFadeEndDistance)],
            ["opacity", new Uniform(OUTLINE.opacity)],
            ["thickness", new Uniform(OUTLINE.thickness)],
            ["texelSize", texelSizeUniform],
            ["debugView", new Uniform(OUTLINE.debugView ? 1 : 0)],
        ]);

        super("OutlineEffect", outlineEffectFragmentShader, uniforms, camera);
        this.texelSize = texelSizeUniform;
    }

    override update(renderer: WebGLRenderer): void {
        super.update(renderer);

        renderer.getDrawingBufferSize(this.scratchBufferSize);
        this.texelSize.value.set(1 / this.scratchBufferSize.x, 1 / this.scratchBufferSize.y);
    }
}
