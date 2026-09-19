import { Cache } from "three";
import type { WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const IMAGE_BITMAP_KEY_PREFIX = "image-bitmap:";
const TRANSCODER_PATH = "/vendor/basis/";

let ktx2Loader: KTX2Loader | null = null;
let isCacheFixInstalled = false;

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
