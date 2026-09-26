import type { IThemeProp } from "@/types/theme";

export enum SettlementCellKind {
    Empty = "empty",
    Floor = "floor",
    Wall = "wall",
    Door = "door",
    Window = "window",
}

interface ISettlementClutterAnchor {
    offsetCellX: number;
    offsetCellZ: number;
    rotationY: number;
    allowedModelPaths: string[];
}

export interface ISettlementBuildingTemplate {
    id: string;
    widthCells: number;
    depthCells: number;
    roof: IThemeProp;
    roofYaw: number;
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
    hasCollider: boolean;
}

export interface ISettlementKeepOutDisc {
    localX: number;
    localZ: number;
    radius: number;
}

interface ISettlementKeepOutLane {
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
