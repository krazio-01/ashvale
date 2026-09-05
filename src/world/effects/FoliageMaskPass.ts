import { Camera, Layers, MeshBasicMaterial, Scene, WebGLRenderer, WebGLRenderTarget } from "three";

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
