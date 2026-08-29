import { Box3, Material, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BufferGeometry } from "three";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { IThemeManifest } from "@/types/theme";
import type { IModelPart, IModelTemplate } from "@/types/world";

const FOLIAGE_MATERIAL_PATTERN = /leaves|leaf|foliage/i;

export class AssetLibrary {
    private readonly templatesByPath = new Map<string, IModelTemplate>();

    static async create(
        manifest: IThemeManifest,
        materialLibrary: MaterialLibrary
    ): Promise<AssetLibrary> {
        const loader = new GLTFLoader();
        const library = new AssetLibrary();
        const uniqueModelPaths = [...new Set(manifest.props.map((prop) => prop.modelPath))];

        const loadedModels = await Promise.all(
            uniqueModelPaths.map(async (modelPath) => ({
                modelPath,
                scene: (await loader.loadAsync(modelPath)).scene,
            }))
        );

        for (const { modelPath, scene } of loadedModels)
            library.templatesByPath.set(modelPath, flattenForInstancing(scene, materialLibrary));

        return library;
    }

    getTemplate(modelPath: string): IModelTemplate | null {
        return this.templatesByPath.get(modelPath) ?? null;
    }

    dispose(): void {
        for (const template of this.templatesByPath.values())
            for (const part of template.parts) part.geometry.dispose();

        this.templatesByPath.clear();
    }
}

function flattenForInstancing(root: Object3D, materialLibrary: MaterialLibrary): IModelTemplate {
    const parts: IModelPart[] = [];
    const bounds = new Box3();

    root.updateWorldMatrix(false, true);
    root.traverse((object) => {
        if (!(object instanceof Mesh)) return;

        const geometry = object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);

        const partIsFoliage = isFoliage(object.material);
        if (partIsFoliage) applyCanopyNormals(geometry);

        geometry.computeBoundingBox();
        if (geometry.boundingBox) bounds.union(geometry.boundingBox);

        parts.push({
            geometry,
            material: toToonMaterial(object.material, materialLibrary),
            isFoliage: partIsFoliage,
        });
    });

    return { parts, height: bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y };
}

function isFoliage(source: Material | Material[]): boolean {
    const materials = Array.isArray(source) ? source : [source];

    return materials.some((material) => FOLIAGE_MATERIAL_PATTERN.test(material.name));
}

function applyCanopyNormals(geometry: BufferGeometry): void {
    geometry.computeBoundingSphere();
    const canopyCenter = geometry.boundingSphere?.center ?? new Vector3();
    const centerX = canopyCenter.x;
    const centerY = canopyCenter.y;
    const centerZ = canopyCenter.z;

    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const positionArray = positions.array as Float32Array;
    const normalArray = normals.array as Float32Array;

    for (let index = 0; index < positions.count; index += 1) {
        const offset = index * 3;
        const radialX = (positionArray[offset] ?? 0) - centerX;
        const radialY = (positionArray[offset + 1] ?? 0) - centerY;
        const radialZ = (positionArray[offset + 2] ?? 0) - centerZ;

        const inverseLength =
            1 / (Math.sqrt(radialX * radialX + radialY * radialY + radialZ * radialZ) || 1);

        normalArray[offset] = radialX * inverseLength;
        normalArray[offset + 1] = radialY * inverseLength;
        normalArray[offset + 2] = radialZ * inverseLength;
    }

    normals.needsUpdate = true;
}

function toToonMaterial(
    source: Material | Material[],
    materialLibrary: MaterialLibrary
): Material | Material[] {
    const sourceMaterials = Array.isArray(source) ? source : [source];

    const toonMaterials = sourceMaterials.map((material) =>
        material instanceof MeshStandardMaterial
            ? materialLibrary.getToonMaterialForSource(material)
            : material
    );

    return toonMaterials.length === 1 ? toonMaterials[0] : toonMaterials;
}
