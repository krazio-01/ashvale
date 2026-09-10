"use client";
import { useEffect, useMemo } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { FractalNoise } from "@/lib/noise";
import { FULL_TURN, lerp } from "@/lib/helpers";
import { LANDING_MOUNTAINS } from "@/constants/landing";

type IMountainLayer = (typeof LANDING_MOUNTAINS.layers)[number];

interface IPoint3 {
    x: number;
    y: number;
    z: number;
}

const LandingMountains = () => {
    const geometries = useMemo(() => LANDING_MOUNTAINS.layers.map(buildLayerGeometry), []);

    useEffect(
        () => () => {
            for (const geometry of geometries) geometry.dispose();
        },
        [geometries]
    );

    return (
        <group>
            {LANDING_MOUNTAINS.layers.map((layer, index) => (
                <mesh key={layer.color} geometry={geometries[index]}>
                    <meshBasicMaterial color={layer.color} side={DoubleSide} />
                </mesh>
            ))}
        </group>
    );
};

function buildLayerGeometry(layer: IMountainLayer): BufferGeometry {
    const noise = new FractalNoise(layer.noiseSeed);
    const positions: number[] = [];

    const peakAt = (angle: number): IPoint3 => {
        const noiseValue = noise.sample(
            Math.cos(angle) * layer.noiseScale,
            Math.sin(angle) * layer.noiseScale,
            3,
            0.5
        );

        return {
            x: Math.cos(angle) * layer.radius,
            y: lerp(layer.peakHeightMin, layer.peakHeightMax, noiseValue),
            z: Math.sin(angle) * layer.radius,
        };
    };

    const baseAt = (angle: number): IPoint3 => ({
        x: Math.cos(angle) * layer.radius,
        y: layer.baseY,
        z: Math.sin(angle) * layer.radius,
    });

    const pushTriangle = (a: IPoint3, b: IPoint3, c: IPoint3): void => {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };

    for (let segment = 0; segment < layer.segments; segment += 1) {
        const angleA = (segment / layer.segments) * FULL_TURN;
        const angleB = ((segment + 1) / layer.segments) * FULL_TURN;

        const peakA = peakAt(angleA);
        const peakB = peakAt(angleB);
        const baseA = baseAt(angleA);
        const baseB = baseAt(angleB);

        pushTriangle(peakA, baseA, baseB);
        pushTriangle(peakA, baseB, peakB);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();

    return geometry;
}

export default LandingMountains;
