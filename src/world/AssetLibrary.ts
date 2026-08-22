import { Box3, Material, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BufferGeometry } from "three";
import type { MaterialLibrary } from "@/world/MaterialLibrary";
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

        const loadedModels = await Promise.all(
            manifest.props.map(async (prop) => ({
                modelPath: prop.modelPath,
                scene: (await loader.loadAsync(prop.modelPath)).scene,
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

    root.updateWorldMatrix(false, true);
    root.traverse((object) => {
        if (!(object instanceof Mesh)) return;

        const geometry = object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);

        const partIsFoliage = isFoliage(object.material);
        if (partIsFoliage) applyCanopyNormals(geometry);

        parts.push({
            geometry,
            material: toToonMaterial(object.material, materialLibrary),
            isFoliage: partIsFoliage,
        });
    });

    return { parts, height: measureHeight(parts) };
}

function isFoliage(source: Material | Material[]): boolean {
    const materials = Array.isArray(source) ? source : [source];

    return materials.some((material) => FOLIAGE_MATERIAL_PATTERN.test(material.name));
}

function applyCanopyNormals(geometry: BufferGeometry): void {
    geometry.computeBoundingSphere();
    const canopyCenter = geometry.boundingSphere?.center ?? new Vector3();

    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const radial = new Vector3();

    for (let index = 0; index < positions.count; index += 1) {
        radial
            .set(positions.getX(index), positions.getY(index), positions.getZ(index))
            .sub(canopyCenter)
            .normalize();

        normals.setXYZ(index, radial.x, radial.y, radial.z);
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

function measureHeight(parts: IModelPart[]): number {
    const bounds = new Box3();

    for (const part of parts) {
        part.geometry.computeBoundingBox();
        if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
    }

    return bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y;
}
