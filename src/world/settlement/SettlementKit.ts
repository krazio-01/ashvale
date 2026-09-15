import { DEFAULT_FAMILY, PropLayer, type IThemeProp } from "@/types/theme";
import { SCALE } from "@/constants/world";
import { metres } from "@/lib/helpers";

/* The kit's meshes are authored one unit per metre, but this world runs at SCALE.unitsPerMetre
   units per metre (the player is metres(2.1) tall). Placing a module at scale 1 therefore makes
   it half size - which is why the player stood taller than a house. Every settlement module is
   placed at MODULE_SCALE, and every linear constant below is a real-world measurement passed
   through metres() rather than a bare number. */
export const MODULE_SCALE = SCALE.unitsPerMetre;

export const CELL_SIZE = metres(2);

/* Wall_Plaster_Straight is 3.12m tall. The kit is a multi-storey one - it ships a base course,
   interior stairs and balconies - and its roofs are sized to match: a single course under
   Roof_RoundTiles_6x6 gives a roof 1.8x the wall height, which reads as a mushroom. Two courses
   bring that to 0.91x, the proportion of an actual house. */
const WALL_COURSE_METRES = 3.12;
export const WALL_COURSES = 2;
export const WALL_COURSE_HEIGHT = metres(WALL_COURSE_METRES);
export const WALL_HEIGHT = WALL_COURSE_HEIGHT * WALL_COURSES;

/* Measured from the kit's meshes, which is why these are not round numbers: Roof_RoundTiles_*
   hangs 0.78m below its origin and peaks 4.89m above it, and Prop_Chimney is 3.18m tall.
   Lifting the roof by the eave drop seats its eaves on the wall top, and the chimney is raised
   so its cap clears the ridge instead of being buried in the roof. */
const ROOF_EAVE_DROP = metres(0.78);
const ROOF_PEAK = metres(4.89);
const CHIMNEY_MESH_HEIGHT = metres(3.18);
const CHIMNEY_RIDGE_CLEARANCE = metres(1.0);

/* Wall_Plaster_Straight spans z in [-0.31, 0.09]: 0.4m thick, and its body sits 0.11m outboard
   of the module origin rather than centred on it. */
export const WALL_HALF_THICKNESS = metres(0.2);
export const WALL_FACE_OFFSET = metres(0.11);

/* How far a prebuilt roof oversails the walls it covers - Roof_RoundTiles_6x6 is 8.25m across a
   6m footprint. Neighbours and scattered props have to clear the roof, not the wall line. */
export const ROOF_OVERHANG = metres(1.15);

export const ROOF_ELEVATION = WALL_HEIGHT + ROOF_EAVE_DROP;
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

/* The kit ships prebuilt pitched roofs sized to a footprint in metres rather than flat tiles, so
   a building takes one roof mesh instead of a per-cell grid. Named {width}x{depth}. */
export const SETTLEMENT_ROOFS = {
    square6x6: medievalProp("Roof_RoundTiles_6x6", 4.2),
    long6x10: medievalProp("Roof_RoundTiles_6x10", 6.0),
} as const;

export const SETTLEMENT_STRUCTURE_PROPS: IThemeProp[] = [
    ...Object.values(SETTLEMENT_MODULES),
    ...Object.values(SETTLEMENT_ROOFS),
];

/* Placed by hand at template anchors, never fed to the natural scatter pipeline. */
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
