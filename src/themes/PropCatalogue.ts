import { PropRole, type IThemeProp } from "@/types/theme";

const MODEL_DIRECTORY = "/models/woodland";

const propFamily = (
    names: string[],
    role: PropRole,
    footprintRadius: number,
    scaleRange: [number, number],
    hasCollider: boolean
): IThemeProp[] =>
    names.map((name) => ({
        modelPath: `${MODEL_DIRECTORY}/${name}.gltf`,
        role,
        footprintRadius,
        scaleRange,
        hasCollider,
    }));

export const CANOPY_TREES = propFamily(
    ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5"],
    PropRole.Landmark,
    0.9,
    [0.8, 1.3],
    true
);

export const PINE_TREES = propFamily(
    ["Pine_1", "Pine_2", "Pine_3", "Pine_4", "Pine_5"],
    PropRole.Landmark,
    0.8,
    [0.9, 1.4],
    true
);

export const TWISTED_TREES = propFamily(
    ["TwistedTree_1", "TwistedTree_2", "TwistedTree_3", "TwistedTree_4", "TwistedTree_5"],
    PropRole.Landmark,
    0.95,
    [0.7, 1.15],
    true
);

export const DEAD_TREES = propFamily(
    ["DeadTree_1", "DeadTree_2", "DeadTree_3", "DeadTree_4", "DeadTree_5"],
    PropRole.Landmark,
    0.7,
    [0.7, 1.1],
    true
);

export const BOULDERS = propFamily(
    ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
    PropRole.Structure,
    0.8,
    [0.7, 1.3],
    true
);

export const ROCK_SLABS = propFamily(
    ["RockPath_Round_Wide", "RockPath_Round_Thin", "RockPath_Square_Wide", "RockPath_Square_Thin"],
    PropRole.Structure,
    1.2,
    [0.8, 1.35],
    true
);

export const ROCK_CHUNKS = propFamily(
    [
        "RockPath_Round_Small_1",
        "RockPath_Round_Small_2",
        "RockPath_Round_Small_3",
        "RockPath_Square_Small_1",
        "RockPath_Square_Small_2",
        "RockPath_Square_Small_3",
    ],
    PropRole.Structure,
    0.6,
    [0.7, 1.15],
    false
);

export const BUSHES = propFamily(
    ["Bush_Common", "Bush_Common_Flowers"],
    PropRole.Structure,
    0.55,
    [0.8, 1.35],
    false
);

export const BROAD_PLANTS = propFamily(
    ["Plant_1_Big", "Plant_7_Big"],
    PropRole.Structure,
    0.4,
    [0.8, 1.25],
    false
);

export const GRASS_TUFTS = propFamily(
    ["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"],
    PropRole.Scatter,
    0.25,
    [0.8, 1.4],
    false
);

export const UNDERGROWTH = propFamily(
    ["Fern_1", "Plant_1", "Plant_7", "Clover_1", "Clover_2"],
    PropRole.Scatter,
    0.28,
    [0.8, 1.3],
    false
);

export const FLOWERS = propFamily(
    ["Flower_3_Group", "Flower_3_Single", "Flower_4_Group", "Flower_4_Single"],
    PropRole.Scatter,
    0.22,
    [0.8, 1.3],
    false
);

export const MUSHROOMS = propFamily(
    ["Mushroom_Common", "Mushroom_Laetiporus"],
    PropRole.Scatter,
    0.2,
    [0.7, 1.2],
    false
);

export const PEBBLES = propFamily(
    [
        "Pebble_Round_1",
        "Pebble_Round_2",
        "Pebble_Round_3",
        "Pebble_Round_4",
        "Pebble_Round_5",
        "Pebble_Square_1",
        "Pebble_Square_2",
        "Pebble_Square_3",
        "Pebble_Square_4",
        "Pebble_Square_5",
        "Pebble_Square_6",
    ],
    PropRole.Scatter,
    0.2,
    [0.7, 1.3],
    false
);

export const FALLEN_PETALS = propFamily(
    ["Petal_1", "Petal_2", "Petal_3", "Petal_4", "Petal_5"],
    PropRole.Scatter,
    0.15,
    [0.8, 1.4],
    false
);
