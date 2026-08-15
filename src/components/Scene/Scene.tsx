"use client";
import { useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { ACESFilmicToneMapping } from "three";
import { World } from "@/world/World";
import SceneLighting from "@/components/SceneLighting";
import OutlinePass from "@/components/OutlinePass";
import { spawnChapter } from "@/factories/RealmSpawner";
import { isRequestCancellation, useRequest } from "@/hooks/useRequest";
import { HttpMethod } from "@/constants/strings";
import type { ChapterResponse, RealmResponse } from "@/responses/realm/RealmResponse";
import { CAMERA, RENDER } from "@/constants/game";
import { InlineLoader } from "generative-loaders";
import "generative-loaders/styles.css";
import "./scene.scss";

const ACTIVE_CHAPTER_INDEX = 0;

const WorldRuntime = ({ chapter }: { chapter: ChapterResponse }) => {
    const camera = useThree((state) => state.camera);
    const [world, setWorld] = useState<World | null>(null);

    useEffect(() => {
        let activeWorld: World | null = null;
        let isCancelled = false;

        const createWorld = async () => {
            const createdWorld = await World.create();

            if (isCancelled) {
                createdWorld.dispose();
                return;
            }

            spawnChapter(createdWorld, camera, chapter);
            activeWorld = createdWorld;
            setWorld(createdWorld);
        };

        void createWorld();

        return () => {
            isCancelled = true;
            activeWorld?.dispose();
            setWorld(null);
        };
    }, [camera, chapter]);

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
                toneMapping: ACESFilmicToneMapping,
                toneMappingExposure: RENDER.toneMappingExposure,
            }}
        >
            <SceneLighting />
            <WorldRuntime chapter={chapter} />
            <EffectComposer enableNormalPass multisampling={RENDER.multisampling}>
                <OutlinePass />
            </EffectComposer>
        </Canvas>
    );
};

export default Scene;
