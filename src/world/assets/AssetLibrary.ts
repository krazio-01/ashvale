import {
    AnimationClip,
    Bone,
    Box3,
    BufferAttribute,
    Material,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    SkinnedMesh,
    Vector3,
} from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BufferGeometry, KeyframeTrack, WebGLRenderer } from "three";
import { createGltfLoader } from "@/world/assets/GltfLoaderFactory";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { IThemeManifest } from "@/types/theme";
import type { IModelPart, IModelTemplate, ISkinnedModel } from "@/types/world";
import { CHARACTER, CREATURE, MOTION_CLIPS } from "@/constants/characters";

const FOLIAGE_MATERIAL_PATTERN = /leaves|leaf|foliage/i;
const USED_CLIP_NAMES = new Set(Object.values(MOTION_CLIPS).map((clip) => clip.clipName));

export class AssetLibrary {
    private readonly templatesByPath = new Map<string, IModelTemplate>();
    private readonly skinnedModelsByPath = new Map<string, ISkinnedModel>();

    static async create(
        manifest: IThemeManifest,
        materialLibrary: MaterialLibrary,
        renderer: WebGLRenderer
    ): Promise<AssetLibrary> {
        const loader = createGltfLoader(renderer);
        const library = new AssetLibrary();
        const uniqueModelPaths = [
            ...new Set([
                ...manifest.props.map((prop) => prop.modelPath),
                ...(manifest.extraPreloadModelPaths ?? []),
            ]),
        ];

        const creatureModelPaths = [CREATURE.impModelPath, CREATURE.puglinModelPath];

        const [loadedModels, characterModel, clipLibraries, creatureModels] = await Promise.all([
            Promise.all(uniqueModelPaths.map((modelPath) => loadPropScene(loader, modelPath))),
            loader.loadAsync(CHARACTER.modelPath),
            Promise.all(CHARACTER.clipLibraryPaths.map((path) => loader.loadAsync(path))),
            Promise.all(creatureModelPaths.map((path) => loader.loadAsync(path))),
        ]);

        const unavailablePaths: string[] = [];

        for (const loaded of loadedModels) {
            if (!loaded.scene) {
                unavailablePaths.push(loaded.modelPath);
                continue;
            }

            library.templatesByPath.set(
                loaded.modelPath,
                flattenForInstancing(loaded.scene, materialLibrary)
            );
        }

        if (unavailablePaths.length > 0)
            console.error(
                `[AssetLibrary] ${unavailablePaths.length} prop model(s) failed to load and will not render:\n  ${unavailablePaths.join("\n  ")}`
            );

        library.skinnedModelsByPath.set(
            CHARACTER.modelPath,
            prepareSkinnedModel(characterModel, clipLibraries, materialLibrary)
        );

        const creatureClipLibraries = [characterModel, ...clipLibraries];

        for (const [index, modelPath] of creatureModelPaths.entries()) {
            const creatureModel = creatureModels[index];
            if (!creatureModel) continue;

            library.skinnedModelsByPath.set(
                modelPath,
                prepareSkinnedModel(creatureModel, creatureClipLibraries, materialLibrary, true)
            );
        }

        return library;
    }

    getTemplate(modelPath: string): IModelTemplate | null {
        return this.templatesByPath.get(modelPath) ?? null;
    }

    getSkinnedModel(modelPath: string): ISkinnedModel | null {
        return this.skinnedModelsByPath.get(modelPath) ?? null;
    }

    dispose(): void {
        for (const template of this.templatesByPath.values())
            for (const part of template.parts) part.geometry.dispose();

        for (const model of this.skinnedModelsByPath.values())
            model.scene.traverse((object) => {
                if (object instanceof SkinnedMesh) object.geometry.dispose();
            });

        this.templatesByPath.clear();
        this.skinnedModelsByPath.clear();
    }
}

async function loadPropScene(
    loader: GLTFLoader,
    modelPath: string
): Promise<{ modelPath: string; scene: Object3D | null }> {
    try {
        return { modelPath, scene: (await loader.loadAsync(modelPath)).scene };
    } catch {
        return { modelPath, scene: null };
    }
}

export function prepareSkinnedModel(
    gltf: GLTF,
    clipLibraries: GLTF[],
    materialLibrary: MaterialLibrary,
    clipsAreForeign = false
): ISkinnedModel {
    gltf.scene.traverse((object) => {
        if (!(object instanceof SkinnedMesh)) return;

        object.material = toToonMaterial(object.material, materialLibrary);
        object.castShadow = true;
        object.frustumCulled = false;
    });

    const bounds = new Box3().setFromObject(gltf.scene);
    const mergedClips = [
        ...gltf.animations,
        ...clipLibraries.flatMap((library) => library.animations),
    ].filter((clip) => USED_CLIP_NAMES.has(clip.name));

    return {
        scene: gltf.scene,
        animations: retargetClips(mergedClips, gltf.scene, clipsAreForeign),
        height: bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y,
    };
}

const POSITION_VARIANCE_EPSILON = 1e-4;

function hasVaryingValues(track: KeyframeTrack): boolean {
    const values = track.values;
    const stride = track.getValueSize();

    if (!Number.isFinite(stride) || stride <= 0) return false;

    for (let component = 0; component < stride; component += 1) {
        const baseline = values[component] ?? 0;

        for (let index = component; index < values.length; index += stride)
            if (Math.abs((values[index] ?? 0) - baseline) > POSITION_VARIANCE_EPSILON) return true;
    }

    return false;
}

function retargetClips(
    clips: AnimationClip[],
    scene: Object3D,
    clipsAreForeign: boolean
): AnimationClip[] {
    const boneNames = new Set<string>();
    scene.traverse((object) => {
        if (object instanceof Bone) boneNames.add(object.name);
    });

    if (boneNames.size === 0) return clips;

    return clips.map((clip) => {
        const tracks = clip.tracks.filter((track) => {
            const separatorIndex = track.name.lastIndexOf(".");

            if (!boneNames.has(track.name.slice(0, separatorIndex))) return false;
            if (track.name.slice(separatorIndex + 1) !== "position") return true;

            return !clipsAreForeign && hasVaryingValues(track);
        });

        return tracks.length === clip.tracks.length
            ? clip
            : new AnimationClip(clip.name, clip.duration, tracks);
    });
}

export function flattenForInstancing(
    root: Object3D,
    materialLibrary: MaterialLibrary
): IModelTemplate {
    const parts: IModelPart[] = [];
    const bounds = new Box3();

    root.updateWorldMatrix(false, true);
    root.traverse((object) => {
        if (!(object instanceof Mesh)) return;

        const geometry = object.geometry.clone();
        expandQuantizedAttributes(geometry);
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

    const halfExtents = new Vector3();
    const centerOffset = new Vector3();

    if (!bounds.isEmpty()) {
        bounds.getSize(halfExtents).multiplyScalar(0.5);
        bounds.getCenter(centerOffset);
    }

    return {
        parts,
        height: bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y,
        halfExtents,
        centerOffset,
    };
}

function expandQuantizedAttributes(geometry: BufferGeometry): void {
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (!attribute.normalized && attribute.array instanceof Float32Array) continue;

        const itemSize = attribute.itemSize;
        const values = new Float32Array(attribute.count * itemSize);

        for (let index = 0; index < attribute.count; index += 1)
            for (let component = 0; component < itemSize; component += 1)
                values[index * itemSize + component] = attribute.getComponent(index, component);

        geometry.setAttribute(name, new BufferAttribute(values, itemSize));
    }
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
