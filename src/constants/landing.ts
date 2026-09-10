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

/* A deliberately richer, moodier sky/lighting pass for the landing scene only - shallow-merged
   onto the resolved Woodland/Summer manifest at render time. Never touches the shared theme
   files, so real generated realms keep their own (paler, daytime) Woodland palette untouched.

   `keyColor`/`skyFill` are deliberately cool and near-neutral, not part of the warm accent
   family: MeshToonMaterial output is (base color * light color), so a saturated, non-neutral
   light washes every surface toward that hue regardless of its own color - a prior version used
   a saturated pink key light and every asset (green trees included) rendered as a flat brick-red
   wash. `ember` (the app's existing brand accent, see $color-ember/PALETTE.ember) is reserved for
   rim light, the sky glow, and particles only - rim light by nature only grazes edges facing away
   from the key light, so it reads as an accent highlight instead of recoloring whole surfaces.

   Re: SkyDome's gradient - verified against its exact shader math (not guessed): at the current
   LANDING_CAMERA framing (orbitHeight 2.4m, lookHeight 0.2m, orbitRadius 16m, fov 42deg) the
   camera's forward direction points ~7.8deg below horizontal, so the top of frame reaches
   ~13.2deg of altitude, i.e. viewDirection.y ~= sin(13.2deg) ~= 0.228. Against
   ATMOSPHERE.middleAltitude = 0.32, smoothstep(0, 0.32, 0.228) ~= 0.80 - `middle` is ~80% blended
   in at the top of the visible sky, so it (unlike `zenith`, which stays out of frame) is a real,
   visible part of the gradient and should read as a distinct, deliberate step from `horizon`. */
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

/* Distant ridge silhouettes ringing the whole scene, so the island reads as a fragment of a
   much larger world instead of floating alone in a gradient. DoubleSide + a flat unlit color
   means triangle winding doesn't matter, so this stays simple and cheap: ~2 layers x
   ~28 segments x 2 tris, no normals, no lighting. The post-process atmosphere pass already
   haze-fades anything by depth, so the far layer naturally recedes without extra work here.
   Both layers sit clearly darker/cooler than LANDING_SKY.horizon so they read as a silhouette
   band instead of blending into the sky.

   peakHeightMin/Max is the peak's absolute world Y (buildLayerGeometry's peakAt() does not offset
   it by baseY - only the base ring uses baseY, to sit that edge comfortably below the horizon so
   it never shows a visible bottom edge). It needs to land inside the camera's visible elevation
   band, or the ridge sits entirely below the horizon (too low) or entirely above the top of frame
   (too high) and never reads as a skyline. At this camera framing (see the elevation-angle math
   in LANDING_SKY's comment above: eye height ~2.4m, visible band ~0-13deg), a peak needs world Y
   roughly in [eyeHeight + radius*tan(2deg), eyeHeight + radius*tan(11deg)] to sit clearly above
   the horizon without being clipped by the top of frame. */
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

/* Low-poly puff clusters drifting slowly through the mid-sky, between the mountain rings and
   the starfield - the thing that reads as genuine "sky" motion rather than a static backdrop.
   Same unlit-silhouette technique as LANDING_MOUNTAINS (flat color, no normals/lighting needed)
   for the same reason: cheap, and consistent with how this scene already renders distant
   background layers. Each cloud is a handful of overlapping icosahedra sharing one geometry and
   material instance - the puff count only affects mesh count, not draw calls worth worrying
   about at this scale (well under 40 meshes total). */
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
