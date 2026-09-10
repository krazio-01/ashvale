"use client";
import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { lerp } from "@/lib/helpers";
import { LANDING_CAMERA } from "@/constants/landing";

const BEARING_DEGREES_IN_CIRCLE = 360;

export interface IOrbitInput {
    angleOffset: number;
    velocity: number;
    isDragging: boolean;
    lastPointerX: number;
    lastPointerTime: number;
}

const LandingCameraRig = ({
    orbitInputRef,
    bearingLabelRef,
    compassRingRef,
    isDiving,
    onDiveComplete,
}: {
    orbitInputRef: RefObject<IOrbitInput>;
    bearingLabelRef: RefObject<HTMLSpanElement | null>;
    compassRingRef: RefObject<HTMLDivElement | null>;
    isDiving: boolean;
    onDiveComplete: () => void;
}) => {
    const pointer = useThree((state) => state.pointer);
    const orbitAngle = useRef(0);
    const smoothedAngle = useRef(0);
    const smoothedHeight = useRef(LANDING_CAMERA.orbitHeight);
    const diveElapsed = useRef(0);
    const diveStartAngle = useRef(0);
    const hasDiveStarted = useRef(false);
    const hasDiveCompleted = useRef(false);

    useFrame(({ camera }, deltaSeconds) => {
        const input = orbitInputRef.current;
        input.velocity *= Math.exp(-LANDING_CAMERA.inputVelocityDecay * deltaSeconds);
        input.angleOffset += input.velocity * deltaSeconds;

        if (isDiving) {
            if (!hasDiveStarted.current) {
                hasDiveStarted.current = true;
                diveElapsed.current = 0;
                diveStartAngle.current = smoothedAngle.current;
            }

            diveElapsed.current += deltaSeconds;
            const progress = Math.min(diveElapsed.current / LANDING_CAMERA.diveDuration, 1);
            const eased = progress * progress * (3 - 2 * progress);

            const angle =
                diveStartAngle.current + diveElapsed.current * LANDING_CAMERA.diveSwoopSpeed;
            const radius = lerp(LANDING_CAMERA.orbitRadius, LANDING_CAMERA.diveRadius, eased);
            const height = lerp(smoothedHeight.current, LANDING_CAMERA.diveHeight, eased);

            camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
            camera.lookAt(0, LANDING_CAMERA.diveHeight * 0.4, 0);

            if (progress >= 1 && !hasDiveCompleted.current) {
                hasDiveCompleted.current = true;
                onDiveComplete();
            }

            return;
        }

        orbitAngle.current += LANDING_CAMERA.orbitSpeed * deltaSeconds;

        const targetAngle =
            orbitAngle.current +
            input.angleOffset +
            (input.isDragging ? 0 : pointer.x * LANDING_CAMERA.parallaxYaw);
        const targetHeight = LANDING_CAMERA.orbitHeight + pointer.y * LANDING_CAMERA.parallaxHeight;
        const smoothing = 1 - Math.exp(-LANDING_CAMERA.smoothing * deltaSeconds);

        smoothedAngle.current += (targetAngle - smoothedAngle.current) * smoothing;
        smoothedHeight.current += (targetHeight - smoothedHeight.current) * smoothing;

        camera.position.set(
            Math.sin(smoothedAngle.current) * LANDING_CAMERA.orbitRadius,
            smoothedHeight.current,
            Math.cos(smoothedAngle.current) * LANDING_CAMERA.orbitRadius
        );
        camera.lookAt(0, LANDING_CAMERA.lookHeight, 0);

        const rawDegrees = Math.round((smoothedAngle.current * 180) / Math.PI);
        const degrees =
            ((rawDegrees % BEARING_DEGREES_IN_CIRCLE) + BEARING_DEGREES_IN_CIRCLE) %
            BEARING_DEGREES_IN_CIRCLE;

        if (bearingLabelRef.current)
            bearingLabelRef.current.textContent = `${degrees.toString().padStart(3, "0")}°`;
        if (compassRingRef.current)
            compassRingRef.current.style.transform = `rotate(${degrees}deg)`;
    });

    return null;
};

export default LandingCameraRig;
