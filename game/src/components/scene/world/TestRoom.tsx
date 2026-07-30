"use client";

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { PALETTE } from "@/constants/game";

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const PILLARS: { at: Vec2; height: number; rot: number }[] = [
    { at: [-9, -12], height: 7, rot: 0.3 },
    { at: [9, -12], height: 6, rot: -0.2 },
    { at: [-9, 3], height: 5.5, rot: 0.6 },
    { at: [9, 3], height: 7.5, rot: -0.45 },
    { at: [-17, -5], height: 4, rot: 0.9 },
    { at: [17, -5], height: 4.5, rot: -0.8 },
];

const STUBS: { at: Vec2; height: number; rot: number }[] = [
    { at: [-3, -17], height: 1.4, rot: 0.4 },
    { at: [7, -19], height: 2.1, rot: -0.7 },
    { at: [-13, 0], height: 1.1, rot: 1.2 },
];

const EMBERS: Vec3[] = [
    [-5, 0.7, -7],
    [6, 0.7, -14],
    [0, 0.7, 1],
];

const RUBBLE = Array.from({ length: 16 }, (_, i) => {
    const angle = i * 2.39;
    const radius = 4 + (i % 5) * 3.4;
    return {
        at: [Math.cos(angle) * radius, 0.22, Math.sin(angle) * radius - 6] as Vec3,
        scale: 0.28 + (i % 3) * 0.14,
        rot: angle,
    };
});

export default function TestRoom() {
    return (
        <>
            <RigidBody type="fixed" colliders={false}>
                <mesh receiveShadow position={[0, -1, 0]}>
                    <boxGeometry args={[52, 2, 52]} />
                    <meshLambertMaterial color={PALETTE.stoneDark} />
                </mesh>
                <CuboidCollider args={[26, 1, 26]} position={[0, -1, 0]} />
            </RigidBody>

            <RigidBody type="fixed" colliders={false}>
                <mesh castShadow receiveShadow position={[0, 0.15, -22]}>
                    <boxGeometry args={[16, 0.3, 6]} />
                    <meshLambertMaterial color={PALETTE.stone} />
                </mesh>
                <CuboidCollider args={[8, 0.15, 3]} position={[0, 0.15, -22]} />
            </RigidBody>

            {PILLARS.map(({ at: [x, z], height, rot }) => (
                <RigidBody key={`p-${x}-${z}`} type="fixed" colliders={false}>
                    <mesh
                        castShadow
                        receiveShadow
                        position={[x, height / 2, z]}
                        rotation={[0, rot, 0]}
                    >
                        <boxGeometry args={[1.3, height, 1.3]} />
                        <meshLambertMaterial color={PALETTE.stone} />
                    </mesh>
                    <CuboidCollider args={[0.75, height / 2, 0.75]} position={[x, height / 2, z]} />
                </RigidBody>
            ))}

            {STUBS.map(({ at: [x, z], height, rot }) => (
                <RigidBody key={`s-${x}-${z}`} type="fixed" colliders={false}>
                    <mesh
                        castShadow
                        receiveShadow
                        position={[x, height / 2, z]}
                        rotation={[0.08, rot, 0.05]}
                    >
                        <boxGeometry args={[1.3, height, 1.3]} />
                        <meshLambertMaterial color={PALETTE.stoneLight} />
                    </mesh>
                    <CuboidCollider args={[0.75, height / 2, 0.75]} position={[x, height / 2, z]} />
                </RigidBody>
            ))}

            {RUBBLE.map(({ at, scale, rot }, i) => (
                <mesh key={`r-${i}`} position={at} rotation={[rot, rot * 0.7, rot * 0.4]} castShadow>
                    <dodecahedronGeometry args={[scale, 0]} />
                    <meshLambertMaterial color={PALETTE.stone} flatShading />
                </mesh>
            ))}

            {EMBERS.map(([x, y, z], i) => (
                <group key={`e-${x}-${z}`} position={[x, y, z]}>
                    <RigidBody type="fixed" colliders={false}>
                        <mesh castShadow>
                            <boxGeometry args={[1.1, 1.1, 1.1]} />
                            <meshLambertMaterial
                                color={PALETTE.ember}
                                emissive={PALETTE.ember}
                                emissiveIntensity={2.4}
                                toneMapped={false}
                            />
                        </mesh>
                        <CuboidCollider args={[0.55, 0.55, 0.55]} />
                    </RigidBody>

                    {i < 2 && (
                        <pointLight
                            color={PALETTE.ember}
                            intensity={11}
                            distance={11}
                            decay={1.5}
                            position={[0, 0.9, 0]}
                        />
                    )}
                </group>
            ))}
        </>
    );
}
