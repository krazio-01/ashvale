"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    AdditiveBlending,
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    Points,
    PointsMaterial,
} from "three";
import type { BufferAttribute, PointsMaterialParameters } from "three";
import { useFrame } from "@react-three/fiber";
import { createSeededRandom, FULL_TURN, lerp } from "@/lib/helpers";
import { LANDING_EMBERS, LANDING_FIREFLIES, LANDING_STARS } from "@/constants/landing";

type IUpdateParticle<T> = (
    particle: T,
    index: number,
    positionAttribute: BufferAttribute,
    colorAttribute: BufferAttribute | undefined,
    elapsedSeconds: number
) => void;

interface IParticleFieldProps<T> {
    particles: T[];
    getPosition: (particle: T) => [number, number, number];
    updateFrame: IUpdateParticle<T>;
    color: string;
    size: number;
    blending?: PointsMaterialParameters["blending"];
    opacity?: number;
    vertexColors?: boolean;
    animatesPosition?: boolean;
}

function ParticleField<T>({
    particles,
    getPosition,
    updateFrame,
    color,
    size,
    blending,
    opacity = 1,
    vertexColors = false,
    animatesPosition = true,
}: IParticleFieldProps<T>) {
    const pointsRef = useRef<Points>(null);

    const geometry = useMemo(() => {
        const positions = new Float32Array(particles.length * 3);
        const colors = vertexColors ? new Float32Array(particles.length * 3) : null;
        const baseColor = new Color(color);

        for (let index = 0; index < particles.length; index += 1) {
            const particle = particles[index];
            if (!particle) continue;

            const [x, y, z] = getPosition(particle);
            positions[index * 3] = x;
            positions[index * 3 + 1] = y;
            positions[index * 3 + 2] = z;

            if (colors) {
                colors[index * 3] = baseColor.r;
                colors[index * 3 + 1] = baseColor.g;
                colors[index * 3 + 2] = baseColor.b;
            }
        }

        const bufferGeometry = new BufferGeometry();
        bufferGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
        if (colors) bufferGeometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
        return bufferGeometry;
    }, [particles, getPosition, vertexColors, color]);

    const material = useMemo(() => {
        const materialParams: PointsMaterialParameters = {
            size,
            vertexColors,
            transparent: true,
            opacity,
            depthWrite: false,
            sizeAttenuation: true,
        };
        if (!vertexColors) materialParams.color = color;
        if (blending !== undefined) materialParams.blending = blending;

        return new PointsMaterial(materialParams);
    }, [color, size, blending, opacity, vertexColors]);

    useEffect(() => () => geometry.dispose(), [geometry]);
    useEffect(() => () => material.dispose(), [material]);

    useFrame(() => {
        const points = pointsRef.current;
        if (!points) return;

        const positionAttribute = points.geometry.getAttribute("position") as BufferAttribute;
        const colorAttribute = points.geometry.getAttribute("color") as BufferAttribute | undefined;
        const elapsedSeconds = performance.now() * 0.001;

        for (let index = 0; index < particles.length; index += 1) {
            const particle = particles[index];
            if (!particle) continue;
            updateFrame(particle, index, positionAttribute, colorAttribute, elapsedSeconds);
        }

        if (animatesPosition) positionAttribute.needsUpdate = true;
        if (colorAttribute) colorAttribute.needsUpdate = true;
    });

    return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

interface IEmberParticle {
    angle: number;
    orbitRadius: number;
    riseSpeed: number;
    driftPhase: number;
    initialHeight: number;
}

const EMBER_HEIGHT_SPAN = LANDING_EMBERS.maxHeight - LANDING_EMBERS.minHeight;

function buildEmbers(): IEmberParticle[] {
    const nextRandom = createSeededRandom(LANDING_EMBERS.seed);

    return Array.from({ length: LANDING_EMBERS.count }, () => ({
        angle: nextRandom() * FULL_TURN,
        orbitRadius: Math.sqrt(nextRandom()) * LANDING_EMBERS.radius,
        riseSpeed: LANDING_EMBERS.riseSpeed * (0.6 + nextRandom() * 0.8),
        driftPhase: nextRandom() * FULL_TURN,
        initialHeight:
            LANDING_EMBERS.minHeight +
            nextRandom() * (LANDING_EMBERS.maxHeight - LANDING_EMBERS.minHeight),
    }));
}

function getEmberPosition(particle: IEmberParticle): [number, number, number] {
    return [
        Math.cos(particle.angle) * particle.orbitRadius,
        particle.initialHeight,
        Math.sin(particle.angle) * particle.orbitRadius,
    ];
}

const updateEmber: IUpdateParticle<IEmberParticle> = (
    particle,
    index,
    positionAttribute,
    _colorAttribute,
    elapsedSeconds
) => {
    const riseOffset =
        (particle.initialHeight - LANDING_EMBERS.minHeight + particle.riseSpeed * elapsedSeconds) %
        EMBER_HEIGHT_SPAN;
    const height = LANDING_EMBERS.minHeight + riseOffset;
    const sway =
        Math.sin(particle.driftPhase + elapsedSeconds * LANDING_EMBERS.driftSpeed) *
        LANDING_EMBERS.driftAmplitude;

    positionAttribute.setXYZ(
        index,
        Math.cos(particle.angle) * particle.orbitRadius + sway,
        height,
        Math.sin(particle.angle) * particle.orbitRadius
    );
};

export const LandingEmbers = () => {
    const [particles] = useState(() => buildEmbers());

    return (
        <ParticleField
            particles={particles}
            getPosition={getEmberPosition}
            updateFrame={updateEmber}
            color={LANDING_EMBERS.color}
            size={LANDING_EMBERS.size}
            blending={AdditiveBlending}
            opacity={0.85}
        />
    );
};

interface IFirefly {
    baseX: number;
    baseY: number;
    baseZ: number;
    phaseX: number;
    phaseY: number;
    phaseZ: number;
    speed: number;
}

function buildFireflies(): IFirefly[] {
    const nextRandom = createSeededRandom(LANDING_FIREFLIES.seed);

    return Array.from({ length: LANDING_FIREFLIES.count }, () => {
        const angle = nextRandom() * FULL_TURN;
        const radius = Math.sqrt(nextRandom()) * LANDING_FIREFLIES.radius;

        return {
            baseX: Math.cos(angle) * radius,
            baseY:
                LANDING_FIREFLIES.minHeight +
                nextRandom() * (LANDING_FIREFLIES.maxHeight - LANDING_FIREFLIES.minHeight),
            baseZ: Math.sin(angle) * radius,
            phaseX: nextRandom() * FULL_TURN,
            phaseY: nextRandom() * FULL_TURN,
            phaseZ: nextRandom() * FULL_TURN,
            speed: 0.6 + nextRandom() * 0.8,
        };
    });
}

function getFireflyPosition(firefly: IFirefly): [number, number, number] {
    return [firefly.baseX, firefly.baseY, firefly.baseZ];
}

const updateFirefly: IUpdateParticle<IFirefly> = (
    firefly,
    index,
    positionAttribute,
    _colorAttribute,
    elapsedSeconds
) => {
    const time = elapsedSeconds * firefly.speed * LANDING_FIREFLIES.wanderSpeed;
    const wanderX = Math.sin(time + firefly.phaseX) * LANDING_FIREFLIES.wanderAmplitude;
    const wanderY = Math.sin(time * 1.3 + firefly.phaseY) * LANDING_FIREFLIES.wanderAmplitude * 0.4;
    const wanderZ = Math.cos(time + firefly.phaseZ) * LANDING_FIREFLIES.wanderAmplitude;

    positionAttribute.setXYZ(
        index,
        firefly.baseX + wanderX,
        firefly.baseY + wanderY,
        firefly.baseZ + wanderZ
    );
};

export const LandingFireflies = () => {
    const [fireflies] = useState(() => buildFireflies());

    return (
        <ParticleField
            particles={fireflies}
            getPosition={getFireflyPosition}
            updateFrame={updateFirefly}
            color={LANDING_FIREFLIES.color}
            size={LANDING_FIREFLIES.size}
            blending={AdditiveBlending}
            opacity={0.9}
        />
    );
};

const STAR_ELEVATION_CEILING = Math.PI / 2;
const STAR_COLOR = new Color(LANDING_STARS.color);

interface IStar {
    x: number;
    y: number;
    z: number;
    phase: number;
    speed: number;
}

function buildStars(): IStar[] {
    const nextRandom = createSeededRandom(LANDING_STARS.seed);
    const [minSpeed, maxSpeed] = LANDING_STARS.twinkleSpeedRange;

    return Array.from({ length: LANDING_STARS.count }, () => {
        const azimuth = nextRandom() * FULL_TURN;
        const elevationAngle = lerp(
            LANDING_STARS.minElevationAngle,
            STAR_ELEVATION_CEILING,
            nextRandom()
        );
        const horizontalRadius = Math.cos(elevationAngle) * LANDING_STARS.radius;

        return {
            x: Math.cos(azimuth) * horizontalRadius,
            y: Math.sin(elevationAngle) * LANDING_STARS.radius,
            z: Math.sin(azimuth) * horizontalRadius,
            phase: nextRandom() * FULL_TURN,
            speed: minSpeed + nextRandom() * (maxSpeed - minSpeed),
        };
    });
}

function getStarPosition(star: IStar): [number, number, number] {
    return [star.x, star.y, star.z];
}

const updateStar: IUpdateParticle<IStar> = (
    star,
    index,
    _positionAttribute,
    colorAttribute,
    elapsedSeconds
) => {
    if (!colorAttribute) return;

    const twinkle =
        LANDING_STARS.twinkleFloor +
        (1 - LANDING_STARS.twinkleFloor) *
        (0.5 + 0.5 * Math.sin(elapsedSeconds * star.speed + star.phase));

    colorAttribute.setXYZ(
        index,
        STAR_COLOR.r * twinkle,
        STAR_COLOR.g * twinkle,
        STAR_COLOR.b * twinkle
    );
};

export const LandingStars = () => {
    const [stars] = useState(() => buildStars());

    return (
        <ParticleField
            particles={stars}
            getPosition={getStarPosition}
            updateFrame={updateStar}
            color={LANDING_STARS.color}
            size={LANDING_STARS.size}
            vertexColors
            animatesPosition={false}
        />
    );
};
