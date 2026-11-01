"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { FractalNoise } from "@/lib/noise";
import { FULL_TURN, lerp } from "@/lib/helpers";
import { LANDING_MOUNTAINS } from "@/constants/ui";
import { stitchRings } from "@/components/Landing/LandingIsland";
import type { IVector3 } from "@/types/physics";

type IMountainLayer = (typeof LANDING_MOUNTAINS.layers)[number];

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

    const peakAt = (angle: number): IVector3 => {
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

    const baseAt = (angle: number): IVector3 => ({
        x: Math.cos(angle) * layer.radius,
        y: layer.baseY,
        z: Math.sin(angle) * layer.radius,
    });

    const angles = Array.from(
        { length: layer.segments },
        (_, segment) => (segment / layer.segments) * FULL_TURN
    );
    stitchRings([{ points: angles.map(peakAt) }, { points: angles.map(baseAt) }], positions, []);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();

    return geometry;
}

export default LandingMountains;
