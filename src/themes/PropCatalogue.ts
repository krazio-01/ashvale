import { PropLayer, type IModelPack, type IThemeProp } from "@/types/world";
import { MODEL_PACKS } from "@/constants/world";
import { DEFAULT_FAMILY } from "@/constants/placement";

export const propVariants = (
    modelPack: IModelPack,
    variants: PropVariant[],
    layer: PropLayer,
    footprintRadius: number,
    [minimumScale, maximumScale]: [number, number],
    options: IPropVariantOptions = {}
): IThemeProp[] => {
    const scaleRange: [number, number] = [
        minimumScale * modelPack.unitScale,
        maximumScale * modelPack.unitScale,
    ];

    return variants.map((variant) => {
        const name = typeof variant === "string" ? variant : variant.name;

        return {
            modelPath: `${modelPack.directory}/${name}.gltf`,
            layer,
            footprintRadius,
            scaleRange,
            family: options.family ?? DEFAULT_FAMILY,
            pack: modelPack.pack,
            groundOffset: typeof variant === "string" ? options.groundOffset : variant.groundOffset,
            rotationSteps: options.rotationSteps,
            collides: options.collides,
            colliderShape: options.colliderShape,
            slopeLimit: options.slopeLimit,
        };
    });
};

export const CANOPY_TREES = propVariants(
    MODEL_PACKS.woodland,
    ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5"],
    PropLayer.Canopy,
    0.9,
    [0.8, 1.3],
    { family: "common" }
);

export const PINE_TREES = propVariants(
    MODEL_PACKS.woodland,
    ["Pine_1", "Pine_2", "Pine_3", "Pine_4", "Pine_5"],
    PropLayer.Canopy,
    0.8,
    [0.9, 1.4],
    { family: "pine" }
);

export const TWISTED_TREES = propVariants(
    MODEL_PACKS.woodland,
    ["TwistedTree_1", "TwistedTree_2", "TwistedTree_3", "TwistedTree_4", "TwistedTree_5"],
    PropLayer.Canopy,
    0.95,
    [0.7, 1.15],
    { family: "twisted" }
);

export const DEAD_TREES = propVariants(
    MODEL_PACKS.woodland,
    ["DeadTree_1", "DeadTree_2", "DeadTree_3", "DeadTree_4", "DeadTree_5"],
    PropLayer.Canopy,
    0.7,
    [0.7, 1.1],
    { family: "dead" }
);

export const BOULDERS = propVariants(
    MODEL_PACKS.woodland,
    ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
    PropLayer.Rock,
    0.8,
    [0.7, 1.3]
);

export const ROCK_SLABS = propVariants(
    MODEL_PACKS.woodland,
    ["RockPath_Round_Wide", "RockPath_Round_Thin", "RockPath_Square_Wide", "RockPath_Square_Thin"],
    PropLayer.Debris,
    1.2,
    [0.8, 1.35]
);

export const ROCK_CHUNKS = propVariants(
    MODEL_PACKS.woodland,
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

export const BUSHES = propVariants(
    MODEL_PACKS.woodland,
    ["Bush_Common", "Bush_Common_Flowers"],
    PropLayer.Understory,
    0.55,
    [0.8, 1.35],
    { groundOffset: -0.25 }
);

export const BROAD_PLANTS = propVariants(
    MODEL_PACKS.woodland,
    ["Plant_1_Big", "Plant_7_Big"],
    PropLayer.Understory,
    0.4,
    [0.8, 1.25],
    { groundOffset: -0.08 }
);

export const GRASS_TUFTS = propVariants(
    MODEL_PACKS.woodland,
    ["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"],
    PropLayer.Groundcover,
    0.25,
    [0.8, 1.4]
);

export const UNDERGROWTH = propVariants(
    MODEL_PACKS.woodland,
    ["Fern_1", "Plant_1", "Clover_1", "Clover_2", { name: "Plant_7", groundOffset: -0.08 }],
    PropLayer.Groundcover,
    0.28,
    [0.8, 1.3]
);

export const FLOWERS = propVariants(
    MODEL_PACKS.woodland,
    ["Flower_3_Group", "Flower_3_Single", "Flower_4_Group", "Flower_4_Single"],
    PropLayer.Groundcover,
    0.22,
    [0.8, 1.3]
);

export const MUSHROOMS = propVariants(
    MODEL_PACKS.woodland,
    ["Mushroom_Common", "Mushroom_Laetiporus"],
    PropLayer.Groundcover,
    0.2,
    [0.7, 1.2]
);

export const PEBBLES = propVariants(
    MODEL_PACKS.woodland,
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

export const FALLEN_PETALS = propVariants(
    MODEL_PACKS.woodland,
    ["Petal_1", "Petal_2", "Petal_3", "Petal_4", "Petal_5"],
    PropLayer.Debris,
    0.15,
    [0.8, 1.4]
);

export const HIGHLANDS_PINE_TREES = propVariants(
    MODEL_PACKS.highlands,
    ["PineTree_1", "PineTree_2", "PineTree_3", "PineTree_4", "PineTree_5"],
    PropLayer.Canopy,
    0.5,
    [1.0, 1.7],
    { family: "pine" }
);

export const HIGHLANDS_DEAD_TREES = propVariants(
    MODEL_PACKS.highlands,
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
    { family: "dead" }
);

export const HIGHLANDS_BOULDERS = propVariants(
    MODEL_PACKS.highlands,
    ["Rock_1", "Rock_2", "Rock_3", "Rock_4", "Rock_5"],
    PropLayer.Rock,
    0.22,
    [2.2, 4.2]
);

export const HIGHLANDS_LOOSE_ROCKS = propVariants(
    MODEL_PACKS.highlands,
    ["Rock_1", "Rock_2", "Rock_3", "Rock_4", "Rock_5"],
    PropLayer.Debris,
    0.22,
    [0.6, 1.6]
);

export const HIGHLANDS_SCRUB = propVariants(
    MODEL_PACKS.highlands,
    [
        { name: "Bush", groundOffset: 0.08 },
        { name: "Bush_Small", groundOffset: 0.25 },
        { name: "Bush_Large", groundOffset: 0.18 },
    ],
    PropLayer.Understory,
    0.6,
    [0.7, 1.25]
);

export const HIGHLANDS_GRASS = propVariants(
    MODEL_PACKS.highlands,
    ["Grass_Small", "Grass_Large"],
    PropLayer.Groundcover,
    0.25,
    [0.9, 1.7]
);

export const WAYSIDE_CRATES = propVariants(
    MODEL_PACKS.medievalVillage,
    ["Prop_Crate"],
    PropLayer.Debris,
    0.55,
    [0.85, 1.15],
    {
        collides: true,
        colliderShape: "cuboid",
        slopeLimit: 0.35,
    }
);

export const WAYSIDE_CLUTTER = propVariants(
    MODEL_PACKS.medievalVillage,
    ["Prop_Brick1", "Prop_Brick2", "Prop_Brick3", "Prop_Brick4"],
    PropLayer.Debris,
    0.2,
    [0.85, 1.15]
);

export const WAYSIDE_BOUNDARY = propVariants(
    MODEL_PACKS.medievalVillage,
    [
        "Prop_WoodenFence_Single",
        "Prop_WoodenFence_Extension1",
        "Prop_WoodenFence_Extension2",
        "Prop_ExteriorBorder_Straight1",
        "Prop_ExteriorBorder_Straight2",
    ],
    PropLayer.Debris,
    0.55,
    [0.85, 1.15],
    {
        rotationSteps: 4,
        collides: true,
        colliderShape: "cuboid",
        slopeLimit: 0.35,
    }
);

export const RUINS_COLUMNS = propVariants(
    MODEL_PACKS.architecture,
    ["Column_Round", "Column_Square"],
    PropLayer.Rock,
    0.3,
    [0.9, 1.1]
);

export const RUINS_WALLS = propVariants(
    MODEL_PACKS.architecture,
    ["Wall_Broken", "Arch_Gothic", "Arch_Round", "Support_Center", "Support_Left", "Support_Right"],
    PropLayer.Rock,
    1.0,
    [0.9, 1.1],
    { rotationSteps: 4 }
);

export const RUINS_GATEWAYS = propVariants(
    MODEL_PACKS.architecture,
    ["Wall_ArchRound_Broken", "Wall_ArchRound_Overgrown", "Wall_ArchRound_Overgrown_Broken"],
    PropLayer.Rock,
    2.1,
    [0.9, 1.1],
    { rotationSteps: 4 }
);

export const RUINS_RUBBLE = propVariants(
    MODEL_PACKS.architecture,
    ["Brick", "Bricks"],
    PropLayer.Debris,
    0.4,
    [0.8, 1.2]
);

export const RUINS_MONUMENTS = propVariants(
    MODEL_PACKS.architecture,
    ["Statue_Fox", "Statue_Stag"],
    PropLayer.Rock,
    1.2,
    [0.9, 1.15]
);

type PropVariant = string | { name: string; groundOffset: number };

interface IPropVariantOptions {
    family?: string;
    groundOffset?: number;
    rotationSteps?: number;
    collides?: boolean;
    colliderShape?: "cylinder" | "cuboid";
    slopeLimit?: number;
}
