"use client";
import { useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { NoToneMapping } from "three";
import { World } from "@/world/World";
import SkyDome from "@/components/SkyDome";
import SceneLighting from "@/components/SceneLighting";
import PostProcessing from "@/components/PostProcessing/PostProcessing";
import { spawnChapterWorld } from "@/world/ChapterSpawner";
import { resolveThemeManifest } from "@/themes/ThemeManifests";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { HttpMethod } from "@/constants/strings";
import type { ChapterResponse, RealmResponse } from "@/responses/realm/RealmResponse";
import type { IThemeManifest } from "@/types/theme";
import { POST_PROCESSING, RENDER } from "@/constants/rendering";
import { CAMERA } from "@/constants/characters";
import { InlineLoader } from "generative-loaders";
import "generative-loaders/styles.css";
import PerformanceOverlay from "../PerformanceOverlay";
import "./scene.scss";

const ACTIVE_CHAPTER_INDEX = 0;

const WorldRuntime = ({
    chapter,
    manifest,
}: {
    chapter: ChapterResponse;
    manifest: IThemeManifest;
}) => {
    const camera = useThree((state) => state.camera);
    const glRenderer = useThree((state) => state.gl);
    const [world, setWorld] = useState<World | null>(null);

    useEffect(() => {
        let activeWorld: World | null = null;
        let isCancelled = false;

        const createWorld = async () => {
            const createdWorld = await World.create(manifest);

            if (isCancelled) {
                createdWorld.dispose();
                return;
            }

            spawnChapterWorld(createdWorld, camera, chapter);
            activeWorld = createdWorld;
            setWorld(createdWorld);
        };

        void createWorld();

        return () => {
            isCancelled = true;
            activeWorld?.dispose();
            setWorld(null);
        };
    }, [camera, chapter, manifest]);

    useEffect(() => {
        const canvas = glRenderer.domElement;
        const requestLock = () => canvas.requestPointerLock();

        canvas.addEventListener("click", requestLock);
        return () => canvas.removeEventListener("click", requestLock);
    }, [glRenderer]);

    useFrame((_, deltaSeconds) => world?.update(deltaSeconds));

    return world ? <primitive object={world.root} /> : null;
};

const Scene = ({ owner, name }: { owner: string; name: string }) => {
    const { isPending, error, sendRequest } = useRequest();
    const [realm, setRealm] = useState<RealmResponse | null>(null);

    useEffect(() => {
        const fetchRealm = async () => {
            try {
                const response = await sendRequest<RealmResponse>(
                    HttpMethod.Get,
                    `/realms/${owner}/${name}`
                );
                setRealm(response);
            } catch (caughtError) {
                if (!isRequestCancellation(caughtError)) setRealm(null);
            }
        };

        void fetchRealm();
    }, [owner, name, sendRequest]);

    if (isPending) {
        return (
            <div className="scene-status">
                <InlineLoader variant="matrix" size={32} color="#fff" />
                <p>Generating your realm</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="scene-status">
                <p>{error.message || "Unknown error"}</p>
            </div>
        );
    }

    const chapter = realm?.chapters[ACTIVE_CHAPTER_INDEX];
    if (!chapter) return null;

    const manifest = resolveThemeManifest(chapter.theme, chapter.season);

    return (
        <Canvas
            shadows="percentage"
            dpr={RENDER.pixelRatioRange}
            camera={{
                fov: CAMERA.fov,
                near: CAMERA.near,
                far: CAMERA.far,
                position: CAMERA.startPosition,
            }}
            gl={{
                antialias: false,
                toneMapping: NoToneMapping,
                toneMappingExposure: POST_PROCESSING.exposure,
            }}
        >
            <SkyDome environment={manifest.environment} />
            <SceneLighting environment={manifest.environment} />
            <WorldRuntime chapter={chapter} manifest={manifest} />

            <PostProcessing environment={manifest.environment} />

            <PerformanceOverlay />
        </Canvas>
    );
};

export default Scene;
