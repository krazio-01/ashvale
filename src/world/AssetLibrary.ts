import { Mesh, MeshStandardMaterial, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MaterialLibrary } from "@/world/MaterialLibrary";
import type { IThemeManifest } from "@/types/theme";

export class AssetLibrary {
    private readonly templatesByPath = new Map<string, Object3D>();

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

        for (const { modelPath, scene } of loadedModels) {
            applyToonMaterials(scene, materialLibrary);
            library.templatesByPath.set(modelPath, scene);
        }

        return library;
    }

    cloneProp(modelPath: string): Object3D | null {
        return this.templatesByPath.get(modelPath)?.clone(true) ?? null;
    }

    dispose(): void {
        for (const template of this.templatesByPath.values()) {
            template.traverse((object) => {
                if (object instanceof Mesh) object.geometry.dispose();
            });
        }

        this.templatesByPath.clear();
    }
}

function applyToonMaterials(root: Object3D, materialLibrary: MaterialLibrary): void {
    root.traverse((object) => {
        if (!(object instanceof Mesh)) return;

        object.castShadow = true;
        object.receiveShadow = true;

        const sourceMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];

        const toonMaterials = sourceMaterials.map((material) =>
            material instanceof MeshStandardMaterial
                ? materialLibrary.getToonMaterialForSource(material)
                : material
        );

        object.material = toonMaterials.length === 1 ? toonMaterials[0] : toonMaterials;
    });
}
