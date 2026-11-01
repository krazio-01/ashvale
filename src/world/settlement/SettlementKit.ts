import { PropLayer, type IModelPack, type IThemeProp } from "@/types/world";
import { MODEL_PACKS, SCALE } from "@/constants/world";
import { metresToUnits } from "@/lib/helpers";
import { propVariants } from "@/themes/PropCatalogue";

const settlementProp = (
    modelPack: IModelPack,
    name: string,
    footprintRadiusMetres: number
): IThemeProp =>
    propVariants(
        modelPack,
        [name],
        PropLayer.Rock,
        metresToUnits(footprintRadiusMetres),
        [1, 1]
    )[0];

const medievalProp = (name: string, footprintRadiusMetres: number): IThemeProp =>
    settlementProp(MODEL_PACKS.medievalVillage, name, footprintRadiusMetres);

const architectureClutter = (name: string): IThemeProp =>
    settlementProp(MODEL_PACKS.architecture, name, 0.4);

export const MODULE_SCALE = SCALE.unitsPerMetre;

export const CELL_SIZE = metresToUnits(2);

const WALL_COURSE_METRES = 3.12;

export const WALL_COURSES = 2;

export const WALL_COURSE_HEIGHT = metresToUnits(WALL_COURSE_METRES);

export const WALL_HEIGHT = WALL_COURSE_HEIGHT * WALL_COURSES;

const CORNER_HEIGHT_METRES = 3.0;

export const CORNER_COURSE_HEIGHT = metresToUnits(CORNER_HEIGHT_METRES);

const ROOF_PEAK = metresToUnits(4.89);

const CHIMNEY_MESH_HEIGHT = metresToUnits(3.18);

const CHIMNEY_RIDGE_CLEARANCE = metresToUnits(1.0);

export const WALL_HALF_THICKNESS = metresToUnits(0.2);

export const WALL_FACE_OFFSET = metresToUnits(0.11);

export const ROOF_OVERHANG = metresToUnits(1.15);

export const CHIMNEY_ELEVATION =
    WALL_HEIGHT + ROOF_PEAK + CHIMNEY_RIDGE_CLEARANCE - CHIMNEY_MESH_HEIGHT;

export const SETTLEMENT_MODULES = {
    wall: medievalProp("Wall_Plaster_Straight", 1.0),
    wallDoor: medievalProp("Wall_Plaster_Door_Round", 1.0),
    wallWindow: medievalProp("Wall_Plaster_Window_Wide_Round", 1.0),
    corner: medievalProp("Corner_Exterior_Wood", 0.15),
    floor: medievalProp("Floor_WoodDark", 1.0),
    chimney: medievalProp("Prop_Chimney", 0.5),
} as const;

export const SETTLEMENT_ROOFS = {
    square6x6: medievalProp("Roof_RoundTiles_6x6", 4.2),
    long6x10: medievalProp("Roof_RoundTiles_6x10", 6.0),
} as const;

const SETTLEMENT_STRUCTURE_PROPS: IThemeProp[] = [
    ...Object.values(SETTLEMENT_MODULES),
    ...Object.values(SETTLEMENT_ROOFS),
];

export const SETTLEMENT_CLUTTER = {
    barrel: architectureClutter("Barrel"),
    crate: architectureClutter("Crate"),
    cart: architectureClutter("Cart"),
    torch: architectureClutter("Torch"),
    pot1: architectureClutter("Pot1"),
    pot2: architectureClutter("Pot2"),
    pot3: architectureClutter("Pot3"),
    chest: architectureClutter("Chest"),
    wagon: medievalProp("Prop_Wagon", 1.0),
    propCrate: medievalProp("Prop_Crate", 0.5),
} as const;

export const SETTLEMENT_EXTRA_PRELOAD_PATHS: string[] = [
    ...SETTLEMENT_STRUCTURE_PROPS,
    ...Object.values(SETTLEMENT_CLUTTER),
].map((prop) => prop.modelPath);
