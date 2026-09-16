import { DEFAULT_FAMILY, PropLayer, type IThemeProp } from "@/types/theme";
import { SCALE } from "@/constants/world";
import { metres } from "@/lib/helpers";

export const MODULE_SCALE = SCALE.unitsPerMetre;

export const CELL_SIZE = metres(2);

const WALL_COURSE_METRES = 3.12;
export const WALL_COURSES = 2;
export const WALL_COURSE_HEIGHT = metres(WALL_COURSE_METRES);
export const WALL_HEIGHT = WALL_COURSE_HEIGHT * WALL_COURSES;

const CORNER_HEIGHT_METRES = 3.0;
export const CORNER_COURSE_HEIGHT = metres(CORNER_HEIGHT_METRES);

const ROOF_PEAK = metres(4.89);
const CHIMNEY_MESH_HEIGHT = metres(3.18);
const CHIMNEY_RIDGE_CLEARANCE = metres(1.0);

export const WALL_HALF_THICKNESS = metres(0.2);
export const WALL_FACE_OFFSET = metres(0.11);

export const ROOF_OVERHANG = metres(1.15);

export const ROOF_ELEVATION = WALL_HEIGHT;
export const CHIMNEY_ELEVATION =
    ROOF_ELEVATION + ROOF_PEAK + CHIMNEY_RIDGE_CLEARANCE - CHIMNEY_MESH_HEIGHT;

const MEDIEVAL_DIRECTORY = "/models/medieval-village";
const ARCHITECTURE_DIRECTORY = "/models/architecture";

const medievalProp = (name: string, footprintRadiusMetres: number): IThemeProp => ({
    modelPath: `${MEDIEVAL_DIRECTORY}/${name}.gltf`,
    layer: PropLayer.Rock,
    footprintRadius: metres(footprintRadiusMetres),
    scaleRange: [MODULE_SCALE, MODULE_SCALE],
    family: DEFAULT_FAMILY,
    pack: "medieval-village",
});

const architectureProp = (name: string): IThemeProp => ({
    modelPath: `${ARCHITECTURE_DIRECTORY}/${name}.gltf`,
    layer: PropLayer.Rock,
    footprintRadius: metres(0.4),
    scaleRange: [MODULE_SCALE, MODULE_SCALE],
    family: DEFAULT_FAMILY,
    pack: "architecture",
});

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

export const SETTLEMENT_STRUCTURE_PROPS: IThemeProp[] = [
    ...Object.values(SETTLEMENT_MODULES),
    ...Object.values(SETTLEMENT_ROOFS),
];

export const SETTLEMENT_CLUTTER_PROPS: IThemeProp[] = [
    ...["Barrel", "Crate", "Cart", "Torch", "Pot1", "Pot2", "Pot3", "Chest"].map(architectureProp),
    medievalProp("Prop_Wagon", 1.0),
    medievalProp("Prop_Crate", 0.5),
];

export const SETTLEMENT_CLUTTER_BY_PATH: ReadonlyMap<string, IThemeProp> = new Map(
    SETTLEMENT_CLUTTER_PROPS.map((prop) => [prop.modelPath, prop])
);

export const SETTLEMENT_EXTRA_PRELOAD_PATHS: string[] = [
    ...SETTLEMENT_STRUCTURE_PROPS,
    ...SETTLEMENT_CLUTTER_PROPS,
].map((prop) => prop.modelPath);
