import { Mesh, OrthographicCamera, PlaneGeometry } from "three";
import type { Material, WebGLRenderer, WebGLRenderTarget } from "three";

const PASS_CAMERA = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

const PASS_QUAD = new Mesh(new PlaneGeometry(2, 2));

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
