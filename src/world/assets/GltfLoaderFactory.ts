import { Cache } from "three";
import type { WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const IMAGE_BITMAP_KEY_PREFIX = "image-bitmap:";
const TRANSCODER_PATH = "/basis/";

// three r185's ImageBitmapLoader caches its in-flight promise, but the handler that
// resolves it returns nothing, so every concurrent requester for a URL already being
// fetched receives undefined instead of the ImageBitmap and ends up with a null-image
// texture. Re-resolving against the cache entry the handler writes restores the bitmap.
const addToCache = Cache.add.bind(Cache);

Cache.add = (key: string, file: unknown): void => {
    const isPendingImageBitmap = key.startsWith(IMAGE_BITMAP_KEY_PREFIX) && file instanceof Promise;
    addToCache(key, isPendingImageBitmap ? file.then(() => Cache.get(key)) : file);
};

Cache.enabled = true;

let ktx2Loader: KTX2Loader | null = null;

export function createGltfLoader(renderer: WebGLRenderer): GLTFLoader {
    if (!ktx2Loader) ktx2Loader = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH);
    ktx2Loader.detectSupport(renderer);

    return new GLTFLoader().setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);
}
