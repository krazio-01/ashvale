import { SettlementCellKind, type ISettlementBuildingTemplate } from "@/types/world";
import { SETTLEMENT_CLUTTER, SETTLEMENT_ROOFS } from "@/world/settlement/SettlementKit";
import { QUARTER_TURN } from "@/lib/helpers";

const WALL = SettlementCellKind.Wall;
const DOOR = SettlementCellKind.Door;
const WINDOW = SettlementCellKind.Window;
const FLOOR = SettlementCellKind.Floor;

const ANCHOR_CLEARANCE = 0.75;

const { barrel, crate, cart, torch, pot1, pot2, pot3, chest, wagon, propCrate } =
    SETTLEMENT_CLUTTER;

const DOORSIDE_CLUTTER = [barrel, crate, pot1, pot2, pot3, propCrate];

const YARD_CLUTTER = [cart, torch, chest, wagon];

const SMALL_HOUSE: ISettlementBuildingTemplate = {
    id: "small-house",
    widthCells: 3,
    depthCells: 3,
    roof: SETTLEMENT_ROOFS.square6x6,
    roofYaw: 0,
    footprint: [
        [WALL, WALL, WALL],
        [WALL, FLOOR, WINDOW],
        [WALL, DOOR, WALL],
    ],
    clutterAnchors: [
        {
            offsetCellX: 2.25,
            offsetCellZ: 3 + ANCHOR_CLEARANCE,
            rotationY: 0,
            allowedProps: DOORSIDE_CLUTTER,
        },
        {
            offsetCellX: 3 + ANCHOR_CLEARANCE,
            offsetCellZ: 1.5,
            rotationY: QUARTER_TURN,
            allowedProps: YARD_CLUTTER,
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
        [WALL, WALL, WALL],
        [WINDOW, FLOOR, WINDOW],
        [WALL, FLOOR, WALL],
        [WINDOW, FLOOR, WINDOW],
        [WALL, DOOR, WALL],
    ],
    clutterAnchors: [
        {
            offsetCellX: 2.25,
            offsetCellZ: 5 + ANCHOR_CLEARANCE,
            rotationY: 0,
            allowedProps: DOORSIDE_CLUTTER,
        },
        {
            offsetCellX: 3 + ANCHOR_CLEARANCE,
            offsetCellZ: 2.5,
            rotationY: QUARTER_TURN,
            allowedProps: YARD_CLUTTER,
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
        [WALL, WINDOW, WALL, WINDOW, WALL],
        [WALL, FLOOR, FLOOR, FLOOR, WALL],
        [WALL, WALL, DOOR, WALL, WALL],
    ],
    clutterAnchors: [
        {
            offsetCellX: 3.75,
            offsetCellZ: 3 + ANCHOR_CLEARANCE,
            rotationY: 0,
            allowedProps: DOORSIDE_CLUTTER,
        },
        {
            offsetCellX: 5 + ANCHOR_CLEARANCE,
            offsetCellZ: 1.5,
            rotationY: QUARTER_TURN,
            allowedProps: YARD_CLUTTER,
        },
    ],
};

export const SETTLEMENT_TEMPLATES: ISettlementBuildingTemplate[] = [SMALL_HOUSE, HALL, WIDE_SHOP];
