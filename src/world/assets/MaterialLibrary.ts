import { SHADING } from "@/constants/rendering";
import {
    DataTexture,
    MeshStandardMaterial,
    MeshToonMaterial,
    NearestFilter,
    RedFormat,
} from "three";

export class MaterialLibrary {
    private readonly gradientMap: DataTexture;
    private readonly materialsByKey = new Map<string, MeshToonMaterial>();
    private vertexColorMaterial: MeshToonMaterial | null = null;

    constructor() {
        this.gradientMap = this.buildGradientMap();
    }

    getVertexColorToonMaterial(): MeshToonMaterial {
        if (!this.vertexColorMaterial)
            this.vertexColorMaterial = new MeshToonMaterial({
                vertexColors: true,
                gradientMap: this.gradientMap,
            });

        return this.vertexColorMaterial;
    }

    getToonMaterialForSource(source: MeshStandardMaterial): MeshToonMaterial {
        const cacheKey = [
            source.map?.uuid ?? "untextured",
            source.normalMap?.uuid ?? "unmapped",
            source.normalScale.x,
            source.normalScale.y,
            source.color.getHexString(),
            source.transparent,
            source.alphaTest,
            source.side,
        ].join("|");
        const cachedMaterial = this.materialsByKey.get(cacheKey);
        if (cachedMaterial) return cachedMaterial;

        const material = new MeshToonMaterial({
            color: source.color,
            map: source.map,
            normalMap: source.normalMap,
            normalScale: source.normalScale.clone(),
            gradientMap: this.gradientMap,
            transparent: source.transparent,
            alphaTest: source.alphaTest,
            side: source.side,
        });

        this.materialsByKey.set(cacheKey, material);
        return material;
    }

    dispose(): void {
        for (const material of this.materialsByKey.values()) material.dispose();
        this.materialsByKey.clear();
        this.vertexColorMaterial?.dispose();
        this.gradientMap.dispose();
    }

    private buildGradientMap(): DataTexture {
        const brightnessSteps = new Uint8Array(SHADING.gradientSteps);

        for (let step = 0; step < SHADING.gradientSteps; step += 1) {
            brightnessSteps[step] = ((step + 1) / SHADING.gradientSteps) * 255;
        }

        const texture = new DataTexture(brightnessSteps, SHADING.gradientSteps, 1, RedFormat);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        return texture;
    }
}
