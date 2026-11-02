import { SHADING } from "@/constants/world";
import type { IUnlitMaterialSpec } from "@/types/world";
import {
    AdditiveBlending,
    Color,
    DataTexture,
    Material,
    MeshBasicMaterial,
    MeshStandardMaterial,
    MeshToonMaterial,
    NearestFilter,
    NormalBlending,
    RedFormat,
    Texture,
} from "three";

export class MaterialLibrary {
    private readonly gradientMap: DataTexture;
    private readonly materialsByKey = new Map<string, MeshToonMaterial>();
    private readonly unlitMaterialsByKey = new Map<string, MeshBasicMaterial>();
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

    getUnlitMaterial({
        color,
        opacity = 1,
        isAdditive = false,
        isToneMapped = true,
    }: IUnlitMaterialSpec): MeshBasicMaterial {
        const resolvedColor = new Color(color);
        const cacheKey = [resolvedColor.getHexString(), opacity, isAdditive, isToneMapped].join(
            "|"
        );
        const cachedMaterial = this.unlitMaterialsByKey.get(cacheKey);
        if (cachedMaterial) return cachedMaterial;

        const isTransparent = isAdditive || opacity < 1;
        const material = new MeshBasicMaterial({
            color: resolvedColor,
            opacity,
            transparent: isTransparent,
            depthWrite: !isTransparent,
            blending: isAdditive ? AdditiveBlending : NormalBlending,
            toneMapped: isToneMapped,
        });

        this.unlitMaterialsByKey.set(cacheKey, material);
        return material;
    }

    disposeUnused(materialsInUse: ReadonlySet<Material>): void {
        const texturesInUse = new Set<Texture>();
        for (const material of this.materialsByKey.values()) {
            if (!materialsInUse.has(material)) continue;
            if (material.map) texturesInUse.add(material.map);
            if (material.normalMap) texturesInUse.add(material.normalMap);
        }

        for (const [cacheKey, material] of this.materialsByKey) {
            if (materialsInUse.has(material)) continue;
            material.dispose();
            if (material.map && !texturesInUse.has(material.map)) material.map.dispose();
            if (material.normalMap && !texturesInUse.has(material.normalMap))
                material.normalMap.dispose();
            this.materialsByKey.delete(cacheKey);
        }
    }

    dispose(): void {
        this.disposeUnused(new Set());
        for (const material of this.unlitMaterialsByKey.values()) material.dispose();
        this.unlitMaterialsByKey.clear();
        this.vertexColorMaterial?.dispose();
        this.gradientMap.dispose();
    }

    private buildGradientMap(): DataTexture {
        const brightnessSteps = new Uint8Array(SHADING.toonShadingSteps);

        for (let step = 0; step < SHADING.toonShadingSteps; step += 1) {
            brightnessSteps[step] = ((step + 1) / SHADING.toonShadingSteps) * 255;
        }

        const texture = new DataTexture(brightnessSteps, SHADING.toonShadingSteps, 1, RedFormat);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        return texture;
    }
}
