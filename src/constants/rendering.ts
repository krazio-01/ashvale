import { pair } from "@/lib/helpers";

export const RENDER = {
    pixelRatioRange: pair(1, 1.5),
    multisampling: 0,
    foliageMaskScale: 0.5,
};

export const SHADING = {
    gradientSteps: 6,
};

export const LIGHT = {
    keyDistance: 60,
    rimDistance: 40,
    rimElevation: 0.45,
    shadowMapSize: 2048,
    shadowBias: -0.0006,
    shadowExtent: 60,
    shadowFar: 200,
};

export const ATMOSPHERE = {
    skyRadius: 650,
    middleAltitude: 0.32,
    skyDitherStrength: 0.6,
    hazeBaseHeight: 0,
    hazeHeightFadeRate: 0.022,
    hazeHeightInfluence: 0.75,
    sunGlowStrength: 0.5,
    sunGlowFalloff: 4,
};

export const POST_PROCESSING = {
    exposure: 1.15,
    bloomIntensity: 0.55,
    bloomThreshold: 0.68,
    bloomSmoothing: 0.35,
    bloomRadius: 0.72,
    saturationBoost: 0.24,
    brightnessLift: 0.02,
    contrastBoost: 0.16,
};

export const AMBIENT_OCCLUSION = {
    radius: 1.4,
    distanceFalloff: 1,
    intensity: 2.4,
    samples: 8,
    denoiseSamples: 4,
    denoiseRadius: 12,
    halfResolution: true,
};

export const OUTLINE = {
    thickness: 1,
    edgeThreshold: 0.012,
    fadeStartDistance: 26,
    fadeEndDistance: 70,
    foliageFadeStartDistance: 9,
    foliageFadeEndDistance: 28,
    opacity: 0.68,
    debugView: false,
};
