import { LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, WebGLRenderTarget } from "three";
import type { Material, WebGLRenderer } from "three";

const PASS_CAMERA = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

const PASS_QUAD = new Mesh(new PlaneGeometry(2, 2));

export function createPassTarget(side: number): WebGLRenderTarget {
    return new WebGLRenderTarget(side, side, {
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
    });
}

export function renderToTarget(
    renderer: WebGLRenderer,
    material: Material,
    target: WebGLRenderTarget
): void {
    const previousTarget = renderer.getRenderTarget();
    PASS_QUAD.material = material;
    renderer.setRenderTarget(target);
    renderer.render(PASS_QUAD, PASS_CAMERA);
    renderer.setRenderTarget(previousTarget);
}
