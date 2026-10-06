import { metres } from "@/lib/helpers";
import type { IPhysicsFeel, PhysicsBodyKind } from "@/types/physics";

export const PHYSICS = {
    dataKey: "physics",
    boneNamePrefix: "phys_",
    step: { maxStepSeconds: 1 / 30, substepSeconds: 1 / 240, maxSubsteps: 4 },
    solver: {
        iterations: 6,
        reducedIterations: 3,
        maxSpeed: metres(12),
        sleepSpeed: metres(0.02),
        sleepSeconds: 0.5,
        wakeDistance: metres(0.002),
        teleportDistance: metres(1.5),
        particleRadius: metres(0.01),
        colliderMargin: metres(0.005),
        tetherReachShare: 0.5,
        pinFollowShare: 0.7,
        floorClearance: metres(0.02),
    },
    environment: {
        gravity: metres(9.81),
        wind: {
            direction: [0.6, 0, 0.8],
            base: metres(0.15),
            gustAmplitude: metres(0.35),
            gustHertz: 0.35,
        },
    },
    impulse: { speedPerStrength: metres(0.35), minimumPushLengthSquared: 1e-8 },
    lod: { fullMetres: metres(15), reducedMetres: metres(40) },
    kinds: {
        sheet: {
            stiffness: 1,
            bendStiffness: 0.25,
            damping: 3.5,
            gravityScale: 1,
            windExposure: 0.6,
            tetherSlack: 0.03,
            contactFriction: 0.25,
            impulseScale: 1,
        },
    } satisfies Record<PhysicsBodyKind, IPhysicsFeel>,
};
