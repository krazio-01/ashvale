"use client";

import { Canvas } from "@react-three/fiber";
import { KeyboardControls, PointerLockControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { ACESFilmicToneMapping } from "three";
import Player from "./player/Player";
import TestRoom from "./world/TestRoom";
import PostProcessing from "./effects/PostProcessing";
import { CAMERA, PALETTE, WORLD } from "@/constants/game";

const keyMap = [
    { name: "forward", keys: ["KeyW", "ArrowUp"] },
    { name: "backward", keys: ["KeyS", "ArrowDown"] },
    { name: "left", keys: ["KeyA", "ArrowLeft"] },
    { name: "right", keys: ["KeyD", "ArrowRight"] },
    { name: "jump", keys: ["Space"] },
    { name: "sprint", keys: ["ShiftLeft"] },
];

export default function Scene() {
    return (
        <KeyboardControls map={keyMap}>
            <Canvas
                shadows="percentage"
                dpr={[1, 1.5]}
                camera={{ fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far }}
                gl={{
                    antialias: false,
                    toneMapping: ACESFilmicToneMapping,
                    toneMappingExposure: 1.5,
                }}
            >
                <color attach="background" args={[PALETTE.void]} />
                <fog attach="fog" args={[PALETTE.haze, WORLD.fogNear, WORLD.fogFar]} />

                <hemisphereLight args={[PALETTE.skyCool, PALETTE.groundWarm, 1.6]} />

                <directionalLight
                    castShadow
                    position={[16, 24, 12]}
                    intensity={2.2}
                    color={PALETTE.keyLight}
                    shadow-mapSize={[1024, 1024]}
                    shadow-bias={-0.0006}
                    shadow-camera-left={-30}
                    shadow-camera-right={30}
                    shadow-camera-top={30}
                    shadow-camera-bottom={-30}
                    shadow-camera-far={70}
                />

                <Physics gravity={[0, WORLD.gravity, 0]}>
                    <TestRoom />
                    <Player />
                </Physics>

                <PointerLockControls makeDefault />

                <PostProcessing />
            </Canvas>
        </KeyboardControls>
    );
}
