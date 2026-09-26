import { DEFAULT_FAMILY, PropLayer, type IThemeProp } from "@/types/theme";
import { SCALE } from "@/constants/world";
const MODEL_DIRECTORY = "/models/woodland";
const HIGHLANDS_DIRECTORY = "/models/highlands";
const MEDIEVAL_DIRECTORY = "/models/medieval-village";
const ARCHITECTURE_DIRECTORY = "/models/architecture";

const BUILT_SCALE = SCALE.unitsPerMetre;

interface IPropFamilyOptions {
    pack: string;
    family?: string;
    directory?: string;
    groundOffset?: number;
    rotationSteps?: number;
    collides?: boolean;
    colliderShape?: "cylinder" | "cuboid";
    slopeLimit?: number;
}

const propFamily = (
    names: string[],
    layer: PropLayer,
    footprintRadius: number,
    scaleRange: [number, number],
    options: IPropFamilyOptions
): IThemeProp[] =>
    names.map((name) => ({
        modelPath: `${options.directory ?? MODEL_DIRECTORY}/${name}.gltf`,
        layer,
        footprintRadius,
        scaleRange,
        family: options.family ?? DEFAULT_FAMILY,
        pack: options.pack,
        groundOffset: options.groundOffset,
        rotationSteps: options.rotationSteps,
        collides: options.collides,
        colliderShape: options.colliderShape,
        slopeLimit: options.slopeLimit,
    }));

export const CANOPY_TREES = propFamily(
    ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5"],
    PropLayer.Canopy,
    0.9,
    [0.8, 1.3],
    { pack: "woodland", family: "common" }
);

export const PINE_TREES = propFamily(
    ["Pine_1", "Pine_2", "Pine_3", "Pine_4", "Pine_5"],
    PropLayer.Canopy,
    0.8,
    [0.9, 1.4],
    { pack: "woodland", family: "pine" }
);

export const TWISTED_TREES = propFamily(
    ["TwistedTree_1", "TwistedTree_2", "TwistedTree_3", "TwistedTree_4", "TwistedTree_5"],
    PropLayer.Canopy,
    0.95,
    [0.7, 1.15],
    { pack: "woodland", family: "twisted" }
);

export const DEAD_TREES = propFamily(
    ["DeadTree_1", "DeadTree_2", "DeadTree_3", "DeadTree_4", "DeadTree_5"],
    PropLayer.Canopy,
    0.7,
    [0.7, 1.1],
    { pack: "woodland", family: "dead" }
);

export const BOULDERS = propFamily(
    ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
    PropLayer.Rock,
    0.8,
    [0.7, 1.3],
    { pack: "woodland" }
);

export const ROCK_SLABS = propFamily(
    ["RockPath_Round_Wide", "RockPath_Round_Thin", "RockPath_Square_Wide", "RockPath_Square_Thin"],
    PropLayer.Debris,
    1.2,
    [0.8, 1.35],
    { pack: "woodland" }
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
    [0.7, 1.15],
    { pack: "woodland" }
);

export const BUSHES = propFamily(
    ["Bush_Common", "Bush_Common_Flowers"],
    PropLayer.Understory,
    0.55,
    [0.8, 1.35],
    { pack: "woodland", groundOffset: -0.25 }
);

export const BROAD_PLANTS = [
    ...propFamily(["Plant_1_Big"], PropLayer.Understory, 0.4, [0.8, 1.25], {
        pack: "woodland",
        groundOffset: -0.08,
    }),
    ...propFamily(["Plant_7_Big"], PropLayer.Understory, 0.4, [0.8, 1.25], {
        pack: "woodland",
        groundOffset: -0.08,
    }),
];

export const GRASS_TUFTS = propFamily(
    ["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"],
    PropLayer.Groundcover,
    0.25,
    [0.8, 1.4],
    { pack: "woodland" }
);

export const UNDERGROWTH = [
    ...propFamily(
        ["Fern_1", "Plant_1", "Clover_1", "Clover_2"],
        PropLayer.Groundcover,
        0.28,
        [0.8, 1.3],
        {
            pack: "woodland",
        }
    ),
    ...propFamily(["Plant_7"], PropLayer.Groundcover, 0.28, [0.8, 1.3], {
        pack: "woodland",
        groundOffset: -0.08,
    }),
];

export const FLOWERS = propFamily(
    ["Flower_3_Group", "Flower_3_Single", "Flower_4_Group", "Flower_4_Single"],
    PropLayer.Groundcover,
    0.22,
    [0.8, 1.3],
    { pack: "woodland" }
);

export const MUSHROOMS = propFamily(
    ["Mushroom_Common", "Mushroom_Laetiporus"],
    PropLayer.Groundcover,
    0.2,
    [0.7, 1.2],
    { pack: "woodland" }
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
    [0.7, 1.3],
    { pack: "woodland" }
);

export const FALLEN_PETALS = propFamily(
    ["Petal_1", "Petal_2", "Petal_3", "Petal_4", "Petal_5"],
    PropLayer.Debris,
    0.15,
    [0.8, 1.4],
    { pack: "woodland" }
);

export const HIGHLANDS_PINE_TREES = propFamily(
    ["PineTree_1", "PineTree_2", "PineTree_3", "PineTree_4", "PineTree_5"],
    PropLayer.Canopy,
    0.5,
    [1.0, 1.7],
    { pack: "quaternius-stylized-nature", family: "pine", directory: HIGHLANDS_DIRECTORY }
);

export const HIGHLANDS_DEAD_TREES = propFamily(
    [
        "DeadTree_1",
        "DeadTree_2",
        "DeadTree_3",
        "DeadTree_4",
        "DeadTree_5",
        "DeadTree_6",
        "DeadTree_7",
        "DeadTree_8",
        "DeadTree_9",
        "DeadTree_10",
    ],
    PropLayer.Canopy,
    0.5,
    [0.8, 1.4],
    { pack: "quaternius-stylized-nature", family: "dead", directory: HIGHLANDS_DIRECTORY }
);

export const HIGHLANDS_BOULDERS = propFamily(
    ["Rock_1", "Rock_2", "Rock_3", "Rock_4", "Rock_5"],
    PropLayer.Rock,
    0.22,
    [2.2, 4.2],
    { pack: "quaternius-stylized-nature", directory: HIGHLANDS_DIRECTORY }
);

export const HIGHLANDS_SCREE = propFamily(
    ["Rock_1", "Rock_2", "Rock_3", "Rock_4", "Rock_5"],
    PropLayer.Debris,
    0.22,
    [0.6, 1.6],
    { pack: "quaternius-stylized-nature", directory: HIGHLANDS_DIRECTORY }
);

export const HIGHLANDS_SCRUB = [
    ...propFamily(["Bush"], PropLayer.Understory, 0.6, [0.7, 1.25], {
        pack: "quaternius-stylized-nature",
        directory: HIGHLANDS_DIRECTORY,
        groundOffset: 0.08,
    }),
    ...propFamily(["Bush_Small"], PropLayer.Understory, 0.6, [0.7, 1.25], {
        pack: "quaternius-stylized-nature",
        directory: HIGHLANDS_DIRECTORY,
        groundOffset: 0.25,
    }),
    ...propFamily(["Bush_Large"], PropLayer.Understory, 0.6, [0.7, 1.25], {
        pack: "quaternius-stylized-nature",
        directory: HIGHLANDS_DIRECTORY,
        groundOffset: 0.18,
    }),
];

export const HIGHLANDS_GRASS = propFamily(
    ["Grass_Small", "Grass_Large"],
    PropLayer.Groundcover,
    0.25,
    [0.9, 1.7],
    { pack: "quaternius-stylized-nature", directory: HIGHLANDS_DIRECTORY }
);

export const WAYSIDE_CRATES = propFamily(
    ["Prop_Crate"],
    PropLayer.Debris,
    0.55,
    [0.85 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    {
        pack: "medieval-village",
        directory: MEDIEVAL_DIRECTORY,
        collides: true,
        colliderShape: "cuboid",
        slopeLimit: 0.35,
    }
);

export const WAYSIDE_CLUTTER = propFamily(
    ["Prop_Brick1", "Prop_Brick2", "Prop_Brick3", "Prop_Brick4"],
    PropLayer.Debris,
    0.2,
    [0.85 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    { pack: "medieval-village", directory: MEDIEVAL_DIRECTORY }
);

export const WAYSIDE_BOUNDARY = propFamily(
    [
        "Prop_WoodenFence_Single",
        "Prop_WoodenFence_Extension1",
        "Prop_WoodenFence_Extension2",
        "Prop_ExteriorBorder_Straight1",
        "Prop_ExteriorBorder_Straight2",
    ],
    PropLayer.Debris,
    0.55,
    [0.85 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    {
        pack: "medieval-village",
        directory: MEDIEVAL_DIRECTORY,
        rotationSteps: 4,
        collides: true,
        colliderShape: "cuboid",
        slopeLimit: 0.35,
    }
);

export const RUINS_COLUMNS = propFamily(
    ["Column_Round", "Column_Square"],
    PropLayer.Rock,
    0.3,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

export const RUINS_WALLS = propFamily(
    ["Wall_Broken", "Arch_Gothic", "Arch_Round", "Support_Center", "Support_Left", "Support_Right"],
    PropLayer.Rock,
    1.0,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY, rotationSteps: 4 }
);

export const RUINS_GATEWAYS = propFamily(
    ["Wall_ArchRound_Broken", "Wall_ArchRound_Overgrown", "Wall_ArchRound_Overgrown_Broken"],
    PropLayer.Rock,
    2.1,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY, rotationSteps: 4 }
);

export const RUINS_RUBBLE = propFamily(
    ["Brick", "Bricks"],
    PropLayer.Debris,
    0.4,
    [0.8 * BUILT_SCALE, 1.2 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

export const RUINS_MONUMENTS = propFamily(
    ["Statue_Fox", "Statue_Stag"],
    PropLayer.Rock,
    1.2,
    [0.9 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);
