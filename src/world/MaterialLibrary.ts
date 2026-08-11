import { DataTexture, MeshToonMaterial, NearestFilter, RedFormat } from "three";
import { SHADING } from "@/constants/game";

export class MaterialLibrary {
    private readonly gradientMap: DataTexture;
    private readonly materialsByColor = new Map<string, MeshToonMaterial>();

    constructor() {
        this.gradientMap = this.buildGradientMap();
    }

    getToonMaterial(color: string): MeshToonMaterial {
        const cachedMaterial = this.materialsByColor.get(color);
        if (cachedMaterial) return cachedMaterial;

        const material = new MeshToonMaterial({ color, gradientMap: this.gradientMap });
        this.materialsByColor.set(color, material);
        return material;
    }

    dispose(): void {
        for (const material of this.materialsByColor.values()) material.dispose();
        this.materialsByColor.clear();
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
