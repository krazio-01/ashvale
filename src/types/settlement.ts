import type { IThemeProp } from "@/types/theme";

export enum SettlementCellKind {
    Empty = "empty",
    Floor = "floor",
    Wall = "wall",
    Door = "door",
    Window = "window",
}

export interface ISettlementClutterAnchor {
    /* Offset in grid cells from the template's (0,0) origin corner. Fractional values sit outside
       the footprint, e.g. 3.5 places the anchor half a cell past the last row. */
    offsetCellX: number;
    offsetCellZ: number;
    rotationY: number;
    allowedModelPaths: string[];
}

export interface ISettlementBuildingTemplate {
    id: string;
    widthCells: number;
    depthCells: number;
    /* One prebuilt pitched roof covers the whole footprint; roofYaw turns a rectangular roof onto
       a footprint that is wider than it is deep. */
    roof: IThemeProp;
    roofYaw: number;
    /* Row-major: outer array is Z rows (0 = north edge), inner array is X columns (0 = west edge).
       Every row holds exactly widthCells entries and there are exactly depthCells rows. */
    footprint: SettlementCellKind[][];
    clutterAnchors: ISettlementClutterAnchor[];
}

export interface ISettlementColliderDesc {
    localX: number;
    localZ: number;
    elevation: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
    rotationY: number;
}

export interface ISettlementPlacement {
    prop: IThemeProp;
    localX: number;
    localZ: number;
    elevation: number;
    rotationY: number;
    scale: number;
    /* Structural modules (walls, corners, roof, floor, chimney) are false: walls/corners get a
       bespoke oriented-cuboid collider from SettlementColliders instead of PropBatch's default
       cylinder, and roof/floor/chimney are unreachable or already walked-on. Clutter (crates,
       barrels, wagons) is true so PropBatch.addColliders builds a real cylinder collider for it -
       without this, placed clutter had no collision at all and the player walked through it. */
    hasCollider: boolean;
}

export interface ISettlementKeepOutDisc {
    localX: number;
    localZ: number;
    radius: number;
}

export interface ISettlementKeepOutLane {
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    halfWidth: number;
}

export interface ISettlementLayoutResult {
    placements: ISettlementPlacement[];
    colliders: ISettlementColliderDesc[];
    keepOutDiscs: ISettlementKeepOutDisc[];
    keepOutLanes: ISettlementKeepOutLane[];
}
