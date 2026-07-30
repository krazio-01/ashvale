"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Vector3 } from "three";
import { PLAYER } from "@/constants/game";

const WORLD_UP = new Vector3(0, 1, 0);

const forwardAxis = new Vector3();
const rightAxis = new Vector3();
const move = new Vector3();

export default function Player() {
    const body = useRef<RapierRigidBody>(null);
    const [, getKeys] = useKeyboardControls();

    useFrame(({ camera }) => {
        if (!body.current) return;

        const keys = getKeys();
        const velocity = body.current.linvel();

        camera.getWorldDirection(forwardAxis);
        forwardAxis.y = 0;
        forwardAxis.normalize();

        rightAxis.crossVectors(forwardAxis, WORLD_UP).normalize();

        move.set(0, 0, 0)
            .addScaledVector(forwardAxis, Number(keys.forward) - Number(keys.backward))
            .addScaledVector(rightAxis, Number(keys.right) - Number(keys.left));

        if (move.lengthSq() > 0)
            move.normalize().multiplyScalar(keys.sprint ? PLAYER.sprintSpeed : PLAYER.speed);

        const grounded = Math.abs(velocity.y) < 0.05;

        body.current.setLinvel(
            { x: move.x, y: keys.jump && grounded ? PLAYER.jumpForce : velocity.y, z: move.z },
            true
        );

        const { x, y, z } = body.current.translation();
        camera.position.set(x, y + PLAYER.eyeHeight, z);
    });

    return (
        <RigidBody
            ref={body}
            type="dynamic"
            colliders={false}
            ccd
            position={[0, 1.2, 8]}
            mass={1}
            canSleep={false}
            enabledRotations={[false, false, false]}
        >
            <CapsuleCollider args={[PLAYER.height / 2 - PLAYER.radius, PLAYER.radius]} />
        </RigidBody>
    );
}
