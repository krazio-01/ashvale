import { SettlementCellKind, type ISettlementBuildingTemplate } from "@/types/settlement";
import { SETTLEMENT_CLUTTER_PROPS, SETTLEMENT_ROOFS } from "@/world/settlement/SettlementKit";
import { QUARTER_TURN } from "@/lib/helpers";

const W = SettlementCellKind.Wall;
const D = SettlementCellKind.Door;
const N = SettlementCellKind.Window;
const F = SettlementCellKind.Floor;

/* Anchors sit a little beyond the wall line: offsetCell* equal to widthCells/depthCells is the
   wall plane itself, which buries the prop in the masonry. */
const ANCHOR_CLEARANCE = 0.75;

const clutterPathsNamed = (...names: string[]): string[] => {
    const wanted = new Set(names);

    return SETTLEMENT_CLUTTER_PROPS.filter((prop) =>
        wanted.has(prop.modelPath.slice(prop.modelPath.lastIndexOf("/") + 1, -5))
    ).map((prop) => prop.modelPath);
};

/* Small enough to sit beside a doorway without blocking it. */
const DOORSIDE_CLUTTER = clutterPathsNamed("Barrel", "Crate", "Prop_Crate", "Pot1", "Pot2", "Pot3");

/* Larger yard pieces, placed against a side wall where their footprint has room. */
const YARD_CLUTTER = clutterPathsNamed("Cart", "Prop_Wagon", "Chest", "Torch");

const SMALL_HOUSE: ISettlementBuildingTemplate = {
    id: "small-house",
    widthCells: 3,
    depthCells: 3,
    roof: SETTLEMENT_ROOFS.square6x6,
    roofYaw: 0,
    footprint: [
        [W, W, W],
        [W, F, N],
        [W, D, W],
    ],
    clutterAnchors: [
        {
            offsetCellX: 2.25,
            offsetCellZ: 3 + ANCHOR_CLEARANCE,
            rotationY: 0,
            allowedModelPaths: DOORSIDE_CLUTTER,
        },
        {
            offsetCellX: 3 + ANCHOR_CLEARANCE,
            offsetCellZ: 1.5,
            rotationY: QUARTER_TURN,
            allowedModelPaths: YARD_CLUTTER,
        },
    ],
};

const HALL: ISettlementBuildingTemplate = {
    id: "hall",
    widthCells: 3,
    depthCells: 5,
    roof: SETTLEMENT_ROOFS.long6x10,
    roofYaw: 0,
    footprint: [
        [W, W, W],
        [N, F, N],
        [W, F, W],
        [N, F, N],
        [W, D, W],
    ],
    clutterAnchors: [
        {
            offsetCellX: 2.25,
            offsetCellZ: 5 + ANCHOR_CLEARANCE,
            rotationY: 0,
            allowedModelPaths: DOORSIDE_CLUTTER,
        },
        {
            offsetCellX: 3 + ANCHOR_CLEARANCE,
            offsetCellZ: 2.5,
            rotationY: QUARTER_TURN,
            allowedModelPaths: YARD_CLUTTER,
        },
    ],
};

const WIDE_SHOP: ISettlementBuildingTemplate = {
    id: "wide-shop",
    widthCells: 5,
    depthCells: 3,
    roof: SETTLEMENT_ROOFS.long6x10,
    roofYaw: QUARTER_TURN,
    footprint: [
        [W, N, W, N, W],
        [W, F, F, F, W],
        [W, W, D, W, W],
    ],
    clutterAnchors: [
        {
            offsetCellX: 3.75,
            offsetCellZ: 3 + ANCHOR_CLEARANCE,
            rotationY: 0,
            allowedModelPaths: DOORSIDE_CLUTTER,
        },
        {
            offsetCellX: 5 + ANCHOR_CLEARANCE,
            offsetCellZ: 1.5,
            rotationY: QUARTER_TURN,
            allowedModelPaths: YARD_CLUTTER,
        },
    ],
};

export const SETTLEMENT_TEMPLATES: ISettlementBuildingTemplate[] = [SMALL_HOUSE, HALL, WIDE_SHOP];
