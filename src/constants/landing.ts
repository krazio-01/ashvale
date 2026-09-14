import { metres } from "@/lib/helpers";
import { ATMOSPHERE } from "@/constants/rendering";
import { PALETTE } from "@/constants/characters";

export const ISLAND = {
    topRadius: metres(6),
    radialSegments: 14,
    ringRadiusRatios: [1, 0.82, 0.5, 0.22],
    ringDepths: [0, metres(1), metres(2.4), metres(3.6)],
    apexDepth: metres(4.6),
    edgeJitterRatio: 0.18,
    craggingGrowthPerRing: 0.06,
    noiseSeed: 1337,
    surfaceNoiseScale: 0.16,
    surfaceNoiseAmplitude: metres(0.3),
    edgeNoiseScale: 0.22,
};

export const LANDING_PROPS = {
    seed: 4242,
    scatterRadius: metres(4.4),
    minSpacing: metres(2.8),
    placementAttempts: 80,
    instanceCount: 7,
    modelPaths: [
        "/models/woodland/CommonTree_1.gltf",
        "/models/woodland/CommonTree_3.gltf",
        "/models/woodland/Pine_2.gltf",
        "/models/woodland/Bush_Common_Flowers.gltf",
        "/models/woodland/Rock_Medium_2.gltf",
        "/models/woodland/Flower_3_Group.gltf",
        "/models/woodland/Grass_Wispy_Tall.gltf",
    ],
    scaleRange: [0.85, 1.2] as [number, number],
};

export const LANDING_CHARACTER = {
    position: [0, 0, metres(2.6)] as [number, number, number],
    rotationY: 0,
    reservedClearance: metres(2.2),
    entranceDelaySeconds: 0.15,
    reactionClipName: "Interact",
    reactionFadeSeconds: 0.18,
    hoverBounceAmplitude: 0.018,
    hoverBounceSpeed: 8,
};

export const LANDING_EMBERS = {
    count: 42,
    seed: 917,
    color: PALETTE.ember,
    radius: metres(5.5),
    minHeight: 0,
    maxHeight: metres(7),
    riseSpeed: metres(0.35),
    driftAmplitude: metres(0.5),
    driftSpeed: 0.6,
    size: 0.16,
};

export const LANDING_FIREFLIES = {
    count: 24,
    seed: 2831,
    color: PALETTE.gold,
    radius: metres(4.6),
    minHeight: metres(0.15),
    maxHeight: metres(1.5),
    wanderSpeed: 0.45,
    wanderAmplitude: metres(0.9),
    size: 0.1,
};

export const LANDING_SKY = {
    zenith: "#0a0e1c",
    middle: "#161d38",
    horizon: "#2b3a66",
    abyss: "#07090f",
    glow: "#ff7a3c",
    sun: "#fff0dc",
    sunElevation: 0.4,
    sunAzimuth: 0.9,
    sunSize: 0.03,
    glowFalloff: 28,
    hazeStrength: 3.4,
    keyColor: "#d8e2ff",
    keyIntensity: 1.1,
    rimColor: "#ff7a3c",
    rimIntensity: 0.6,
    skyFill: "#4b5a8c",
    groundFill: "#14152a",
    hemisphereIntensity: 0.6,
    fogDensity: 0.0022,
    outlineColor: "#0a0c16",
};

export const LANDING_HUD = {
    ringDiameter: 3.5,
    dotOffset: 1.55,
};

export const LANDING_MOUNTAINS = {
    layers: [
        {
            radius: metres(70),
            segments: 26,
            peakHeightMin: metres(6),
            peakHeightMax: metres(16),
            baseY: -metres(30),
            color: "#0b0f1f",
            noiseSeed: 5501,
            noiseScale: 0.42,
        },
        {
            radius: metres(115),
            segments: 30,
            peakHeightMin: metres(10),
            peakHeightMax: metres(24),
            baseY: -metres(30),
            color: "#374a82",
            noiseSeed: 7703,
            noiseScale: 0.3,
        },
    ],
};

export const LANDING_CLOUDS = {
    count: 7,
    seed: 4471,
    radiusMin: metres(55),
    radiusMax: metres(95),
    minHeight: metres(6),
    maxHeight: metres(14),
    puffsPerClusterMin: 3,
    puffsPerClusterMax: 6,
    clusterSpread: metres(3.5),
    puffRadiusMin: metres(1.6),
    puffRadiusMax: metres(3.2),
    color: "#3a4570",
    opacity: 0.85,
    driftSpeed: 0.012,
};

export const LANDING_STARS = {
    count: 220,
    seed: 6161,
    radius: metres(220),
    minElevationAngle: -0.05,
    size: 1.1,
    color: "#fdf6ff",
    twinkleSpeedRange: [0.5, 2.2] as [number, number],
    twinkleFloor: 0.35,
};

export const LANDING_CAMERA = {
    fov: 42,
    near: 0.1,
    far: ATMOSPHERE.skyRadius + 50,
    orbitRadius: metres(16),
    orbitHeight: metres(2.4),
    lookHeight: metres(0.2),
    orbitSpeed: 0.045,
    parallaxYaw: 0.3,
    parallaxHeight: metres(1),
    smoothing: 2.2,
    wheelSensitivity: 0.0022,
    dragSensitivity: 0.006,
    inputVelocityDecay: 2.4,
    maxInputVelocity: 4.5,
    diveDuration: 0.85,
    diveRadius: metres(2.2),
    diveHeight: metres(1.4),
    diveSwoopSpeed: 0.09,
};
