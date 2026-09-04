import { PropLayer, type IThemeProp } from "@/types/theme";

const MODEL_DIRECTORY = "/models/woodland";

const propFamily = (
    names: string[],
    layer: PropLayer,
    footprintRadius: number,
    scaleRange: [number, number]
): IThemeProp[] =>
    names.map((name) => ({
        modelPath: `${MODEL_DIRECTORY}/${name}.gltf`,
        layer,
        footprintRadius,
        scaleRange,
    }));

export const CANOPY_TREES = propFamily(
    ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5"],
    PropLayer.Canopy,
    0.9,
    [0.8, 1.3]
);

export const PINE_TREES = propFamily(
    ["Pine_1", "Pine_2", "Pine_3", "Pine_4", "Pine_5"],
    PropLayer.Canopy,
    0.8,
    [0.9, 1.4]
);

export const TWISTED_TREES = propFamily(
    ["TwistedTree_1", "TwistedTree_2", "TwistedTree_3", "TwistedTree_4", "TwistedTree_5"],
    PropLayer.Canopy,
    0.95,
    [0.7, 1.15]
);

export const DEAD_TREES = propFamily(
    ["DeadTree_1", "DeadTree_2", "DeadTree_3", "DeadTree_4", "DeadTree_5"],
    PropLayer.Canopy,
    0.7,
    [0.7, 1.1]
);

export const BOULDERS = propFamily(
    ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
    PropLayer.Rock,
    0.8,
    [0.7, 1.3]
);

export const ROCK_SLABS = propFamily(
    ["RockPath_Round_Wide", "RockPath_Round_Thin", "RockPath_Square_Wide", "RockPath_Square_Thin"],
    PropLayer.Debris,
    1.2,
    [0.8, 1.35]
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
    PropLayer.Debris,
    0.6,
    [0.7, 1.15]
);

export const BUSHES = propFamily(
    ["Bush_Common", "Bush_Common_Flowers"],
    PropLayer.Understory,
    0.55,
    [0.8, 1.35]
);

export const BROAD_PLANTS = propFamily(
    ["Plant_1_Big", "Plant_7_Big"],
    PropLayer.Understory,
    0.4,
    [0.8, 1.25]
);

export const GRASS_TUFTS = propFamily(
    ["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"],
    PropLayer.Groundcover,
    0.25,
    [0.8, 1.4]
);

export const UNDERGROWTH = propFamily(
    ["Fern_1", "Plant_1", "Plant_7", "Clover_1", "Clover_2"],
    PropLayer.Groundcover,
    0.28,
    [0.8, 1.3]
);

export const FLOWERS = propFamily(
    ["Flower_3_Group", "Flower_3_Single", "Flower_4_Group", "Flower_4_Single"],
    PropLayer.Groundcover,
    0.22,
    [0.8, 1.3]
);

export const MUSHROOMS = propFamily(
    ["Mushroom_Common", "Mushroom_Laetiporus"],
    PropLayer.Groundcover,
    0.2,
    [0.7, 1.2]
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
    PropLayer.Debris,
    0.2,
    [0.7, 1.3]
);

export const FALLEN_PETALS = propFamily(
    ["Petal_1", "Petal_2", "Petal_3", "Petal_4", "Petal_5"],
    PropLayer.Debris,
    0.15,
    [0.8, 1.4]
);
