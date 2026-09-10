"use client";
import { useEffect, useRef, useState } from "react";
import { Group, IcosahedronGeometry, MeshBasicMaterial } from "three";
import { useFrame } from "@react-three/fiber";
import { createSeededRandom, FULL_TURN, lerp } from "@/lib/helpers";
import { LANDING_CLOUDS } from "@/constants/landing";

interface ICloudPuff {
    id: number;
    x: number;
    y: number;
    z: number;
    scale: number;
}

function buildPuffs(): ICloudPuff[] {
    const nextRandom = createSeededRandom(LANDING_CLOUDS.seed);
    const puffs: ICloudPuff[] = [];
    let nextId = 0;

    for (let cluster = 0; cluster < LANDING_CLOUDS.count; cluster += 1) {
        const azimuth = nextRandom() * FULL_TURN;
        const clusterRadius = lerp(
            LANDING_CLOUDS.radiusMin,
            LANDING_CLOUDS.radiusMax,
            nextRandom()
        );
        const clusterHeight = lerp(
            LANDING_CLOUDS.minHeight,
            LANDING_CLOUDS.maxHeight,
            nextRandom()
        );
        const centerX = Math.cos(azimuth) * clusterRadius;
        const centerZ = Math.sin(azimuth) * clusterRadius;
        const puffCount = Math.round(
            lerp(LANDING_CLOUDS.puffsPerClusterMin, LANDING_CLOUDS.puffsPerClusterMax, nextRandom())
        );

        for (let puff = 0; puff < puffCount; puff += 1) {
            const spreadAngle = nextRandom() * FULL_TURN;
            const spread = nextRandom() * LANDING_CLOUDS.clusterSpread;

            puffs.push({
                id: nextId++,
                x: centerX + Math.cos(spreadAngle) * spread,
                y: clusterHeight + (nextRandom() - 0.5) * LANDING_CLOUDS.clusterSpread * 0.35,
                z: centerZ + Math.sin(spreadAngle) * spread,
                scale: lerp(
                    LANDING_CLOUDS.puffRadiusMin,
                    LANDING_CLOUDS.puffRadiusMax,
                    nextRandom()
                ),
            });
        }
    }

    return puffs;
}

const LandingClouds = () => {
    const groupRef = useRef<Group>(null);
    const [puffs] = useState(() => buildPuffs());
    const [geometry] = useState(() => new IcosahedronGeometry(1, 0));
    const [material] = useState(
        () =>
            new MeshBasicMaterial({
                color: LANDING_CLOUDS.color,
                transparent: true,
                opacity: LANDING_CLOUDS.opacity,
            })
    );

    useEffect(() => () => geometry.dispose(), [geometry]);
    useEffect(() => () => material.dispose(), [material]);

    useFrame((_, deltaSeconds) => {
        const group = groupRef.current;
        if (!group) return;

        group.rotation.y += LANDING_CLOUDS.driftSpeed * deltaSeconds;
    });

    return (
        <group ref={groupRef}>
            {puffs.map((puff) => (
                <mesh
                    key={puff.id}
                    position={[puff.x, puff.y, puff.z]}
                    scale={puff.scale}
                    geometry={geometry}
                    material={material}
                />
            ))}
        </group>
    );
};

export default LandingClouds;
