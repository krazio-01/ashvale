import { DEFAULT_FAMILY, PropLayer, type IThemeProp } from "@/types/theme";
import { SCALE } from "@/constants/world";

const MODEL_DIRECTORY = "/models/woodland";
const HIGHLANDS_DIRECTORY = "/models/highlands";
const MEDIEVAL_DIRECTORY = "/models/medieval-village";
const ARCHITECTURE_DIRECTORY = "/models/architecture";

/* The architecture and medieval-village packs are authored one unit per metre, but the world runs
   at SCALE.unitsPerMetre units per metre. Placed at 1x, a gothic arch stands 2m tall - shorter
   than the player - so these built-object families carry the conversion in their scale range.
   The woodland and highlands nature packs are deliberately NOT scaled this way: they are tuned by
   eye against each other and predate this convention, and rescaling them would change every
   chapter the player has already seen. */
const BUILT_SCALE = SCALE.unitsPerMetre;

interface IPropFamilyOptions {
    pack: string;
    /* Only canopy trees currently need biome-region coherence, so every other family is left as
       one shared bucket. */
    family?: string;
    directory?: string;
    groundOffset?: number;
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
    { pack: "woodland" }
);

export const BROAD_PLANTS = propFamily(
    ["Plant_1_Big", "Plant_7_Big"],
    PropLayer.Understory,
    0.4,
    [0.8, 1.25],
    { pack: "woodland" }
);

export const GRASS_TUFTS = propFamily(
    ["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"],
    PropLayer.Groundcover,
    0.25,
    [0.8, 1.4],
    { pack: "woodland" }
);

export const UNDERGROWTH = propFamily(
    ["Fern_1", "Plant_1", "Plant_7", "Clover_1", "Clover_2"],
    PropLayer.Groundcover,
    0.28,
    [0.8, 1.3],
    { pack: "woodland" }
);

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

/* Quaternius Ultimate Stylized Nature. The pack ships only 36 of its 63 models as glTF - pine
   and rock were omitted upstream - so those ten were converted from the pack's FBX sources.
   Its meshes are far smaller than the woodland pack's (a rock is ~1m, not ~3m), which is why the
   scale ranges here are much larger than the woodland equivalents rather than copied. The ranges
   are also deliberately wide: a narrow band makes every boulder the same size, which is what
   makes a scatter read as placed rather than grown. */
export const HIGHLANDS_PINE_TREES = propFamily(
    ["PineTree_1", "PineTree_2", "PineTree_3", "PineTree_4", "PineTree_5"],
    PropLayer.Canopy,
    0.5,
    [1.0, 1.7],
    { pack: "quaternius-stylized-nature", family: "pine", directory: HIGHLANDS_DIRECTORY }
);

/* Ten weathered variants, against the woodland pack's five. Highlands is the exposed, wind-bitten
   chapter, so dead wood carries a lot of its character and benefits most from variety. */
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

/* The same five meshes at a fraction of the size. The pack has no separate debris rocks, and
   scattering the boulders small reads as scree without reintroducing the woodland rock meshes
   this work is moving Highlands away from. */
export const HIGHLANDS_SCREE = propFamily(
    ["Rock_1", "Rock_2", "Rock_3", "Rock_4", "Rock_5"],
    PropLayer.Debris,
    0.22,
    [0.6, 1.6],
    { pack: "quaternius-stylized-nature", directory: HIGHLANDS_DIRECTORY }
);

/* Highlands previously had no Understory family at all, so fillClump's understory pass placed
   nothing and the chapter jumped straight from groundcover to tree canopy - the single biggest
   reason it read as bare. These bushes are modelled around a centred pivot, hence groundOffset. */
export const HIGHLANDS_SCRUB = propFamily(
    ["Bush", "Bush_Small", "Bush_Large"],
    PropLayer.Understory,
    0.6,
    [0.7, 1.25],
    { pack: "quaternius-stylized-nature", directory: HIGHLANDS_DIRECTORY, groundOffset: 0.7 }
);

export const HIGHLANDS_GRASS = propFamily(
    ["Grass_Small", "Grass_Large"],
    PropLayer.Groundcover,
    0.25,
    [0.9, 1.7],
    { pack: "quaternius-stylized-nature", directory: HIGHLANDS_DIRECTORY }
);

/* Medieval Village MegaKit - the same pack Settlement is built from, so a wayside crate reads as
   belonging to the same world as the village down the road. Debris layer, so scatterDebris
   biases these toward trail shoulders. All four are low enough that not colliding is not
   noticeable. */
export const WAYSIDE_CLUTTER = propFamily(
    [
        "Prop_Crate",
        "Prop_Brick1",
        "Prop_Brick2",
        "Prop_Brick3",
        "Prop_Brick4",
        "Prop_WoodenFence_Single",
        "Prop_WoodenFence_Extension1",
        "Prop_WoodenFence_Extension2",
        "Prop_ExteriorBorder_Straight1",
        "Prop_ExteriorBorder_Straight2",
    ],
    PropLayer.Debris,
    0.55 * BUILT_SCALE,
    [0.85 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    { pack: "medieval-village", directory: MEDIEVAL_DIRECTORY }
);

/* Split by measured size rather than kept as one family: propFamily applies a single
   footprintRadius to every member, and PropBatch turns that into the collider cylinder for
   PropLayer.Rock. One radius across meshes spanning 0.66m (a column) to 4.0m (an arched wall)
   would stop the player a metre short of thin columns and make flat slabs impassable. */
export const RUINS_COLUMNS = propFamily(
    ["Column_Round", "Column_Square"],
    PropLayer.Rock,
    0.3 * BUILT_SCALE,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

export const RUINS_WALLS = propFamily(
    ["Wall_Broken", "Arch_Gothic", "Arch_Round", "Support_Center", "Support_Left", "Support_Right"],
    PropLayer.Rock,
    0.7 * BUILT_SCALE,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

export const RUINS_GATEWAYS = propFamily(
    ["Wall_ArchRound_Broken", "Wall_ArchRound_Overgrown", "Wall_ArchRound_Overgrown_Broken"],
    PropLayer.Rock,
    1.1 * BUILT_SCALE,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

/* Flat, walkable-looking pieces (a bridge deck is 0.44m tall, stairs 0.92m). As Debris they are
   scenery the player walks over instead of invisible pillars. */
export const RUINS_RUBBLE = propFamily(
    ["Floor_Hole_Corner", "Floor_Hole_Straight", "Stairs", "Stairs_2", "BridgeSection"],
    PropLayer.Debris,
    1.0 * BUILT_SCALE,
    [0.9 * BUILT_SCALE, 1.1 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

/* Statues are 3.75m and 4.63m tall - at RUINS_CLUTTER's 0.4 radius in the non-colliding Debris
   layer they scattered at trinket density and the player walked through them. */
export const RUINS_MONUMENTS = propFamily(
    ["Statue_Fox", "Statue_Stag"],
    PropLayer.Rock,
    0.6 * BUILT_SCALE,
    [0.9 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);

/* Flag_GothicArch and Flag_RoundArch are deliberately absent: their pivot sits 2.25m below the
   mesh because they are banners made to hang on an arch, so scattered free-standing they hover
   in mid-air. They belong attached to an arch, which this pipeline has no way to express. */
export const RUINS_CLUTTER = propFamily(
    [
        "Chest",
        "Chest_Gold",
        "Pot1_Broken",
        "Pot2_Broken",
        "Pot3_Broken",
        "Skull",
        "BearTrap_Open",
        "BearTrap_Closed",
    ],
    PropLayer.Debris,
    0.35 * BUILT_SCALE,
    [0.85 * BUILT_SCALE, 1.15 * BUILT_SCALE],
    { pack: "architecture", directory: ARCHITECTURE_DIRECTORY }
);
