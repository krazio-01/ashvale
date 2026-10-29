import {
    Cache,
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
    VectorKeyframeTrack,
} from "three";
import type { WebGLRenderer, BufferGeometry, KeyframeTrack } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import type { IThemeManifest, IModelPart, IModelTemplate, ISkinnedModel } from "@/types/world";
import { CHARACTER, CREATURE, CLIP, SKELETON_BONES } from "@/constants/characters";

const IMAGE_BITMAP_KEY_PREFIX = "image-bitmap:";

const TRANSCODER_PATH = "/vendor/basis/";

let ktx2Loader: KTX2Loader | null = null;

let isCacheFixInstalled = false;

const FOLIAGE_MATERIAL_PATTERN = /leaves|leaf|foliage/i;

const USED_CLIP_NAMES = new Set<string>(Object.values(CLIP));

const ROOT_POSITION_TRACK = "root.position";

const PELVIS_POSITION_TRACK = `${SKELETON_BONES.pelvis}.position`;

const PELVIS_RATIO_EPSILON = 1e-4;

const POSITION_VARIANCE_EPSILON = 1e-4;

export class AssetLibrary {
    private static async loadPropScene(
        loader: GLTFLoader,
        modelPath: string
    ): Promise<{ modelPath: string; scene: Object3D | null }> {
        try {
            return { modelPath, scene: (await loader.loadAsync(modelPath)).scene };
        } catch {
            return { modelPath, scene: null };
        }
    }

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
            Promise.all(
                uniqueModelPaths.map((modelPath) => AssetLibrary.loadPropScene(loader, modelPath))
            ),
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

        const preparedCharacterModel = prepareSkinnedModel(
            characterModel,
            clipLibraries,
            materialLibrary
        );
        library.skinnedModelsByPath.set(CHARACTER.modelPath, preparedCharacterModel);

        const creatureClipLibraries = [characterModel, ...clipLibraries];
        const mannequinHeight =
            clipLibraries
                .map((library) => measureHeight(library.scene))
                .find((height) => height > 0) ?? 0;

        for (const [index, modelPath] of creatureModelPaths.entries()) {
            const creatureModel = creatureModels[index];
            if (!creatureModel) continue;

            library.skinnedModelsByPath.set(
                modelPath,
                prepareSkinnedModel(
                    creatureModel,
                    creatureClipLibraries,
                    materialLibrary,
                    true,
                    mannequinHeight
                )
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

function installImageBitmapCacheFix(): void {
    if (isCacheFixInstalled) return;
    isCacheFixInstalled = true;

    const addToCache = Cache.add.bind(Cache);

    Cache.add = (key: string, file: unknown): void => {
        const isPendingImageBitmap =
            key.startsWith(IMAGE_BITMAP_KEY_PREFIX) && file instanceof Promise;
        addToCache(key, isPendingImageBitmap ? file.then(() => Cache.get(key)) : file);
    };

    Cache.enabled = true;
}

export function createGltfLoader(renderer: WebGLRenderer): GLTFLoader {
    installImageBitmapCacheFix();

    if (!ktx2Loader) ktx2Loader = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH);
    ktx2Loader.detectSupport(renderer);

    return new GLTFLoader().setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);
}

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

const boundsHeight = (bounds: Box3): number => (bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y);

const measureHeight = (scene: Object3D): number => boundsHeight(new Box3().setFromObject(scene));

export function prepareSkinnedModel(
    gltf: GLTF,
    clipLibraries: GLTF[],
    materialLibrary: MaterialLibrary,
    clipsAreForeign = false,
    mannequinHeight = 0
): ISkinnedModel {
    gltf.scene.traverse((object) => {
        if (!(object instanceof SkinnedMesh)) return;

        object.material = toToonMaterial(object.material, materialLibrary);
        object.castShadow = true;
        object.frustumCulled = false;
    });

    const height = measureHeight(gltf.scene);
    const foreignScaleFactor =
        clipsAreForeign && mannequinHeight > 0 ? height / mannequinHeight : 1;
    const modelPelvis = gltf.scene.getObjectByName(SKELETON_BONES.pelvis);
    const mergedClips = [
        ...gltf.animations,
        ...clipLibraries.flatMap((library) => {
            const libraryPelvis = library.scene.getObjectByName(SKELETON_BONES.pelvis);
            const pelvisRatio =
                clipsAreForeign ||
                !modelPelvis ||
                !libraryPelvis ||
                libraryPelvis.position.length() < PELVIS_RATIO_EPSILON
                    ? 1
                    : modelPelvis.position.length() / libraryPelvis.position.length();
            return library.animations.map((clip) => scalePelvisMotion(clip, pelvisRatio));
        }),
    ].filter((clip) => USED_CLIP_NAMES.has(clip.name));

    const rootMotion = new Map<string, KeyframeTrack>();
    const clipsWithoutRoot = mergedClips.map((clip) => {
        const rootTrack = clip.tracks.find((track) => track.name === ROOT_POSITION_TRACK);
        if (!rootTrack) return clip;

        if (hasVaryingValues(rootTrack))
            rootMotion.set(clip.name, scaleTrack(rootTrack, foreignScaleFactor));

        return new AnimationClip(
            clip.name,
            clip.duration,
            clip.tracks.filter((track) => track !== rootTrack)
        );
    });

    return {
        scene: gltf.scene,
        animations: retargetClips(
            clipsWithoutRoot,
            gltf.scene,
            clipsAreForeign,
            foreignScaleFactor
        ),
        height,
        rootMotion,
    };
}

function scalePelvisMotion(clip: AnimationClip, ratio: number): AnimationClip {
    if (Math.abs(ratio - 1) < PELVIS_RATIO_EPSILON) return clip;
    return new AnimationClip(
        clip.name,
        clip.duration,
        clip.tracks.map((track) =>
            track.name === PELVIS_POSITION_TRACK ? scaleTrack(track, ratio) : track
        )
    );
}

function scaleTrack(track: KeyframeTrack, scaleFactor: number): KeyframeTrack {
    const scaled = track.clone();
    for (let index = 0; index < scaled.values.length; index++) scaled.values[index] *= scaleFactor;
    return scaled;
}

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
    clipsAreForeign: boolean,
    foreignScaleFactor: number
): AnimationClip[] {
    const boneRestPositions = new Map<string, Vector3>();
    scene.traverse((object) => {
        if (object instanceof Bone) boneRestPositions.set(object.name, object.position.clone());
    });

    if (boneRestPositions.size === 0) return clips;

    return clips.map((clip) => {
        const tracks: KeyframeTrack[] = [];

        for (const track of clip.tracks) {
            const separatorIndex = track.name.lastIndexOf(".");
            const boneName = track.name.slice(0, separatorIndex);
            const restPosition = boneRestPositions.get(boneName);

            if (!restPosition) continue;
            if (track.name.slice(separatorIndex + 1) !== "position") {
                tracks.push(track);
                continue;
            }
            if (!hasVaryingValues(track)) continue;

            tracks.push(
                clipsAreForeign
                    ? remapPositionTrack(track, restPosition, foreignScaleFactor)
                    : track
            );
        }

        return tracks.length === clip.tracks.length
            ? clip
            : new AnimationClip(clip.name, clip.duration, tracks);
    });
}

function remapPositionTrack(
    track: KeyframeTrack,
    restPosition: Vector3,
    scaleFactor: number
): KeyframeTrack {
    const rest = [restPosition.x, restPosition.y, restPosition.z];
    const baseline = [track.values[0] ?? 0, track.values[1] ?? 0, track.values[2] ?? 0];
    const values = new Float32Array(track.values.length);

    for (let index = 0; index < values.length; index += 1) {
        const component = index % 3;
        values[index] =
            (rest[component] ?? 0) +
            ((track.values[index] ?? 0) - (baseline[component] ?? 0)) * scaleFactor;
    }

    return new VectorKeyframeTrack(track.name, track.times, values);
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
        height: boundsHeight(bounds),
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
    return asArray(source).some((material) => FOLIAGE_MATERIAL_PATTERN.test(material.name));
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
    const toonMaterials = asArray(source).map((material) =>
        material instanceof MeshStandardMaterial
            ? materialLibrary.getToonMaterialForSource(material)
            : material
    );

    return toonMaterials.length === 1 ? toonMaterials[0] : toonMaterials;
}
