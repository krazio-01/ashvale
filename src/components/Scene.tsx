"use client";

import { useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { ACESFilmicToneMapping } from "three";
import { World } from "@/world/World";
import RenderPipeline from "@/world/RenderPipeline";
import OutlinePass from "@/components/OutlinePass";
import { spawnTestRealm } from "@/factories/RealmSpawner";
import { CAMERA, RENDER } from "@/constants/game";

// Lives inside Canvas so the world can be built against the real camera
function WorldRuntime() {
    const camera = useThree((state) => state.camera);
    const [world, setWorld] = useState<World | null>(null);

    useEffect(() => {
        let activeWorld: World | null = null;
        let isCancelled = false;

        World.create().then((createdWorld) => {
            if (isCancelled) {
                createdWorld.dispose();
                return;
            }

            spawnTestRealm(createdWorld, camera);
            activeWorld = createdWorld;
            setWorld(createdWorld);
        });

        return () => {
            isCancelled = true;
            activeWorld?.dispose();
            setWorld(null);
        };
    }, [camera]);

    useFrame((_, deltaSeconds) => world?.update(deltaSeconds));

    return world ? <primitive object={world.root} /> : null;
}

export default function Scene() {
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
            <RenderPipeline />
            <WorldRuntime />
            <EffectComposer enableNormalPass>
                <OutlinePass />
            </EffectComposer>
        </Canvas>
    );
}
