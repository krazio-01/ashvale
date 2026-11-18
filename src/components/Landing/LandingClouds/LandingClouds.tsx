"use client";
import { useEffect, useRef, useState } from "react";
import {
    Camera,
    Group,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Vector3,
} from "three";
import { useFrame } from "@react-three/fiber";
import { createSeededRandom, FULL_TURN, lerp, randomOffset } from "@/lib/helpers";
import { LANDING_CLOUDS } from "@/constants/ui";
interface ICloudPuff {
    x: number;
    y: number;
    z: number;
    scale: number;
}

interface ICloudField {
    mesh: InstancedMesh<IcosahedronGeometry, MeshBasicMaterial>;
    matrices: Float32Array;
    depths: Float64Array;
    order: number[];
    shown: Int32Array;
    byDepth: (first: number, second: number) => number;
    forward: Vector3;
}

function buildPuffs(): ICloudPuff[] {
    const nextRandom = createSeededRandom(LANDING_CLOUDS.seed);
    const puffs: ICloudPuff[] = [];

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
                x: centerX + Math.cos(spreadAngle) * spread,
                y:
                    clusterHeight +
                    randomOffset(nextRandom, LANDING_CLOUDS.clusterSpread / 2) * 0.35,
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
    const [field] = useState(() => buildCloudField(puffs));

    useEffect(
        () => () => {
            field.mesh.geometry.dispose();
            field.mesh.material.dispose();
            field.mesh.dispose();
        },
        [field]
    );

    useFrame(({ camera }, deltaSeconds) => {
        const group = groupRef.current!;
        group.rotation.y += LANDING_CLOUDS.driftSpeed * deltaSeconds;
        reorderPuffs(field, puffs, group.rotation.y, camera);
    });

    return (
        <group ref={groupRef}>
            <primitive object={field.mesh} />
        </group>
    );
};

function reorderPuffs(
    field: ICloudField,
    puffs: readonly ICloudPuff[],
    yaw: number,
    camera: Camera
): void {
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const forward = field.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const { position } = camera;
    for (let index = 0; index < puffs.length; index += 1) {
        const { x, y, z } = puffs[index];
        field.depths[index] =
            (x * cosine + z * sine - position.x) * forward.x +
            (y - position.y) * forward.y +
            (-x * sine + z * cosine - position.z) * forward.z;
    }
    field.order.sort(field.byDepth);
    let changed = false;
    for (let slot = 0; slot < field.order.length; slot += 1) {
        if (field.shown[slot] === field.order[slot]) continue;
        field.shown[slot] = field.order[slot];
        field.mesh.instanceMatrix.array.set(
            field.matrices.subarray(field.order[slot] * 16, field.order[slot] * 16 + 16),
            slot * 16
        );
        changed = true;
    }
    if (changed) field.mesh.instanceMatrix.needsUpdate = true;
}

function buildCloudField(puffs: readonly ICloudPuff[]): ICloudField {
    const mesh = new InstancedMesh(
        new IcosahedronGeometry(1, 0),
        new MeshBasicMaterial({
            color: LANDING_CLOUDS.color,
            transparent: true,
            opacity: LANDING_CLOUDS.opacity,
        }),
        puffs.length
    );
    const matrices = new Float32Array(puffs.length * 16);
    const matrix = new Matrix4();
    for (const [index, puff] of puffs.entries()) {
        matrix.makeScale(puff.scale, puff.scale, puff.scale).setPosition(puff.x, puff.y, puff.z);
        matrix.toArray(matrices, index * 16);
        mesh.setMatrixAt(index, matrix);
    }
    const depths = new Float64Array(puffs.length);
    return {
        mesh,
        matrices,
        depths,
        order: puffs.map((_, index) => index),
        shown: Int32Array.from(puffs, (_, index) => index),
        byDepth: (first, second) => depths[second] - depths[first] || first - second,
        forward: new Vector3(),
    };
}

export default LandingClouds;
