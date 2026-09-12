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
import { POST_PROCESSING } from "@/constants/rendering";
import { CAMERA } from "@/constants/characters";
import { InlineLoader } from "generative-loaders";
import { useRouter } from "next/navigation";
import PerformanceOverlay from "../PerformanceOverlay";
import { useFrameLimit } from "@/hooks/useFrameLimit";
import { useRenderPixelRatio } from "@/hooks/useRenderPixelRatio";
import { usePointerLock } from "@/hooks/usePointerLock";
import { FrameRateMeter } from "@/components/Hud/FrameRateMeter";
import { PauseMenu } from "@/components/PauseMenu/PauseMenu";
import "./scene.scss";

const ACTIVE_CHAPTER_INDEX = 0;
const FIRST_SPAWN_STAGE = "Opening the realm";
const SHADER_WARMUP_STAGE = "Warming the shaders";

const WorldRuntime = ({
    chapter,
    manifest,
    onStageChange,
    isPaused,
    onRequestLock,
}: {
    chapter: ChapterResponse;
    manifest: IThemeManifest;
    onStageChange: (stageLabel: string | null) => void;
    isPaused: boolean;
    onRequestLock: (target: Element) => void;
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
        const handleClick = () => onRequestLock(canvas);

        canvas.addEventListener("click", handleClick);
        return () => canvas.removeEventListener("click", handleClick);
    }, [glRenderer, onRequestLock]);

    useFrame((_, deltaSeconds) => {
        if (isPaused) return;
        world?.update(deltaSeconds);
    });

    return world ? <primitive object={world.root} /> : null;
};

const FrameLimitDriver = () => {
    useFrameLimit();
    return null;
};

const Scene = ({ owner, name }: { owner: string; name: string }) => {
    const router = useRouter();
    const { isPending, error, sendRequest } = useRequest();
    const [realm, setRealm] = useState<RealmResponse | null>(null);
    const [spawnStage, setSpawnStage] = useState<string | null>(FIRST_SPAWN_STAGE);
    const [isPaused, setIsPaused] = useState(false);

    const { requestLock, releaseLock } = usePointerLock();
    const pixelRatio = useRenderPixelRatio();

    const handleResume = useCallback(() => {
        setIsPaused(false);
        requestLock();
    }, [requestLock]);

    const handleQuit = useCallback(() => {
        router.push("/");
    }, [router]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;

            // Tab is the menu binding, but once focus is inside the dialog it has to
            // stay a focus-navigation key or the menu is unusable by keyboard.
            if (isPaused && (e.target as HTMLElement | null)?.closest(".pause-menu-shell")) return;

            e.preventDefault();

            if (isPaused) {
                handleResume();
            } else {
                setIsPaused(true);
                releaseLock();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isPaused, handleResume, releaseLock]);

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
                frameloop="never"
                dpr={pixelRatio}
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
                <FrameLimitDriver />
                <SkyDome environment={manifest.environment} />
                <SceneLighting environment={manifest.environment} />
                <WorldRuntime
                    chapter={chapter}
                    manifest={manifest}
                    onStageChange={handleStageChange}
                    isPaused={isPaused}
                    onRequestLock={requestLock}
                />

                <PostProcessing environment={manifest.environment} />

                <PerformanceOverlay />
            </Canvas>

            <FrameRateMeter />

            {!isPaused && !spawnStage && (
                <div className="scene-menu-hint">
                    <kbd>Tab</kbd> menu
                </div>
            )}

            {spawnStage && (
                <div className="scene-status scene-status--overlay">
                    <InlineLoader variant="matrix" size={32} color="#fff" />
                    <p>{spawnStage}</p>
                </div>
            )}

            {isPaused && (
                <PauseMenu
                    onResume={handleResume}
                    onQuit={handleQuit}
                    realmTitle={`${owner}/${name}`}
                    dismissKey="Esc"
                />
            )}
        </div>
    );
};

export default Scene;
