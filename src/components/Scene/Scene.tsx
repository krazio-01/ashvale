"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { GameSession, World } from "@/world/World";
import { spawnChapterWorld } from "@/world/ChapterSpawner";
import { QualityProbe } from "@/world/QualityProbe";
import { pickChapterLooks, resolveTheme } from "@/themes/Themes";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { INTERLUDE_TEXT, LOADING_TEXT, PAUSE_TEXT, QUALITY_TEXT } from "@/constants/strings";
import { CAMERA } from "@/constants/player";
import type { ChapterResponse, RealmResponse } from "@/responses/realm/RealmResponse";
import type { IThemeConfig } from "@/types/themes";
import { advanceBy, clamp } from "@/lib/helpers";
import { InlineLoader } from "generative-loaders";
import { useRouter } from "next/navigation";
import { RenderCanvas } from "@/components/RenderCanvas/RenderCanvas";
import { store } from "@/store/store";
import { realmKeyFor } from "@/store/progressionSlice";
import { useGameStore } from "@/hooks/useGameStore";
import { Interlude } from "@/components/Interlude/Interlude";
import { AnimationFrameLoop } from "@/components/AnimationFrameLoop/AnimationFrameLoop";
import { Hud } from "@/components/Hud/Hud";
import { PauseMenu } from "@/components/PauseMenu/PauseMenu";
import { useHotkey } from "@/hooks/useHotkey";
import "./scene.scss";

const WorldRuntime = ({
    chapter,
    manifest,
    realmKey,
    chapterCount,
    onStageChange,
    isRunning,
    canvasRef,
}: {
    chapter: ChapterResponse;
    manifest: IThemeConfig;
    realmKey: string;
    chapterCount: number;
    onStageChange: (stageLabel: string | null) => void;
    isRunning: boolean;
    canvasRef: RefObject<HTMLCanvasElement | null>;
}) => {
    const camera = useThree((state) => state.camera);
    const glRenderer = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const getRootState = useThree((state) => state.get);
    const [session, setSession] = useState<GameSession | null>(null);
    const [world, setWorld] = useState<World | null>(null);
    const chapterTeardown = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        if (!session) return;

        const controller = new AbortController();
        const previousTeardown = chapterTeardown.current;
        let builtWorld: World | null = null;
        let markSettled: () => void = () => {};
        const settled = new Promise<void>((resolve) => (markSettled = resolve));

        const runProbe = async (measure: (probe: QualityProbe) => Promise<boolean>) => {
            store.getState().settings.beginProbe();
            store.getState().session.setPhase("probing");
            onStageChange(QUALITY_TEXT.probing);
            let keepsProbedTier = false;

            try {
                keepsProbedTier = await measure(
                    new QualityProbe(
                        glRenderer,
                        camera,
                        (deltaSeconds) => {
                            builtWorld?.syncToCamera();
                            advanceBy(getRootState(), deltaSeconds);
                        },
                        (tier) => store.getState().settings.applyPreset(tier, true)
                    )
                );
            } finally {
                store.getState().settings.endProbe(keepsProbedTier);
                if (store.getState().session.phase === "probing")
                    store.getState().session.setPhase("loading");
            }
            controller.signal.throwIfAborted();
        };

        const probeQualityIfAuto = async () => {
            const { settings } = store.getState();
            if (!settings.values.autoQuality) return;

            await runProbe(async (probe) => {
                const report = await probe.run(settings.values.frameRateLimit, controller.signal);
                if (!controller.signal.aborted) store.getState().session.setQualityReport(report);
                return report !== null;
            });
        };

        const discardWorld = () => {
            if (!builtWorld) return;

            scene.remove(builtWorld.root);
            builtWorld.dispose();
            builtWorld = null;
        };

        const assembleWorld = async () => {
            const assembled = await World.create(session, manifest);
            builtWorld = assembled;
            controller.signal.throwIfAborted();

            await spawnChapterWorld(
                assembled,
                camera,
                chapter,
                manifest,
                { realmKey, chapterCount },
                controller.signal,
                onStageChange
            );

            assembled.update(0);
            scene.add(assembled.root);
            onStageChange(LOADING_TEXT.warmingShaders);
            await glRenderer.compileAsync(scene, camera);
            controller.signal.throwIfAborted();
            setWorld(assembled);
        };

        const buildChapter = async () => {
            try {
                onStageChange(LOADING_TEXT.openingRealm);
                await previousTeardown;
                controller.signal.throwIfAborted();
                const builtTier = store.getState().settings.values.worldTier;
                await assembleWorld();
                await probeQualityIfAuto();
                if (store.getState().settings.values.worldTier !== builtTier) {
                    setWorld(null);
                    discardWorld();
                    onStageChange(LOADING_TEXT.openingRealm);
                    await assembleWorld();
                }
                onStageChange(null);
                store.getState().session.setPhase("ready");
            } finally {
                markSettled();
            }
        };

        void buildChapter().catch((error: unknown) => {
            if (error !== controller.signal.reason) throw error;
        });

        return () => {
            controller.abort();
            setWorld(null);
            chapterTeardown.current = settled.then(discardWorld);
        };
    }, [
        session,
        camera,
        glRenderer,
        scene,
        getRootState,
        chapter,
        manifest,
        realmKey,
        chapterCount,
        onStageChange,
    ]);

    useEffect(() => {
        let createdSession: GameSession | null = null;
        let isUnmounted = false;

        void GameSession.create(glRenderer).then((created) => {
            if (isUnmounted) return created.dispose();
            createdSession = created;
            setSession(created);
        });

        return () => {
            isUnmounted = true;
            setSession(null);
            void chapterTeardown.current.finally(() => createdSession?.dispose());
        };
    }, [glRenderer]);

    useEffect(() => {
        const canvas = glRenderer.domElement;
        const handleClick = () => requestLock(canvas);

        canvasRef.current = canvas;
        canvas.addEventListener("click", handleClick);
        return () => canvas.removeEventListener("click", handleClick);
    }, [glRenderer, canvasRef]);

    useFrame((_, deltaSeconds) => {
        if (isRunning) world?.update(deltaSeconds);
    });

    return null;
};

const Scene = ({
    owner,
    name,
    chapterOverride,
}: {
    owner: string;
    name: string;
    chapterOverride: number | null;
}) => {
    const router = useRouter();
    const { isPending, error, sendRequest } = useRequest();
    const [realm, setRealm] = useState<RealmResponse | null>(null);
    const [chapterManifests, setChapterManifests] = useState<IThemeConfig[]>([]);
    const [stageLabel, setStageLabel] = useState<string | null>(LOADING_TEXT.openingRealm);
    const [isPaused, setIsPaused] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const phase = useGameStore((state) => state.session.phase);
    const chapterIndex = useGameStore((state) => state.session.chapterIndex);
    const isPlaying = phase === "playing";
    const realmTitle = `${owner}/${name}`;

    const handleResume = () => {
        setIsPaused(false);
        requestLock(canvasRef.current);
    };

    const handleQuit = () => router.push("/");

    const handleContinue = () => {
        if (phase === "ended") {
            router.push("/");
            return;
        }

        requestLock(canvasRef.current);
        store.getState().session.setPhase("playing");
    };

    useHotkey("Tab", (e) => {
        if (!isPlaying) return;
        if (isPaused && e.target instanceof Element && e.target.closest(".pause-menu-shell"))
            return;

        e.preventDefault();

        if (isPaused) {
            handleResume();
        } else {
            setIsPaused(true);
            releaseLock();
        }
    });

    useEffect(() => {
        if (!isPlaying) releaseLock();
    }, [isPlaying]);

    useEffect(() => {
        const fetchRealm = async () => {
            try {
                const response = await sendRequest<RealmResponse>(`/realms/${owner}/${name}`);
                const lastChapterIndex = response.chapters.length - 1;
                const { progression, session } = store.getState();
                const chapterReached =
                    progression.records[realmKeyFor(owner, name, response.version)]
                        ?.chapterReached ?? 0;

                setRealm(response);
                setChapterManifests(pickChapterLooks(response.chapters).map(resolveTheme));
                session.beginChapter(
                    clamp(
                        chapterOverride ?? Math.min(chapterReached, lastChapterIndex),
                        0,
                        lastChapterIndex
                    )
                );
            } catch (caughtError) {
                if (!isRequestCancellation(caughtError)) setRealm(null);
            }
        };

        void fetchRealm();
    }, [owner, name, chapterOverride, sendRequest]);

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

    const chapter = realm?.chapters[chapterIndex];
    const manifest = chapterManifests[chapterIndex];
    if (!realm || !chapter || !manifest) return null;
    const realmKey = realmKeyFor(owner, name, realm.version);

    const isEnded = phase === "ended";

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
                    realmKey={realmKey}
                    chapterCount={realm.chapters.length}
                    onStageChange={setStageLabel}
                    isRunning={isPlaying && !isPaused}
                    canvasRef={canvasRef}
                />
            </RenderCanvas>

            <AnimationFrameLoop>{isPlaying && <Hud />}</AnimationFrameLoop>

            {isPlaying && !isPaused && (
                <div className="scene-menu-hint">
                    <kbd>{PAUSE_TEXT.menuKey}</kbd> {PAUSE_TEXT.menuHint}
                </div>
            )}

            {!isPlaying && (
                <Interlude
                    title={isEnded ? INTERLUDE_TEXT.endingTitle : chapter.title}
                    paragraphs={
                        isEnded
                            ? [INTERLUDE_TEXT.endingBody(realmTitle)]
                            : chapter.interludeParagraphs
                    }
                    stageLabel={stageLabel}
                    phase={phase}
                    onContinue={handleContinue}
                />
            )}

            {isPaused && (
                <PauseMenu
                    onResume={handleResume}
                    onQuit={handleQuit}
                    realmTitle={realmTitle}
                    realmKey={realmKey}
                    dismissKey={PAUSE_TEXT.resumeKey}
                />
            )}
        </div>
    );
};

const requestLock = (canvas: HTMLCanvasElement | null) => canvas?.requestPointerLock();

const releaseLock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
};

export default Scene;
