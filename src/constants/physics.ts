import { WORLD, metresToUnits } from "@/constants/world";
import { degreesToRadians } from "@/lib/helpers";
import type { IClothTuning, MotorTuning } from "@/types/physics";

export const MOTOR_BASE_TUNING = {
    colliderOffset: 0.02,
    terminalVelocity: -45,
    airAccelerationPerHeight: 6,
} satisfies Partial<MotorTuning>;

export const PHYSICS = {
    dataKey: "physics",
    dataVersion: 3,
    hullSupportDirections: 64,
    boneNamePrefix: "phys_",
    capsuleSlots: { carriedWeapon: 0 },
    epsilon: { geometry: 1e-12, motion: 1e-9 },
    step: {
        substepsPerFrame: 12,
        referenceFrameSeconds: WORLD.fixedTimestep,
        maxSubsteps: 24,
        maxFrameSeconds: 1 / 30,
        reducedSubstepShare: 1 / 3,
    },
    solver: {
        maxSpeed: metresToUnits(12),
        sleepSpeed: metresToUnits(0.02),
        sleepSeconds: 0.5,
        wakeSpeed: metresToUnits(0.12),
        wakeAngularSpeed: degreesToRadians(12),
        floorClearance: metresToUnits(0.02),
        collisionPasses: 2,
    },
    reference: {
        moveLag: 0.6,
        turnLag: 0.6,
        turnFlingScale: 0.8,
        maxLagMoveSpeed: metresToUnits(8),
        maxLagTurnSpeed: degreesToRadians(540),
        teleportDistance: metresToUnits(1.5),
        teleportAngle: degreesToRadians(90),
    },
    restart: { holdSeconds: 0.18, dampingSeconds: 1.5, dampingScale: 10 },
    environment: {
        gravity: Math.abs(WORLD.gravity),
        wind: {
            direction: [0.6, 0, 0.8],
            base: metresToUnits(0.02),
            gustAmplitude: metresToUnits(0.04),
            gustHertz: 0.35,
            gustMix: { primary: 0.6, secondary: 0.4, secondaryRate: 2.3, secondaryPhase: 1.3 },
        },
    },
    impulse: { speedPerStrength: metresToUnits(0.35), minimumPushLengthSquared: 1e-8 },
    cloth: {
        damping: 1.2,
        stretchSoftness: 1e-7,
        bendSoftness: 1e-5,
        gravityScale: 0.89,
        windExposure: 1,
        pinSlack: 1.03,
        maxDriftAtHem: metresToUnits(1),
        driftCurve: 1,
        bodyGuardRadius: metresToUnits(0.3),
        bodyGuardDepth: metresToUnits(0.01),
        collisionThickness: metresToUnits(0.012),
        targetClearance: metresToUnits(0.01),
        targetClearanceBlend: metresToUnits(0.06),
        friction: 4,
        hitImpulseScale: 1,
    } satisfies IClothTuning,
};
