"use client";

import { useEffect, useMemo } from "react";
import {
    AdditiveBlending,
    BufferGeometry,
    Color,
    BufferAttribute,
    DynamicDrawUsage,
    PointsMaterial,
} from "three";
import type { PointsMaterialParameters } from "three";
import { useFrame } from "@react-three/fiber";
import {
    createSeededRandom,
    FULL_TURN,
    lerp,
    randomPointInDisc,
    valueInRange,
} from "@/lib/helpers";
import { LANDING_EMBERS, LANDING_FIREFLIES, LANDING_STARS } from "@/constants/ui";

const EMBER_HEIGHT_SPAN = LANDING_EMBERS.maxHeight - LANDING_EMBERS.minHeight;

const STAR_ELEVATION_CEILING = Math.PI / 2;

const STAR_COLOR = new Color(LANDING_STARS.color);

const EMBERS = buildEmbers();

const FIREFLIES = buildFireflies();

const STARS = buildStars();

type UpdateParticles<T> = (
    particles: readonly T[],
    attribute: BufferAttribute,
    elapsedSeconds: number
) => void;

interface IParticleFieldProps<T> {
    particles: readonly T[];
    getPosition?: (particle: T) => [number, number, number];
    updateFrame: UpdateParticles<T>;
    color: string;
    size: number;
    blending?: PointsMaterialParameters["blending"];
    opacity?: number;
    vertexColors?: boolean;
}

interface IEmberParticle {
    orbitX: number;
    orbitZ: number;
    riseSpeed: number;
    driftPhase: number;
    initialRiseOffset: number;
}

interface IFirefly {
    baseX: number;
    baseY: number;
    baseZ: number;
    phaseX: number;
    phaseY: number;
    phaseZ: number;
    speed: number;
}

interface IStar {
    x: number;
    y: number;
    z: number;
    phase: number;
    speed: number;
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
}: IParticleFieldProps<T>) {
    const { geometry, animated } = useMemo(() => {
        const position = new BufferAttribute(new Float32Array(particles.length * 3), 3);
        if (getPosition)
            particles.forEach((particle, index) =>
                position.setXYZ(index, ...getPosition(particle))
            );
        const bufferGeometry = new BufferGeometry().setAttribute("position", position);
        if (!vertexColors)
            return { geometry: bufferGeometry, animated: position.setUsage(DynamicDrawUsage) };

        const colors = new BufferAttribute(new Float32Array(particles.length * 3), 3);
        bufferGeometry.setAttribute("color", colors);
        return { geometry: bufferGeometry, animated: colors.setUsage(DynamicDrawUsage) };
    }, [particles, getPosition, vertexColors]);

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

    useFrame(() => advanceParticles(updateFrame, particles, animated));

    return <points geometry={geometry} material={material} frustumCulled={false} />;
}

export const LandingEmbers = () => (
    <ParticleField
        particles={EMBERS}
        updateFrame={updateEmbers}
        color={LANDING_EMBERS.color}
        size={LANDING_EMBERS.size}
        blending={AdditiveBlending}
        opacity={0.85}
    />
);

export const LandingFireflies = () => (
    <ParticleField
        particles={FIREFLIES}
        updateFrame={updateFireflies}
        color={LANDING_FIREFLIES.color}
        size={LANDING_FIREFLIES.size}
        blending={AdditiveBlending}
        opacity={0.9}
    />
);

export const LandingStars = () => (
    <ParticleField
        particles={STARS}
        getPosition={getStarPosition}
        updateFrame={updateStars}
        color={LANDING_STARS.color}
        size={LANDING_STARS.size}
        vertexColors
    />
);

function advanceParticles<T>(
    updateFrame: UpdateParticles<T>,
    particles: readonly T[],
    attribute: BufferAttribute
): void {
    updateFrame(particles, attribute, performance.now() * 0.001);
    attribute.needsUpdate = true;
}

function buildEmbers(): IEmberParticle[] {
    const nextRandom = createSeededRandom(LANDING_EMBERS.seed);

    return Array.from({ length: LANDING_EMBERS.count }, () => {
        const angle = nextRandom() * FULL_TURN;
        const orbitRadius = Math.sqrt(nextRandom()) * LANDING_EMBERS.radius;
        return {
            orbitX: Math.cos(angle) * orbitRadius,
            orbitZ: Math.sin(angle) * orbitRadius,
            riseSpeed: LANDING_EMBERS.riseSpeed * (0.6 + nextRandom() * 0.8),
            driftPhase: nextRandom() * FULL_TURN,
            initialRiseOffset: nextRandom() * EMBER_HEIGHT_SPAN,
        };
    });
}

const updateEmbers: UpdateParticles<IEmberParticle> = (particles, attribute, elapsedSeconds) => {
    const drift = elapsedSeconds * LANDING_EMBERS.driftSpeed;
    for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const riseOffset =
            (particle.initialRiseOffset + particle.riseSpeed * elapsedSeconds) % EMBER_HEIGHT_SPAN;
        const height = LANDING_EMBERS.minHeight + riseOffset;
        const sway = Math.sin(particle.driftPhase + drift) * LANDING_EMBERS.driftAmplitude;

        attribute.setXYZ(index, particle.orbitX + sway, height, particle.orbitZ);
    }
};

function buildFireflies(): IFirefly[] {
    const nextRandom = createSeededRandom(LANDING_FIREFLIES.seed);

    return Array.from({ length: LANDING_FIREFLIES.count }, () => {
        const [baseX, baseZ] = randomPointInDisc(nextRandom, LANDING_FIREFLIES.radius);

        return {
            baseX,
            baseY: lerp(LANDING_FIREFLIES.minHeight, LANDING_FIREFLIES.maxHeight, nextRandom()),
            baseZ,
            phaseX: nextRandom() * FULL_TURN,
            phaseY: nextRandom() * FULL_TURN,
            phaseZ: nextRandom() * FULL_TURN,
            speed: 0.6 + nextRandom() * 0.8,
        };
    });
}

const updateFireflies: UpdateParticles<IFirefly> = (particles, attribute, elapsedSeconds) => {
    for (let index = 0; index < particles.length; index += 1) {
        const firefly = particles[index];
        const time = elapsedSeconds * firefly.speed * LANDING_FIREFLIES.wanderSpeed;
        const wanderX = Math.sin(time + firefly.phaseX) * LANDING_FIREFLIES.wanderAmplitude;
        const wanderY =
            Math.sin(time * 1.3 + firefly.phaseY) * LANDING_FIREFLIES.wanderAmplitude * 0.4;
        const wanderZ = Math.cos(time + firefly.phaseZ) * LANDING_FIREFLIES.wanderAmplitude;

        attribute.setXYZ(
            index,
            firefly.baseX + wanderX,
            firefly.baseY + wanderY,
            firefly.baseZ + wanderZ
        );
    }
};

function buildStars(): IStar[] {
    const nextRandom = createSeededRandom(LANDING_STARS.seed);

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
            speed: valueInRange(LANDING_STARS.twinkleSpeedRange, nextRandom()),
        };
    });
}

function getStarPosition(star: IStar): [number, number, number] {
    return [star.x, star.y, star.z];
}

const updateStars: UpdateParticles<IStar> = (particles, attribute, elapsedSeconds) => {
    for (let index = 0; index < particles.length; index += 1) {
        const star = particles[index];
        const twinkle =
            LANDING_STARS.twinkleFloor +
            (1 - LANDING_STARS.twinkleFloor) *
                (0.5 + 0.5 * Math.sin(elapsedSeconds * star.speed + star.phase));

        attribute.setXYZ(
            index,
            STAR_COLOR.r * twinkle,
            STAR_COLOR.g * twinkle,
            STAR_COLOR.b * twinkle
        );
    }
};
