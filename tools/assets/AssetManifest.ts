import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    Box3,
    Euler,
    MathUtils,
    Matrix4,
    type Matrix4Tuple,
    Vector3,
    type Vector2Tuple,
    type Vector3Tuple,
} from "three";
import { PLAYER_ASSETS, SKELETONS, type SkeletonName } from "@/constants/characters";
import { BELL_FRAME, PROP_SCALE, SCALE, STYLE } from "@/constants/world";
import { PERCH_STAND, SCENE_LAYOUT } from "@/constants/placement";
import { BIOME_THEMES, type ThemeId } from "@/themes/Biomes";
import type { SharedMaterial } from "@/types/world";
import {
    createSeededRandom,
    hashString,
    keysOf,
    randomOffset,
    valueInRange,
    type RandomSource,
} from "@/lib/helpers";
import type { ISkeletonDescriptor } from "@/types/characters";
import type { IClothTuning } from "@/types/physics";
import type { IKitModuleExtras, IKitSocket, IStaticPieceExtras } from "@/types/world";
import { CLIP_BAKE_FILES } from "../clips/combatClipManifest";
import {
    PIPELINE_CONFIG,
    assertExists,
    fetchTextureSource,
    type TextureMap,
    sourcePathOf,
    textureFile,
    textureInfoFile,
} from "../pipeline";
import {
    AssembleGlbStage,
    AssetBuildPipeline,
    BlenderStage,
    SkeletonStage,
    ValidationStage,
    type BuildStage,
} from "./AssetBuilds";
import type { IAssetCategoryOptions } from "./AssetCategories";
import {
    CHARACTER_TUNING_LAYER,
    KIT_TUNING_LAYER,
    ROLE_TUNING,
    SHARED_TUNING_LAYER,
    type IKitTuning,
    type TuningLayer,
    type DeepPartial,
    type IPipelineTuning,
    type ISharedTuning,
} from "./PipelineTuning";
import {
    CharacterValidator,
    KitValidator,
    ModelValidator,
    ScanValidator,
    SculptValidator,
    extentsOf,
} from "./AssetValidation";

const CHARACTER_ROLE_DEFAULTS = {
    player: { triangles: 36_000, textureSize: 2048 },
    enemy: { triangles: 15_000, textureSize: 1024 },
    boss: { triangles: 45_000, textureSize: 2048 },
} as const satisfies Record<string, ICharacterBudget>;

const ALL_MESHES = "*";

const EVERY_THEME = keysOf(BIOME_THEMES);

const UP_AXIS = new Vector3(0, 1, 0);

const MINIMUM_MITER = 0.2;

const COURSE_SINK = 0.35;

const SPAN_SAMPLES = 13;

const PAPER_CHARM_PROFILE: Vector2Tuple[] = [
    [-0.06, 0],
    [0.06, 0],
    [0.06, -0.1],
    [0.11, -0.1],
    [0.11, -0.2],
    [0.01, -0.2],
    [0.01, -0.3],
    [0.06, -0.3],
    [0.06, -0.42],
    [-0.04, -0.42],
    [-0.04, -0.3],
    [-0.09, -0.3],
    [-0.09, -0.2],
    [-0.04, -0.2],
    [-0.04, -0.1],
    [-0.06, -0.1],
];

const PAPER_LANTERN_PROFILE: Vector2Tuple[] = [
    [0, 0],
    [0.09, 0],
    [0.17, 0.08],
    [0.19, 0.18],
    [0.17, 0.28],
    [0.09, 0.35],
    [0.04, 0.35],
    [0.04, 0.38],
    [0, 0.38],
];

const ROOF_DESIGN = {
    flareLiftMetres: 0.45,
    flarePower: 2.5,
    hipSegmentsPerSide: 8,
    gableProfile: [
        [0.95, 0.05],
        [0.6, 0.2],
        [0.3, 0.42],
        [0, 0.55],
        [-0.3, 0.42],
        [-0.6, 0.2],
        [-0.95, 0.05],
        [-0.95, -0.07],
        [-0.6, 0.08],
        [-0.3, 0.3],
        [0, 0.43],
        [0.3, 0.3],
        [0.6, 0.08],
        [0.95, -0.07],
    ] satisfies Vector2Tuple[],
    gableSurface: [0, 6] satisfies Vector2Tuple,
    ridgeProfile: [
        [0.13, -0.08],
        [0.13, 0.14],
        [-0.13, 0.14],
        [-0.13, -0.08],
    ] satisfies Vector2Tuple[],
    ridgeEndSize: [0.24, 0.42, 0.3] satisfies Vector3Tuple,
    hipProfile: [
        [3.8, 0],
        [3.8, 0.2],
        [2.9, 0.5],
        [2, 0.95],
        [1.15, 1.55],
        [0.45, 2.15],
        [0.25, 2.6],
    ] satisfies Vector2Tuple[],
    courses: (surface: Vector2Tuple): IKitCourses => ({
        spacingMetres: 0.32,
        radiusMetres: 0.055,
        sides: 5,
        surface,
    }),
};

const HOUSE_DESIGN = {
    trianglesPerModule: 12_000,
    angleRounding: 1e4,
    wallThickness: 0.3,
    proud: 0.04,
    beam: {
        heightMetres: 0.2,
        depthMetres: 0.1,
        widthMetres: 0.22,
        studMetres: 0.14,
        joistMetres: 0.16,
        joistSpacingMetres: 0.6,
    },
    window: {
        widthMetres: 0.8,
        heightMetres: 1.1,
        frameMetres: 0.08,
        sillMetres: 0.07,
        groundSillMetres: 0.95,
        upperSillMetres: 0.8,
    },
    door: [1.1, 2.1] satisfies Vector2Tuple,
    quoin: { longMetres: 0.55, shortMetres: 0.35, heightMetres: 0.3, stepMetres: 0.35 },
    battenMetres: 0.6,
    flowerProfile: [
        [0, 0],
        [0.09, 0.05],
        [0.07, 0.13],
        [0, 0.15],
    ] satisfies Vector2Tuple[],
    roofMetres: 0.12,
    thatchMetres: 0.35,
    tileCourse: { spacingMetres: 0.3, radiusMetres: 0.04 },
    ridgeCapMetres: 0.12,
    chimney: {
        stackMetres: [0.7, 0.6],
        capMetres: [0.84, 0.12, 0.74] satisfies Vector3Tuple,
        aboveRidgeMetres: 0.9,
        belowEaveMetres: 0.5,
        potRadiusMetres: 0.1,
        potHeightMetres: 0.32,
        potSpacingMetres: 0.3,
        smokeSocket: "smoke",
    },
    roostSocket: "roost",
    log: { radiusMetres: 0.14, overhangMetres: 0.28, sides: 8 },
    column: { radiusMetres: 0.15, sides: 10 },
    lattice: { bars: 4, barMetres: 0.04 },
    step: { riseMetres: 0.2, treadMetres: 0.32, sideMetres: 0.3 },
    stilts: { postMetres: 0.24, spacingMetres: 2.2, deckMetres: 0.16, porchMetres: 1.2 },
    worn: { missingShutterShare: 0.5, missingCourseShare: 0.4 },
    ruin: {
        chunkMetres: 1.1,
        heightShare: [0.2, 0.95] satisfies Vector2Tuple,
        rafters: 4,
        leanMetres: 1.4,
        rubble: 16,
        rubbleMetres: [0.2, 0.55] satisfies Vector2Tuple,
        rubbleReachMetres: 1.6,
    },
};

const HOUSE_ROOF_COURSED: Record<IHouseDesign["roof"]["material"], boolean> = {
    tiles: true,
    slate: true,
    shingle: true,
    greyTiles: true,
    thatch: false,
    turf: false,
};

const WALL_BODIES: Record<IHouseStorey["wall"], string | null> = {
    stone: "stone",
    plank: "planks",
    log: null,
    wattle: "daub",
    timber: null,
    lacquer: null,
};

const timberStorey = (
    windows: IHouseStorey["windows"],
    jettyMetres = 0,
    heightMetres = 2.8
): IHouseStorey => ({ heightMetres, wall: "timber", jettyMetres, windows, door: false });

const HOUSE_DESIGNS: readonly IHouseRow[] = [
    {
        name: "cottage",
        design: {
            widthMetres: 6,
            depthMetres: 5,
            plinthMetres: 0.35,
            storeys: [
                {
                    heightMetres: 2.9,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [2, 1, 2],
                    door: true,
                },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 50,
                overhangMetres: 0.5,
                material: "thatch",
            },
            plaster: "plasterCream",
            shutters: "shutterGreen",
            chimneys: [[-1.9, -0.6]],
            sign: false,
            flowerBoxes: false,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "timberHouse",
        design: {
            widthMetres: 7,
            depthMetres: 6,
            plinthMetres: 0.35,
            storeys: [
                { heightMetres: 3, wall: "stone", jettyMetres: 0, windows: [2, 2, 2], door: true },
                timberStorey([3, 2, 3], 0.5),
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 48,
                overhangMetres: 0.45,
                material: "tiles",
            },
            plaster: "plasterCream",
            shutters: "shutterGreen",
            chimneys: [[2.4, -0.8]],
            sign: false,
            flowerBoxes: true,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "tallTownhouse",
        design: {
            widthMetres: 5,
            depthMetres: 6,
            plinthMetres: 0.3,
            storeys: [
                { heightMetres: 3, wall: "timber", jettyMetres: 0, windows: [1, 2, 1], door: true },
                timberStorey([2, 2, 2], 0.4),
                timberStorey([2, 2, 2], 0.4, 2.6),
            ],
            roof: {
                form: "gable",
                ridge: "along",
                pitchDegrees: 55,
                overhangMetres: 0.4,
                material: "slate",
            },
            plaster: "plasterOchre",
            shutters: "shutterRed",
            chimneys: [[1.4, -1.6]],
            sign: true,
            flowerBoxes: true,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "shopHouse",
        design: {
            widthMetres: 8,
            depthMetres: 6,
            plinthMetres: 0.3,
            storeys: [
                { heightMetres: 3, wall: "timber", jettyMetres: 0, windows: [3, 2, 2], door: true },
                timberStorey([4, 2, 3], 0.55),
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 45,
                overhangMetres: 0.5,
                material: "tiles",
            },
            plaster: "plasterWhite",
            shutters: "shutterBlue",
            chimneys: [[-2.6, -0.7]],
            sign: true,
            flowerBoxes: true,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "millHouse",
        design: {
            widthMetres: 8,
            depthMetres: 7,
            plinthMetres: 0.4,
            storeys: [
                {
                    heightMetres: 3.2,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [2, 2, 2],
                    door: true,
                },
                {
                    heightMetres: 2.6,
                    wall: "plank",
                    jettyMetres: 0,
                    windows: [2, 1, 2],
                    door: false,
                },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 40,
                overhangMetres: 0.55,
                material: "slate",
            },
            plaster: "plasterCream",
            shutters: "shutterRed",
            roosts: true,
            chimneys: [[-2.8, 0.6]],
            sign: false,
            flowerBoxes: false,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "longHall",
        design: {
            widthMetres: 10,
            depthMetres: 6,
            plinthMetres: 0.35,
            storeys: [
                { heightMetres: 3, wall: "stone", jettyMetres: 0, windows: [4, 2, 4], door: true },
                timberStorey([5, 2, 5]),
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 45,
                overhangMetres: 0.5,
                material: "tiles",
            },
            plaster: "plasterOchre",
            shutters: "shutterGreen",
            roosts: true,
            chimneys: [
                [-3.2, -0.7],
                [3.2, -0.7],
            ],
            sign: false,
            flowerBoxes: true,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "bellTower",
        design: {
            widthMetres: 4.6,
            depthMetres: 4.6,
            plinthMetres: 0.5,
            storeys: [
                {
                    heightMetres: 3.4,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [0, 1, 1],
                    door: true,
                },
                {
                    heightMetres: 3.2,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [1, 1, 1],
                    door: false,
                },
                {
                    heightMetres: 3.2,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [1, 1, 1],
                    door: false,
                },
                timberStorey([2, 2, 2], 0, 2.6),
            ],
            roof: {
                form: "gable",
                ridge: "along",
                pitchDegrees: 60,
                overhangMetres: 0.45,
                material: "slate",
            },
            plaster: "plasterWhite",
            shutters: "shutterRed",
            roosts: true,
            chimneys: [],
            sign: false,
            flowerBoxes: false,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "teaHall",
        design: {
            widthMetres: 7,
            depthMetres: 7,
            plinthMetres: 0.9,
            storeys: [
                {
                    heightMetres: 3.4,
                    wall: "lacquer",
                    jettyMetres: 0,
                    windows: [2, 2, 2],
                    door: true,
                },
            ],
            roof: {
                form: "hip",
                ridge: "across",
                pitchDegrees: 28,
                overhangMetres: 1.1,
                material: "greyTiles",
            },
            plaster: "plasterWhite",
            shutters: "shutterRed",
            roosts: true,
            chimneys: [],
            sign: false,
            flowerBoxes: false,
            foundation: "stepped",
            condition: "fresh",
        },
    },
];

const houseVariant = (
    base: string,
    suffix: string,
    change: (design: IHouseDesign) => IHouseDesign,
    rows: readonly IHouseRow[] = HOUSE_DESIGNS
): IHouseRow => {
    const row = rows.find((candidate) => candidate.name === base);
    if (!row) throw new Error(`no house design ${base}`);
    return { name: `${base}${suffix}`, design: change(row.design) };
};

const SETTLEMENT_HOUSES: readonly IHouseRow[] = [
    ...HOUSE_DESIGNS,
    houseVariant("cottage", "Slate", (design) => ({
        ...design,
        roof: { ...design.roof, material: "slate" },
        shutters: "shutterRed",
    })),
    houseVariant("timberHouse", "Ochre", (design) => ({
        ...design,
        plaster: "plasterOchre",
        shutters: "shutterBlue",
    })),
    houseVariant("tallTownhouse", "White", (design) => ({
        ...design,
        plaster: "plasterWhite",
        shutters: "shutterGreen",
    })),
    houseVariant("shopHouse", "Cream", (design) => ({
        ...design,
        plaster: "plasterCream",
        shutters: "shutterRed",
        roof: { ...design.roof, material: "slate" },
    })),
    houseVariant("cottage", "Worn", (design) => ({ ...design, condition: "worn" })),
    houseVariant("timberHouse", "Worn", (design) => ({ ...design, condition: "worn" })),
    {
        name: "inn",
        design: {
            widthMetres: 10,
            depthMetres: 7,
            plinthMetres: 0.35,
            storeys: [
                { heightMetres: 3, wall: "stone", jettyMetres: 0, windows: [4, 2, 4], door: true },
                timberStorey([5, 2, 5], 0.5),
                timberStorey([5, 2, 5], 0.35, 2.6),
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 50,
                overhangMetres: 0.55,
                material: "tiles",
            },
            plaster: "plasterCream",
            shutters: "shutterRed",
            roosts: true,
            chimneys: [
                [-3.6, -1],
                [3.6, -1],
            ],
            sign: true,
            flowerBoxes: true,
            doorMetres: [1.6, 2.3],
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "smithy",
        design: {
            widthMetres: 7,
            depthMetres: 6,
            plinthMetres: 0.3,
            storeys: [
                {
                    heightMetres: 3.4,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [1, 1, 1],
                    door: true,
                },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 38,
                overhangMetres: 0.6,
                material: "slate",
            },
            plaster: "plasterOchre",
            shutters: "shutterBlue",
            chimneys: [
                [-2.2, -1],
                [2.2, -1],
            ],
            sign: true,
            flowerBoxes: false,
            doorMetres: [2, 2.4],
            foundation: "plinth",
            condition: "worn",
        },
    },
    {
        name: "barn",
        design: {
            widthMetres: 9,
            depthMetres: 7,
            plinthMetres: 0.3,
            storeys: [
                {
                    heightMetres: 4.2,
                    wall: "plank",
                    jettyMetres: 0,
                    windows: [0, 2, 0],
                    door: true,
                },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 50,
                overhangMetres: 0.6,
                material: "thatch",
            },
            plaster: "plasterCream",
            shutters: "shutterRed",
            roosts: true,
            chimneys: [],
            sign: false,
            flowerBoxes: false,
            doorMetres: [2.8, 3.1],
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "guardHouse",
        design: {
            widthMetres: 6,
            depthMetres: 6,
            plinthMetres: 0.5,
            storeys: [
                {
                    heightMetres: 3.2,
                    wall: "stone",
                    jettyMetres: 0,
                    windows: [1, 1, 1],
                    door: true,
                },
                { heightMetres: 3, wall: "stone", jettyMetres: 0, windows: [2, 1, 2], door: false },
            ],
            roof: {
                form: "gable",
                ridge: "along",
                pitchDegrees: 45,
                overhangMetres: 0.4,
                material: "slate",
            },
            plaster: "plasterWhite",
            shutters: "shutterRed",
            chimneys: [[1.8, -1.4]],
            sign: false,
            flowerBoxes: false,
            foundation: "plinth",
            condition: "fresh",
        },
    },
];

const WOODLAND_BUILDINGS: readonly IHouseRow[] = [
    {
        name: "logCabin",
        design: {
            widthMetres: 6,
            depthMetres: 5,
            plinthMetres: 0.4,
            storeys: [
                { heightMetres: 2.7, wall: "log", jettyMetres: 0, windows: [2, 1, 1], door: true },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 42,
                overhangMetres: 0.6,
                material: "shingle",
            },
            plaster: "daub",
            shutters: "shutterGreen",
            chimneys: [[2, -0.8]],
            sign: false,
            flowerBoxes: false,
            foundation: "plinth",
            condition: "fresh",
        },
    },
    {
        name: "stiltLodge",
        design: {
            widthMetres: 8,
            depthMetres: 6,
            plinthMetres: 1.6,
            storeys: [
                { heightMetres: 2.8, wall: "log", jettyMetres: 0, windows: [2, 2, 2], door: true },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 35,
                overhangMetres: 0.7,
                material: "turf",
            },
            plaster: "daub",
            shutters: "shutterGreen",
            roosts: true,
            chimneys: [[-2.6, 0.6]],
            sign: false,
            flowerBoxes: false,
            foundation: "stilts",
            condition: "fresh",
        },
    },
    {
        name: "wattleHut",
        design: {
            widthMetres: 5,
            depthMetres: 4,
            plinthMetres: 0.3,
            storeys: [
                {
                    heightMetres: 2.5,
                    wall: "wattle",
                    jettyMetres: 0,
                    windows: [1, 1, 0],
                    door: true,
                },
            ],
            roof: {
                form: "gable",
                ridge: "along",
                pitchDegrees: 52,
                overhangMetres: 0.5,
                material: "shingle",
            },
            plaster: "daub",
            shutters: "shutterGreen",
            chimneys: [],
            sign: false,
            flowerBoxes: false,
            foundation: "plinth",
            condition: "worn",
        },
    },
];

const prop = (name: string, parts: KitPart[], sockets: IKitSocket[] = []): IKitModule => ({
    name,
    parts,
    extras: { role: "prop", wallRunnable: false, sockets },
});

const PALISADE = prop("palisade", [
    {
        shape: "cylinder",
        radius: 0.13,
        height: 2.4,
        sides: 7,
        material: "logs",
        at: [-1.69, 0, 0],
        bevelMetres: 0,
        repeat: { mode: "line", count: 14, step: [0.26, 0, 0] },
    },
    {
        shape: "lathe",
        profile: [
            [0.13, 0],
            [0, 0.35],
        ],
        sides: 7,
        material: "logs",
        at: [-1.69, 2.4, 0],
        bevelMetres: 0,
        repeat: { mode: "line", count: 14, step: [0.26, 0, 0] },
    },
    {
        shape: "box",
        size: [3.7, 0.14, 0.12],
        material: "timber",
        at: [0, 0.6, -0.19],
        bevelMetres: 0,
        repeat: { mode: "line", count: 2, step: [0, 1.2, 0] },
    },
]);

const YARD_GOODS: readonly IKitModule[] = [
    prop(
        "workbench",
        [
            {
                shape: "box",
                size: [1.8, 0.08, 0.7],
                material: "planks",
                at: [0, 0.82, 0],
                bevelMetres: 0,
            },
            {
                shape: "box",
                size: [0.1, 0.82, 0.1],
                material: "timber",
                at: [-0.8, 0, -0.28],
                bevelMetres: 0,
                repeat: {
                    mode: "grid",
                    count: [2, 2],
                    step: [
                        [1.6, 0, 0],
                        [0, 0, 0.56],
                    ],
                },
            },
            {
                shape: "box",
                size: [1.6, 0.05, 0.5],
                material: "planks",
                at: [0, 0.25, 0],
                bevelMetres: 0,
            },
        ],
        [-0.55, 0, 0.55].map((x) => goodsSocket([x, 0.89, 0]))
    ),
    prop("toolRack", [
        {
            shape: "box",
            size: [0.1, 1.8, 0.1],
            material: "timber",
            at: [-0.7, 0, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [1.4, 0, 0] },
        },
        {
            shape: "box",
            size: [1.6, 0.1, 0.08],
            material: "timber",
            at: [0, 1.5, 0],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.025,
            height: 1.15,
            sides: 6,
            material: "timber",
            at: [-0.5, 0.3, 0.07],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [0.25, 0, 0] },
        },
        {
            shape: "box",
            size: [0.18, 0.1, 0.04],
            material: "iron",
            at: [-0.5, 1.35, 0.07],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [0.25, 0, 0] },
        },
    ]),
    prop("chopBlock", [
        {
            shape: "cylinder",
            radius: 0.3,
            height: 0.5,
            sides: 10,
            material: "logs",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.025,
            height: 0.7,
            sides: 6,
            material: "timber",
            at: [0.05, 0.48, 0],
            rotationDegrees: [0, 0, -35],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.04, 0.12, 0.16],
            material: "iron",
            at: [0.02, 0.46, 0],
            bevelMetres: 0,
        },
    ]),
    prop("crateStack", [
        { shape: "box", size: [0.6, 0.5, 0.6], material: "planks", at: [0, 0, 0], bevelMetres: 0 },
        {
            shape: "box",
            size: [0.6, 0.5, 0.6],
            material: "planks",
            at: [0.66, 0, 0.05],
            rotationDegrees: [0, 8, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.55, 0.45, 0.55],
            material: "planks",
            at: [0.3, 0.5, 0],
            rotationDegrees: [0, -6, 0],
            bevelMetres: 0,
        },
    ]),
    prop("waterBarrel", [
        {
            shape: "lathe",
            profile: [
                [0, 0],
                [0.3, 0],
                [0.36, 0.25],
                [0.38, 0.45],
                [0.36, 0.65],
                [0.3, 0.9],
                [0, 0.9],
            ],
            sides: 12,
            material: "planks",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.385,
            height: 0.04,
            sides: 12,
            material: "iron",
            at: [0, 0.2, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [0, 0.48, 0] },
        },
    ]),
    prop("basket", [
        {
            shape: "lathe",
            profile: [
                [0, 0],
                [0.18, 0],
                [0.24, 0.28],
                [0, 0.28],
            ],
            sides: 10,
            material: "thatch",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "lathe",
            profile: [
                [0.22, 0],
                [0.12, 0.1],
                [0, 0.13],
            ],
            sides: 8,
            material: "flowers",
            at: [0, 0.27, 0],
            bevelMetres: 0,
        },
    ]),
    prop("jug", [
        {
            shape: "lathe",
            profile: [
                [0, 0],
                [0.09, 0],
                [0.12, 0.12],
                [0.08, 0.25],
                [0.05, 0.3],
                [0.06, 0.33],
                [0, 0.33],
            ],
            sides: 10,
            material: "tiles",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
    ]),
];

const ARMS_GOODS: readonly IKitModule[] = [
    prop("weaponRack", [
        {
            shape: "box",
            size: [0.1, 1.6, 0.1],
            material: "timber",
            at: [-0.7, 0, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [1.4, 0, 0] },
        },
        {
            shape: "box",
            size: [1.6, 0.08, 0.3],
            material: "timber",
            at: [0, 0.25, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [1.6, 0.1, 0.08],
            material: "timber",
            at: [0, 1.4, 0],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.025,
            height: 1.9,
            sides: 6,
            material: "timber",
            at: [-0.5, 0.28, 0.08],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [0.25, 0, 0] },
        },
        {
            shape: "lathe",
            profile: [
                [0.04, 0],
                [0, 0.22],
            ],
            sides: 4,
            material: "iron",
            at: [-0.5, 2.18, 0.08],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [0.25, 0, 0] },
        },
    ]),
    prop(
        "brazier",
        [
            {
                shape: "box",
                size: [0.06, 0.9, 0.06],
                material: "iron",
                at: [0, 0, 0],
                bevelMetres: 0,
                repeat: { mode: "ring", count: 3, radius: 0.22 },
            },
            {
                shape: "lathe",
                profile: [
                    [0, 0],
                    [0.18, 0],
                    [0.34, 0.22],
                    [0.3, 0.24],
                    [0, 0.06],
                ],
                sides: 10,
                material: "iron",
                at: [0, 0.85, 0],
                bevelMetres: 0,
            },
        ],
        [{ name: "fire", at: [0, 0.95, 0] }]
    ),
];

const TOWN_GOODS: readonly IKitModule[] = [
    ...ARMS_GOODS,
    prop("anvil", [
        {
            shape: "cylinder",
            radius: 0.3,
            height: 0.5,
            sides: 10,
            material: "logs",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
        { shape: "box", size: [0.3, 0.14, 0.2], material: "iron", at: [0, 0.5, 0], bevelMetres: 0 },
        {
            shape: "box",
            size: [0.62, 0.16, 0.24],
            material: "iron",
            at: [0.05, 0.64, 0],
            bevelMetres: 0,
        },
        {
            shape: "lathe",
            profile: [
                [0.08, 0],
                [0, 0.3],
            ],
            sides: 6,
            material: "iron",
            at: [-0.26, 0.72, 0],
            rotationDegrees: [0, 0, 90],
            bevelMetres: 0,
        },
    ]),
    prop(
        "forgeHearth",
        [
            {
                shape: "box",
                size: [1.6, 0.8, 1.2],
                material: "stone",
                at: [0, 0, 0],
                bevelMetres: 0,
            },
            {
                shape: "box",
                size: [1.2, 0.06, 0.7],
                material: "iron",
                at: [0, 0.8, 0.15],
                bevelMetres: 0,
            },
            {
                shape: "box",
                size: [0.8, 2.3, 0.5],
                material: "stone",
                at: [0, 0.8, -0.35],
                bevelMetres: 0,
            },
            {
                shape: "box",
                size: [0.5, 0.35, 0.4],
                material: "planks",
                at: [0.95, 0.4, 0.1],
                rotationDegrees: [0, 0, -20],
                bevelMetres: 0,
            },
        ],
        [
            { name: "fire", at: [0, 0.9, 0.15] },
            { name: HOUSE_DESIGN.chimney.smokeSocket, at: [0, 3, -0.35] },
        ]
    ),
    prop("quenchTrough", [
        { shape: "box", size: [1.4, 0.55, 0.6], material: "planks", at: [0, 0, 0], bevelMetres: 0 },
        {
            shape: "box",
            size: [1.3, 0.02, 0.5],
            material: "glass",
            at: [0, 0.5, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [1.44, 0.05, 0.64],
            material: "iron",
            at: [0, 0.12, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [0, 0.3, 0] },
        },
    ]),
    prop("hayBale", [
        { shape: "box", size: [1.1, 0.55, 0.6], material: "thatch", at: [0, 0, 0], bevelMetres: 0 },
        {
            shape: "box",
            size: [1.1, 0.55, 0.6],
            material: "thatch",
            at: [0.2, 0, 0.66],
            rotationDegrees: [0, 12, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [1.05, 0.5, 0.58],
            material: "thatch",
            at: [0.1, 0.55, 0.33],
            rotationDegrees: [0, -5, 0],
            bevelMetres: 0,
        },
    ]),
    prop("townWall", [
        { shape: "box", size: [4, 2.8, 0.6], material: "stone", at: [0, 0, 0], bevelMetres: 0 },
        {
            shape: "box",
            size: [4.1, 0.2, 0.76],
            material: "stone",
            at: [0, 2.8, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.5, 0.5, 0.6],
            material: "stone",
            at: [-1.6, 3, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [0.8, 0, 0] },
        },
        {
            shape: "box",
            size: [0.6, 2.2, 0.5],
            material: "stone",
            at: [-1.7, 0, -0.5],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [3.4, 0, 0] },
        },
    ]),
];

const RUINED_BUILDINGS: readonly IHouseRow[] = [
    ...["cottage", "timberHouse", "longHall", "bellTower"].map((base) =>
        houseVariant(base, "Ruin", (design) => ({ ...design, condition: "ruined" }))
    ),
    houseVariant("teaHall", "Worn", (design) => ({ ...design, condition: "worn" })),
];

const seededBy = (name: string) => createSeededRandom(hashString(name));

const STEP_SLAB = {
    widthMetres: 1.2,
    heightMetres: 0.3,
    depthMetres: 0.6,
    chipMetres: [0.03, 0.12] satisfies Vector2Tuple,
};

const stepSlab = (name: string): IKitModule => {
    const nextRandom = seededBy(name);
    const halfWidth = STEP_SLAB.widthMetres / 2;
    const chip = () => valueInRange(STEP_SLAB.chipMetres, nextRandom());
    const top = STEP_SLAB.heightMetres;
    return prop(name, [
        {
            shape: "extrude",
            profile: [
                [-halfWidth, 0],
                [halfWidth, 0],
                [halfWidth, top - chip()],
                [halfWidth - chip(), top],
                [chip() - halfWidth, top - chip() / 3],
                [-halfWidth, top - chip()],
            ],
            depth: STEP_SLAB.depthMetres,
            material: "stone",
            at: [0, 0, -STEP_SLAB.depthMetres / 2],
            bevelMetres: 0.02,
        },
    ]);
};

const CLIMB_STONES: readonly IKitModule[] = ["stepSlabA", "stepSlabB", "stepSlabC"].map(stepSlab);

const WOODLAND_PERCH = perchStand({
    legs: "posts",
    legMaterial: "logs",
    floorMaterial: "planks",
    roofMaterial: "thatch",
});

const SETTLEMENT_PERCH = perchStand({
    legs: "posts",
    legMaterial: "timber",
    floorMaterial: "planks",
    roofMaterial: "tiles",
});

const RUINS_PERCH = perchStand({
    legs: "block",
    legMaterial: "stone",
    floorMaterial: "stone",
    roofMaterial: null,
});

const HIGHLANDS_PERCH = perchStand({
    legs: "block",
    legMaterial: "stone",
    floorMaterial: "timber",
    roofMaterial: "slate",
});

const RUINS_GOODS: readonly IKitModule[] = [
    prop("brokenWall", [
        ...jaggedWall({
            lengthMetres: 4,
            centreMetres: 0,
            heightMetres: 3.2,
            thicknessMetres: 0.6,
            plane: 0.3,
            base: 0,
            material: "stone",
            heightShare: [0.55, 1],
            nextRandom: seededBy("brokenWall"),
        }),
    ]),
    prop(
        "rubblePile",
        rubble({ widthMetres: 0, depthMetres: 0, material: "stone" }, seededBy("rubblePile"))
    ),
    prop("tornBanner", [
        {
            shape: "cylinder",
            radius: 0.06,
            height: 3.4,
            sides: 8,
            material: "timber",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [1.2, 0.07, 0.07],
            material: "timber",
            at: [0, 3.08, 0.08],
            bevelMetres: 0,
        },
        {
            shape: "extrude",
            profile: [
                [-0.5, 2],
                [-0.3, 1.75],
                [-0.15, 1.9],
                [0.02, 1.6],
                [0.2, 1.95],
                [0.32, 1.7],
                [0.5, 1.9],
                [0.5, 3.05],
                [-0.5, 3.05],
            ],
            depth: 0.02,
            material: "bannerRed",
            at: [0, 0, 0.14],
            bevelMetres: 0,
        },
    ]),
    prop("battleDebris", [
        {
            shape: "cylinder",
            radius: 0.4,
            height: 0.05,
            sides: 12,
            material: "shutterRed",
            at: [-0.6, 0.04, 0.3],
            rotationDegrees: [10, 0, 8],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.38,
            height: 0.05,
            sides: 12,
            material: "shutterBlue",
            at: [0.4, 0.38, -0.45],
            rotationDegrees: [70, 25, 0],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.025,
            height: 1.3,
            sides: 6,
            material: "timber",
            at: [-0.2, 0.03, 0.75],
            rotationDegrees: [0, 20, 90],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.025,
            height: 1.1,
            sides: 6,
            material: "timber",
            at: [-1.1, 0, -0.4],
            rotationDegrees: [0, 0, 18],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.06, 0.9, 0.015],
            material: "iron",
            at: [0.9, 0, 0.4],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.32, 0.05, 0.05],
            material: "iron",
            at: [0.9, 0.9, 0.4],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.025,
            height: 0.22,
            sides: 6,
            material: "timber",
            at: [0.9, 0.95, 0.4],
            bevelMetres: 0,
        },
    ]),
];

const stoneStorey = (
    windows: IHouseStorey["windows"],
    heightMetres: number,
    door = false
): IHouseStorey => ({ heightMetres, wall: "stone", jettyMetres: 0, windows, door });

const HIGHLAND_HUT: IHouseDesign = {
    widthMetres: 5,
    depthMetres: 4.5,
    plinthMetres: 0.4,
    storeys: [stoneStorey([1, 1, 1], 2.5, true)],
    roof: {
        form: "gable",
        ridge: "across",
        pitchDegrees: 32,
        overhangMetres: 0.5,
        material: "turf",
    },
    plaster: "daub",
    shutters: "shutterBlue",
    chimneys: [[1.4, -0.6]],
    sign: false,
    flowerBoxes: false,
    foundation: "plinth",
    condition: "fresh",
};

const HIGHLAND_TEMPLE: IHouseDesign = {
    widthMetres: 9,
    depthMetres: 7,
    plinthMetres: 0.6,
    storeys: [
        stoneStorey([2, 2, 2], 3.2, true),
        { heightMetres: 2.6, wall: "lacquer", jettyMetres: 0, windows: [3, 2, 3], door: false },
    ],
    roof: {
        form: "hip",
        ridge: "across",
        pitchDegrees: 26,
        overhangMetres: 1,
        material: "greyTiles",
    },
    plaster: "plasterWhite",
    shutters: "shutterRed",
    roosts: true,
    chimneys: [],
    sign: false,
    flowerBoxes: false,
    foundation: "stepped",
    condition: "fresh",
};

const HIGHLAND_STONE_BUILDINGS: readonly IHouseRow[] = [
    { name: "stoneHut", design: HIGHLAND_HUT },
    {
        name: "herderLonghouse",
        design: {
            ...HIGHLAND_HUT,
            widthMetres: 9,
            depthMetres: 5,
            storeys: [stoneStorey([3, 1, 3], 2.6, true)],
            roof: { ...HIGHLAND_HUT.roof, pitchDegrees: 30, overhangMetres: 0.6 },
            chimneys: [
                [-3, -0.5],
                [3, -0.5],
            ],
            roosts: true,
        },
    },
    { name: "monasteryHall", design: HIGHLAND_TEMPLE },
    {
        name: "bellTower",
        design: {
            ...HIGHLAND_TEMPLE,
            widthMetres: 4.2,
            depthMetres: 4.2,
            storeys: [
                stoneStorey([0, 1, 1], 3.2, true),
                stoneStorey([1, 1, 1], 3),
                {
                    heightMetres: 2.6,
                    wall: "lacquer",
                    jettyMetres: 0,
                    windows: [1, 1, 1],
                    door: false,
                },
            ],
            roof: { ...HIGHLAND_TEMPLE.roof, pitchDegrees: 30, overhangMetres: 0.9 },
        },
    },
    {
        name: "watchTower",
        design: {
            ...HIGHLAND_HUT,
            widthMetres: 4,
            depthMetres: 4,
            plinthMetres: 2.6,
            storeys: [
                {
                    heightMetres: 2.4,
                    wall: "plank",
                    jettyMetres: 0,
                    windows: [2, 2, 2],
                    door: true,
                },
            ],
            roof: {
                form: "gable",
                ridge: "along",
                pitchDegrees: 45,
                overhangMetres: 0.5,
                material: "shingle",
            },
            shutters: "shutterGreen",
            chimneys: [],
            roosts: true,
            foundation: "stilts",
        },
    },
    {
        name: "barracks",
        design: {
            ...HIGHLAND_HUT,
            widthMetres: 7,
            depthMetres: 5,
            storeys: [
                { heightMetres: 2.7, wall: "log", jettyMetres: 0, windows: [2, 1, 2], door: true },
            ],
            roof: {
                form: "gable",
                ridge: "across",
                pitchDegrees: 40,
                overhangMetres: 0.6,
                material: "shingle",
            },
            shutters: "shutterGreen",
            chimneys: [[2.4, -0.8]],
        },
    },
];

const HIGHLAND_BUILDINGS: readonly IHouseRow[] = [
    ...HIGHLAND_STONE_BUILDINGS,
    houseVariant(
        "stoneHut",
        "Slate",
        (design) => ({
            ...design,
            roof: { ...design.roof, material: "slate" },
            shutters: "shutterRed",
            condition: "worn",
        }),
        HIGHLAND_STONE_BUILDINGS
    ),
];

const CAIRN_STONES = [
    { radius: 0.55, height: 0.3, yawDegrees: 0 },
    { radius: 0.45, height: 0.28, yawDegrees: 20 },
    { radius: 0.36, height: 0.25, yawDegrees: 45 },
    { radius: 0.28, height: 0.22, yawDegrees: 10 },
    { radius: 0.2, height: 0.2, yawDegrees: 35 },
];

const SPEAR = { lengthMetres: 2.4, footMetres: 0.45, crossMetres: 0.05, count: 6 };

const HIGHLAND_GOODS: readonly IKitModule[] = [
    prop("stupa", [
        { shape: "box", size: [2.6, 0.5, 2.6], material: "stone", at: [0, 0, 0], bevelMetres: 0 },
        {
            shape: "box",
            size: [2.1, 0.45, 2.1],
            material: "stone",
            at: [0, 0.5, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [1.7, 0.4, 1.7],
            material: "plasterWhite",
            at: [0, 0.95, 0],
            bevelMetres: 0,
        },
        {
            shape: "lathe",
            profile: [
                [0, 0],
                [0.8, 0],
                [0.86, 0.35],
                [0.76, 0.75],
                [0.5, 1],
                [0, 1.1],
            ],
            sides: 16,
            material: "plasterWhite",
            at: [0, 1.35, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.55, 0.35, 0.55],
            material: "plasterWhite",
            at: [0, 2.35, 0],
            bevelMetres: 0,
        },
        {
            shape: "lathe",
            profile: [
                [0, 0],
                [0.3, 0],
                [0.08, 1.2],
                [0, 1.2],
            ],
            sides: 10,
            material: "gilt",
            at: [0, 2.7, 0],
            bevelMetres: 0,
        },
        {
            shape: "lathe",
            profile: [
                [0, 0],
                [0.32, 0],
                [0, 0.16],
            ],
            sides: 10,
            material: "gilt",
            at: [0, 3.85, 0],
            bevelMetres: 0,
        },
    ]),
    prop("prayerWheels", [
        {
            shape: "box",
            size: [3.2, 1.7, 0.12],
            material: "stone",
            at: [0, 0, -0.32],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.12, 2.2, 0.12],
            material: "lacquer",
            at: [-1.5, 0, 0.2],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [3, 0, 0] },
        },
        {
            shape: "box",
            size: [3.1, 0.1, 0.5],
            material: "timber",
            at: [0, 0.45, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [0, 1.15, 0] },
        },
        {
            shape: "cylinder",
            radius: 0.2,
            height: 0.95,
            sides: 12,
            material: "lacquer",
            at: [-1.1, 0.58, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [0.55, 0, 0] },
        },
        {
            shape: "cylinder",
            radius: 0.215,
            height: 0.07,
            sides: 12,
            material: "gilt",
            at: [-1.1, 0.66, 0],
            bevelMetres: 0,
            repeat: {
                mode: "grid",
                count: [5, 2],
                step: [
                    [0.55, 0, 0],
                    [0, 0.72, 0],
                ],
            },
        },
        {
            shape: "box",
            size: [3.6, 0.08, 1.1],
            material: "greyTiles",
            at: [0, 2.15, 0],
            rotationDegrees: [14, 0, 0],
            bevelMetres: 0,
        },
    ]),
    prop("monasteryWall", [
        {
            shape: "box",
            size: [4, 2.4, 0.5],
            material: "plasterWhite",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [4.02, 0.35, 0.52],
            material: "lacquer",
            at: [0, 1.85, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [4.3, 0.14, 0.85],
            material: "greyTiles",
            at: [0, 2.4, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [4.1, 0.4, 0.62],
            material: "stone",
            at: [0, 0, 0],
            bevelMetres: 0,
        },
    ]),
    prop("dryStoneWall", [
        ...jaggedWall({
            lengthMetres: 4,
            centreMetres: 0,
            heightMetres: 1.3,
            thicknessMetres: 0.7,
            plane: 0.35,
            base: 0,
            material: "stone",
            heightShare: [0.75, 1],
            nextRandom: seededBy("dryStoneWall"),
        }),
    ]),
    prop("cairn", [
        ...CAIRN_STONES.map(({ radius, height, yawDegrees }, index): KitPart => ({
            shape: "cylinder",
            radius,
            height,
            sides: 7,
            material: "stone",
            at: [0, CAIRN_STONES.slice(0, index).reduce((sum, below) => sum + below.height, 0), 0],
            rotationDegrees: [0, yawDegrees, 0],
            bevelMetres: 0,
        })),
        {
            shape: "cylinder",
            radius: 0.15,
            height: 0.12,
            sides: 6,
            material: "stone",
            at: [0, 0, 0],
            bevelMetres: 0,
            repeat: {
                mode: "ring",
                count: 6,
                radius: 0.8,
                jitter: { scale: [0.3, 0.3, 0.3], yawDegrees: 60 },
            },
        },
    ]),
    prop("waystone", [
        {
            shape: "box",
            size: [0.95, 0.25, 0.6],
            material: "stone",
            at: [0, 0, 0],
            bevelMetres: 0.03,
        },
        {
            shape: "box",
            size: [0.55, 1.7, 0.28],
            material: "stone",
            at: [0, 0.25, 0],
            bevelMetres: 0.05,
        },
        {
            shape: "box",
            size: [0.36, 0.7, 0.02],
            material: "bannerRed",
            at: [0, 0.95, 0.14],
            bevelMetres: 0,
        },
    ]),
    prop(
        "spearStack",
        Array.from({ length: SPEAR.count }, (_, index) =>
            turnedParts(
                [
                    slantedBeam({
                        from: [SPEAR.footMetres, 0],
                        to: [-SPEAR.crossMetres, SPEAR.lengthMetres],
                        plane: 0,
                        widthMetres: 0.05,
                        depthMetres: 0.05,
                        material: "timber",
                    }),
                    slantedBeam({
                        from: [-SPEAR.crossMetres, SPEAR.lengthMetres],
                        to: [-SPEAR.crossMetres * 2, SPEAR.lengthMetres + 0.25],
                        plane: 0,
                        widthMetres: 0.08,
                        depthMetres: 0.03,
                        material: "iron",
                    }),
                ],
                (360 / SPEAR.count) * index
            )
        ).flat()
    ),
    prop("fortGate", [
        {
            shape: "cylinder",
            radius: 0.26,
            height: 4.2,
            sides: 8,
            material: "logs",
            at: [-2, 0, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [4, 0, 0] },
        },
        {
            shape: "box",
            size: [4.8, 0.36, 0.42],
            material: "timber",
            at: [0, 3.3, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [5, 0.08, 1],
            material: "shingle",
            at: [0, 4.05, 0.38],
            rotationDegrees: [28, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [5, 0.08, 1],
            material: "shingle",
            at: [0, 4.05, -0.38],
            rotationDegrees: [-28, 0, 0],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: [0.7, 1.3, 0.02],
            material: "bannerRed",
            at: [-2, 1.7, 0.28],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [4, 0, 0] },
        },
    ]),
];

const tiledMaterial = (texture: string, resolution: number, tint?: string): KitMaterial => ({
    kind: "tiled",
    texture,
    tileScale: 1,
    resolution,
    ...(tint ? { tint } : {}),
});

const KIT_MATERIALS = {
    hessianCanvas: {
        kind: "baked",
        texture: "hessian_230",
        reliefMetres: 0.003,
        tileScale: 1,
        macroVariation: 0,
    },
    brownBark: {
        kind: "baked",
        texture: "bark_brown_02",
        reliefMetres: 0.01,
        tileScale: 1,
        macroVariation: 0,
    },
    mossyRock: {
        kind: "baked",
        texture: "mossy_rock",
        reliefMetres: 0.008,
        tileScale: 1,
        macroVariation: 0,
    },
    dressedStone: {
        kind: "baked",
        texture: "rock_08",
        reliefMetres: 0.01,
        tileScale: 1,
        macroVariation: 0,
    },
    cliffRock: {
        kind: "baked",
        texture: "rock_face_03",
        reliefMetres: 0.03,
        tileScale: 2.5,
        macroVariation: 0.35,
    },
    treeLeaves: {
        kind: "cutout",
        image: "environment/Stylized Nature MegaKit[Standard]/Textures/Leaves_NormalTree_C.png",
        alphaCutoff: 0.2,
    },
    lacquerWood: {
        kind: "baked",
        texture: "lacquered_cherry_wood",
        reliefMetres: 0.004,
        tileScale: 1,
        macroVariation: 0.15,
        tint: "#a3301f",
    },
    roofTiles: {
        kind: "baked",
        texture: "grey_roof_tiles",
        reliefMetres: 0.02,
        tileScale: 1,
        macroVariation: 0.2,
    },
    templeStone: {
        kind: "baked",
        texture: "japanese_stone_wall",
        reliefMetres: 0.015,
        tileScale: 1,
        macroVariation: 0.25,
    },
    templePaving: {
        kind: "baked",
        texture: "stone_tiles",
        reliefMetres: 0.01,
        tileScale: 1,
        macroVariation: 0.2,
    },
    weatheredPlanks: {
        kind: "baked",
        texture: "weathered_planks",
        reliefMetres: 0.008,
        tileScale: 1,
        macroVariation: 0.2,
    },
} as const satisfies Record<string, KitMaterial>;

const HOUSE_MATERIALS: Record<string, KitMaterial> = {
    stone: tiledMaterial("medieval_blocks_02", 512, "#a1998b"),
    timber: tiledMaterial("medieval_wood", 512, "#5a4130"),
    planks: tiledMaterial("weathered_planks", 512),
    plasterCream: tiledMaterial("white_plaster_rough_02", 512, "#e2d1ab"),
    plasterOchre: tiledMaterial("white_plaster_rough_02", 512, "#d2a660"),
    plasterWhite: tiledMaterial("white_plaster_rough_02", 512, "#ebe6da"),
    daub: tiledMaterial("white_plaster_rough_02", 512, "#a88d6a"),
    logs: tiledMaterial("bark_brown_02", 512, "#8a6a4c"),
    lacquer: tiledMaterial("lacquered_cherry_wood", 256, "#8e2a1f"),
    paper: tiledMaterial("hessian_230", 128, "#efe6cf"),
    tiles: tiledMaterial("clay_roof_tiles_02", 512),
    slate: tiledMaterial("roof_slates_02", 512),
    shingle: tiledMaterial("weathered_planks", 512, "#6b5a48"),
    greyTiles: tiledMaterial("grey_roof_tiles", 512),
    thatch: tiledMaterial("thatch_roof_angled", 512, "#b39563"),
    turf: tiledMaterial("forrest_ground_01", 512, "#5f6e34"),
    glass: tiledMaterial("weathered_planks", 128, "#1d2328"),
    iron: tiledMaterial("medieval_blocks_02", 128, "#2b2a28"),
    flowers: tiledMaterial("forest_leaves_04", 128, "#5b8a3a"),
    shutterGreen: tiledMaterial("weathered_planks", 256, "#3f5f45"),
    shutterRed: tiledMaterial("weathered_planks", 256, "#8a3a2c"),
    shutterBlue: tiledMaterial("weathered_planks", 256, "#3d5878"),
    bannerRed: tiledMaterial("hessian_230", 128, "#7a2a20"),
    gilt: tiledMaterial("lacquered_cherry_wood", 128, "#b8903c"),
};

const CHARACTER_RECIPES: readonly ICharacterRecipe[] = [
    {
        name: "Player",
        role: "player",
        source: "Charaters/models/player/carachter_texture.glb",
        skeleton: "ual",
        fit: { facingYawDegrees: -90, heightMetres: 1.78 },
        references: {
            riggedModel: "Charaters/models/player/character_rig.glb",
            segmentedModel: "Charaters/models/player/character_meshed.glb",
            jointsFromRiggedModel: [
                "upperarm_l",
                "lowerarm_l",
                "hand_l",
                "middle_01_l",
                "upperarm_r",
                "lowerarm_r",
                "hand_r",
                "middle_01_r",
            ],
        },
        tuning: { physics: { latticeTop: 0.1 } },
        props: [{ segmentedParts: [34, 40, 55, 57] }],
        overrides: {
            cloth_cloak: { segmentedParts: [0, 8, 12], attachBone: "spine_03" },
        },
        joints: {
            sourceSha256: "9ecfc326cd5bf7d06bacd1e45ca622b7de3055bdaed7f17746be6204a69d67aa",
            positions: {
                pelvis: [-0.0099, 0.0296, 0.8931],
                spine_01: [-0.0091, 0.0165, 1.0233],
                spine_02: [-0.0084, 0.0157, 1.1431],
                spine_03: [-0.0077, 0.028, 1.2806],
                neck_01: [-0.0069, 0.039, 1.4487],
                Head: [-0.0066, 0.029, 1.5277],
                head_top: [-0.0043, 0.0112, 1.7684],
                upperarm_l: [0.1717, 0.0808, 1.4388],
                lowerarm_l: [0.2745, 0.0602, 1.1921],
                hand_l: [0.3784, -0.0159, 0.9908],
                middle_01_l: [0.4327, -0.0475, 0.8822],
                upperarm_r: [-0.1847, 0.0808, 1.4388],
                lowerarm_r: [-0.2874, 0.0602, 1.1921],
                hand_r: [-0.4112, -0.0195, 0.9901],
                middle_01_r: [-0.4506, -0.0471, 0.8849],
                thigh_l: [0.0767, 0.0296, 0.908],
                calf_l: [0.1152, -0.0124, 0.5168],
                foot_l: [0.1599, 0.0615, 0.1015],
                ball_l: [0.1558, -0.0621, 0.0148],
                thigh_r: [-0.0965, 0.0296, 0.908],
                calf_r: [-0.1343, -0.0105, 0.5165],
                foot_r: [-0.1765, 0.0687, 0.1019],
                ball_r: [-0.1742, -0.062, 0.0148],
            },
        },
    },
];

const SCULPT_RECIPES: readonly ISculptRecipe[] = [
    {
        name: "GiantTreeTrunk",
        themes: ["woodland"],
        source: "environment/woodland/model/tree_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 14,
        triangles: 12_000,
        textureSize: 2048,
        embedOnly: false,
    },
    {
        name: "ShrineCore",
        themes: EVERY_THEME,
        source: "environment/woodland/model/shrine_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 1.6,
        triangles: 4_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "FoxGuardian",
        themes: ["woodland"],
        source: "environment/woodland/model/foxStand_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 180,
        heightMetres: 1.8,
        triangles: 4_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "TempleBell",
        themes: ["woodland"],
        source: "environment/woodland/model/bell_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: BELL_FRAME.bellHeightMetres,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "ArcheryTarget",
        themes: ["woodland"],
        source: "environment/woodland/model/archer_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 1.6,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "LogCart",
        themes: ["woodland"],
        source: "environment/woodland/model/woodlog_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 1.8,
        triangles: 4_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "GrainSacks",
        themes: ["settlement"],
        source: "environment/settlement/model/wheatBags_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 0.9,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "ProduceBasket",
        themes: ["settlement"],
        source: "environment/settlement/model/fruitBasket_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 0.5,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "Millstone",
        themes: ["settlement"],
        source: "environment/settlement/model/brokenWheel_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 1.4,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "CeramicJars",
        themes: ["settlement"],
        source: "environment/settlement/model/jars_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 0.9,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "FallenKnight",
        themes: ["ruins"],
        source: "environment/ruins/model/knightMonument_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 1.25,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SealedArch",
        themes: EVERY_THEME,
        source: "environment/ruins/model/carvedGate_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 9,
        triangles: 8_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SealedDoor",
        themes: EVERY_THEME,
        source: "environment/ruins/model/doorGates_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 6.75,
        triangles: 6_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SteppingStone",
        themes: EVERY_THEME,
        source: "environment/shared/models/pebble_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 0.75,
        triangles: 1_500,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "BridgePlank",
        themes: EVERY_THEME,
        source: "environment/shared/models/woodlog_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 0.2,
        triangles: 600,
        textureSize: 256,
        embedOnly: false,
    },
    {
        name: "BridgePost",
        themes: EVERY_THEME,
        source: "environment/shared/models/bridgeStand_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 1.8,
        triangles: 3_000,
        textureSize: 256,
        embedOnly: false,
    },
    {
        name: "HunterLookout",
        themes: ["woodland"],
        source: "environment/shared/models/hunterLookout_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 6.1,
        triangles: 8_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "YaguraPost",
        themes: ["settlement"],
        source: "environment/shared/models/yaguraPost_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 6.2,
        triangles: 8_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "TowerStump",
        themes: ["ruins"],
        source: "environment/shared/models/towerStump_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 5.3,
        triangles: 8_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "BeaconTower",
        themes: ["highlands"],
        source: "environment/shared/models/beaconTower_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 5.8,
        triangles: 8_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "ShrineRock",
        themes: ["woodland", "highlands"],
        source: "environment/shared/models/shrineRock_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 4.25,
        triangles: 8_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "GuardianHead",
        themes: ["ruins"],
        source: "environment/ruins/model/carvedStone_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 3.5,
        triangles: 6_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "TurtleStele",
        themes: ["ruins"],
        source: "environment/ruins/model/turtleArtifact_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 2.6,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SiegeWreck",
        themes: ["ruins"],
        source: "environment/ruins/model/woodenCart_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 1.9,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "MemorialCairn",
        themes: ["ruins"],
        source: "environment/ruins/model/memorial_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 1.3,
        triangles: 4_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "BrokenThrone",
        themes: ["ruins"],
        source: "environment/ruins/model/throne_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 3,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SignalBeacon",
        themes: ["highlands"],
        source: "environment/highlands/model/beacon_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 3.2,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SignalHorn",
        themes: ["highlands"],
        source: "environment/highlands/model/horn_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 1.4,
        triangles: 4_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "CliffWinch",
        themes: ["highlands"],
        source: "environment/highlands/model/winch_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 1.8,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "BridgeAnchor",
        themes: ["highlands"],
        source: "environment/highlands/model/ropeBridge_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 90,
        heightMetres: 2.2,
        triangles: 5_000,
        textureSize: 1024,
        embedOnly: false,
    },
    {
        name: "SpringTrough",
        themes: ["highlands"],
        source: "environment/highlands/model/waterTrough_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: -90,
        heightMetres: 1.2,
        triangles: 4_000,
        textureSize: 512,
        embedOnly: false,
    },
    {
        name: "CampFirePit",
        themes: ["woodland"],
        source: "environment/woodland/model/campfire_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 0.9,
        triangles: 3_000,
        textureSize: 512,
        embedOnly: false,
        sockets: [{ name: "fire", at: [0, 0.15, 0] }],
    },
    {
        name: "CampTent",
        themes: ["woodland"],
        source: "environment/woodland/model/tent_model.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 90,
        heightMetres: 2.7,
        triangles: 4_000,
        textureSize: 1024,
        embedOnly: false,
        patches: [
            {
                regionMetres: { min: [0.191, 0, -1.525], max: [0.985, 2.065, -1.271] },
                facing: [0, 0, -1],
                offsetMetres: [-0.349, 0, 0.159],
                thicknessMetres: 0.015,
            },
            {
                regionMetres: { min: [-0.985, 0, -1.525], max: [-0.191, 2.065, -1.271] },
                facing: [0, 0, -1],
                offsetMetres: [0.349, 0, 0.183],
                thicknessMetres: 0.015,
            },
        ],
    },
];

const SCAN_RECIPES: readonly IScanRecipe[] = [
    {
        name: "BoulderJagged",
        themes: ["woodland"],
        source: "environment/polyhaven/boulder_01/boulder_01_1k.gltf",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 1,
        triangles: 1_300,
        textureSize: 1024,
        embedOnly: false,
        sharedMaterial: "rock",
    },
    {
        name: "BoulderSlab",
        themes: ["woodland"],
        source: "environment/polyhaven/rock_moss_set_01/rock_moss_set_01_1k.gltf",
        objects: ["rock_moss_set_01_rock01"],
        facingYawDegrees: 0,
        heightMetres: 1.47,
        triangles: 1_600,
        textureSize: 1024,
        embedOnly: false,
        sharedMaterial: "rock",
    },
    {
        name: "OutcropLayered",
        themes: ["woodland"],
        source: "environment/polyhaven/rock_face_01/rock_face_01_1k.gltf",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 3.56,
        triangles: 2_600,
        textureSize: 1024,
        embedOnly: true,
        sharedMaterial: "rock",
    },
    {
        name: "OutcropStepped",
        themes: ["woodland"],
        source: "environment/polyhaven/rock_face_02/rock_face_02_1k.gltf",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        heightMetres: 2.47,
        triangles: 1_800,
        textureSize: 1024,
        embedOnly: true,
        sharedMaterial: "rock",
    },
];

const WEAPON_RECIPES: readonly IImportedRecipe[] = [
    {
        name: "Sword",
        source: "weapons/model/sword_texture.glb",
        objects: ALL_MESHES,
        facingYawDegrees: 0,
        triangles: 15_000,
        textureSize: 1024,
    },
];

const KIT_RECIPES: readonly IKitRecipe[] = [
    {
        name: "WoodlandCamp",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        materials: {
            canvas: KIT_MATERIALS.hessianCanvas,
            bark: KIT_MATERIALS.brownBark,
            stone: KIT_MATERIALS.mossyRock,
        },
        modules: [
            {
                name: "campfire",
                parts: [
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.14, 0.015],
                            [0.16, 0.09],
                            [0.1, 0.18],
                            [0, 0.19],
                        ],
                        sides: 7,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0,
                        noise: { amplitudeMetres: 0.015, featureMetres: 0.1 },
                        repeat: {
                            mode: "ring",
                            count: 11,
                            radius: 0.66,
                            jitter: { scale: [0.25, 0.3, 0.25], yawDegrees: 180 },
                        },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.055,
                        height: 0.9,
                        sides: 7,
                        material: "bark",
                        at: [0, 0.03, 0],
                        rotationDegrees: [0, 0, 30],
                        bevelMetres: 0.004,
                        repeat: {
                            mode: "ring",
                            count: 5,
                            radius: 0.34,
                            jitter: { scale: [0.15, 0.12, 0.15], yawDegrees: 10 },
                        },
                    },
                ],
                extras: {
                    role: "fire",
                    wallRunnable: false,
                    sockets: [{ name: "fire", at: [0, 0.3, 0] }],
                },
            },
            {
                name: "bedroll",
                parts: [
                    {
                        shape: "box",
                        size: [0.72, 0.07, 1.85],
                        material: "canvas",
                        at: [0, 0, 0.12],
                        bevelMetres: 0.012,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.18 },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.12,
                        height: 0.74,
                        sides: 10,
                        material: "canvas",
                        at: [0.37, 0.15, -0.9],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0.01,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.1 },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "firewoodPile",
                parts: [
                    {
                        shape: "cylinder",
                        radius: 0.08,
                        height: 1.1,
                        sides: 7,
                        material: "bark",
                        at: [-0.34, 0.08, -0.55],
                        rotationDegrees: [90, 0, 0],
                        bevelMetres: 0.006,
                        repeat: {
                            mode: "line",
                            count: 5,
                            step: [0.17, 0, 0],
                            jitter: { scale: [0.12, 0.08, 0.12], yawDegrees: 4 },
                        },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.08,
                        height: 1.1,
                        sides: 7,
                        material: "bark",
                        at: [-0.255, 0.225, -0.55],
                        rotationDegrees: [90, 0, 0],
                        bevelMetres: 0.006,
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.17, 0, 0],
                            jitter: { scale: [0.12, 0.08, 0.12], yawDegrees: 4 },
                        },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.08,
                        height: 1.1,
                        sides: 7,
                        material: "bark",
                        at: [-0.17, 0.37, -0.55],
                        rotationDegrees: [90, 0, 0],
                        bevelMetres: 0.006,
                        repeat: {
                            mode: "line",
                            count: 3,
                            step: [0.17, 0, 0],
                            jitter: { scale: [0.12, 0.08, 0.12], yawDegrees: 4 },
                        },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "logSeat",
                parts: [
                    {
                        shape: "cylinder",
                        radius: 0.175,
                        height: 1.8,
                        sides: 10,
                        material: "bark",
                        at: [0.9, 0.175, 0],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0.012,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.12 },
                    },
                ],
                extras: { role: "seat", wallRunnable: false, sockets: [] },
            },
            {
                name: "rack",
                parts: [
                    {
                        shape: "cylinder",
                        radius: 0.035,
                        height: 1.7,
                        sides: 7,
                        material: "bark",
                        at: [-0.45, 0, -0.9],
                        rotationDegrees: [0, 0, -15],
                        bevelMetres: 0.004,
                        repeat: { mode: "line", count: 2, step: [0, 0, 1.8] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.035,
                        height: 1.7,
                        sides: 7,
                        material: "bark",
                        at: [0.45, 0, -0.9],
                        rotationDegrees: [0, 0, 15],
                        bevelMetres: 0.004,
                        repeat: { mode: "line", count: 2, step: [0, 0, 1.8] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.03,
                        height: 2.1,
                        sides: 7,
                        material: "bark",
                        at: [0, 1.5, -1.05],
                        rotationDegrees: [90, 0, 0],
                        bevelMetres: 0.004,
                    },
                    {
                        shape: "box",
                        size: [0.02, 0.7, 0.6],
                        sag: { metres: 0.04, segments: 5 },
                        material: "canvas",
                        at: [0, 0.78, -0.45],
                        bevelMetres: 0.004,
                        noise: { amplitudeMetres: 0.004, featureMetres: 0.12 },
                        repeat: { mode: "line", count: 2, step: [0, 0, 0.9] },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
        ],
    },
    {
        name: "WoodlandShrine",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        materials: {
            stone: KIT_MATERIALS.dressedStone,
            wood: KIT_MATERIALS.brownBark,
            rope: { ...KIT_MATERIALS.hessianCanvas, tint: "#b89a5e" },
            paper: { ...KIT_MATERIALS.hessianCanvas, tint: "#ece6d4" },
            flagRed: { ...KIT_MATERIALS.hessianCanvas, tint: "#a3301f" },
            flagGold: { ...KIT_MATERIALS.hessianCanvas, tint: "#c79a2e" },
            flagGreen: { ...KIT_MATERIALS.hessianCanvas, tint: "#3f6b4a" },
        },
        modules: [
            {
                name: "prayerFlags",
                parts: [
                    ...hungSpan({
                        halfLengthMetres: 2.4,
                        heightMetres: 2.6,
                        sagMetres: 0.35,
                        postRadiusMetres: 0.06,
                        ropeRadiusMetres: 0.012,
                        postMaterial: "wood",
                        ropeMaterial: "rope",
                    }),
                    ...hangingAlongSpan({
                        halfLengthMetres: 2.4,
                        heightMetres: 2.6,
                        sagMetres: 0.35,
                        count: 9,
                        dropMetres: 0.36,
                        piece: (index) => ({
                            shape: "box",
                            size: [0.24, 0.34, 0.012],
                            material: (["flagRed", "flagGold", "flagGreen"] as const)[index % 3],
                            bevelMetres: 0,
                        }),
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "sacredRope",
                parts: [
                    ...hungSpan({
                        halfLengthMetres: 1.8,
                        heightMetres: 2.2,
                        sagMetres: 0.3,
                        postRadiusMetres: 0.14,
                        ropeRadiusMetres: 0.09,
                        postMaterial: "wood",
                        ropeMaterial: "rope",
                    }),
                    ...hangingAlongSpan({
                        halfLengthMetres: 1.8,
                        heightMetres: 2.2,
                        sagMetres: 0.3,
                        count: 4,
                        dropMetres: 0.09,
                        piece: () => ({
                            shape: "extrude",
                            profile: PAPER_CHARM_PROFILE,
                            depth: 0.012,
                            material: "paper",
                            bevelMetres: 0,
                        }),
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "lantern",
                parts: [
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.25, 0],
                            [0.25, 0.1],
                            [0.17, 0.16],
                            [0, 0.16],
                        ],
                        sides: 6,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.008,
                        noise: { amplitudeMetres: 0.003, featureMetres: 0.05 },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.09,
                        height: 0.6,
                        sides: 6,
                        material: "stone",
                        at: [0, 0.16, 0],
                        bevelMetres: 0.008,
                        noise: { amplitudeMetres: 0.003, featureMetres: 0.05 },
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.22, 0],
                            [0.22, 0.08],
                            [0, 0.08],
                        ],
                        sides: 6,
                        material: "stone",
                        at: [0, 0.76, 0],
                        bevelMetres: 0.008,
                        noise: { amplitudeMetres: 0.003, featureMetres: 0.05 },
                    },
                    {
                        shape: "box",
                        size: [0.04, 0.32, 0.04],
                        material: "stone",
                        at: [0, 0.84, 0],
                        bevelMetres: 0.004,
                        repeat: { mode: "ring", count: 6, radius: 0.16 },
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.3, 0],
                            [0.33, 0.04],
                            [0.12, 0.22],
                            [0, 0.27],
                        ],
                        sides: 6,
                        material: "stone",
                        at: [0, 1.16, 0],
                        bevelMetres: 0.005,
                        noise: { amplitudeMetres: 0.003, featureMetres: 0.05 },
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.05, 0],
                            [0.065, 0.06],
                            [0, 0.13],
                        ],
                        sides: 6,
                        material: "stone",
                        at: [0, 1.43, 0],
                        bevelMetres: 0,
                        noise: { amplitudeMetres: 0.003, featureMetres: 0.05 },
                    },
                ],
                extras: {
                    role: "light",
                    wallRunnable: false,
                    sockets: [{ name: "light", at: [0, 1.0, 0] }],
                },
            },
            {
                name: "paving",
                parts: [
                    {
                        shape: "cylinder",
                        radius: 0.6,
                        height: 0.12,
                        sides: 10,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.004, featureMetres: 0.1 },
                    },
                    {
                        shape: "box",
                        size: [0.55, 0.12, 0.5],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.004, featureMetres: 0.1 },
                        repeat: {
                            mode: "ring",
                            count: 11,
                            radius: 1.0,
                            jitter: { scale: [0.06, 0.2, 0.06], yawDegrees: 6 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.6, 0.12, 0.52],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.004, featureMetres: 0.1 },
                        repeat: {
                            mode: "ring",
                            count: 17,
                            radius: 1.6,
                            jitter: { scale: [0.06, 0.2, 0.06], yawDegrees: 6 },
                        },
                    },
                ],
                extras: {
                    role: "floor",
                    wallRunnable: false,
                    sockets: [
                        { name: "core", at: [0, 0.12, 0] },
                        { name: "lanternLeft", at: [-1.25, 0.12, 1.25] },
                        { name: "lanternRight", at: [1.25, 0.12, 1.25] },
                    ],
                },
            },
        ],
    },
    {
        name: "WoodlandLore",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        materials: {
            stone: KIT_MATERIALS.dressedStone,
        },
        modules: [
            {
                name: "loreStone",
                parts: [
                    {
                        shape: "extrude",
                        profile: [
                            [-0.44, 0],
                            [0.48, 0],
                            [0.46, 0.7],
                            [0.34, 1.3],
                            [0.26, 1.58],
                            [0.12, 1.58],
                            [-0.05, 1.5],
                            [-0.3, 1.25],
                            [-0.42, 0.7],
                        ],
                        depth: 0.55,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.03,
                        noise: { amplitudeMetres: 0.015, featureMetres: 0.22 },
                    },
                    {
                        shape: "box",
                        size: [0.5, 0.22, 0.4],
                        material: "stone",
                        at: [-0.55, 0, 0.25],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.012, featureMetres: 0.15 },
                    },
                    {
                        shape: "box",
                        size: [0.42, 0.18, 0.36],
                        material: "stone",
                        at: [0.58, 0, -0.2],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.012, featureMetres: 0.15 },
                    },
                    {
                        shape: "box",
                        size: [0.36, 0.16, 0.3],
                        material: "stone",
                        at: [0.1, 0, 0.48],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.012, featureMetres: 0.15 },
                    },
                ],
                extras: {
                    role: "lore",
                    wallRunnable: false,
                    sockets: [{ name: "read", at: [0, 0.17, 0.5] }],
                },
            },
        ],
    },
    {
        name: "WoodlandMasonry",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        sharedMaterial: "rock",
        materials: {
            stone: KIT_MATERIALS.dressedStone,
        },
        modules: [
            {
                name: "wallCourse",
                parts: [
                    {
                        shape: "box",
                        size: [0.48, 0.48, 0.6],
                        material: "stone",
                        at: [-0.75, 0, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.48, 0.6],
                        material: "stone",
                        at: [-0.5, 0.5, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 3,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.23, 0.48, 0.6],
                        material: "stone",
                        at: [-0.875, 0.5, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 2,
                            step: [1.75, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                ],
                extras: { role: "wall", wallRunnable: false, sockets: [] },
            },
            {
                name: "wallBroken",
                parts: [
                    {
                        shape: "box",
                        size: [0.48, 0.48, 0.6],
                        material: "stone",
                        at: [-0.75, 0, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.48, 0.6],
                        material: "stone",
                        at: [-0.5, 0.5, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 3,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.23, 0.48, 0.6],
                        material: "stone",
                        at: [-0.875, 0.5, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 1,
                            step: [0, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.48, 0.6],
                        material: "stone",
                        at: [-0.75, 1.0, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 2,
                            step: [1, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.48, 0.6],
                        material: "stone",
                        at: [-0.75, 1.5, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 1,
                            step: [0, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                ],
                extras: { role: "wall", wallRunnable: false, sockets: [] },
            },
            {
                name: "corner",
                parts: [
                    {
                        shape: "box",
                        size: [0.58, 0.48, 0.58],
                        material: "stone",
                        at: [-0.3, 0, -0.3],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 2,
                            step: [0.6, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.58, 0.48, 0.58],
                        material: "stone",
                        at: [-0.3, 0, 0.3],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 1,
                            step: [0, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.58, 0.48, 0.58],
                        material: "stone",
                        at: [-0.3, 0.5, -0.3],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 2,
                            step: [0, 0, 0.6],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.58, 0.48, 0.58],
                        material: "stone",
                        at: [0.3, 0.5, -0.3],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 1,
                            step: [0, 0, 0],
                            jitter: { scale: [0.03, 0.04, 0.03], yawDegrees: 3 },
                        },
                    },
                ],
                extras: { role: "wall", wallRunnable: false, sockets: [] },
            },
            {
                name: "floorSlab",
                parts: [
                    {
                        shape: "box",
                        size: [0.48, 0.2, 0.48],
                        material: "stone",
                        at: [-0.75, 0, -0.75],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.15, 0.03], yawDegrees: 4 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.2, 0.48],
                        material: "stone",
                        at: [-0.75, 0, -0.25],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.15, 0.03], yawDegrees: 4 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.2, 0.48],
                        material: "stone",
                        at: [-0.75, 0, 0.25],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.15, 0.03], yawDegrees: 4 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.48, 0.2, 0.48],
                        material: "stone",
                        at: [-0.75, 0, 0.75],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.25 },
                        repeat: {
                            mode: "line",
                            count: 4,
                            step: [0.5, 0, 0],
                            jitter: { scale: [0.03, 0.15, 0.03], yawDegrees: 4 },
                        },
                    },
                ],
                extras: { role: "floor", wallRunnable: false, sockets: [] },
            },
            {
                name: "rubble",
                parts: [
                    {
                        shape: "box",
                        size: [0.46, 0.3, 0.55],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.25 },
                        repeat: {
                            mode: "ring",
                            count: 4,
                            radius: 0.55,
                            jitter: { scale: [0.3, 0.35, 0.3], yawDegrees: 180 },
                        },
                    },
                    {
                        shape: "box",
                        size: [0.5, 0.42, 0.6],
                        material: "stone",
                        at: [0.08, 0, 0.05],
                        rotationDegrees: [0, 25, 0],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.25 },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "stair",
                parts: [
                    {
                        shape: "extrude",
                        profile: [
                            [0, 0],
                            [1.6, 0],
                            [1.6, 1.0],
                            [1.28, 1.0],
                            [1.28, 0.8],
                            [0.96, 0.8],
                            [0.96, 0.6],
                            [0.64, 0.6],
                            [0.64, 0.4],
                            [0.32, 0.4],
                            [0.32, 0.2],
                            [0, 0.2],
                        ],
                        depth: 2.1,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.015,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.4 },
                    },
                ],
                extras: { role: "stair", wallRunnable: false, sockets: [] },
            },
        ],
    },
    {
        name: "WoodlandRavine",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        sharedMaterial: "rock",
        materials: {
            rock: KIT_MATERIALS.cliffRock,
        },
        modules: [
            {
                name: "cliffPanel8",
                parts: [
                    {
                        shape: "extrude",
                        profile: [
                            [-4, 0],
                            [4, 0],
                            [4.1, 1.8],
                            [3.85, 3.6],
                            [4.05, 5.2],
                            [3.6, 6],
                            [2.4, 5.7],
                            [1.1, 6.2],
                            [-0.4, 5.8],
                            [-1.8, 6.3],
                            [-3.1, 5.9],
                            [-3.9, 6.05],
                            [-4.1, 4.4],
                            [-3.85, 2.5],
                            [-4.05, 1],
                        ],
                        depth: 1,
                        material: "rock",
                        at: [0, 0, 0],
                        bevelMetres: 0.05,
                        noise: { amplitudeMetres: 0.08, featureMetres: 0.8 },
                    },
                ],
                extras: { role: "cliff", wallRunnable: true, sockets: [] },
            },
            {
                name: "cliffPanel4",
                parts: [
                    {
                        shape: "extrude",
                        profile: [
                            [-2, 0],
                            [2, 0],
                            [2.1, 2.1],
                            [1.9, 4.3],
                            [2.05, 5.7],
                            [1.3, 6.1],
                            [0.2, 5.75],
                            [-0.9, 6.2],
                            [-1.9, 5.9],
                            [-2.1, 3.8],
                            [-1.9, 1.6],
                        ],
                        depth: 1,
                        material: "rock",
                        at: [0, 0, 0],
                        bevelMetres: 0.05,
                        noise: { amplitudeMetres: 0.08, featureMetres: 0.8 },
                    },
                ],
                extras: { role: "cliff", wallRunnable: true, sockets: [] },
            },
            {
                name: "ledge",
                parts: [
                    {
                        shape: "box",
                        size: [2, 1, 1.2],
                        material: "rock",
                        at: [0, 0, 0],
                        bevelMetres: 0.05,
                        noise: { amplitudeMetres: 0.04, featureMetres: 0.4 },
                    },
                ],
                extras: { role: "ledge", wallRunnable: false, sockets: [] },
            },
            {
                name: "cap",
                parts: [
                    {
                        shape: "extrude",
                        profile: [
                            [-2, 0],
                            [2, 0],
                            [1.8, 0.5],
                            [0.8, 0.8],
                            [-0.6, 0.7],
                            [-1.7, 0.45],
                        ],
                        depth: 1.4,
                        material: "rock",
                        at: [0, 0, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.06, featureMetres: 0.5 },
                    },
                ],
                extras: { role: "cliff", wallRunnable: false, sockets: [] },
            },
        ],
    },
    {
        name: "WoodlandCanopy",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        materials: {
            leaves: KIT_MATERIALS.treeLeaves,
        },
        modules: [
            {
                name: "clusterLarge",
                parts: [
                    {
                        shape: "card",
                        size: [1.4, 1.4],
                        material: "leaves",
                        at: [0, 0.3, 0],
                        rotationDegrees: [0, 0, 0],
                        bevelMetres: 0,
                        repeat: {
                            mode: "ring",
                            count: 3,
                            radius: 0,
                            jitter: { scale: [0.2, 0.2, 0.2], yawDegrees: 30 },
                        },
                    },
                    {
                        shape: "card",
                        size: [1.0, 0.9],
                        material: "leaves",
                        at: [0, 0.1, 0],
                        rotationDegrees: [0, 0, -65],
                        bevelMetres: 0,
                        repeat: {
                            mode: "ring",
                            count: 6,
                            radius: 0.6,
                            jitter: { scale: [0.2, 0.2, 0.2], yawDegrees: 30 },
                        },
                    },
                    {
                        shape: "card",
                        size: [1.2, 1.1],
                        material: "leaves",
                        at: [0, 0.3, 0],
                        rotationDegrees: [0, 0, -35],
                        bevelMetres: 0,
                        repeat: {
                            mode: "ring",
                            count: 6,
                            radius: 0.45,
                            jitter: { scale: [0.2, 0.2, 0.2], yawDegrees: 30 },
                        },
                    },
                    {
                        shape: "card",
                        size: [1.0, 0.9],
                        material: "leaves",
                        at: [0, 0.95, 0],
                        rotationDegrees: [0, 0, -30],
                        bevelMetres: 0,
                        repeat: {
                            mode: "ring",
                            count: 4,
                            radius: 0.2,
                            jitter: { scale: [0.2, 0.2, 0.2], yawDegrees: 30 },
                        },
                    },
                ],
                extras: {
                    role: "foliage",
                    wallRunnable: false,
                    sockets: [{ name: "attach", at: [0, 0, 0] }],
                },
            },
            {
                name: "clusterSmall",
                parts: [
                    {
                        shape: "card",
                        size: [0.9, 0.9],
                        material: "leaves",
                        at: [0, 0.15, 0],
                        rotationDegrees: [0, 0, 0],
                        bevelMetres: 0,
                        repeat: {
                            mode: "ring",
                            count: 3,
                            radius: 0,
                            jitter: { scale: [0.2, 0.2, 0.2], yawDegrees: 30 },
                        },
                    },
                    {
                        shape: "card",
                        size: [0.8, 0.7],
                        material: "leaves",
                        at: [0, 0.05, 0],
                        rotationDegrees: [0, 0, -45],
                        bevelMetres: 0,
                        repeat: {
                            mode: "ring",
                            count: 5,
                            radius: 0.3,
                            jitter: { scale: [0.2, 0.2, 0.2], yawDegrees: 30 },
                        },
                    },
                ],
                extras: {
                    role: "foliage",
                    wallRunnable: false,
                    sockets: [{ name: "attach", at: [0, 0, 0] }],
                },
            },
        ],
    },
    {
        name: "WoodlandTemple",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 4_000,
        materials: {
            lacquer: KIT_MATERIALS.lacquerWood,
            tiles: KIT_MATERIALS.roofTiles,
            stone: KIT_MATERIALS.templeStone,
            paving: KIT_MATERIALS.templePaving,
        },
        modules: [
            {
                name: "bellFrame",
                parts: [
                    {
                        shape: "box",
                        size: [0.4, 0.3, 0.4],
                        material: "stone",
                        at: [-1, 0, 0],
                        bevelMetres: 0.02,
                        repeat: { mode: "line", count: 2, step: [2, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.1,
                        height: BELL_FRAME.beamHeightMetres - 0.3,
                        sides: 12,
                        material: "lacquer",
                        at: [-1, 0.3, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [2, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [2.5, 0.22, 0.24],
                        material: "lacquer",
                        at: [0, BELL_FRAME.beamHeightMetres, 0],
                        bevelMetres: 0.015,
                    },
                    ...gateRoof({
                        at: [0, BELL_FRAME.beamHeightMetres + 0.22, 0],
                        halfLengthMetres: 1.45,
                        material: "tiles",
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "offeringTable",
                parts: [
                    {
                        shape: "box",
                        size: [0.08, 0.72, 0.08],
                        material: "lacquer",
                        at: [-0.6, 0, -0.25],
                        bevelMetres: 0.01,
                        repeat: {
                            mode: "grid",
                            count: [2, 2],
                            step: [
                                [1.2, 0, 0],
                                [0, 0, 0.5],
                            ],
                        },
                    },
                    {
                        shape: "box",
                        size: [1.3, 0.1, 0.04],
                        material: "lacquer",
                        at: [0, 0.6, -0.27],
                        bevelMetres: 0.01,
                        repeat: { mode: "line", count: 2, step: [0, 0, 0.54] },
                    },
                    {
                        shape: "box",
                        size: [1.44, 0.07, 0.74],
                        material: "lacquer",
                        at: [0, 0.72, 0],
                        bevelMetres: 0.015,
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.1, 0],
                            [0.14, 0.07],
                            [0.13, 0.09],
                            [0.09, 0.05],
                            [0, 0.05],
                        ],
                        sides: 12,
                        material: "stone",
                        at: [-0.42, 0.79, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 3, step: [0.42, 0, 0] },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "gate",
                parts: [
                    {
                        shape: "box",
                        size: [0.8, 0.55, 0.8],
                        material: "stone",
                        at: [-1.8, 0, 0],
                        bevelMetres: 0.03,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.2 },
                        repeat: { mode: "line", count: 2, step: [3.6, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.2,
                        height: 3.4,
                        sides: 12,
                        material: "lacquer",
                        at: [-1.8, 0.55, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [3.6, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [4.3, 0.3, 0.34],
                        material: "lacquer",
                        at: [0, 2.85, 0],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "box",
                        size: [1.3, 0.6, 0.2],
                        material: "stone",
                        at: [0, 3.15, 0],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "box",
                        size: [4.8, 0.34, 0.4],
                        material: "lacquer",
                        at: [0, 3.75, 0],
                        bevelMetres: 0.02,
                    },
                    ...gateRoof({ at: [0, 4.09, 0], halfLengthMetres: 3, material: "tiles" }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "pagodaRoof",
                parts: [hipRoof({ at: [0, 0, 0], material: "tiles" })],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "pavilion",
                parts: [
                    {
                        shape: "box",
                        size: [5.2, 0.6, 5.2],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.03,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.3 },
                    },
                    {
                        shape: "box",
                        size: [1.8, 0.3, 0.6],
                        material: "stone",
                        at: [0, 0, 2.9],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.2,
                        height: 3,
                        sides: 12,
                        material: "lacquer",
                        at: [-2, 0.6, -2],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [4, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.2,
                        height: 3,
                        sides: 12,
                        material: "lacquer",
                        at: [-2, 0.6, 2],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [4, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [4.6, 0.3, 0.3],
                        material: "lacquer",
                        at: [0, 3.6, -2],
                        bevelMetres: 0.02,
                        repeat: { mode: "line", count: 2, step: [0, 0, 4] },
                    },
                    {
                        shape: "box",
                        size: [0.3, 0.3, 4.6],
                        material: "lacquer",
                        at: [-2, 3.6, 0],
                        bevelMetres: 0.02,
                        repeat: { mode: "line", count: 2, step: [4, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [1.3, 0.9, 0.8],
                        material: "stone",
                        at: [0, 0.6, -1.2],
                        bevelMetres: 0.02,
                    },
                    hipRoof({ at: [0, 3.9, 0], material: "tiles" }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "incenseBurner",
                parts: [
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.3, 0],
                            [0.3, 0.12],
                            [0.18, 0.2],
                            [0.42, 0.45],
                            [0.52, 0.75],
                            [0.48, 0.82],
                            [0, 0.82],
                        ],
                        sides: 12,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0,
                        noise: { amplitudeMetres: 0.004, featureMetres: 0.1 },
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.4, 0],
                            [0.28, 0.2],
                            [0.12, 0.3],
                            [0.1, 0.42],
                            [0, 0.46],
                        ],
                        sides: 12,
                        material: "stone",
                        at: [0, 0.82, 0],
                        bevelMetres: 0,
                    },
                ],
                extras: {
                    role: "prop",
                    wallRunnable: false,
                    sockets: [{ name: "incense", at: [0, 1.22, 0] }],
                },
            },
            {
                name: "steps",
                parts: stairFlight({
                    steps: 5,
                    widthMetres: 3.2,
                    riseMetres: 0.3,
                    treadMetres: 0.6,
                    material: "paving",
                    bevelMetres: 0.02,
                }),
                extras: { role: "stair", wallRunnable: false, sockets: [] },
            },
            {
                name: "wall",
                parts: [
                    {
                        shape: "box",
                        size: [4, 1.3, 0.6],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.03,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.3 },
                    },
                    {
                        shape: "extrude",
                        profile: [
                            [-0.5, 0],
                            [0.5, 0],
                            [0.45, 0.1],
                            [0, 0.3],
                            [-0.45, 0.1],
                        ],
                        depth: 4.3,
                        material: "tiles",
                        at: [0, 1.3, 0],
                        rotationDegrees: [0, 90, 0],
                        bevelMetres: 0,
                    },
                ],
                extras: { role: "wall", wallRunnable: false, sockets: [] },
            },
        ],
    },
    {
        name: "WoodlandOutpost",
        themes: ["woodland"],
        textureSize: 1024,
        trianglesPerModule: 2_000,
        materials: {
            planks: KIT_MATERIALS.weatheredPlanks,
            bark: KIT_MATERIALS.brownBark,
        },
        modules: [
            {
                name: "sawhorse",
                parts: [
                    {
                        shape: "box",
                        size: [0.08, 0.9, 0.08],
                        material: "planks",
                        at: [-0.2, 0, -0.45],
                        rotationDegrees: [0, 0, -22],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0, 0, 0.9] },
                    },
                    {
                        shape: "box",
                        size: [0.08, 0.9, 0.08],
                        material: "planks",
                        at: [0.2, 0, -0.45],
                        rotationDegrees: [0, 0, 22],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0, 0, 0.9] },
                    },
                    {
                        shape: "box",
                        size: [0.08, 0.08, 1.1],
                        material: "planks",
                        at: [0, 0.4, 0],
                        bevelMetres: 0,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.14,
                        height: 1.7,
                        sides: 10,
                        material: "bark",
                        at: [0, 0.98, -0.85],
                        rotationDegrees: [90, 0, 0],
                        bevelMetres: 0,
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "watchPlatform",
                parts: [
                    {
                        shape: "cylinder",
                        radius: 0.16,
                        height: 3.2,
                        sides: 8,
                        material: "bark",
                        at: [-1.3, 0, -1.3],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [2.6, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.16,
                        height: 3.2,
                        sides: 8,
                        material: "bark",
                        at: [-1.3, 0, 1.3],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [2.6, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [3.2, 0.2, 3.2],
                        material: "planks",
                        at: [0, 3.2, 0],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "box",
                        size: [0.1, 0.5, 3.2],
                        material: "planks",
                        at: [-1.55, 3.4, 0],
                        bevelMetres: 0.01,
                        repeat: { mode: "line", count: 2, step: [3.1, 0, 0] },
                    },
                    ...stairFlight({
                        steps: 10,
                        widthMetres: 1.2,
                        riseMetres: 0.34,
                        treadMetres: 0.45,
                        material: "planks",
                        bevelMetres: 0.01,
                        at: [0, 0, 1.6 + 0.45 * 9.5],
                    }),
                ],
                extras: { role: "floor", wallRunnable: false, sockets: [] },
            },
        ],
    },
    {
        name: "SettlementMarket",
        themes: ["settlement"],
        textureSize: 512,
        trianglesPerModule: 3_000,
        materials: {
            planks: tiledMaterial("weathered_planks", 512),
            stone: tiledMaterial("medieval_blocks_02", 256, "#a1998b"),
            rope: tiledMaterial("hessian_230", 128, "#b89a5e"),
            paper: tiledMaterial("hessian_230", 128, "#e6dcc2"),
            awningRed: tiledMaterial("hessian_230", 256, "#9c3424"),
            awningCream: tiledMaterial("hessian_230", 256, "#e3d6b4"),
            awningBlue: tiledMaterial("hessian_230", 256, "#3d5878"),
            clothBlue: tiledMaterial("hessian_230", 128, "#3d5878"),
            clothRed: tiledMaterial("hessian_230", 128, "#9c3424"),
            clothCream: tiledMaterial("hessian_230", 128, "#e3d6b4"),
            herbs: tiledMaterial("forest_leaves_04", 128, "#5f7a3a"),
            fruitRed: tiledMaterial("medieval_blocks_02", 128, "#a3352b"),
            fruitGreen: tiledMaterial("medieval_blocks_02", 128, "#7f9a3c"),
            terracotta: tiledMaterial("medieval_blocks_02", 128, "#a45a3c"),
        },
        modules: [
            {
                name: "marketStall",
                parts: [
                    {
                        shape: "box",
                        size: [0.1, 2.2, 0.1],
                        material: "planks",
                        at: [-1.15, 0, 0.85],
                        bevelMetres: 0.01,
                        repeat: { mode: "line", count: 2, step: [2.3, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.1, 2.6, 0.1],
                        material: "planks",
                        at: [-1.15, 0, -0.75],
                        bevelMetres: 0.01,
                        repeat: { mode: "line", count: 2, step: [2.3, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [2.3, 0.86, 0.5],
                        material: "planks",
                        at: [0, 0, 0.55],
                        bevelMetres: 0.01,
                    },
                    {
                        shape: "box",
                        size: [2.45, 0.06, 0.62],
                        material: "planks",
                        at: [0, 0.86, 0.55],
                        bevelMetres: 0.01,
                    },
                    {
                        shape: "box",
                        size: [2.2, 0.05, 0.35],
                        material: "planks",
                        at: [0, 1.0, -0.6],
                        bevelMetres: 0.005,
                        repeat: { mode: "line", count: 2, step: [0, 0.55, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.33, 0.02, 1.98],
                        material: "awningRed",
                        at: [-1.14, 2.36, 0.08],
                        rotationDegrees: [13, 0, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 4, step: [0.66, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.33, 0.02, 1.98],
                        material: "awningCream",
                        at: [-0.81, 2.36, 0.08],
                        rotationDegrees: [13, 0, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 4, step: [0.66, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [2.64, 0.24, 0.02],
                        material: "awningRed",
                        at: [0, 1.9, 1.05],
                        bevelMetres: 0,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.045,
                        height: 0.28,
                        sides: 6,
                        material: "herbs",
                        at: [-0.9, 1.6, 0.9],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 5, step: [0.45, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.006,
                        height: 0.27,
                        sides: 4,
                        material: "rope",
                        at: [-0.9, 1.88, 0.9],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 5, step: [0.45, 0, 0] },
                    },
                ],
                extras: {
                    role: "prop",
                    wallRunnable: false,
                    sockets: [
                        ...[-0.75, 0, 0.75].map((x) => goodsSocket([x, 0.92, 0.55])),
                        ...[1.05, 1.6].flatMap((y) =>
                            [-0.55, 0.55].map((x) => goodsSocket([x, y, -0.6]))
                        ),
                    ],
                },
            },
            {
                name: "well",
                parts: [
                    {
                        shape: "lathe",
                        profile: [
                            [0.55, 0],
                            [0.78, 0],
                            [0.78, 0.78],
                            [0.72, 0.84],
                            [0.6, 0.84],
                            [0.55, 0.78],
                        ],
                        sides: 16,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.56,
                        height: 0.35,
                        sides: 16,
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0,
                    },
                    {
                        shape: "box",
                        size: [0.12, 2.1, 0.12],
                        material: "planks",
                        at: [-0.86, 0, 0],
                        bevelMetres: 0.01,
                        repeat: { mode: "line", count: 2, step: [1.72, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.05,
                        height: 1.9,
                        sides: 8,
                        material: "planks",
                        at: [0.95, 1.6, 0],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.012,
                        height: 0.42,
                        sides: 6,
                        material: "rope",
                        at: [0, 1.18, 0],
                        bevelMetres: 0,
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.12, 0],
                            [0.15, 0.22],
                            [0.13, 0.22],
                            [0.1, 0.03],
                            [0, 0.03],
                        ],
                        sides: 10,
                        material: "planks",
                        at: [0, 0.96, 0],
                        bevelMetres: 0,
                    },
                    ...pitchedRoof({
                        ridgeAt: [0, 2.35, 0],
                        lengthMetres: 2.1,
                        slopeMetres: 1.15,
                        pitchDegrees: 32,
                        thicknessMetres: 0.05,
                        material: "planks",
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "noticeBoard",
                parts: [
                    {
                        shape: "box",
                        size: [0.12, 2.25, 0.12],
                        material: "planks",
                        at: [-0.85, 0, 0],
                        bevelMetres: 0.01,
                        repeat: { mode: "line", count: 2, step: [1.7, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [1.62, 1.0, 0.06],
                        material: "planks",
                        at: [0, 0.9, 0],
                        bevelMetres: 0.01,
                    },
                    {
                        shape: "box",
                        size: [0.3, 0.4, 0.008],
                        material: "paper",
                        at: [-0.5, 1.4, 0.034],
                        rotationDegrees: [0, 0, 3],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 3, step: [0.5, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.36, 0.3, 0.008],
                        material: "paper",
                        at: [-0.25, 0.98, 0.034],
                        rotationDegrees: [0, 0, -4],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0.55, 0, 0] },
                    },
                    ...pitchedRoof({
                        ridgeAt: [0, 2.35, 0],
                        lengthMetres: 2,
                        slopeMetres: 0.42,
                        pitchDegrees: 28,
                        thicknessMetres: 0.04,
                        material: "planks",
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "produceCrate",
                parts: produceCrate("fruitRed"),
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "greensCrate",
                parts: produceCrate("fruitGreen"),
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "clothBolts",
                parts: [
                    ...(["clothRed", "clothBlue"] as const).map((material, index): KitPart => ({
                        shape: "cylinder",
                        radius: 0.07,
                        height: 0.5,
                        sides: 10,
                        material,
                        at: [0.25, 0.07, index * 0.15 - 0.075],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0,
                    })),
                    {
                        shape: "cylinder",
                        radius: 0.07,
                        height: 0.5,
                        sides: 10,
                        material: "clothCream",
                        at: [0.25, 0.19, 0],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0,
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "potStack",
                parts: [
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.08, 0],
                            [0.12, 0.08],
                            [0.11, 0.18],
                            [0.06, 0.24],
                            [0.07, 0.27],
                            [0, 0.27],
                        ],
                        sides: 10,
                        material: "terracotta",
                        at: [-0.13, 0, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0.26, 0, 0] },
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.05, 0],
                            [0.1, 0.06],
                            [0.09, 0.07],
                            [0, 0.03],
                        ],
                        sides: 10,
                        material: "terracotta",
                        at: [0, 0, 0.17],
                        bevelMetres: 0,
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "bunting",
                parts: [
                    ...hungSpan({
                        halfLengthMetres: 6,
                        heightMetres: 4.2,
                        sagMetres: 0.5,
                        postRadiusMetres: 0.07,
                        ropeRadiusMetres: 0.012,
                        postMaterial: "planks",
                        ropeMaterial: "rope",
                    }),
                    ...hangingAlongSpan({
                        halfLengthMetres: 6,
                        heightMetres: 4.2,
                        sagMetres: 0.5,
                        count: 17,
                        dropMetres: 0,
                        piece: (index) => ({
                            shape: "extrude",
                            profile: [
                                [-0.13, 0],
                                [0, -0.32],
                                [0.13, 0],
                            ],
                            depth: 0.01,
                            material: (["awningRed", "awningCream", "awningBlue"] as const)[
                                index % 3
                            ],
                            bevelMetres: 0,
                        }),
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "waterWheel",
                parts: [
                    {
                        shape: "lathe",
                        profile: [
                            [1.45, 0],
                            [1.6, 0],
                            [1.6, 0.08],
                            [1.45, 0.08],
                        ],
                        sides: 24,
                        material: "planks",
                        at: [-0.27, 1.45, 0],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0.62, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.66, 0.05, 0.45],
                        material: "planks",
                        at: [0, 1.45, 0],
                        bevelMetres: 0,
                        repeat: { mode: "ring", count: 12, radius: 1.6, axis: [1, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.07, 0.07, 1.5],
                        material: "planks",
                        at: [-0.31, 1.45, 0],
                        bevelMetres: 0,
                        repeat: { mode: "ring", count: 6, radius: 0.75, axis: [1, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.07, 0.07, 1.5],
                        material: "planks",
                        at: [0.31, 1.45, 0],
                        bevelMetres: 0,
                        repeat: { mode: "ring", count: 6, radius: 0.75, axis: [1, 0, 0] },
                    },
                    {
                        shape: "cylinder",
                        radius: 0.24,
                        height: 0.7,
                        sides: 12,
                        material: "planks",
                        at: [0.35, 1.45, 0],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.1,
                        height: 1.5,
                        sides: 10,
                        material: "planks",
                        at: [0.75, 1.45, 0],
                        rotationDegrees: [0, 0, 90],
                        bevelMetres: 0,
                    },
                    {
                        shape: "box",
                        size: [0.16, 1.4, 0.24],
                        material: "stone",
                        at: [-0.66, 0, 0],
                        bevelMetres: 0.02,
                        repeat: { mode: "line", count: 2, step: [1.32, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.56, 0.04, 3.2],
                        material: "planks",
                        at: [0, 3.12, -1.75],
                        bevelMetres: 0,
                    },
                    {
                        shape: "box",
                        size: [0.04, 0.26, 3.2],
                        material: "planks",
                        at: [-0.28, 3.12, -1.75],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0.56, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.12, 3.12, 0.12],
                        material: "planks",
                        at: [-0.3, 0, -1.6],
                        bevelMetres: 0.01,
                        repeat: {
                            mode: "grid",
                            count: [2, 2],
                            step: [
                                [0.6, 0, 0],
                                [0, 0, -1.6],
                            ],
                        },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
        ],
    },
    {
        name: "SettlementTeaHouse",
        themes: ["settlement"],
        textureSize: 1024,
        trianglesPerModule: 8_000,
        materials: {
            lacquer: KIT_MATERIALS.lacquerWood,
            tiles: KIT_MATERIALS.roofTiles,
            stone: KIT_MATERIALS.templeStone,
            paving: KIT_MATERIALS.templePaving,
            whitewash: { ...KIT_MATERIALS.templePaving, tint: "#e4ddcc" },
            paper: { ...KIT_MATERIALS.hessianCanvas, tint: "#ece4cf" },
            paperRed: { ...KIT_MATERIALS.hessianCanvas, tint: "#b0372a" },
            cushion: { ...KIT_MATERIALS.hessianCanvas, tint: "#7d2f2a" },
            rope: { ...KIT_MATERIALS.hessianCanvas, tint: "#b89a5e" },
            glaze: { ...KIT_MATERIALS.templePaving, tint: "#7fa38c" },
        },
        modules: [
            {
                name: "teaHouse",
                parts: [
                    {
                        shape: "box",
                        size: [6, 0.5, 6],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.03,
                        noise: { amplitudeMetres: 0.008, featureMetres: 0.3 },
                    },
                    {
                        shape: "box",
                        size: [2, 0.25, 0.6],
                        material: "stone",
                        at: [0, 0, 3.3],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.17,
                        height: 3.1,
                        sides: 12,
                        material: "lacquer",
                        at: [-2.4, 0.5, -2.4],
                        bevelMetres: 0,
                        repeat: {
                            mode: "grid",
                            count: [2, 2],
                            step: [
                                [4.8, 0, 0],
                                [0, 0, 4.8],
                            ],
                        },
                    },
                    {
                        shape: "box",
                        size: [4.6, 2.4, 0.06],
                        material: "paper",
                        at: [0, 0.5, -2.4],
                        bevelMetres: 0,
                    },
                    {
                        shape: "box",
                        size: [0.08, 2.4, 0.1],
                        material: "lacquer",
                        at: [-1.2, 0.5, -2.36],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 3, step: [1.2, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [5.04, 0.24, 0.24],
                        material: "lacquer",
                        at: [0, 3.1, -2.4],
                        bevelMetres: 0.015,
                        repeat: { mode: "line", count: 2, step: [0, 0, 4.8] },
                    },
                    {
                        shape: "box",
                        size: [0.24, 0.24, 5.04],
                        material: "lacquer",
                        at: [-2.4, 3.1, 0],
                        bevelMetres: 0.015,
                        repeat: { mode: "line", count: 2, step: [4.8, 0, 0] },
                    },
                    hipRoof({ at: [0, 2.85, 0], material: "tiles", scale: 1.15, rings: 4 }),
                    {
                        shape: "cylinder",
                        radius: 0.14,
                        height: 2.5,
                        sides: 12,
                        material: "lacquer",
                        at: [-1.8, 3.49, -1.8],
                        bevelMetres: 0,
                        repeat: {
                            mode: "grid",
                            count: [2, 2],
                            step: [
                                [3.6, 0, 0],
                                [0, 0, 3.6],
                            ],
                        },
                    },
                    {
                        shape: "box",
                        size: [3.46, 1.9, 0.06],
                        material: "paper",
                        at: [0, 3.49, -1.8],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0, 0, 3.6] },
                    },
                    {
                        shape: "box",
                        size: [0.06, 1.9, 3.46],
                        material: "paper",
                        at: [-1.8, 3.49, 0],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [3.6, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [3.5, 0.08, 0.1],
                        material: "lacquer",
                        at: [0, 4.4, -1.82],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0, 0, 3.64] },
                    },
                    {
                        shape: "box",
                        size: [3.9, 0.24, 0.24],
                        material: "lacquer",
                        at: [0, 5.99, -1.8],
                        bevelMetres: 0.015,
                        repeat: { mode: "line", count: 2, step: [0, 0, 3.6] },
                    },
                    hipRoof({ at: [0, 6.2, 0], material: "tiles", scale: 0.95 }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "lowTable",
                parts: [
                    {
                        shape: "box",
                        size: [0.07, 0.38, 0.07],
                        material: "lacquer",
                        at: [-0.5, 0, -0.26],
                        bevelMetres: 0.005,
                        repeat: {
                            mode: "grid",
                            count: [2, 2],
                            step: [
                                [1, 0, 0],
                                [0, 0, 0.52],
                            ],
                        },
                    },
                    {
                        shape: "box",
                        size: [1.2, 0.05, 0.7],
                        material: "lacquer",
                        at: [0, 0.38, 0],
                        bevelMetres: 0.01,
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.07, 0],
                            [0.1, 0.06],
                            [0.09, 0.12],
                            [0.04, 0.15],
                            [0.03, 0.18],
                            [0, 0.18],
                        ],
                        sides: 12,
                        material: "glaze",
                        at: [0, 0.43, 0],
                        bevelMetres: 0,
                    },
                    {
                        shape: "lathe",
                        profile: [
                            [0, 0],
                            [0.03, 0],
                            [0.045, 0.05],
                            [0, 0.05],
                        ],
                        sides: 10,
                        material: "glaze",
                        at: [-0.3, 0.43, 0.12],
                        bevelMetres: 0,
                        repeat: { mode: "line", count: 2, step: [0.6, 0, 0] },
                    },
                    {
                        shape: "box",
                        size: [0.5, 0.1, 0.5],
                        material: "cushion",
                        at: [0, 0, 0.75],
                        bevelMetres: 0.03,
                        repeat: { mode: "line", count: 2, step: [0, 0, -1.5] },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "lanternString",
                parts: [
                    ...hungSpan({
                        halfLengthMetres: 3,
                        heightMetres: 3.2,
                        sagMetres: 0.4,
                        postRadiusMetres: 0.08,
                        ropeRadiusMetres: 0.012,
                        postMaterial: "lacquer",
                        ropeMaterial: "rope",
                    }),
                    ...hangingAlongSpan({
                        halfLengthMetres: 3,
                        heightMetres: 3.2,
                        sagMetres: 0.4,
                        count: 5,
                        dropMetres: 0.42,
                        piece: () => ({
                            shape: "lathe",
                            profile: PAPER_LANTERN_PROFILE,
                            sides: 10,
                            material: "paperRed",
                            bevelMetres: 0,
                        }),
                    }),
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
            {
                name: "lanternPost",
                parts: [
                    {
                        shape: "box",
                        size: [0.3, 0.2, 0.3],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "box",
                        size: [0.12, 2.3, 0.12],
                        material: "lacquer",
                        at: [0, 0.2, 0],
                        bevelMetres: 0.01,
                    },
                    {
                        shape: "box",
                        size: [0.7, 0.08, 0.08],
                        material: "lacquer",
                        at: [0.3, 2.3, 0],
                        bevelMetres: 0.01,
                    },
                    {
                        shape: "cylinder",
                        radius: 0.01,
                        height: 0.1,
                        sides: 6,
                        material: "rope",
                        at: [0.55, 2.2, 0],
                        bevelMetres: 0,
                    },
                    {
                        shape: "lathe",
                        profile: PAPER_LANTERN_PROFILE,
                        sides: 10,
                        material: "paperRed",
                        at: [0.55, 1.84, 0],
                        bevelMetres: 0,
                    },
                ],
                extras: {
                    role: "prop",
                    wallRunnable: false,
                    sockets: [{ name: "light", at: [0.55, 2.0, 0] }],
                },
            },
            {
                name: "courtyardWall",
                parts: [
                    {
                        shape: "box",
                        size: [4.1, 0.4, 0.55],
                        material: "stone",
                        at: [0, 0, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.006, featureMetres: 0.2 },
                    },
                    {
                        shape: "box",
                        size: [4, 1.5, 0.4],
                        material: "whitewash",
                        at: [0, 0.4, 0],
                        bevelMetres: 0.02,
                    },
                    {
                        shape: "extrude",
                        profile: [
                            [-0.4, 0],
                            [0.4, 0],
                            [0.36, 0.1],
                            [0, 0.28],
                            [-0.36, 0.1],
                        ],
                        depth: 4.3,
                        material: "tiles",
                        at: [0, 1.9, 0],
                        rotationDegrees: [0, 90, 0],
                        bevelMetres: 0,
                    },
                ],
                extras: { role: "wall", wallRunnable: false, sockets: [] },
            },
            {
                name: "paving",
                parts: [
                    {
                        shape: "box",
                        size: [4.4, 0.12, 4.4],
                        material: "paving",
                        at: [0, 0, 0],
                        bevelMetres: 0.02,
                        noise: { amplitudeMetres: 0.004, featureMetres: 0.2 },
                    },
                ],
                extras: { role: "prop", wallRunnable: false, sockets: [] },
            },
        ],
    },
    houseKit("SettlementHouses", ["settlement"], SETTLEMENT_HOUSES, 512, {}, [
        SETTLEMENT_PERCH,
        ...YARD_GOODS,
        ...TOWN_GOODS,
        ...CLIMB_STONES,
    ]),
    houseKit("WoodlandBuildings", ["woodland"], WOODLAND_BUILDINGS, 512, {}, [
        WOODLAND_PERCH,
        PALISADE,
        ...YARD_GOODS,
        ...CLIMB_STONES,
    ]),
    houseKit(
        "RuinsBuildings",
        ["ruins"],
        RUINED_BUILDINGS,
        512,
        {
            stone: { tint: "#8b887f" },
            timber: { tint: "#3e3128" },
            lacquer: { tint: "#5a2a22" },
        },
        [PALISADE, ...ARMS_GOODS, ...RUINS_GOODS, ...CLIMB_STONES, RUINS_PERCH]
    ),
    houseKit(
        "HighlandsBuildings",
        ["highlands"],
        HIGHLAND_BUILDINGS,
        512,
        { stone: { tint: "#9b988f" } },
        [
            PALISADE,
            ...YARD_GOODS,
            ...ARMS_GOODS,
            ...HIGHLAND_GOODS,
            ...CLIMB_STONES,
            HIGHLANDS_PERCH,
        ]
    ),
];

export type CharacterJoints = Record<string, Vector3Tuple>;

export type CharacterRole = keyof typeof CHARACTER_ROLE_DEFAULTS;

interface IConfirmedJoints {
    sourceSha256: string;
    positions: CharacterJoints;
}

interface ICharacterBudget {
    triangles: number;
    textureSize: number;
}

interface IAlbedoGrade {
    saturationScale: number;
    valueExponent: number;
}

interface IRigidProp {
    segmentedParts: readonly number[];
    name?: string;
    bone?: string;
}

interface IBodyOverride {
    exclude?: true;
    attachBone?: string;
    segmentedParts?: readonly number[];
    clothSeed?: Vector3Tuple;
    columns?: number;
    rows?: number;
    feel?: Partial<IClothTuning>;
}

interface ICharacterReferences {
    riggedModel: string;
    segmentedModel: string;
    jointsFromRiggedModel: readonly string[];
}

interface ICharacterRecipe {
    name: string;
    role: CharacterRole;
    source: string;
    skeleton: SkeletonName;
    fit: { facingYawDegrees: number; heightMetres: number };
    budget?: Partial<ICharacterBudget>;
    albedoGrade?: IAlbedoGrade;
    tuning?: DeepPartial<IPipelineTuning>;
    props?: readonly IRigidProp[];
    overrides?: Record<string, IBodyOverride>;
    references: ICharacterReferences;
    joints?: IConfirmedJoints;
}

interface ISourcePatch {
    regionMetres: IBoundsMetres;
    facing: Vector3Tuple;
    offsetMetres: Vector3Tuple;
    thicknessMetres: number;
}

interface IImportedRecipe {
    name: string;
    source: string;
    objects: readonly string[] | typeof ALL_MESHES;
    facingYawDegrees: number;
    triangles: number;
    textureSize: number;
    tuning?: DeepPartial<ISharedTuning>;
    patches?: readonly ISourcePatch[];
}

interface ISculptRecipe extends IImportedRecipe {
    themes: readonly ThemeId[];
    heightMetres: number;
    embedOnly: boolean;
    sockets?: readonly IKitSocket[];
}

interface IScanRecipe extends ISculptRecipe {
    sharedMaterial: SharedMaterial;
}

interface IResolvedBuildBase<TTuning> {
    name: string;
    triangles: number;
    textureSize: number;
    tuning: TTuning;
    referenceHeightMetres: number;
    heightMetres: number | null;
    extras: Readonly<Partial<IStaticPieceExtras>>;
    bakes: boolean;
    propScale: number;
    themes: readonly ThemeId[];
}

type IStaticRecipe = IResolvedBuildBase<ISharedTuning>;

export interface IResolvedImportedRecipe extends IStaticRecipe {
    source: string;
    objects: readonly string[] | null;
    facingYawDegrees: number;
    patches: readonly ISourcePatch[];
}

interface IResolvedWeaponRecipe extends IResolvedImportedRecipe {
    kind: "weapon";
    heightMetres: null;
}

export interface IResolvedSculptRecipe extends IResolvedImportedRecipe {
    kind: "sculpt";
    heightMetres: number;
    extras: Readonly<IStaticPieceExtras>;
}

export interface IResolvedScanRecipe extends Omit<IResolvedSculptRecipe, "kind"> {
    kind: "scan";
    sharedMaterial: SharedMaterial;
}

interface IKitNoise {
    amplitudeMetres: number;
    featureMetres: number;
}

interface IKitSag {
    metres: number;
    segments: number;
}

interface IKitJitter {
    scale: Vector3Tuple;
    yawDegrees: number;
}

interface IPathFrame {
    point: Vector3;
    side: Vector3;
    miter: number;
}

interface IKitFlare {
    liftMetres: number;
    segmentsPerSide: number;
    power: number;
}

interface IKitCourses {
    spacingMetres: number;
    radiusMetres: number;
    sides: number;
    surface: Vector2Tuple;
}

type KitRepeat = (
    | { mode: "ring"; count: number; radius: number; axis?: Vector3Tuple }
    | { mode: "line"; count: number; step: Vector3Tuple }
    | { mode: "grid"; count: Vector2Tuple; step: readonly [Vector3Tuple, Vector3Tuple] }
) & { jitter?: IKitJitter };

type KitShape =
    | { shape: "box"; size: Vector3Tuple; sag?: IKitSag }
    | { shape: "cylinder"; radius: number; height: number; sides: number }
    | { shape: "extrude"; profile: readonly Vector2Tuple[]; depth: number }
    | {
          shape: "lathe";
          profile: readonly Vector2Tuple[];
          sides: number;
          flare?: IKitFlare;
          courses?: IKitCourses;
      }
    | {
          shape: "sweep";
          profile: readonly Vector2Tuple[];
          path: readonly Vector3Tuple[];
          closed?: boolean;
          courses?: IKitCourses;
      }
    | { shape: "card"; size: Vector2Tuple };

type KitSweep =
    | { sweep: "extrude"; profile: readonly Vector2Tuple[]; depth: number; sag: IKitSag | null }
    | { sweep: "lathe"; profile: readonly Vector2Tuple[]; sides: number; sag: null }
    | { sweep: "loft"; rings: readonly Vector3Tuple[][]; closed: boolean; sag: null }
    | { sweep: "card"; size: Vector2Tuple; sag: null };

type KitPart = KitShape & {
    material: string;
    at: Vector3Tuple;
    rotationDegrees?: Vector3Tuple;
    bevelMetres: number;
    noise?: IKitNoise;
    repeat?: KitRepeat;
};

type ResolvedKitPart = KitSweep & {
    material: string;
    bevelMetres: number;
    noise: IKitNoise | null;
    transforms: readonly Matrix4Tuple[];
};

interface IKitModule {
    name: string;
    parts: readonly KitPart[];
    extras: IKitModuleExtras;
}

type KitMaterial =
    | {
          kind: "baked";
          texture: string;
          reliefMetres: number;
          tileScale: number;
          macroVariation: number;
          tint?: string;
      }
    | { kind: "cutout"; image: string; alphaCutoff: number }
    | { kind: "tiled"; texture: string; tileScale: number; resolution: number; tint?: string };

interface IKitRecipe {
    name: string;
    themes: readonly ThemeId[];
    textureSize: number;
    trianglesPerModule: number;
    sharedMaterial?: SharedMaterial;
    materials: Record<string, KitMaterial>;
    modules: readonly IKitModule[];
    tuning?: DeepPartial<IKitTuning>;
}

export interface IBoundsMetres {
    min: Vector3Tuple;
    max: Vector3Tuple;
}

type ResolvedKitMaterial =
    | {
          kind: "baked";
          texture: string;
          albedo: string;
          height: string;
          info: string;
          reliefMetres: number;
          tileScale: number;
          macroVariation: number;
          tint: string | null;
      }
    | { kind: "cutout"; image: string; alphaCutoff: number }
    | {
          kind: "tiled";
          texture: string;
          albedo: string;
          normal: string;
          info: string;
          imageStem: string;
          normalStem: string;
          tileScale: number;
          resolution: number;
          tint: string | null;
      };

interface IResolvedKitModule {
    name: string;
    noiseSeed: number;
    parts: readonly ResolvedKitPart[];
    extras: IKitModuleExtras;
    boundsMetres: IBoundsMetres;
    partBoundsMetres: readonly IKitPartBounds[];
    minimumTriangles: number;
}

export interface IKitPartBounds extends IBoundsMetres {
    material: string;
}

export interface IResolvedKitRecipe extends IStaticRecipe {
    kind: "kit";
    trianglesPerModule: number;
    heightMetres: number;
    tuning: IKitTuning;
    materials: Record<string, ResolvedKitMaterial>;
    modules: readonly IResolvedKitModule[];
    sharedMaterial: SharedMaterial | null;
    sway: { attribute: string; materials: readonly string[] };
}

export interface IResolvedCharacterRecipe extends IResolvedBuildBase<IPipelineTuning> {
    kind: "character";
    role: CharacterRole;
    source: string;
    skeleton: string;
    skeletonDescriptor: ISkeletonDescriptor;
    clipLibraries: readonly string[];
    facingYawDegrees: number;
    heightMetres: number;
    albedoGrade: IAlbedoGrade;
    props: readonly IRigidProp[];
    overrides: Record<string, IBodyOverride>;
    references: ICharacterReferences;
    joints: IConfirmedJoints | null;
}

type KindCategoryOptions = Omit<IAssetCategoryOptions, "kind">;

type BuildRecipe =
    | IResolvedCharacterRecipe
    | IResolvedSculptRecipe
    | IResolvedScanRecipe
    | IResolvedWeaponRecipe
    | IResolvedKitRecipe;

export type AssetKind = BuildRecipe["kind"];

export type RecipeOf<TKind extends AssetKind> = Extract<BuildRecipe, { kind: TKind }>;

interface IHouseStorey {
    heightMetres: number;
    wall: "stone" | "timber" | "plank" | "log" | "wattle" | "lacquer";
    jettyMetres: number;
    windows: readonly [front: number, side: number, back: number];
    door: boolean;
}

interface IPerchDesign {
    legs: "posts" | "block";
    legMaterial: string;
    floorMaterial: string;
    roofMaterial: string | null;
}

interface IHouseDesign {
    widthMetres: number;
    depthMetres: number;
    plinthMetres: number;
    storeys: readonly IHouseStorey[];
    roof: {
        form: "gable" | "hip";
        ridge: "across" | "along";
        pitchDegrees: number;
        overhangMetres: number;
        material: "tiles" | "slate" | "thatch" | "shingle" | "turf" | "greyTiles";
    };
    plaster: string;
    shutters: string;
    chimneys: readonly Vector2Tuple[];
    sign: boolean;
    flowerBoxes: boolean;
    roosts?: boolean;
    doorMetres?: Vector2Tuple;
    foundation: "plinth" | "stepped" | "stilts";
    condition: "fresh" | "worn" | "ruined";
}

interface IWallFace {
    lengthMetres: number;
    centreMetres: number;
    plane: number;
    base: number;
    storey: IHouseStorey;
    windows: number;
    door: boolean;
    design: IHouseDesign;
    courseShift: number;
    isRuined: boolean;
    nextRandom: RandomSource;
}

interface IHouseRow {
    name: string;
    design: IHouseDesign;
}

abstract class AssetKindDefinition<TRecipe extends BuildRecipe> {
    private static readonly PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

    protected static readonly CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

    protected static readonly fromGameAssets = (file: string): string =>
        path.join(PIPELINE_CONFIG.gameAssetsRoot, file);

    abstract readonly kind: TRecipe["kind"];
    abstract readonly category: KindCategoryOptions;
    protected abstract readonly stages: readonly BuildStage<TRecipe>[];
    protected abstract readonly validation: ValidationStage<TRecipe, unknown>;
    private builtPipeline: AssetBuildPipeline<TRecipe> | null = null;

    get pipeline(): AssetBuildPipeline<TRecipe> {
        this.builtPipeline ??= new AssetBuildPipeline(
            path.join(PIPELINE_CONFIG.builds.workRoot, this.kind),
            this.stages,
            this.validation
        );
        return this.builtPipeline;
    }

    private resolvedRecipes: readonly TRecipe[] | null = null;

    private recipesByName: ReadonlyMap<string, TRecipe> | null = null;

    protected abstract resolveRecipes(): readonly TRecipe[];

    recipes(): readonly TRecipe[] {
        this.resolvedRecipes ??= this.resolveRecipes();
        return this.resolvedRecipes;
    }

    async prepare(_recipe: TRecipe): Promise<void> {}

    find(name: string): TRecipe | undefined {
        if (!this.recipesByName) {
            const byName = new Map<string, TRecipe>();
            for (const recipe of this.recipes()) {
                if (!AssetKindDefinition.PASCAL_CASE.test(recipe.name) || byName.has(recipe.name))
                    throw new Error(
                        `${recipe.name}: recipe names are unique PascalCase, so file names split on "_" find their owner`
                    );
                byName.set(recipe.name, recipe);
            }
            this.recipesByName = byName;
        }
        return this.recipesByName.get(name);
    }

    findOwningFile(fileName: string): TRecipe | undefined {
        const stemEnd = fileName.indexOf("_");
        return stemEnd < 0 ? undefined : this.find(fileName.slice(0, stemEnd));
    }

    moduleNamesOf(_name: string): readonly string[] {
        return [];
    }

    assertReady(recipe: TRecipe): void {
        if (!AssetKindDefinition.PASCAL_CASE.test(recipe.name))
            throw new Error(
                `${this.kind} name ${recipe.name} must be PascalCase letters and digits`
            );
        this.checkReady(recipe);
    }

    protected static assertStaticBudget<TTuning extends ISharedTuning>(
        recipe: IResolvedBuildBase<TTuning>,
        layer: TuningLayer<TTuning>
    ): void {
        layer.assert(recipe.name, recipe.tuning);
        if (!(Number.isInteger(recipe.triangles) && recipe.triangles > 0))
            throw new Error(`${recipe.name}: triangles must be a whole number above 0`);
        if (!(Number.isInteger(Math.log2(recipe.textureSize)) && recipe.textureSize > 0))
            throw new Error(
                `${recipe.name}: textureSize ${recipe.textureSize} must be a power of two`
            );
    }

    protected static resolveBase<TTuning, THeight extends number | null>(
        recipe: {
            name: string;
            triangles: number;
            textureSize: number;
            themes?: readonly ThemeId[];
        },
        build: { tuning: TTuning; heightMetres: THeight; bakes: boolean; propScale: number }
    ): IResolvedBuildBase<TTuning> & { heightMetres: THeight } {
        return {
            name: recipe.name,
            triangles: recipe.triangles,
            textureSize: recipe.textureSize,
            tuning: build.tuning,
            referenceHeightMetres: SCALE.humanHeightMetres,
            heightMetres: build.heightMetres,
            extras: {},
            bakes: build.bakes,
            propScale: build.propScale,
            themes: recipe.themes ?? [],
        };
    }

    protected abstract checkReady(recipe: TRecipe): void;
}

class CharacterKind extends AssetKindDefinition<IResolvedCharacterRecipe> {
    private static readonly SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

    private static readonly MINIMUM_LATTICE_SIZE = 2;

    private static readonly SKELETON = {
        ual: {
            file: sourcePathOf(PLAYER_ASSETS.clipLibraries.base),
            clipLibraries: PLAYER_ASSETS.clipLibraryPaths.map(sourcePathOf),
        },
    } as const satisfies Record<SkeletonName, { file: string; clipLibraries: readonly string[] }>;

    private static readonly NEUTRAL_ALBEDO_GRADE: IAlbedoGrade = {
        saturationScale: 1,
        valueExponent: 1,
    };

    private static readonly ALBEDO_GRADE_RANGE = { minimum: 0.3, maximum: 1.5 };

    readonly kind = "character";
    readonly category = {
        name: "characters",
        budgetMegabytes: 32,
        triangleBudget: Math.max(
            ...Object.values(CHARACTER_ROLE_DEFAULTS).map((budget) => budget.triangles)
        ),
        compressesGeometry: false,
        fileBudgetsMegabytes: { [path.basename(CLIP_BAKE_FILES.output)]: 6 },
        unitScale: SCALE.unitsPerMetre,
        importsStagingFolders: true,
    };
    protected readonly stages = [
        new BlenderStage<IResolvedCharacterRecipe>("prepare"),
        new BlenderStage<IResolvedCharacterRecipe>("unwrap"),
        new BlenderStage<IResolvedCharacterRecipe>("bake"),
        new BlenderStage<IResolvedCharacterRecipe>("thickness"),
        new SkeletonStage(),
        new BlenderStage<IResolvedCharacterRecipe>("joints"),
        new BlenderStage<IResolvedCharacterRecipe>("skinned-closeups"),
        new BlenderStage<IResolvedCharacterRecipe>("masks"),
        new BlenderStage<IResolvedCharacterRecipe>("physics"),
        new BlenderStage<IResolvedCharacterRecipe>("rig"),
        new BlenderStage<IResolvedCharacterRecipe>("bones"),
        new BlenderStage<IResolvedCharacterRecipe>("weights"),
        new BlenderStage<IResolvedCharacterRecipe>("skinned-export"),
        new AssembleGlbStage(),
    ];
    protected readonly validation = new ValidationStage("anim", new CharacterValidator());

    protected resolveRecipes(): readonly IResolvedCharacterRecipe[] {
        return CHARACTER_RECIPES.map(CharacterKind.resolveCharacter);
    }

    protected checkReady(recipe: IResolvedCharacterRecipe): void {
        assertExists(recipe.source, `${recipe.name}: source model not found: ${recipe.source}`);
        assertExists(recipe.skeleton, `${recipe.name}: skeleton not found: ${recipe.skeleton}`);
        for (const reference of [recipe.references.riggedModel, recipe.references.segmentedModel])
            assertExists(reference, `${recipe.name}: reference model not found: ${reference}`);
        CharacterKind.assertBonesExist(recipe);
        CHARACTER_TUNING_LAYER.assert(recipe.name, recipe.tuning);
        CharacterKind.assertAlbedoGrade(recipe);
        CharacterKind.assertOverrides(recipe);
        CharacterKind.assertJointsMatchSource(recipe);
    }

    private static resolveCharacter(recipe: ICharacterRecipe): IResolvedCharacterRecipe {
        const budget = { ...CHARACTER_ROLE_DEFAULTS[recipe.role], ...recipe.budget };
        return {
            kind: "character",
            ...AssetKindDefinition.resolveBase(
                { name: recipe.name, ...budget },
                {
                    tuning: CHARACTER_TUNING_LAYER.resolve(ROLE_TUNING[recipe.role], recipe.tuning),
                    heightMetres: recipe.fit.heightMetres,
                    bakes: true,
                    propScale: 1,
                }
            ),
            role: recipe.role,
            source: AssetKindDefinition.fromGameAssets(recipe.source),
            skeleton: CharacterKind.SKELETON[recipe.skeleton].file,
            skeletonDescriptor: SKELETONS[recipe.skeleton],
            clipLibraries: CharacterKind.SKELETON[recipe.skeleton].clipLibraries,
            facingYawDegrees: recipe.fit.facingYawDegrees,
            albedoGrade: recipe.albedoGrade ?? CharacterKind.NEUTRAL_ALBEDO_GRADE,
            props: recipe.props ?? [],
            overrides: recipe.overrides ?? {},
            references: {
                riggedModel: AssetKindDefinition.fromGameAssets(recipe.references.riggedModel),
                segmentedModel: AssetKindDefinition.fromGameAssets(
                    recipe.references.segmentedModel
                ),
                jointsFromRiggedModel: recipe.references.jointsFromRiggedModel,
            },
            joints: recipe.joints ?? null,
        };
    }

    private static assertBonesExist(recipe: IResolvedCharacterRecipe): void {
        const skeleton = recipe.skeletonDescriptor;
        const known = new Set<string>([...skeleton.measuredJoints, ...skeleton.rig.coreBones]);
        known.delete(skeleton.bones.headTop);
        const requireBone = (field: string, bone: string): void => {
            if (!known.has(bone))
                throw new Error(
                    `${recipe.name}: ${field} ${bone} is not a bone of skeleton ${recipe.skeleton}`
                );
        };
        for (const bone of recipe.references.jointsFromRiggedModel)
            requireBone("references.jointsFromRiggedModel", bone);
        for (const prop of recipe.props)
            if (prop.bone) requireBone(`prop ${prop.name ?? prop.segmentedParts} bone`, prop.bone);
        for (const [name, override] of Object.entries(recipe.overrides))
            if (override.attachBone)
                requireBone(`override ${name} attachBone`, override.attachBone);
        if (!recipe.joints) return;
        const confirmed = Object.keys(recipe.joints.positions).sort().join(",");
        if (confirmed !== [...skeleton.measuredJoints].sort().join(","))
            throw new Error(
                `${recipe.name}: confirmed joints ${confirmed} differ from the skeleton's measured joints`
            );
    }

    private static assertAlbedoGrade(recipe: IResolvedCharacterRecipe): void {
        for (const [key, value] of Object.entries(recipe.albedoGrade))
            if (!(
                value >= CharacterKind.ALBEDO_GRADE_RANGE.minimum &&
                value <= CharacterKind.ALBEDO_GRADE_RANGE.maximum
            ))
                throw new Error(
                    `${recipe.name}: albedoGrade.${key} ${value} is outside ${CharacterKind.ALBEDO_GRADE_RANGE.minimum} to ${CharacterKind.ALBEDO_GRADE_RANGE.maximum}`
                );
    }

    private static assertOverrides(recipe: IResolvedCharacterRecipe): void {
        for (const [name, override] of Object.entries(recipe.overrides)) {
            if (!AssetKindDefinition.CAMEL_CASE.test(name) && !CharacterKind.SNAKE_CASE.test(name))
                throw new Error(`${recipe.name}: override name ${name} is not a body name`);
            if (override.segmentedParts?.length && override.clothSeed)
                throw new Error(
                    `${recipe.name}: override ${name} has both segmentedParts and clothSeed`
                );
            if (override.segmentedParts?.length && (override.columns || override.rows))
                throw new Error(
                    `${recipe.name}: override ${name} is a garment; its lattice is sized by physics.nodeSpacing, not columns/rows`
                );
            if (override.clothSeed && !override.clothSeed.every(Number.isFinite))
                throw new Error(`${recipe.name}: override ${name} has a non-finite clothSeed`);
            for (const [field, value] of [
                ["columns", override.columns],
                ["rows", override.rows],
            ] as const)
                if (
                    value !== undefined &&
                    (!Number.isInteger(value) || value < CharacterKind.MINIMUM_LATTICE_SIZE)
                )
                    throw new Error(
                        `${recipe.name}: override ${name} ${field} must be a whole number of at least ${CharacterKind.MINIMUM_LATTICE_SIZE}`
                    );
        }
        for (const prop of recipe.props)
            if (!prop.segmentedParts.length)
                throw new Error(`${recipe.name}: a prop needs at least one segmented part`);
    }

    private static assertJointsMatchSource(recipe: IResolvedCharacterRecipe): void {
        if (!recipe.joints) return;
        const sourceSha256 = createHash("sha256")
            .update(fs.readFileSync(recipe.source))
            .digest("hex");
        if (sourceSha256 !== recipe.joints.sourceSha256)
            throw new Error(
                `${recipe.name}: the source model changed since its joints were confirmed ` +
                    `(sha256 ${sourceSha256}); remove its joints from tools/assets/AssetManifest.ts, ` +
                    "rebuild, check them against the character and add them again"
            );
    }
}

abstract class ImportedKind<
    TRecipe extends IResolvedImportedRecipe & BuildRecipe,
> extends AssetKindDefinition<TRecipe> {
    protected checkReady(recipe: TRecipe): void {
        assertExists(recipe.source, `${recipe.name}: source model not found: ${recipe.source}`);
        AssetKindDefinition.assertStaticBudget(recipe, SHARED_TUNING_LAYER);
        if (recipe.heightMetres !== null && !(recipe.heightMetres > 0))
            throw new Error(`${recipe.name}: heightMetres must be above 0`);
        if (recipe.objects?.length === 0)
            throw new Error(
                `${recipe.name}: objects must name at least one mesh or be ${ALL_MESHES}`
            );
        for (const patch of recipe.patches)
            if (
                !patch.regionMetres.min.every(
                    (value, axis) => value < patch.regionMetres.max[axis]
                ) ||
                !(patch.thicknessMetres > 0) ||
                new Vector3(...patch.facing).length() === 0
            )
                throw new Error(
                    `${recipe.name}: a patch needs a region with min below max, a positive thickness and a facing direction`
                );
    }

    protected static resolveImported<THeight extends number | null>(
        recipe: IImportedRecipe,
        build: { heightMetres: THeight; bakes: boolean; propScale: number }
    ): IResolvedImportedRecipe & { heightMetres: THeight } {
        return {
            ...AssetKindDefinition.resolveBase(recipe, {
                ...build,
                tuning: SHARED_TUNING_LAYER.resolve(recipe.tuning),
            }),
            source: AssetKindDefinition.fromGameAssets(recipe.source),
            objects: recipe.objects === ALL_MESHES ? null : recipe.objects,
            facingYawDegrees: recipe.facingYawDegrees,
            patches: recipe.patches ?? [],
        };
    }
}

class SculptKind extends ImportedKind<IResolvedSculptRecipe> {
    readonly kind = "sculpt";
    readonly category = {
        name: "sculpts",
        budgetMegabytes: 20,
        budgetPerTheme: true,
        unitScale: SCALE.unitsPerMetre,
        farVersion: PIPELINE_CONFIG.farVersion,
    };
    protected readonly stages = [
        new BlenderStage<IResolvedSculptRecipe>("import"),
        new BlenderStage<IResolvedSculptRecipe>("decimate"),
        new BlenderStage<IResolvedSculptRecipe>("unwrap"),
        new BlenderStage<IResolvedSculptRecipe>("bake"),
        new BlenderStage<IResolvedSculptRecipe>("export"),
    ];
    protected readonly validation = new ValidationStage("closeups", new SculptValidator());

    protected resolveRecipes(): readonly IResolvedSculptRecipe[] {
        return SCULPT_RECIPES.map(SculptKind.resolveSculpt);
    }

    static resolveSculpt(recipe: ISculptRecipe): IResolvedSculptRecipe {
        return {
            kind: "sculpt",
            ...ImportedKind.resolveImported(recipe, {
                heightMetres: recipe.heightMetres,
                bakes: true,
                propScale: PROP_SCALE,
            }),
            extras: { embedOnly: recipe.embedOnly, sockets: recipe.sockets ?? [] },
        };
    }
}

class ScanKind extends ImportedKind<IResolvedScanRecipe> {
    readonly kind = "scan";
    readonly category = {
        name: "scans",
        budgetMegabytes: 6,
        unitScale: SCALE.unitsPerMetre,
        farVersion: { ...PIPELINE_CONFIG.farVersion, errorMetres: 0.08, minimumHeightMetres: 0 },
    };
    protected readonly stages = [
        new BlenderStage<IResolvedScanRecipe>("import"),
        new BlenderStage<IResolvedScanRecipe>("decimate"),
        new BlenderStage<IResolvedScanRecipe>("unwrap"),
        new BlenderStage<IResolvedScanRecipe>("bake"),
        new BlenderStage<IResolvedScanRecipe>("shared-material"),
        new BlenderStage<IResolvedScanRecipe>("export"),
    ];
    protected readonly validation = new ValidationStage("closeups", new ScanValidator());

    protected resolveRecipes(): readonly IResolvedScanRecipe[] {
        return SCAN_RECIPES.map(ScanKind.resolveScan);
    }

    private static resolveScan(recipe: IScanRecipe): IResolvedScanRecipe {
        return {
            ...SculptKind.resolveSculpt(recipe),
            kind: "scan",
            sharedMaterial: recipe.sharedMaterial,
        };
    }
}

class WeaponKind extends ImportedKind<IResolvedWeaponRecipe> {
    readonly kind = "weapon";
    readonly category = {
        name: "weapons",
        budgetMegabytes: 6,
        triangleBudget: 15_000,
        keepSourceTextures: true,
    };
    protected readonly stages = [
        new BlenderStage<IResolvedWeaponRecipe>("import"),
        new BlenderStage<IResolvedWeaponRecipe>("align"),
        new BlenderStage<IResolvedWeaponRecipe>("decimate"),
        new BlenderStage<IResolvedWeaponRecipe>("export"),
    ];
    protected readonly validation = new ValidationStage(
        "closeups",
        new ModelValidator<IResolvedWeaponRecipe>()
    );

    protected resolveRecipes(): readonly IResolvedWeaponRecipe[] {
        return WEAPON_RECIPES.map(WeaponKind.resolveWeapon);
    }

    private static resolveWeapon(recipe: IImportedRecipe): IResolvedWeaponRecipe {
        return {
            kind: "weapon",
            ...ImportedKind.resolveImported(recipe, {
                heightMetres: null,
                bakes: false,
                propScale: 1,
            }),
        };
    }
}

class KitKind extends AssetKindDefinition<IResolvedKitRecipe> {
    readonly kind = "kit";
    readonly category = {
        name: "kits",
        budgetMegabytes: 14,
        budgetPerTheme: true,
        unitScale: SCALE.unitsPerMetre,
    };
    protected readonly stages = [
        new BlenderStage<IResolvedKitRecipe>("generate"),
        new BlenderStage<IResolvedKitRecipe>("modules"),
        new BlenderStage<IResolvedKitRecipe>("unwrap"),
        new BlenderStage<IResolvedKitRecipe>("bake"),
        new BlenderStage<IResolvedKitRecipe>("module-export"),
    ];
    protected readonly validation = new ValidationStage("module-closeups", new KitValidator());

    protected resolveRecipes(): readonly IResolvedKitRecipe[] {
        return KIT_RECIPES.map(KitKind.resolveKit);
    }

    moduleNamesOf(name: string): readonly string[] {
        return this.find(name)?.modules.map((kitModule) => kitModule.name) ?? [];
    }

    protected checkReady(recipe: IResolvedKitRecipe): void {
        AssetKindDefinition.assertStaticBudget(recipe, KIT_TUNING_LAYER);
        const materialKinds = new Set(Object.values(recipe.materials).map(({ kind }) => kind));
        if (materialKinds.size !== 1)
            throw new Error(
                `${recipe.name}: a kit's materials are all baked, all tiled or all cutout; join mixed pieces as two kits through sockets`
            );
        for (const [slot, material] of Object.entries(recipe.materials)) {
            const files =
                material.kind === "baked"
                    ? [material.albedo, material.height, material.info]
                    : material.kind === "tiled"
                      ? [material.albedo, material.normal, material.info]
                      : [material.image];
            for (const file of files)
                assertExists(file, `${recipe.name}: material ${slot} needs ${file}`);
            if (
                material.kind === "cutout" &&
                !(material.alphaCutoff > 0 && material.alphaCutoff < 1)
            )
                throw new Error(
                    `${recipe.name}: material ${slot} needs an alphaCutoff between 0 and 1`
                );
        }
        if (materialKinds.has("cutout") && Object.keys(recipe.materials).length !== 1)
            throw new Error(`${recipe.name}: a cutout kit has exactly one material`);
        if (recipe.modules.length === 0) throw new Error(`${recipe.name}: a kit needs a module`);
        const names = new Set<string>();
        for (const kitModule of recipe.modules) {
            const label = `${recipe.name}: module ${kitModule.name}`;
            if (!AssetKindDefinition.CAMEL_CASE.test(kitModule.name) || names.has(kitModule.name))
                throw new Error(`${label} needs a unique camelCase name`);
            names.add(kitModule.name);
            if (kitModule.parts.length === 0) throw new Error(`${label} has no parts`);
            for (const part of kitModule.parts) KitKind.assertKitPart(label, part, recipe);
            if (kitModule.minimumTriangles > recipe.trianglesPerModule)
                throw new Error(
                    `${label} needs at least ${kitModule.minimumTriangles} triangles, over the per-module budget of ${recipe.trianglesPerModule}`
                );
            const bounds = new Box3(
                new Vector3(...kitModule.boundsMetres.min),
                new Vector3(...kitModule.boundsMetres.max)
            );
            for (const socket of kitModule.extras.sockets)
                if (!bounds.containsPoint(new Vector3(...socket.at)))
                    throw new Error(`${label}: socket ${socket.name} sits outside its parts`);
        }
    }

    private static assertKitPart(
        label: string,
        part: ResolvedKitPart,
        recipe: IResolvedKitRecipe
    ): void {
        const material = recipe.materials[part.material];
        if (!material) throw new Error(`${label}: material ${part.material} is not declared`);
        if ((part.sweep === "card") !== (material.kind === "cutout"))
            throw new Error(`${label}: cards and only cards use a cutout material`);
        if (part.sweep === "card" && (part.bevelMetres > 0 || part.noise))
            throw new Error(`${label}: a card takes no bevel or noise`);
        if (part.sweep === "card" && !part.size.every((length) => length > 0))
            throw new Error(`${label}: a card needs a positive width and height`);
        if (!(part.bevelMetres >= 0)) throw new Error(`${label}: bevelMetres must be 0 or more`);
        if (part.noise && !(part.noise.amplitudeMetres > 0 && part.noise.featureMetres > 0))
            throw new Error(`${label}: noise needs a positive amplitude and feature size`);
        if (part.transforms.length === 0) throw new Error(`${label}: a part repeats 0 times`);
        if (
            part.sag &&
            !(
                Number.isInteger(part.sag.segments) &&
                part.sag.segments >= 2 &&
                part.sag.metres !== 0
            )
        )
            throw new Error(`${label}: sag needs 2 or more whole segments and a non-zero depth`);
        if (part.sweep === "extrude" && !(part.profile.length >= 3 && part.depth > 0))
            throw new Error(`${label}: an extrude needs 3 profile points and a positive depth`);
        if (
            part.sweep === "loft" &&
            !(
                part.rings.length >= 2 &&
                part.rings.every((ring) => ring.length >= 3 && ring.length === part.rings[0].length)
            )
        )
            throw new Error(`${label}: a sweep needs 2 rings of 3 or more matching points`);
        if (part.sweep === "lathe") {
            if (!(Number.isInteger(part.sides) && part.sides >= 3 && part.profile.length >= 2))
                throw new Error(`${label}: a lathe needs 3 whole sides and 2 profile points`);
            if (
                part.profile.some(([radius]) => radius < 0) ||
                part.profile.some(
                    ([radius], index) =>
                        index > 0 && radius === 0 && part.profile[index - 1][0] === 0
                )
            )
                throw new Error(`${label}: lathe radii must be positive between axis points`);
        }
    }

    override async prepare(recipe: IResolvedKitRecipe): Promise<void> {
        const mapsByTexture = new Map<string, Set<TextureMap>>();
        for (const material of Object.values(recipe.materials)) {
            if (material.kind === "cutout") continue;
            const maps = mapsByTexture.get(material.texture) ?? new Set<TextureMap>();
            maps.add("albedo").add(material.kind === "baked" ? "height" : "normal");
            mapsByTexture.set(material.texture, maps);
        }
        await Promise.all(
            [...mapsByTexture].map(([texture, maps]) => fetchTextureSource(texture, [...maps]))
        );
    }

    private static resolveKit(recipe: IKitRecipe): IResolvedKitRecipe {
        const modules = recipe.modules.map(KitKind.resolveKitModule);
        return {
            kind: "kit",
            ...AssetKindDefinition.resolveBase(
                { ...recipe, triangles: recipe.trianglesPerModule * recipe.modules.length },
                {
                    tuning: KIT_TUNING_LAYER.resolve(recipe.tuning),
                    heightMetres: Math.max(
                        ...modules.map((kitModule) => extentsOf(kitModule.boundsMetres)[1])
                    ),
                    bakes: Object.values(recipe.materials).every(
                        (material) => material.kind === "baked"
                    ),
                    propScale: PROP_SCALE,
                }
            ),
            trianglesPerModule: recipe.trianglesPerModule,
            sharedMaterial: recipe.sharedMaterial ?? null,
            sway: {
                attribute: STYLE.cloth.swayAttribute,
                materials: Object.keys(recipe.materials).filter((slot) =>
                    STYLE.cloth.materialPattern.test(slot)
                ),
            },
            materials: Object.fromEntries(
                Object.entries(recipe.materials).map(
                    ([slot, material]): [string, ResolvedKitMaterial] => [
                        slot,
                        material.kind === "cutout"
                            ? {
                                  ...material,
                                  image: AssetKindDefinition.fromGameAssets(material.image),
                              }
                            : material.kind === "tiled"
                              ? {
                                    kind: "tiled",
                                    texture: material.texture,
                                    albedo: textureFile(material.texture, "albedo"),
                                    normal: textureFile(material.texture, "normal"),
                                    info: textureInfoFile(material.texture),
                                    imageStem: `${recipe.name}_${slot}`,
                                    normalStem: `${recipe.name}_${material.texture}`,
                                    tileScale: material.tileScale,
                                    resolution: Math.min(material.resolution, recipe.textureSize),
                                    tint: material.tint ?? null,
                                }
                              : {
                                    kind: "baked",
                                    texture: material.texture,
                                    albedo: textureFile(material.texture, "albedo"),
                                    height: textureFile(material.texture, "height"),
                                    info: textureInfoFile(material.texture),
                                    reliefMetres: material.reliefMetres,
                                    tileScale: material.tileScale,
                                    macroVariation: material.macroVariation,
                                    tint: material.tint ?? null,
                                },
                    ]
                )
            ),
            modules,
        };
    }

    private static resolveKitModule(kitModule: IKitModule): IResolvedKitModule {
        const nextRandom = seededBy(kitModule.name);
        const parts = kitModule.parts.flatMap((part) => {
            const transforms = KitKind.partTransforms(part, nextRandom);
            return KitKind.sweepsOf(part).map((sweep) => ({ part, sweep, transforms }));
        });
        const corner = new Vector3();
        const partBounds = parts.flatMap(({ part, sweep, transforms }) => {
            const points = KitKind.sweepPoints(sweep);
            return transforms.map((transform) => {
                const box = new Box3();
                for (const point of points)
                    box.expandByPoint(corner.copy(point).applyMatrix4(transform));
                return { material: part.material, box };
            });
        });
        const bounds = new Box3();
        for (const { box } of partBounds) bounds.union(box);
        const origin = new Vector3(
            (bounds.min.x + bounds.max.x) / 2,
            bounds.min.y,
            (bounds.min.z + bounds.max.z) / 2
        );
        const toOrigin = new Matrix4().makeTranslation(origin.clone().negate());
        const placed = new Matrix4();
        return {
            name: kitModule.name,
            noiseSeed: hashString(kitModule.name),
            parts: parts.map(({ part, sweep, transforms }) => ({
                ...sweep,
                material: part.material,
                bevelMetres: part.bevelMetres,
                noise: part.noise ?? null,
                transforms: transforms.map((transform) =>
                    placed.multiplyMatrices(toOrigin, transform).toArray()
                ),
            })),
            extras: {
                ...kitModule.extras,
                sockets: kitModule.extras.sockets.map((socket) => ({
                    name: socket.name,
                    at: new Vector3(...socket.at).sub(origin).toArray(),
                })),
            },
            boundsMetres: {
                min: bounds.min.clone().sub(origin).toArray(),
                max: bounds.max.clone().sub(origin).toArray(),
            },
            partBoundsMetres: partBounds.map(({ material, box }) => ({
                material,
                min: box.min.clone().sub(origin).toArray(),
                max: box.max.clone().sub(origin).toArray(),
            })),
            minimumTriangles: parts.reduce(
                (sum, { sweep, transforms }) =>
                    sum + KitKind.sweepTriangles(sweep) * transforms.length,
                0
            ),
        };
    }

    private static sweepsOf(shape: KitShape): KitSweep[] {
        switch (shape.shape) {
            case "box": {
                const [width, height, depth] = shape.size;
                return [
                    {
                        sweep: "extrude",
                        profile: [
                            [-width / 2, 0],
                            [width / 2, 0],
                            [width / 2, height],
                            [-width / 2, height],
                        ],
                        depth,
                        sag: shape.sag ?? null,
                    },
                ];
            }
            case "cylinder":
                return [
                    {
                        sweep: "lathe",
                        profile: [
                            [0, 0],
                            [shape.radius, 0],
                            [shape.radius, shape.height],
                            [0, shape.height],
                        ],
                        sides: shape.sides,
                        sag: null,
                    },
                ];
            case "extrude":
                return [
                    { sweep: "extrude", profile: shape.profile, depth: shape.depth, sag: null },
                ];
            case "lathe":
                if (shape.flare) return KitKind.flaredLathe(shape, shape.flare);
                if (shape.courses) throw new Error("tile courses on a lathe need a flare");
                return [{ sweep: "lathe", profile: shape.profile, sides: shape.sides, sag: null }];
            case "sweep":
                return KitKind.sweptSurface(shape);
            case "card":
                return [{ sweep: "card", size: shape.size, sag: null }];
        }
    }

    private static sweptSurface(shape: Extract<KitShape, { shape: "sweep" }>): KitSweep[] {
        const closed = shape.closed ?? false;
        const frames = KitKind.pathFrames(shape.path, closed);
        const surface: KitSweep = {
            sweep: "loft",
            rings: frames.map((frame) =>
                shape.profile.map(([across, up]) =>
                    frame.point
                        .clone()
                        .addScaledVector(frame.side, across * frame.miter)
                        .add(new Vector3(0, up, 0))
                        .toArray()
                )
            ),
            closed,
            sag: null,
        };
        if (shape.courses && closed)
            throw new Error("tile courses follow an open sweep; a hip roof is a flared lathe");
        return shape.courses
            ? [surface, ...KitKind.tileCourses(shape.profile, shape.courses, frames)]
            : [surface];
    }

    private static pathFrames(path: readonly Vector3Tuple[], closed: boolean): IPathFrame[] {
        if (path.length < 2) throw new Error("a sweep path needs 2 or more points");
        const points = path.map((point) => new Vector3(...point));
        const last = points.length - 1;
        const flat = (from: Vector3, to: Vector3): Vector3 => {
            const direction = to.clone().sub(from).setY(0);
            if (direction.lengthSq() === 0)
                throw new Error("a sweep path needs a horizontal step between points");
            return direction.normalize();
        };
        const sideOf = (direction: Vector3): Vector3 =>
            direction.clone().cross(UP_AXIS).normalize();
        const centre = points
            .reduce((sum, point) => sum.add(point), new Vector3())
            .divideScalar(points.length);
        const frames = points.map((point, index) => {
            const incoming = index > 0 || closed ? flat(points.at(index - 1)!, point) : null;
            const outgoing =
                index < last || closed ? flat(point, points[(index + 1) % points.length]) : null;
            const tangent = (incoming ?? outgoing!)
                .clone()
                .add(outgoing ?? incoming!)
                .normalize();
            const side = sideOf(tangent);
            const miter = 1 / Math.max(side.dot(sideOf(incoming ?? outgoing!)), MINIMUM_MITER);
            return { point, side, miter };
        });
        const outward = frames.reduce(
            (sum, frame) => sum + frame.side.dot(frame.point.clone().sub(centre)),
            0
        );
        if (closed && outward < 0) for (const frame of frames) frame.side.negate();
        return frames;
    }

    private static tileCourses(
        profile: readonly Vector2Tuple[],
        courses: IKitCourses,
        frames: readonly IPathFrame[]
    ): KitSweep[] {
        const surface = KitKind.courseSurface(profile, courses);
        const lengths = frames
            .slice(1)
            .map((frame, index) => frame.point.clone().sub(frames[index].point).setY(0).length());
        const pathLength = lengths.reduce((sum, length) => sum + length, 0);
        const count = Math.floor(pathLength / courses.spacingMetres);
        let segment = 0;
        let walked = 0;
        return Array.from({ length: count }, (_, course) => {
            const along = (course + 0.5) * (pathLength / count);
            while (segment < lengths.length - 1 && walked + lengths[segment] < along)
                walked += lengths[segment++];
            const from = frames[segment];
            const to = frames[segment + 1];
            const point = from.point.clone().lerp(to.point, (along - walked) / lengths[segment]);
            const tangent = to.point.clone().sub(from.point).setY(0).normalize();
            return KitKind.courseTube(
                surface.map(([across, up]) =>
                    point
                        .clone()
                        .addScaledVector(from.side, across)
                        .add(new Vector3(0, up, 0))
                ),
                tangent,
                courses
            );
        });
    }

    private static flaredLathe(
        shape: Extract<KitShape, { shape: "lathe" }>,
        flare: IKitFlare
    ): KitSweep[] {
        const { sides } = shape;
        const outermost = Math.max(...shape.profile.map(([radius]) => radius));
        const corner = (index: number, radius: number): Vector3 => {
            const angle = (2 * Math.PI * index) / sides;
            return new Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle));
        };
        const edgePoint = (
            edge: number,
            along: number,
            radius: number,
            height: number
        ): Vector3 => {
            const point = corner(edge, radius).lerp(corner(edge + 1, radius), along);
            const fromMiddle = Math.abs(2 * along - 1);
            return point.setY(
                height + flare.liftMetres * ((fromMiddle * radius) / outermost) ** flare.power
            );
        };
        const rings = shape.profile
            .filter(([radius]) => radius > 0)
            .map(([radius, height]) =>
                Array.from({ length: sides * flare.segmentsPerSide }, (_, step) =>
                    edgePoint(
                        Math.floor(step / flare.segmentsPerSide),
                        (step % flare.segmentsPerSide) / flare.segmentsPerSide,
                        radius,
                        height
                    ).toArray()
                )
            );
        const roof: KitSweep = { sweep: "loft", rings, closed: false, sag: null };
        if (!shape.courses) return [roof];
        const { courses } = shape;
        const surface = KitKind.courseSurface(shape.profile, courses);
        const eaveHalf = corner(0, outermost).distanceTo(corner(1, outermost)) / 2;
        const perEdge = Math.floor((2 * eaveHalf) / courses.spacingMetres);
        const courseProfile = surface.map(([radius, height]) => ({
            radius,
            height,
            half: (eaveHalf * radius) / outermost,
        }));
        const tiles: KitSweep[] = [];
        for (let edge = 0; edge < sides; edge++) {
            const tangent = corner(edge + 1, 1)
                .sub(corner(edge, 1))
                .normalize();
            for (let course = 0; course < perEdge; course++) {
                const offset = (course + 0.5) * ((2 * eaveHalf) / perEdge) - eaveHalf;
                const line = courseProfile
                    .filter(({ half }) => Math.abs(offset) <= half)
                    .map(({ radius, height, half }) =>
                        edgePoint(edge, (offset + half) / (2 * half), radius, height)
                    );
                if (line.length >= 2) tiles.push(KitKind.courseTube(line, tangent, courses));
            }
        }
        return [roof, ...tiles];
    }

    private static courseSurface(
        profile: readonly Vector2Tuple[],
        courses: IKitCourses
    ): Vector2Tuple[] {
        const [first, last] = courses.surface;
        const surface = profile.slice(first, last + 1);
        if (!(
            surface.length >= 2 &&
            courses.spacingMetres > 0 &&
            courses.radiusMetres > 0 &&
            courses.sides >= 3
        ))
            throw new Error(
                "courses need 2 surface points, 3 sides and a positive spacing and radius"
            );
        return surface;
    }

    private static courseTube(
        line: readonly Vector3[],
        tangent: Vector3,
        courses: IKitCourses
    ): KitSweep {
        return {
            sweep: "loft",
            rings: line.map((centre, index) => {
                const direction = (line[index + 1] ?? centre)
                    .clone()
                    .sub(line[index - 1] ?? centre)
                    .normalize();
                const lift = direction.clone().cross(tangent).normalize();
                if (lift.y < 0) lift.negate();
                const middle = centre
                    .clone()
                    .addScaledVector(lift, courses.radiusMetres * COURSE_SINK);
                return Array.from({ length: courses.sides }, (_, step) => {
                    const angle = (2 * Math.PI * step) / courses.sides;
                    return middle
                        .clone()
                        .addScaledVector(tangent, courses.radiusMetres * Math.cos(angle))
                        .addScaledVector(lift, courses.radiusMetres * Math.sin(angle))
                        .toArray();
                });
            }),
            closed: false,
            sag: null,
        };
    }

    private static sweepPoints(sweep: KitSweep): Vector3[] {
        if (sweep.sweep === "extrude") {
            const corners = sweep.profile.flatMap(([x, y]) => [
                new Vector3(x, y, sweep.depth / 2),
                new Vector3(x, y, -sweep.depth / 2),
            ]);
            const { sag } = sweep;
            if (!sag) return corners;
            const middleY =
                (Math.min(...sweep.profile.map(([, y]) => y)) +
                    Math.max(...sweep.profile.map(([, y]) => y))) /
                2;
            return [
                ...corners,
                ...sweep.profile.map(([x]) => new Vector3(x + sag.metres, middleY, 0)),
            ];
        }
        if (sweep.sweep === "loft") {
            const points: Vector3[] = [];
            for (const ring of sweep.rings)
                for (const point of ring) points.push(new Vector3(...point));
            return points;
        }
        if (sweep.sweep === "card") {
            const [width, height] = sweep.size;
            return [
                new Vector3(-width / 2, 0, 0),
                new Vector3(width / 2, 0, 0),
                new Vector3(width / 2, height, 0),
                new Vector3(-width / 2, height, 0),
            ];
        }
        const directions = Array.from({ length: sweep.sides }, (_, index) => {
            const angle = (2 * Math.PI * index) / sweep.sides;
            return { cos: Math.cos(angle), sin: Math.sin(angle) };
        });
        const points: Vector3[] = [];
        for (const [radius, y] of sweep.profile)
            for (const { cos, sin } of directions)
                points.push(new Vector3(radius * cos, y, radius * sin));
        return points;
    }

    private static sweepTriangles(sweep: KitSweep): number {
        if (sweep.sweep === "extrude")
            return sweep.sag
                ? 4 * sweep.sag.segments ** 2 + 8 * sweep.sag.segments
                : 4 * sweep.profile.length - 4;
        if (sweep.sweep === "card") return 2;
        if (sweep.sweep === "loft") {
            const sides = sweep.rings[0].length;
            const spans = sweep.closed ? sweep.rings.length : sweep.rings.length - 1;
            return 2 * spans * sides + (sweep.closed ? 0 : 2 * (sides - 2));
        }
        return sweep.profile
            .slice(1)
            .reduce(
                (sum, [radius], index) =>
                    sum + sweep.sides * (Number(radius > 0) + Number(sweep.profile[index][0] > 0)),
                0
            );
    }

    private static repeatOffset(repeat: KitRepeat): (index: number) => Matrix4 {
        if (repeat.mode === "ring") {
            const spin = new Vector3(...(repeat.axis ?? UP_AXIS.toArray())).normalize();
            const across = new Vector3(1, 0, 0).projectOnPlane(spin);
            const outward = (across.lengthSq() > 0 ? across : new Vector3(0, 0, 1)).normalize();
            const translation = new Matrix4().makeTranslation(
                outward.multiplyScalar(repeat.radius)
            );
            return (index) =>
                new Matrix4()
                    .makeRotationAxis(spin, (2 * Math.PI * index) / repeat.count)
                    .multiply(translation);
        }
        if (repeat.mode === "grid") {
            const across = new Vector3(...repeat.step[0]);
            const along = new Vector3(...repeat.step[1]);
            return (index) =>
                new Matrix4().makeTranslation(
                    across
                        .clone()
                        .multiplyScalar(index % repeat.count[0])
                        .addScaledVector(along, Math.floor(index / repeat.count[0]))
                );
        }
        const step = new Vector3(...repeat.step);
        return (index) => new Matrix4().makeTranslation(step.clone().multiplyScalar(index));
    }

    private static partTransforms(part: KitPart, nextRandom: RandomSource): Matrix4[] {
        const rotation = new Matrix4().makeRotationFromEuler(
            new Euler().setFromVector3(
                new Vector3(...(part.rotationDegrees ?? [0, 0, 0])).multiplyScalar(
                    MathUtils.DEG2RAD
                )
            )
        );
        const translation = new Matrix4().makeTranslation(new Vector3(...part.at));
        const placed = (offset: Matrix4): Matrix4 =>
            translation.clone().multiply(offset).multiply(rotation);
        const { repeat } = part;
        if (!repeat) return [placed(new Matrix4())];
        const counts = repeat.mode === "grid" ? repeat.count : [repeat.count];
        if (!counts.every((count) => Number.isInteger(count) && count >= 1))
            throw new Error(
                `repeat count ${counts.join(" x ")} must be whole numbers of at least 1`
            );
        const { jitter } = repeat;
        if (jitter && !jitter.scale.every((spread) => spread >= 0 && spread < 1))
            throw new Error(
                `jitter scale spreads ${jitter.scale.join(", ")} must be from 0 up to 1`
            );
        const offsetAt = KitKind.repeatOffset(repeat);
        return Array.from(
            { length: counts.reduce((product, count) => product * count, 1) },
            (_, index) => {
                const offset = offsetAt(index);
                if (!jitter) return placed(offset);
                const yaw = randomOffset(nextRandom, jitter.yawDegrees) * MathUtils.DEG2RAD;
                const scale = jitter.scale.map((spread) => 1 + randomOffset(nextRandom, spread));
                return placed(
                    offset
                        .multiply(new Matrix4().makeRotationY(yaw))
                        .multiply(new Matrix4().makeScale(scale[0], scale[1], scale[2]))
                );
            }
        );
    }
}

function perchStand({ legs, legMaterial, floorMaterial, roofMaterial }: IPerchDesign): IKitModule {
    const {
        deckHeightMetres: deckTop,
        deckSideMetres: side,
        deckThicknessMetres: thickness,
        stairWidthMetres,
        steps,
        treadMetres,
        railHeightMetres,
        roofClearanceMetres,
        postRadiusMetres,
    } = PERCH_STAND;
    const half = side / 2;
    const roofBase = deckTop + roofClearanceMetres;
    const postSpan = side - postRadiusMetres * 2;
    const railThickness = postRadiusMetres;
    const cornerPosts = (fromMetres: number, toMetres: number, material: string): KitPart[] =>
        [-1, 1].map((row) => ({
            shape: "cylinder",
            radius: postRadiusMetres,
            height: toMetres - fromMetres,
            sides: 8,
            material,
            at: [-postSpan / 2, fromMetres, (row * postSpan) / 2],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [postSpan, 0, 0] },
        }));
    const supports: KitPart[] =
        legs === "posts"
            ? cornerPosts(0, roofMaterial === null ? deckTop - thickness : roofBase, legMaterial)
            : [
                  {
                      shape: "box",
                      size: [side, deckTop - thickness, side],
                      material: legMaterial,
                      at: [0, 0, 0],
                      bevelMetres: 0.03,
                  },
                  ...(roofMaterial === null ? [] : cornerPosts(deckTop, roofBase, floorMaterial)),
              ];
    return prop("perchStand", [
        ...supports,
        {
            shape: "box",
            size: [side, thickness, side],
            material: floorMaterial,
            at: [0, deckTop - thickness, 0],
            bevelMetres: 0.02,
        },
        {
            shape: "box",
            size: [railThickness, railHeightMetres, side],
            material: floorMaterial,
            at: [-half + railThickness / 2, deckTop, 0],
            bevelMetres: 0.01,
            repeat: { mode: "line", count: 2, step: [side - railThickness, 0, 0] },
        },
        ...stairFlight({
            steps,
            widthMetres: stairWidthMetres,
            riseMetres: deckTop / steps,
            treadMetres,
            material: floorMaterial,
            bevelMetres: 0.01,
            at: [0, 0, half + treadMetres * (steps - 0.5)],
        }),
        ...(roofMaterial === null
            ? []
            : [
                  hipRoof({
                      at: [0, roofBase, 0],
                      material: roofMaterial,
                      scale: (half * Math.SQRT2) / (ROOF_DESIGN.hipProfile[0]?.[0] ?? 1),
                  }),
              ]),
    ]);
}

function stairFlight({
    steps,
    widthMetres,
    riseMetres,
    treadMetres,
    material,
    bevelMetres,
    at = [0, 0, 0],
}: {
    steps: number;
    widthMetres: number;
    riseMetres: number;
    treadMetres: number;
    material: string;
    bevelMetres: number;
    at?: Vector3Tuple;
}): KitPart[] {
    return Array.from({ length: steps }, (_, step): KitPart => ({
        shape: "box",
        size: [widthMetres, riseMetres * (step + 1), treadMetres],
        material,
        at: [at[0], at[1], at[2] - treadMetres * step],
        bevelMetres,
    }));
}

function gateRoof({
    at,
    halfLengthMetres,
    material,
}: {
    at: Vector3Tuple;
    halfLengthMetres: number;
    material: string;
}): KitPart[] {
    const path = spanPath(
        halfLengthMetres,
        (along) => ROOF_DESIGN.flareLiftMetres * Math.abs(along) ** ROOF_DESIGN.flarePower
    );
    const ridgeTop = Math.max(...ROOF_DESIGN.gableProfile.map(([, up]) => up));
    const endLift = ROOF_DESIGN.flareLiftMetres;
    return [
        {
            shape: "sweep",
            profile: ROOF_DESIGN.gableProfile,
            path,
            material,
            at,
            bevelMetres: 0,
            courses: ROOF_DESIGN.courses(ROOF_DESIGN.gableSurface),
        },
        {
            shape: "sweep",
            profile: ROOF_DESIGN.ridgeProfile.map(([across, up]): Vector2Tuple => [
                across,
                up + ridgeTop,
            ]),
            path,
            material,
            at,
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: ROOF_DESIGN.ridgeEndSize,
            material,
            at: [
                at[0] - halfLengthMetres + ROOF_DESIGN.ridgeEndSize[0],
                at[1] + ridgeTop + endLift,
                at[2],
            ],
            bevelMetres: 0.02,
            repeat: {
                mode: "line",
                count: 2,
                step: [2 * (halfLengthMetres - ROOF_DESIGN.ridgeEndSize[0]), 0, 0],
            },
        },
    ];
}

function spanPath(halfLengthMetres: number, heightAt: (along: number) => number): Vector3Tuple[] {
    return Array.from({ length: SPAN_SAMPLES }, (_, index): Vector3Tuple => {
        const along = (2 * index) / (SPAN_SAMPLES - 1) - 1;
        return [along * halfLengthMetres, heightAt(along), 0];
    });
}

function sagAt(sagMetres: number): (along: number) => number {
    return (along) => -sagMetres * (1 - along * along);
}

function roundProfile(radiusMetres: number, sides: number): Vector2Tuple[] {
    return Array.from({ length: sides }, (_, index): Vector2Tuple => {
        const angle = (2 * Math.PI * index) / sides;
        return [radiusMetres * Math.cos(angle), radiusMetres * Math.sin(angle)];
    });
}

function hungSpan({
    halfLengthMetres,
    heightMetres,
    sagMetres,
    postRadiusMetres,
    ropeRadiusMetres,
    postMaterial,
    ropeMaterial,
}: {
    halfLengthMetres: number;
    heightMetres: number;
    sagMetres: number;
    postRadiusMetres: number;
    ropeRadiusMetres: number;
    postMaterial: string;
    ropeMaterial: string;
}): KitPart[] {
    return [
        {
            shape: "cylinder",
            radius: postRadiusMetres,
            height: heightMetres + ropeRadiusMetres,
            sides: 10,
            material: postMaterial,
            at: [-halfLengthMetres, 0, 0],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [2 * halfLengthMetres, 0, 0] },
        },
        {
            shape: "sweep",
            profile: roundProfile(ropeRadiusMetres, 8),
            path: spanPath(halfLengthMetres, sagAt(sagMetres)),
            material: ropeMaterial,
            at: [0, heightMetres, 0],
            bevelMetres: 0,
        },
    ];
}

function hangingAlongSpan({
    halfLengthMetres,
    heightMetres,
    sagMetres,
    count,
    dropMetres,
    piece,
}: {
    halfLengthMetres: number;
    heightMetres: number;
    sagMetres: number;
    count: number;
    dropMetres: number;
    piece: (index: number) => KitShape & { material: string; bevelMetres: number };
}): KitPart[] {
    const height = sagAt(sagMetres);
    return Array.from({ length: count }, (_, index): KitPart => {
        const along = (2 * (index + 1)) / (count + 1) - 1;
        return {
            ...piece(index),
            at: [along * halfLengthMetres, heightMetres + height(along) - dropMetres, 0],
        };
    });
}

function goodsSocket(at: Vector3Tuple): IKitSocket {
    return { name: SCENE_LAYOUT.dressSocket, at };
}

function produceCrate(fruit: string): KitPart[] {
    const apple: Vector2Tuple[] = [
        [0, 0],
        [0.035, 0.008],
        [0.048, 0.045],
        [0.035, 0.085],
        [0, 0.09],
    ];
    return [
        {
            shape: "box",
            size: [0.5, 0.25, 0.35],
            material: "planks",
            at: [0, 0, 0],
            bevelMetres: 0.01,
        },
        {
            shape: "lathe",
            profile: apple,
            sides: 6,
            material: fruit,
            at: [-0.165, 0.24, -0.1],
            bevelMetres: 0,
            repeat: {
                mode: "grid",
                count: [4, 3],
                step: [
                    [0.11, 0, 0],
                    [0, 0, 0.1],
                ],
            },
        },
        {
            shape: "lathe",
            profile: apple,
            sides: 6,
            material: fruit,
            at: [-0.11, 0.31, -0.05],
            bevelMetres: 0,
            repeat: {
                mode: "grid",
                count: [3, 2],
                step: [
                    [0.11, 0, 0],
                    [0, 0, 0.1],
                ],
            },
        },
    ];
}

function turnedParts(
    parts: readonly KitPart[],
    yawDegrees: number,
    shift: Vector3Tuple = [0, 0, 0]
): KitPart[] {
    const turn = new Matrix4().makeRotationY(yawDegrees * MathUtils.DEG2RAD);
    const turned = (vector: Vector3Tuple): Vector3Tuple =>
        new Vector3(...vector).applyMatrix4(turn).toArray();
    const degrees = (radians: number) =>
        Math.round(radians * MathUtils.RAD2DEG * HOUSE_DESIGN.angleRounding) /
        HOUSE_DESIGN.angleRounding;
    return parts.map((part): KitPart => {
        const [x, y, z] = (part.rotationDegrees ?? [0, 0, 0]).map(
            (angle) => angle * MathUtils.DEG2RAD
        );
        const euler = new Euler().setFromRotationMatrix(
            turn.clone().multiply(new Matrix4().makeRotationFromEuler(new Euler(x, y, z)))
        );
        const { repeat } = part;
        return {
            ...part,
            at: new Vector3(...part.at)
                .add(new Vector3(...shift))
                .applyMatrix4(turn)
                .toArray(),
            rotationDegrees: [degrees(euler.x), degrees(euler.y), degrees(euler.z)],
            ...(repeat && {
                repeat:
                    repeat.mode === "line"
                        ? { ...repeat, step: turned(repeat.step) }
                        : repeat.mode === "grid"
                          ? { ...repeat, step: [turned(repeat.step[0]), turned(repeat.step[1])] }
                          : { ...repeat, axis: turned(repeat.axis ?? UP_AXIS.toArray()) },
            }),
        };
    });
}

function slantedBeam({
    from,
    to,
    plane,
    widthMetres,
    depthMetres,
    material,
}: {
    from: Vector2Tuple;
    to: Vector2Tuple;
    plane: number;
    widthMetres: number;
    depthMetres: number;
    material: string;
}): KitPart {
    const rise: Vector2Tuple = [to[0] - from[0], to[1] - from[1]];
    return {
        shape: "box",
        size: [widthMetres, Math.hypot(...rise), depthMetres],
        material,
        at: [from[0], from[1], plane],
        rotationDegrees: [0, 0, -Math.atan2(rise[0], rise[1]) * MathUtils.RAD2DEG],
        bevelMetres: 0,
    };
}

function wallFace(face: IWallFace): KitPart[] {
    const { lengthMetres: length, centreMetres: centre, plane, base, storey, design } = face;
    const { wallThickness, beam, proud, window } = HOUSE_DESIGN;
    const height = storey.heightMetres;
    const body = WALL_BODIES[storey.wall] ?? design.plaster;
    if (face.isRuined) return ruinedWall(face);
    const isFramed =
        storey.wall === "timber" || storey.wall === "wattle" || storey.wall === "lacquer";
    const frame = storey.wall === "lacquer" ? "lacquer" : "timber";
    const slots = face.windows + Number(face.door);
    const bay = length / Math.max(slots, 1);
    const doorSlot = face.door ? Math.floor(slots / 2) : -1;
    const slotCentre = (slot: number) => centre - length / 2 + bay * (slot + 0.5);
    const sill = base + (face.door ? window.groundSillMetres : window.upperSillMetres);
    const parts: KitPart[] = [];
    if (storey.wall === "log") {
        const { radiusMetres: radius, overhangMetres: overhang, sides } = HOUSE_DESIGN.log;
        const shift = face.courseShift * radius;
        parts.push({
            shape: "cylinder",
            radius,
            height: length + 2 * overhang,
            sides,
            material: "logs",
            at: [centre + length / 2 + overhang, base + radius + shift, plane - radius],
            rotationDegrees: [0, 0, 90],
            bevelMetres: 0,
            repeat: {
                mode: "line",
                count: Math.floor((height - shift) / (2 * radius)),
                step: [0, 2 * radius, 0],
            },
        });
    } else
        parts.push({
            shape: "box",
            size: [length, height, wallThickness],
            material: body,
            at: [centre, base, plane - wallThickness / 2],
            bevelMetres: 0,
        });
    if (isFramed)
        parts.push(
            ...[base, base + height - beam.heightMetres].map((y): KitPart => ({
                shape: "box",
                size: [length + proud, beam.heightMetres, beam.depthMetres],
                material: frame,
                at: [centre, y, plane],
                bevelMetres: 0,
            })),
            storey.wall === "lacquer"
                ? {
                      shape: "cylinder",
                      radius: HOUSE_DESIGN.column.radiusMetres,
                      height,
                      sides: HOUSE_DESIGN.column.sides,
                      material: frame,
                      at: [centre - length / 2, base, plane],
                      bevelMetres: 0,
                      repeat: { mode: "line", count: 2, step: [length, 0, 0] },
                  }
                : {
                      shape: "box",
                      size: [beam.widthMetres, height, beam.depthMetres],
                      material: frame,
                      at: [centre - length / 2 + beam.widthMetres / 2, base, plane],
                      bevelMetres: 0,
                      repeat: { mode: "line", count: 2, step: [length - beam.widthMetres, 0, 0] },
                  },
            ...Array.from({ length: Math.max(slots - 1, 0) }, (_, index): KitPart => ({
                shape: "box",
                size: [beam.studMetres, height - 2 * beam.heightMetres, beam.depthMetres - proud],
                material: frame,
                at: [centre - length / 2 + bay * (index + 1), base + beam.heightMetres, plane],
                bevelMetres: 0,
            }))
        );
    if (storey.wall === "timber")
        parts.push(
            ...Array.from({ length: slots }, (_, slot) => slot)
                .filter((slot) => slot !== doorSlot)
                .flatMap((slot) =>
                    [-1, 1].map((side) =>
                        slantedBeam({
                            from: [slotCentre(slot) + (side * bay) / 2, base + beam.heightMetres],
                            to: [slotCentre(slot), sill - window.sillMetres],
                            plane: plane + proud / 4,
                            widthMetres: beam.studMetres,
                            depthMetres: beam.depthMetres - proud,
                            material: frame,
                        })
                    )
                )
        );
    if (storey.wall === "stone")
        parts.push(
            ...[0, 1].map((row): KitPart => ({
                shape: "box",
                size: [
                    row === 0 ? HOUSE_DESIGN.quoin.longMetres : HOUSE_DESIGN.quoin.shortMetres,
                    HOUSE_DESIGN.quoin.heightMetres,
                    proud * 2,
                ],
                material: "stone",
                at: [
                    centre -
                        length / 2 +
                        (row === 0
                            ? HOUSE_DESIGN.quoin.longMetres
                            : HOUSE_DESIGN.quoin.shortMetres) /
                            2,
                    base + row * HOUSE_DESIGN.quoin.stepMetres,
                    plane,
                ],
                bevelMetres: 0,
                repeat: {
                    mode: "grid",
                    count: [2, Math.floor(height / (2 * HOUSE_DESIGN.quoin.stepMetres))],
                    step: [
                        [
                            length -
                                (row === 0
                                    ? HOUSE_DESIGN.quoin.longMetres
                                    : HOUSE_DESIGN.quoin.shortMetres),
                            0,
                            0,
                        ],
                        [0, 2 * HOUSE_DESIGN.quoin.stepMetres, 0],
                    ],
                },
            }))
        );
    if (storey.wall === "plank")
        parts.push({
            shape: "box",
            size: [beam.studMetres, height, proud],
            material: "timber",
            at: [centre - length / 2 + HOUSE_DESIGN.battenMetres / 2, base, plane],
            bevelMetres: 0,
            repeat: {
                mode: "line",
                count: Math.floor(length / HOUSE_DESIGN.battenMetres),
                step: [HOUSE_DESIGN.battenMetres, 0, 0],
            },
        });
    for (let slot = 0; slot < slots; slot += 1)
        parts.push(
            ...(slot === doorSlot
                ? doorParts(slotCentre(slot), base, plane, design)
                : windowParts(slotCentre(slot), sill, plane, design, {
                      isUpper: !face.door,
                      isLattice: storey.wall === "lacquer",
                      hasShutters:
                          storey.wall !== "lacquer" &&
                          design.condition !== "ruined" &&
                          (design.condition === "fresh" ||
                              face.nextRandom() > HOUSE_DESIGN.worn.missingShutterShare),
                  }))
        );
    return parts;
}

function ruinedWall(face: IWallFace): KitPart[] {
    return jaggedWall({
        lengthMetres: face.lengthMetres,
        centreMetres: face.centreMetres,
        heightMetres: face.storey.heightMetres,
        thicknessMetres: HOUSE_DESIGN.wallThickness,
        plane: face.plane,
        base: face.base,
        material: face.storey.wall === "log" ? "logs" : "stone",
        heightShare: HOUSE_DESIGN.ruin.heightShare,
        nextRandom: face.nextRandom,
    });
}

function jaggedWall(wall: {
    lengthMetres: number;
    centreMetres: number;
    heightMetres: number;
    thicknessMetres: number;
    plane: number;
    base: number;
    material: string;
    heightShare: Vector2Tuple;
    nextRandom: RandomSource;
}): KitPart[] {
    const { lengthMetres: length, centreMetres: centre, heightShare, nextRandom } = wall;
    const { chunkMetres } = HOUSE_DESIGN.ruin;
    const chunks = Math.max(1, Math.round(length / chunkMetres));
    const width = length / chunks;
    const heights = Array.from(
        { length: chunks + 1 },
        () => wall.heightMetres * valueInRange(heightShare, nextRandom())
    );
    return Array.from({ length: chunks }, (_, index): KitPart => {
        const left = centre - length / 2 + width * index;
        return {
            shape: "extrude",
            profile: [
                [left, 0],
                [left + width, 0],
                [left + width, heights[index + 1] ?? 0],
                [left, heights[index] ?? 0],
            ],
            depth: wall.thicknessMetres,
            material: wall.material,
            at: [0, wall.base, wall.plane - wall.thicknessMetres / 2],
            bevelMetres: 0,
        };
    });
}

function windowParts(
    x: number,
    sill: number,
    plane: number,
    design: IHouseDesign,
    {
        isUpper,
        isLattice,
        hasShutters,
    }: { isUpper: boolean; isLattice: boolean; hasShutters: boolean }
): KitPart[] {
    const {
        widthMetres: width,
        heightMetres: height,
        frameMetres: frame,
        sillMetres,
    } = HOUSE_DESIGN.window;
    const { proud } = HOUSE_DESIGN;
    const frameMaterial = isLattice ? "lacquer" : "timber";
    const box = (
        size: Vector3Tuple,
        material: string,
        at: Vector3Tuple,
        bevelMetres = 0
    ): KitPart => ({ shape: "box", size, material, at, bevelMetres });
    const { bars, barMetres } = HOUSE_DESIGN.lattice;
    return [
        box([width + 2 * frame, height + 2 * frame, proud * 2], frameMaterial, [
            x,
            sill - frame,
            plane,
        ]),
        box([width, height, proud * 2 + 0.01], isLattice ? "paper" : "glass", [x, sill, plane], 0),
        ...(isLattice
            ? [
                  {
                      ...box([barMetres, height, proud * 2 + 0.03], frameMaterial, [
                          x - width / 2 + width / (bars + 1),
                          sill,
                          plane,
                      ]),
                      repeat: { mode: "line", count: bars, step: [width / (bars + 1), 0, 0] },
                  } satisfies KitPart,
                  {
                      ...box([width, barMetres, proud * 2 + 0.03], frameMaterial, [
                          x,
                          sill + height / (bars + 1),
                          plane,
                      ]),
                      repeat: { mode: "line", count: bars, step: [0, height / (bars + 1), 0] },
                  } satisfies KitPart,
              ]
            : [
                  box([frame / 2, height, proud * 2 + 0.03], "timber", [x, sill, plane]),
                  box([width, frame / 2, proud * 2 + 0.03], "timber", [
                      x,
                      sill + height * 0.55,
                      plane,
                  ]),
              ]),
        box([width + 0.3, sillMetres, 0.22], "stone", [x, sill - frame - sillMetres, plane + 0.05]),
        box([width + 0.34, 0.14, proud * 3], frameMaterial, [x, sill + height + frame, plane]),
        ...(hasShutters
            ? [
                  {
                      shape: "box",
                      size: [width / 2, height, proud],
                      material: design.shutters,
                      at: [x - width * 0.75 - frame, sill, plane + proud / 2],
                      bevelMetres: 0,
                      repeat: { mode: "line", count: 2, step: [width * 1.5 + 2 * frame, 0, 0] },
                  } satisfies KitPart,
              ]
            : []),
        ...(design.flowerBoxes && isUpper && design.condition !== "ruined"
            ? flowerBox(x, sill - frame - sillMetres, plane)
            : []),
    ];
}

function flowerBox(x: number, top: number, plane: number): KitPart[] {
    const { widthMetres: width } = HOUSE_DESIGN.window;
    return [
        {
            shape: "box",
            size: [width + 0.1, 0.18, 0.24],
            material: "planks",
            at: [x, top - 0.2, plane + 0.14],
            bevelMetres: 0,
        },
        {
            shape: "lathe",
            profile: HOUSE_DESIGN.flowerProfile,
            sides: 5,
            material: "flowers",
            at: [x - width / 2 + 0.08, top - 0.04, plane + 0.14],
            bevelMetres: 0,
            repeat: { mode: "line", count: 5, step: [(width - 0.16) / 4, 0, 0] },
        },
    ];
}

function doorParts(x: number, base: number, plane: number, design: IHouseDesign): KitPart[] {
    const [width, height] = design.doorMetres ?? HOUSE_DESIGN.door;
    const { proud } = HOUSE_DESIGN;
    return [
        {
            shape: "box",
            size: [width + 0.24, height + 0.14, proud * 2],
            material: "timber",
            at: [x, base, plane],
            bevelMetres: 0,
        },
        ...(design.condition === "ruined"
            ? []
            : [
                  {
                      shape: "box",
                      size: [width, height, proud * 2 + 0.02],
                      material: "planks",
                      at: [x, base, plane - 0.02],
                      bevelMetres: 0,
                  } satisfies KitPart,
                  {
                      shape: "box",
                      size: [width * 0.7, 0.04, proud * 2 + 0.05],
                      material: "iron",
                      at: [x, base + 0.45, plane],
                      bevelMetres: 0,
                      repeat: { mode: "line", count: 2, step: [0, height - 0.9, 0] },
                  } satisfies KitPart,
              ]),
        ...entranceSteps(x, base, plane, width, design),
        ...(design.condition === "ruined"
            ? []
            : [
                  ...pitchedRoof({
                      ridgeAt: [x, base + height + 0.62, plane + 0.12],
                      lengthMetres: width + 0.7,
                      slopeMetres: 0.75,
                      pitchDegrees: 35,
                      thicknessMetres: 0.06,
                      material: HOUSE_ROOF_COURSED[design.roof.material]
                          ? design.roof.material
                          : "planks",
                  }).filter((part) => part.at[2] > plane + 0.12),
                  ...[-1, 1].map((side) =>
                      slantedBeam({
                          from: [x + side * (width / 2 + 0.2), base + height - 0.3],
                          to: [x + side * (width / 2 + 0.2), base + height + 0.3],
                          plane: plane + 0.2,
                          widthMetres: 0.08,
                          depthMetres: 0.4,
                          material: "timber",
                      })
                  ),
              ]),
        ...(design.sign ? hangingSign(x + width / 2 + 0.7, base + height, plane, design) : []),
    ];
}

function entranceSteps(
    x: number,
    base: number,
    plane: number,
    width: number,
    design: IHouseDesign
): KitPart[] {
    const { riseMetres, treadMetres, sideMetres } = HOUSE_DESIGN.step;
    const count = Math.max(1, Math.round(base / riseMetres));
    const rise = base / count;
    const start = plane + (design.foundation === "stilts" ? HOUSE_DESIGN.stilts.porchMetres : 0);
    return Array.from({ length: count }, (_, step): KitPart => ({
        shape: "box",
        size: [width + 2 * sideMetres, rise * (count - step), treadMetres],
        material: design.foundation === "stilts" ? "planks" : "stone",
        at: [x, 0, start + treadMetres * (step + 0.5)],
        bevelMetres: 0,
    }));
}

function hangingSign(x: number, top: number, plane: number, design: IHouseDesign): KitPart[] {
    return [
        {
            shape: "box",
            size: [0.06, 0.06, 1],
            material: "iron",
            at: [x, top + 0.2, plane + 0.5],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: 0.012,
            height: 0.16,
            sides: 5,
            material: "iron",
            at: [x, top + 0.05, plane + 0.32],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [0, 0, 0.56] },
        },
        {
            shape: "box",
            size: [0.05, 0.55, 0.75],
            material: design.shutters,
            at: [x, top - 0.5, plane + 0.6],
            bevelMetres: 0,
        },
    ];
}

function jettyJoists(width: number, plane: number, base: number, jetty: number): KitPart[] {
    const { joistMetres, joistSpacingMetres } = HOUSE_DESIGN.beam;
    const count = Math.floor(width / joistSpacingMetres);
    return [
        {
            shape: "box",
            size: [joistMetres, joistMetres, jetty + 0.15],
            material: "timber",
            at: [
                -((count - 1) * joistSpacingMetres) / 2,
                base - joistMetres,
                plane + jetty / 2 - 0.05,
            ],
            bevelMetres: 0,
            repeat: { mode: "line", count, step: [joistSpacingMetres, 0, 0] },
        },
    ];
}

function houseRoof(
    design: IHouseDesign,
    eave: number,
    front: number,
    back: number
): { parts: KitPart[]; sockets: IKitSocket[] } {
    const across = design.roof.ridge === "across";
    const span = across ? front - back : design.widthMetres;
    const length = across ? design.widthMetres : front - back;
    const centre = (front + back) / 2;
    const { pitchDegrees: pitchDegreesValue, overhangMetres: overhang, material } = design.roof;
    const pitch = pitchDegreesValue * MathUtils.DEG2RAD;
    const run = span / 2 + overhang;
    const rise = (span / 2) * Math.tan(pitch);
    const slope = run / Math.cos(pitch);
    const ridge = eave + rise;
    const thickness = HOUSE_ROOF_COURSED[material]
        ? HOUSE_DESIGN.roofMetres
        : HOUSE_DESIGN.thatchMetres;
    const { spacingMetres, radiusMetres } = HOUSE_DESIGN.tileCourse;
    const courses = Math.floor(slope / spacingMetres);
    const isCoursed = HOUSE_ROOF_COURSED[material];
    if (design.condition === "ruined")
        return { parts: ruinedRafters(design, eave, span, length, centre, across), sockets: [] };
    if (design.roof.form === "hip") {
        const halfSide = Math.max(span, length) / 2 + overhang;
        const { hipProfile } = ROOF_DESIGN;
        const scale = (halfSide * Math.SQRT2) / (hipProfile[0]?.[0] ?? 1);
        const height = (Math.max(span, length) / 2) * Math.tan(pitch);
        return {
            parts: [hipRoof({ at: [0, eave, centre], material, scale, heightMetres: height })],
            sockets: design.roosts
                ? [{ name: HOUSE_DESIGN.roostSocket, at: [0, eave + height * 0.9, centre] }]
                : [],
        };
    }
    const topWall = design.storeys.at(-1)?.wall;
    const gableBody = topWall === "stone" ? "stone" : topWall === "log" ? "logs" : design.plaster;
    const roof: KitPart[] = [
        ...pitchedRoof({
            ridgeAt: [0, ridge, 0],
            lengthMetres: length + 2 * overhang,
            slopeMetres: slope,
            pitchDegrees: pitchDegreesValue,
            thicknessMetres: thickness,
            material,
        }),
        ...(!isCoursed
            ? []
            : [-1, 1].map((side): KitPart => ({
                  shape: "cylinder",
                  radius: radiusMetres,
                  height: length + 2 * overhang,
                  sides: 5,
                  material,
                  at: [
                      length / 2 + overhang,
                      ridge +
                          (thickness + radiusMetres) * Math.cos(pitch) -
                          spacingMetres * 0.5 * Math.sin(pitch),
                      side *
                          ((thickness + radiusMetres) * Math.sin(pitch) +
                              spacingMetres * 0.5 * Math.cos(pitch)),
                  ],
                  rotationDegrees: [0, 0, 90],
                  bevelMetres: 0,
                  repeat: {
                      mode: "line",
                      count:
                          design.condition === "worn" && side > 0
                              ? Math.round(courses * (1 - HOUSE_DESIGN.worn.missingCourseShare))
                              : courses,
                      step: [
                          0,
                          -spacingMetres * Math.sin(pitch),
                          side * spacingMetres * Math.cos(pitch),
                      ],
                  },
              }))),
        {
            shape: "cylinder",
            radius: HOUSE_DESIGN.ridgeCapMetres,
            height: length + 2 * overhang + 0.1,
            sides: 8,
            material: isCoursed ? material : material === "turf" ? "turf" : "timber",
            at: [length / 2 + overhang + 0.05, ridge + thickness, 0],
            rotationDegrees: [0, 0, 90],
            bevelMetres: 0,
        },
        ...[-1, 1].map((side): KitPart => ({
            shape: "extrude",
            profile: [
                [-span / 2, 0],
                [span / 2, 0],
                [0, rise],
            ],
            depth: HOUSE_DESIGN.wallThickness,
            material: gableBody,
            at: [side * (length / 2 - HOUSE_DESIGN.wallThickness / 2), eave, 0],
            rotationDegrees: [0, 90, 0],
            bevelMetres: 0,
        })),
        ...[-1, 1].flatMap((side) =>
            turnedParts(
                [
                    {
                        shape: "box",
                        size: [
                            HOUSE_DESIGN.beam.studMetres,
                            rise - 0.15,
                            HOUSE_DESIGN.beam.depthMetres,
                        ],
                        material: "timber",
                        at: [0, eave, length / 2],
                        bevelMetres: 0,
                    },
                    ...[-1, 1].map((edge) =>
                        slantedBeam({
                            from: [edge * (span / 2 + overhang), eave - overhang * Math.tan(pitch)],
                            to: [0, ridge + 0.05],
                            plane: length / 2 + overhang + 0.02,
                            widthMetres: 0.22,
                            depthMetres: 0.05,
                            material: "timber",
                        })
                    ),
                ],
                side * 90
            )
        ),
    ];
    const chimney = HOUSE_DESIGN.chimney;
    const capTop = ridge + chimney.aboveRidgeMetres;
    const potBase = capTop + chimney.capMetres[1];
    const chimneys = design.chimneys.flatMap(([x, z]): KitPart[] => [
        {
            shape: "box",
            size: [
                chimney.stackMetres[0],
                capTop - eave + chimney.belowEaveMetres,
                chimney.stackMetres[1],
            ],
            material: "stone",
            at: [x, eave - chimney.belowEaveMetres, z],
            bevelMetres: 0,
        },
        {
            shape: "box",
            size: chimney.capMetres,
            material: "stone",
            at: [x, capTop, z],
            bevelMetres: 0,
        },
        {
            shape: "cylinder",
            radius: chimney.potRadiusMetres,
            height: chimney.potHeightMetres,
            sides: 8,
            material: material === "tiles" ? "tiles" : "stone",
            at: [x + chimney.potSpacingMetres / 2, potBase, z],
            bevelMetres: 0,
            repeat: { mode: "line", count: 2, step: [-chimney.potSpacingMetres, 0, 0] },
        },
    ]);
    return {
        parts: [
            ...turnedParts(roof, across ? 0 : 90, [0, 0, 0]).map((part) =>
                shiftedPart(part, [0, 0, centre])
            ),
            ...chimneys,
        ],
        sockets: [
            ...design.chimneys.map(([x, z]): IKitSocket => ({
                name: chimney.smokeSocket,
                at: [x, potBase + chimney.potHeightMetres / 2, z],
            })),
            ...(design.roosts
                ? [
                      {
                          name: HOUSE_DESIGN.roostSocket,
                          at: [0, ridge, centre] satisfies Vector3Tuple,
                      },
                  ]
                : []),
        ],
    };
}

function shiftedPart(part: KitPart, [x, y, z]: Vector3Tuple): KitPart {
    return { ...part, at: [part.at[0] + x, part.at[1] + y, part.at[2] + z] };
}

function houseKit(
    name: string,
    themes: readonly ThemeId[],
    rows: readonly IHouseRow[],
    resolution: number,
    overrides: Readonly<Record<string, { tint?: string; resolution?: number }>> = {},
    extraModules: readonly IKitModule[] = []
): IKitRecipe {
    const modules = [
        ...rows.map(({ name: moduleName, design }) => {
            const { parts, sockets } = house(moduleName, design);
            return prop(moduleName, parts, sockets);
        }),
        ...extraModules,
    ];
    const used = new Set(
        modules.flatMap((kitModule) => kitModule.parts.map((part) => part.material))
    );
    return {
        name,
        themes,
        textureSize: resolution,
        trianglesPerModule: HOUSE_DESIGN.trianglesPerModule,
        materials: Object.fromEntries(
            Object.entries(HOUSE_MATERIALS)
                .filter(([key]) => used.has(key))
                .map(([key, material]) => [
                    key,
                    material.kind === "tiled"
                        ? {
                              ...material,
                              ...overrides[key],
                              resolution: Math.min(
                                  overrides[key]?.resolution ?? material.resolution,
                                  resolution
                              ),
                          }
                        : material,
                ])
        ),
        modules,
    };
}

function house(name: string, design: IHouseDesign): { parts: KitPart[]; sockets: IKitSocket[] } {
    const { widthMetres: width, depthMetres: depth, plinthMetres: plinth } = design;
    const nextRandom = seededBy(name);
    const back = -depth / 2;
    const parts: KitPart[] = foundationParts(design);
    let base = plinth;
    let front = depth / 2;
    for (const [index, storey] of design.storeys.entries()) {
        if (storey.jettyMetres > 0)
            parts.push(...jettyJoists(width, front, base, storey.jettyMetres));
        front += storey.jettyMetres;
        const sideLength = front - back - 2 * HOUSE_DESIGN.wallThickness;
        const sideCentre = (front + back) / 2;
        const isRuined = design.condition === "ruined" && index === design.storeys.length - 1;
        const face = (
            yaw: number,
            lengthMetres: number,
            plane: number,
            windows: number,
            door: boolean,
            centreMetres = 0
        ) =>
            turnedParts(
                wallFace({
                    lengthMetres,
                    centreMetres,
                    plane,
                    base,
                    storey,
                    windows,
                    door,
                    design,
                    courseShift: Math.abs(yaw) === 90 ? 1 : 0,
                    isRuined,
                    nextRandom,
                }),
                yaw
            );
        parts.push(
            ...face(0, width, front, storey.windows[0], storey.door),
            ...face(180, width, -back, storey.windows[2], false),
            ...face(90, sideLength, width / 2, storey.windows[1], false, -sideCentre),
            ...face(-90, sideLength, width / 2, storey.windows[1], false, sideCentre)
        );
        base += storey.heightMetres;
    }
    if (design.condition === "ruined")
        parts.push(
            ...rubble(
                {
                    widthMetres: width,
                    depthMetres: depth,
                    material: design.storeys.at(-1)?.wall === "log" ? "logs" : "stone",
                },
                nextRandom
            )
        );
    const roof = houseRoof(design, base, front, back);
    return { parts: [...parts, ...roof.parts], sockets: roof.sockets };
}

function foundationParts(design: IHouseDesign): KitPart[] {
    const { widthMetres: width, depthMetres: depth, plinthMetres: plinth } = design;
    if (design.foundation !== "stilts")
        return [
            {
                shape: "box",
                size: [width + 0.16, plinth, depth + 0.16],
                material: "stone",
                at: [0, 0, 0],
                bevelMetres: 0,
            },
        ];
    const { postMetres, spacingMetres, deckMetres, porchMetres } = HOUSE_DESIGN.stilts;
    const across = Math.max(2, Math.round(width / spacingMetres) + 1);
    const along = Math.max(2, Math.round((depth + porchMetres) / spacingMetres) + 1);
    return [
        {
            shape: "box",
            size: [postMetres, plinth, postMetres],
            material: "timber",
            at: [-width / 2, 0, -depth / 2],
            bevelMetres: 0,
            repeat: {
                mode: "grid",
                count: [across, along],
                step: [
                    [width / (across - 1), 0, 0],
                    [0, 0, (depth + porchMetres) / (along - 1)],
                ],
            },
        },
        {
            shape: "box",
            size: [width + 0.3, deckMetres, depth + porchMetres + 0.3],
            material: "planks",
            at: [0, plinth - deckMetres, porchMetres / 2],
            bevelMetres: 0,
        },
    ];
}

function rubble(
    {
        widthMetres,
        depthMetres,
        material,
        count = HOUSE_DESIGN.ruin.rubble,
    }: { widthMetres: number; depthMetres: number; material: string; count?: number },
    nextRandom: RandomSource
): KitPart[] {
    const { rubbleMetres, rubbleReachMetres } = HOUSE_DESIGN.ruin;
    return Array.from({ length: count }, (): KitPart => {
        const size = valueInRange(rubbleMetres, nextRandom());
        const side = nextRandom() < 0.5 ? -1 : 1;
        const alongFront = nextRandom() < 0.5;
        const spread = nextRandom() - 0.5;
        const reach = nextRandom() * rubbleReachMetres;
        return {
            shape: "box",
            size: [size, size * 0.6, size * 0.8],
            material,
            at: alongFront
                ? [spread * widthMetres, 0, side * (depthMetres / 2 + reach)]
                : [side * (widthMetres / 2 + reach), 0, spread * depthMetres],
            rotationDegrees: [0, nextRandom() * 90, (nextRandom() - 0.5) * 30],
            bevelMetres: 0,
        };
    });
}

function ruinedRafters(
    design: IHouseDesign,
    eave: number,
    span: number,
    length: number,
    centre: number,
    across: boolean
): KitPart[] {
    const { rafters, leanMetres, heightShare } = HOUSE_DESIGN.ruin;
    const wallTop = eave - (design.storeys.at(-1)?.heightMetres ?? 0) * (1 - heightShare[0]);
    return turnedParts(
        Array.from({ length: rafters }, (_, index) => {
            const side = index % 2 === 0 ? -1 : 1;
            return slantedBeam({
                from: [side * (span / 2 + leanMetres), 0],
                to: [side * (span / 2 - HOUSE_DESIGN.wallThickness), wallTop],
                plane: -length / 2 + (length * (index + 0.5)) / rafters,
                widthMetres: HOUSE_DESIGN.beam.widthMetres,
                depthMetres: HOUSE_DESIGN.beam.depthMetres,
                material: "timber",
            });
        }),
        across ? 90 : 0,
        across ? [-centre, 0, 0] : [0, 0, centre]
    );
}

function pitchedRoof({
    ridgeAt,
    lengthMetres,
    slopeMetres,
    pitchDegrees,
    thicknessMetres,
    material,
}: {
    ridgeAt: Vector3Tuple;
    lengthMetres: number;
    slopeMetres: number;
    pitchDegrees: number;
    thicknessMetres: number;
    material: string;
}): KitPart[] {
    const pitch = pitchDegrees * MathUtils.DEG2RAD;
    const run = (slopeMetres / 2) * Math.cos(pitch);
    const drop = (slopeMetres / 2) * Math.sin(pitch);
    return [-1, 1].map((side): KitPart => ({
        shape: "box",
        size: [lengthMetres, thicknessMetres, slopeMetres],
        material,
        at: [ridgeAt[0], ridgeAt[1] - drop, ridgeAt[2] + side * run],
        rotationDegrees: [side * pitchDegrees, 0, 0],
        bevelMetres: 0,
    }));
}

function hipRoof({
    at,
    material,
    scale = 1,
    rings = ROOF_DESIGN.hipProfile.length,
    heightMetres,
}: {
    at: Vector3Tuple;
    material: string;
    scale?: number;
    rings?: number;
    heightMetres?: number;
}): KitPart {
    const profile = ROOF_DESIGN.hipProfile.slice(0, rings);
    const top = profile.at(-1)?.[1] ?? 1;
    const rise = heightMetres === undefined ? scale : heightMetres / top;
    return {
        shape: "lathe",
        profile: profile.map(([radius, up]): Vector2Tuple => [radius * scale, up * rise]),
        sides: 4,
        flare: {
            liftMetres: ROOF_DESIGN.flareLiftMetres,
            segmentsPerSide: ROOF_DESIGN.hipSegmentsPerSide,
            power: ROOF_DESIGN.flarePower,
        },
        courses: ROOF_DESIGN.courses([1, rings - 1]),
        material,
        at,
        rotationDegrees: [0, 45, 0],
        bevelMetres: 0,
    };
}

export const ASSET_KINDS: {
    [TKind in AssetKind]: AssetKindDefinition<RecipeOf<TKind>>;
} = {
    character: new CharacterKind(),
    sculpt: new SculptKind(),
    scan: new ScanKind(),
    weapon: new WeaponKind(),
    kit: new KitKind(),
};
