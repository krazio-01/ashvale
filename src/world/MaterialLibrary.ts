import {
    DataTexture,
    MeshStandardMaterial,
    MeshToonMaterial,
    NearestFilter,
    RedFormat,
} from "three";
import { SHADING } from "@/constants/game";

export class MaterialLibrary {
    private readonly gradientMap: DataTexture;
    private readonly materialsByKey = new Map<string, MeshToonMaterial>();

    constructor() {
        this.gradientMap = this.buildGradientMap();
    }

    getToonMaterial(color: string): MeshToonMaterial {
        const cachedMaterial = this.materialsByKey.get(color);
        if (cachedMaterial) return cachedMaterial;

        const material = new MeshToonMaterial({ color, gradientMap: this.gradientMap });
        this.materialsByKey.set(color, material);
        return material;
    }

    getToonMaterialForSource(source: MeshStandardMaterial): MeshToonMaterial {
        const cacheKey = `${source.map?.uuid ?? "untextured"}|${source.color.getHexString()}`;
        const cachedMaterial = this.materialsByKey.get(cacheKey);
        if (cachedMaterial) return cachedMaterial;

        const material = new MeshToonMaterial({
            color: source.color,
            map: source.map,
            gradientMap: this.gradientMap,
        });

        this.materialsByKey.set(cacheKey, material);
        return material;
    }

    dispose(): void {
        for (const material of this.materialsByKey.values()) material.dispose();
        this.materialsByKey.clear();
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
