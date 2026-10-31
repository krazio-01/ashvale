"use client";

import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { World } from "@/world/World";
import { spawnChapterWorld } from "@/world/ChapterSpawner";
import { resolveTheme } from "@/themes/Themes";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { LOADING_TEXT, PAUSE_TEXT } from "@/constants/strings";
import { CAMERA } from "@/constants/player";
import type { ChapterResponse, RealmResponse } from "@/responses/realm/RealmResponse";
import type { IThemeConfig } from "@/types/world";
import { InlineLoader } from "generative-loaders";
import { useRouter } from "next/navigation";
import { RenderCanvas } from "@/components/RenderCanvas/RenderCanvas";
import { store } from "@/store/store";
import { AnimationFrameLoop } from "@/components/AnimationFrameLoop/AnimationFrameLoop";
import { Hud } from "@/components/Hud/Hud";
import { PauseMenu } from "@/components/PauseMenu/PauseMenu";
import dynamic from "next/dynamic";
import { useHotkey } from "@/hooks/useHotkey";
import "./scene.scss";

const PhysicsTuner =
    process.env.NODE_ENV === "development"
        ? dynamic(
              () =>
                  import("@/components/PhysicsTuner/PhysicsTuner").then(
                      (module) => module.PhysicsTuner
                  ),
              { ssr: false }
          )
        : () => null;

const ACTIVE_CHAPTER_INDEX = 0;

const WorldRuntime = ({
    chapter,
    manifest,
    onStageChange,
    isPaused,
    onRequestLock,
}: {
    chapter: ChapterResponse;
    manifest: IThemeConfig;
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
            onStageChange(LOADING_TEXT.openingRealm);

            const createdWorld = await World.create(manifest, glRenderer);
            const abortIfCancelled = () => {
                if (isCancelled) createdWorld.dispose();
                return isCancelled;
            };
            if (abortIfCancelled()) return;

            await spawnChapterWorld(createdWorld, camera, chapter, onStageChange);
            if (abortIfCancelled()) return;

            onStageChange(LOADING_TEXT.warmingShaders);
            await glRenderer.compileAsync(createdWorld.root, camera);
            if (abortIfCancelled()) return;

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

const Scene = ({ owner, name }: { owner: string; name: string }) => {
    const router = useRouter();
    const { isPending, error, sendRequest } = useRequest();
    const [realm, setRealm] = useState<RealmResponse | null>(null);
    const [spawnStage, setSpawnStage] = useState<string | null>(LOADING_TEXT.openingRealm);
    const [isPaused, setIsPaused] = useState(false);

    const handleResume = () => {
        setIsPaused(false);
        requestLock();
    };

    const handleQuit = () => router.push("/");

    useHotkey("Tab", (e) => {
        if (isPaused && (e.target as HTMLElement | null)?.closest(".pause-menu-shell")) return;

        e.preventDefault();

        if (isPaused) {
            handleResume();
        } else {
            setIsPaused(true);
            releaseLock();
        }
    });

    useEffect(() => {
        const fetchRealm = async () => {
            try {
                const response = await sendRequest<RealmResponse>(`/realms/${owner}/${name}`);
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
                <p>{LOADING_TEXT.generatingRealm}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="scene-status">
                <p>{error.message || LOADING_TEXT.unknownError}</p>
            </div>
        );
    }

    const chapter = realm?.chapters[ACTIVE_CHAPTER_INDEX];
    if (!chapter) return null;

    const manifest = resolveTheme(chapter.theme, chapter.season);

    return (
        <div className="scene-canvas-container">
            <RenderCanvas
                environment={manifest.environment}
                camera={{
                    fov: store.getState().settings.values.fov,
                    near: CAMERA.near,
                    far: CAMERA.far,
                    position: CAMERA.startPosition,
                }}
            >
                <WorldRuntime
                    chapter={chapter}
                    manifest={manifest}
                    onStageChange={setSpawnStage}
                    isPaused={isPaused}
                    onRequestLock={requestLock}
                />
            </RenderCanvas>

            <PhysicsTuner />
            <AnimationFrameLoop>
                <Hud />
            </AnimationFrameLoop>

            {!isPaused && !spawnStage && (
                <div className="scene-menu-hint">
                    <kbd>{PAUSE_TEXT.menuKey}</kbd> {PAUSE_TEXT.menuHint}
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
                    dismissKey={PAUSE_TEXT.resumeKey}
                />
            )}
        </div>
    );
};

const requestLock = (target: Element | null = document.querySelector("canvas")) =>
    target?.requestPointerLock();

const releaseLock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
};

export default Scene;
