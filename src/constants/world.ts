export const WORLD = {
    gravity: -22,
    fixedTimestep: 1 / 60,
    maximumStepsPerFrame: 5,
    maximumFrameDelta: 0.25,
};

export const TERRAIN = {
    targetCellSize: 4,
    minimumResolution: 64,
    maximumResolution: 256,
    pathLevel: 0,
    bankWidth: 12,
    corridorDrop: 0.4,
    macroSlopeGrainWavelengths: 4,
    carveColorSharpness: 0.75,
    peakColorSharpness: 0.7,
    bucketSize: 220,
};

export const LANDFORM = {
    floorReliefHeight: 0.5,
    floorReliefScale: 0.028,
    minimumOpennessRatio: 0.5,
    openGroundRampRatio: 0.7,
    openGroundReliefHeight: 1.6,
    openGroundReliefScale: 0.05,
};

export const WORLD_EDGE = {
    groundApron: 24,
    lipWidth: 20,
    dropDepth: 70,
    dropCurve: 2.6,
    barrierLipRatio: 0.3,
    barrierHeight: 30,
    barrierSink: 6,
};

export const TERRAIN_DETAIL = {
    textureSize: 384,
    worldRepeat: 7,
    grainTileCount: 10,
    grainStrength: 0.15,
    blotchTileCount: 3,
    mudMultiplier: [0.55, 0.48, 0.4],
    dustMultiplier: [1, 0.94, 0.78],
    grainNoiseHeight: 0.55,
    grainNoiseScale: 0.42,
    rockSlopeStart: 0.32,
    rockSlopeEnd: 0.85,
};

export const GROUND = {
    clearedHueShift: -0.05,
    clearedSaturationScale: 0.55,
    clearedLightnessGain: 0.18,
    depthLightnessStep: 0.035,
    minimumFloorLightness: 0.22,
    routeSaturationScale: 0.8,
    routeLightnessGain: 0.09,
};
