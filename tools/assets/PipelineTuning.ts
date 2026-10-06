import type { CharacterRole } from "./AssetManifest";

export const REFERENCE_HEIGHT_METRES = 1.78;

export type DeepPartial<T> = {
    [Key in keyof T]?: T[Key] extends readonly unknown[]
        ? T[Key]
        : T[Key] extends object
          ? DeepPartial<T[Key]>
          : T[Key];
};

export interface IPrepareTuning {
    torsoBand: readonly [number, number];
    torsoHalfWidth: number;
    spineDepth: number;
    debrisFaceFraction: number;
    debrisPropShare: number;
    debrisTinyFaces: number;
    propMinPiece: number;
    propPartReach: number;
    physicsPartReach: number;
    propSmoothIterations: number;
    thinTo: number;
    thicknessRayStart: number;
    thicknessLimit: number;
    clothSeedReach: number;
}

export interface IUnwrapTuning {
    padding: number;
    iterations: number;
}

export interface IBakeTuning {
    samples: number;
    cageExtrusion: number;
    rayDistance: number;
    marginPixels: number;
    roughness: number;
    minNormalLength: number;
    normalDonorCount: number;
}

export interface IJointsTuning {
    skinMinSaturation: number;
    skinMinRed: number;
    bodyMinThickness: number;
    legSlack: number;
    torsoBandHalfHeight: number;
    handCentringIterations: number;
    armAxisPathIndex: number;
    handBand: readonly [number, number];
    handMinOffset: number;
    handRadius: number;
    minHandVertices: number;
    footBandTop: number;
    minFootVertices: number;
    footSplitIterations: number;
    footGrowTop: number;
    footGrowRadius: number;
    heelSearchTop: number;
    heelBand: number;
    ankleAboveHeel: number;
    ankleAlongFoot: number;
    toeToBall: number;
    ankleSliceRadius: number;
    sliceStep: number;
    sliceHalf: number;
    armTrackRadius: number;
    armTorsoClearance: number;
    minSlicePoints: number;
    shoulderTrackMargin: number;
    upperArmBelowShoulder: number;
    upperArmOutsideTorso: readonly [number, number];
    headHalfWidth: number;
    headRadius: number;
    headTopShare: number;
    bodyExtentPercentiles: readonly [number, number];
    widthPercentiles: readonly [number, number];
    centringIterations: number;
    headTopSlice: number;
    spineCurveDegree: number;
    mirrorSearch: number;
    mirrorStep: number;
    mirrorSlice: number;
    mirrorDistanceCap: number;
    mirrorHalfWidth: { torso: number; neck: number; head: number };
    wristEdgeShare: number;
    handEndShare: number;
    knuckleAlongHand: number;
}

export interface IPhysicsTuning {
    fadeRows: number;
    nodeSigmaCells: number;
    minCell: number;
    colliderSectors: number;
    colliderAlong: readonly [number, number];
    colliderMinRadius: number;
    colliderShrink: number;
    colliderMaxRadius: {
        torso: number;
        upperArm: number;
        lowerArm: number;
        thigh: number;
        calf: number;
    };
    minBodyVertices: number;
    minPointsForCapsule: number;
    pinInsideTolerance: number;
}

export interface IRigTuning {
    heatTransferNeighbours: number;
    heatProxyVoxel: number;
    thinFrom: number;
    clothCore: readonly [number, number];
    clothBodyShare: number;
    dampedLimbFactor: number;
    thighShare: number;
    thighRamp: number;
    thighSideBlend: number;
    headZoneBelow: readonly [number, number];
    headZoneRadius: readonly [number, number];
    handZoneAlong: readonly [number, number];
    handZoneRadius: readonly [number, number];
    fingersPastKnuckles: number;
    rigidZoneSnap: number;
    clothSheetThickness: number;
    limbHeatDominance: number;
    limbCoreShare: number;
}

export interface IWeightsTuning {
    crotchHalfWidth: number;
    crotchBelowHip: number;
    crotchAboveHip: number;
    smoothingIterations: number;
    maxInfluences: number;
    minEdgeLength: number;
    regionDominance: number;
    stretchPercentile: number;
}

export interface IPreviewTuning {
    boneTubeRadius: number;
}

export interface IDetectionTuning {
    minClothArea: number;
    minClothFaces: number;
    maxPhysicsBodies: number;
    clothCellSize: number;
    sideDeadZone: number;
}

export interface IPipelineTuning {
    prepare: IPrepareTuning;
    unwrap: IUnwrapTuning;
    bake: IBakeTuning;
    joints: IJointsTuning;
    physics: IPhysicsTuning;
    rig: IRigTuning;
    weights: IWeightsTuning;
    preview: IPreviewTuning;
    detection: IDetectionTuning;
}

const BASE_TUNING: IPipelineTuning = {
    prepare: {
        torsoBand: [0.95, 1.25],
        torsoHalfWidth: 0.14,
        spineDepth: 0.016,
        debrisFaceFraction: 0.003,
        debrisPropShare: 0.5,
        debrisTinyFaces: 12,
        propMinPiece: 200,
        propPartReach: 0.01,
        physicsPartReach: 0.05,
        propSmoothIterations: 3,
        thinTo: 0.03,
        thicknessRayStart: 0.002,
        thicknessLimit: 0.12,
        clothSeedReach: 0.03,
    },
    unwrap: { padding: 6, iterations: 2 },
    bake: {
        samples: 8,
        cageExtrusion: 0.02,
        rayDistance: 0.05,
        marginPixels: 12,
        roughness: 0.8,
        minNormalLength: 0.5,
        normalDonorCount: 8,
    },
    joints: {
        skinMinSaturation: 0.42,
        skinMinRed: 0.18,
        bodyMinThickness: 0.03,
        legSlack: 0.01,
        torsoBandHalfHeight: 0.05,
        handCentringIterations: 6,
        armAxisPathIndex: 5,
        handBand: [0.55, 1.05],
        handMinOffset: 0.12,
        handRadius: 0.14,
        minHandVertices: 40,
        footBandTop: 0.1,
        minFootVertices: 50,
        footSplitIterations: 50,
        footGrowTop: 0.16,
        footGrowRadius: 0.14,
        heelSearchTop: 0.16,
        heelBand: 0.04,
        ankleAboveHeel: 0.075,
        ankleAlongFoot: 0.25,
        toeToBall: 0.07,
        ankleSliceRadius: 0.07,
        sliceStep: 0.02,
        sliceHalf: 0.012,
        armTrackRadius: 0.07,
        armTorsoClearance: 0.1,
        minSlicePoints: 8,
        shoulderTrackMargin: 0.06,
        upperArmBelowShoulder: 0.05,
        upperArmOutsideTorso: [0.1, 0.3],
        headHalfWidth: 0.08,
        headRadius: 0.12,
        headTopShare: 0.02,
        bodyExtentPercentiles: [10, 90],
        widthPercentiles: [2, 98],
        centringIterations: 8,
        headTopSlice: 0.04,
        spineCurveDegree: 2,
        mirrorSearch: 0.12,
        mirrorStep: 0.0025,
        mirrorSlice: 0.015,
        mirrorDistanceCap: 0.03,
        mirrorHalfWidth: { torso: 0.15, neck: 0.08, head: 0.09 },
        wristEdgeShare: 0.03,
        handEndShare: 0.15,
        knuckleAlongHand: 0.55,
    },
    physics: {
        fadeRows: 1.0,
        nodeSigmaCells: 0.6,
        minCell: 0.01,
        colliderSectors: 16,
        colliderAlong: [0.1, 0.9],
        colliderMinRadius: 0.02,
        colliderShrink: 0.9,
        colliderMaxRadius: { torso: 0.3, upperArm: 0.12, lowerArm: 0.1, thigh: 0.2, calf: 0.15 },
        minBodyVertices: 40,
        minPointsForCapsule: 20,
        pinInsideTolerance: 0.015,
    },
    rig: {
        heatTransferNeighbours: 3,
        heatProxyVoxel: 0.012,
        thinFrom: 0.015,
        clothCore: [0.11, 0.15],
        clothBodyShare: 0.15,
        dampedLimbFactor: 0.1,
        thighShare: 0.35,
        thighRamp: 0.45,
        thighSideBlend: 0.08,
        headZoneBelow: [0.1, 0.04],
        headZoneRadius: [0.12, 0.17],
        handZoneAlong: [-0.02, 0.03],
        handZoneRadius: [0.075, 0.11],
        fingersPastKnuckles: 0.07,
        rigidZoneSnap: 0.99,
        clothSheetThickness: 0.008,
        limbHeatDominance: 0.5,
        limbCoreShare: 0.6,
    },
    weights: {
        crotchHalfWidth: 0.13,
        crotchBelowHip: 0.45,
        crotchAboveHip: 0.05,
        smoothingIterations: 60,
        maxInfluences: 4,
        minEdgeLength: 0.004,
        regionDominance: 0.6,
        stretchPercentile: 99.5,
    },
    preview: { boneTubeRadius: 0.007 },
    detection: {
        minClothArea: 0.1,
        minClothFaces: 40,
        maxPhysicsBodies: 6,
        clothCellSize: 0.15,
        sideDeadZone: 0.05,
    },
};

const ROLE_TUNING: Record<CharacterRole, DeepPartial<IPipelineTuning>> = {
    player: {},
    enemy: {},
    boss: {},
};

const SHARE_PATHS = [
    "prepare.debrisFaceFraction",
    "prepare.debrisPropShare",
    "rig.clothBodyShare",
    "rig.thighShare",
    "rig.limbHeatDominance",
    "rig.limbCoreShare",
    "rig.rigidZoneSnap",
    "weights.regionDominance",
    "joints.headTopShare",
    "joints.wristEdgeShare",
    "joints.handEndShare",
    "joints.knuckleAlongHand",
    "physics.colliderShrink",
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const mergeDeep = <T>(base: T, overrides: DeepPartial<T> | undefined): T => {
    if (!overrides) return base;
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(overrides)) {
        const current = merged[key];
        merged[key] =
            isPlainObject(value) && isPlainObject(current)
                ? mergeDeep(current, value as never)
                : value;
    }
    return merged as T;
};

const numbersIn = (value: unknown, path: string): [string, number][] => {
    if (typeof value === "number") return [[path, value]];
    if (Array.isArray(value))
        return value.flatMap((item, index) => numbersIn(item, `${path}[${index}]`));
    if (isPlainObject(value))
        return Object.entries(value).flatMap(([key, item]) =>
            numbersIn(item, path ? `${path}.${key}` : key)
        );
    return [];
};

export const resolveTuning = (
    role: CharacterRole,
    overrides: DeepPartial<IPipelineTuning> | undefined
): IPipelineTuning => mergeDeep(mergeDeep(BASE_TUNING, ROLE_TUNING[role]), overrides);

const WHOLE_NUMBER_PATHS = [
    "prepare.debrisTinyFaces",
    "prepare.propMinPiece",
    "prepare.propSmoothIterations",
    "unwrap.padding",
    "unwrap.iterations",
    "weights.smoothingIterations",
    "weights.maxInfluences",
    "detection.minClothFaces",
    "detection.maxPhysicsBodies",
] as const;

const POSITIVE_PATHS = [
    "detection.clothCellSize",
    "detection.minClothArea",
    "physics.minCell",
] as const;

const valueAt = (tuning: IPipelineTuning, path: string): number =>
    path
        .split(".")
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], tuning) as number;

export const assertTuning = (name: string, tuning: IPipelineTuning): void => {
    for (const [path, value] of numbersIn(tuning, ""))
        if (!Number.isFinite(value))
            throw new Error(`${name}: tuning ${path} is not a finite number`);
    for (const path of WHOLE_NUMBER_PATHS)
        if (!Number.isInteger(valueAt(tuning, path)) || valueAt(tuning, path) < 0)
            throw new Error(`${name}: tuning ${path} must be a whole number of at least 0`);
    for (const path of POSITIVE_PATHS)
        if (!(valueAt(tuning, path) > 0))
            throw new Error(`${name}: tuning ${path} must be above 0`);
    if (tuning.detection.minClothFaces < 3)
        throw new Error(`${name}: tuning detection.minClothFaces must be at least 3`);
    for (const path of SHARE_PATHS) {
        const value = valueAt(tuning, path);
        if (value < 0 || value > 1)
            throw new Error(`${name}: tuning ${path} ${value} must be between 0 and 1`);
    }
};
