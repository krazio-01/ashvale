"use client";
import { useCallback, useEffect, useState } from "react";
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
const FIRST_SPAWN_STAGE = "Opening the realm";
const SHADER_WARMUP_STAGE = "Warming the shaders";

const WorldRuntime = ({
    chapter,
    manifest,
    onStageChange,
}: {
    chapter: ChapterResponse;
    manifest: IThemeManifest;
    onStageChange: (stageLabel: string | null) => void;
}) => {
    const camera = useThree((state) => state.camera);
    const glRenderer = useThree((state) => state.gl);
    const [world, setWorld] = useState<World | null>(null);

    useEffect(() => {
        let activeWorld: World | null = null;
        let isCancelled = false;

        const createWorld = async () => {
            onStageChange(FIRST_SPAWN_STAGE);

            const createdWorld = await World.create(manifest);
            if (isCancelled) {
                createdWorld.dispose();
                return;
            }

            await spawnChapterWorld(createdWorld, camera, chapter, onStageChange);
            if (isCancelled) {
                createdWorld.dispose();
                return;
            }

            onStageChange(SHADER_WARMUP_STAGE);
            await glRenderer.compileAsync(createdWorld.root, camera);
            if (isCancelled) {
                createdWorld.dispose();
                return;
            }

            activeWorld = createdWorld;
            setWorld(createdWorld);
            onStageChange(null);
        };

        void createWorld();

        return () => {
            isCancelled = true;
            activeWorld?.dispose();
            setWorld(null);
        };
    }, [camera, glRenderer, chapter, manifest, onStageChange]);

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
    const [spawnStage, setSpawnStage] = useState<string | null>(FIRST_SPAWN_STAGE);

    const handleStageChange = useCallback(
        (stageLabel: string | null) => setSpawnStage(stageLabel),
        []
    );

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
        <div className="scene-canvas-container">
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
                <WorldRuntime
                    chapter={chapter}
                    manifest={manifest}
                    onStageChange={handleStageChange}
                />

                <PostProcessing environment={manifest.environment} />

                <PerformanceOverlay />
            </Canvas>

            {spawnStage && (
                <div className="scene-status scene-status--overlay">
                    <InlineLoader variant="matrix" size={32} color="#fff" />
                    <p>{spawnStage}</p>
                </div>
            )}
        </div>
    );
};

export default Scene;
