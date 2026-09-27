import { SettlementCellKind, type ISettlementBuildingTemplate } from "@/types/settlement";
import type { ISettlementColliderDesc, ISettlementPlacement } from "@/types/settlement";
import type { IThemeProp } from "@/types/theme";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import {
    CELL_SIZE,
    CHIMNEY_ELEVATION,
    CORNER_COURSE_HEIGHT,
    MODULE_SCALE,
    ROOF_ELEVATION,
    ROOF_OVERHANG,
    SETTLEMENT_CLUTTER_BY_PATH,
    SETTLEMENT_MODULES,
    WALL_COURSES,
    WALL_COURSE_HEIGHT,
    WALL_FACE_OFFSET,
    WALL_HALF_THICKNESS,
    WALL_HEIGHT,
} from "@/world/settlement/SettlementKit";
import { metres, QUARTER_TURN } from "@/lib/helpers";

const HALF_TURN = Math.PI;
const THREE_QUARTER_TURN = QUARTER_TURN * 3;
const CORNER_HALF_EXTENT = metres(0.15);

const enum Edge {
    North,
    South,
    West,
    East,
}

const EDGE_YAW: Record<Edge, number> = {
    [Edge.North]: 0,
    [Edge.South]: HALF_TURN,
    [Edge.West]: QUARTER_TURN,
    [Edge.East]: THREE_QUARTER_TURN,
};

interface IGenerateBuildingInput {
    template: ISettlementBuildingTemplate;
    originLocalX: number;
    originLocalZ: number;
    yaw: number;
    heightMap: TerrainSampleGrid;
    nextRandom: () => number;
    floorElevation: number;
}

interface IGeneratedBuilding {
    placements: ISettlementPlacement[];
    colliders: ISettlementColliderDesc[];
    footprintRadius: number;
    doorLocalX: number;
    doorLocalZ: number;
}

export function generateBuilding(input: IGenerateBuildingInput): IGeneratedBuilding {
    const { template, originLocalX, originLocalZ, yaw, heightMap, nextRandom, floorElevation } =
        input;
    const { widthCells, depthCells, footprint } = template;

    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const eastEdgeLocalX = widthCells * CELL_SIZE;
    const southEdgeLocalZ = depthCells * CELL_SIZE;

    const placements: ISettlementPlacement[] = [];
    const colliders: ISettlementColliderDesc[] = [];
    let doorLocalX = originLocalX;
    let doorLocalZ = originLocalZ;

    const rotatedX = (cellX: number, cellZ: number): number =>
        originLocalX + cellX * cosYaw + cellZ * sinYaw;
    const rotatedZ = (cellX: number, cellZ: number): number =>
        originLocalZ - cellX * sinYaw + cellZ * cosYaw;

    const groundElevations = [
        heightMap.surfaceElevationAt(rotatedX(0, 0), rotatedZ(0, 0)),
        heightMap.surfaceElevationAt(rotatedX(eastEdgeLocalX, 0), rotatedZ(eastEdgeLocalX, 0)),
        heightMap.surfaceElevationAt(rotatedX(0, southEdgeLocalZ), rotatedZ(0, southEdgeLocalZ)),
        heightMap.surfaceElevationAt(
            rotatedX(eastEdgeLocalX, southEdgeLocalZ),
            rotatedZ(eastEdgeLocalX, southEdgeLocalZ)
        ),
        heightMap.surfaceElevationAt(
            rotatedX(eastEdgeLocalX / 2, southEdgeLocalZ / 2),
            rotatedZ(eastEdgeLocalX / 2, southEdgeLocalZ / 2)
        ),
    ];
    const baseElevation = Math.min(...groundElevations, floorElevation) - 0.05;

    const addPlacement = (
        prop: IThemeProp,
        cellX: number,
        cellZ: number,
        localYaw: number,
        heightAboveFloor: number,
        hasCollider = false,
        scale = MODULE_SCALE
    ): void => {
        placements.push({
            prop,
            localX: rotatedX(cellX, cellZ),
            localZ: rotatedZ(cellX, cellZ),
            elevation: baseElevation + heightAboveFloor,
            rotationY: yaw + localYaw,
            scale,
            hasCollider,
        });
    };

    const addWall = (kind: SettlementCellKind, edge: Edge, cellX: number, cellZ: number): void => {
        const edgeYaw = EDGE_YAW[edge];
        const groundModule =
            kind === SettlementCellKind.Door
                ? SETTLEMENT_MODULES.wallDoor
                : kind === SettlementCellKind.Window
                  ? SETTLEMENT_MODULES.wallWindow
                  : SETTLEMENT_MODULES.wall;

        addPlacement(groundModule, cellX, cellZ, edgeYaw, 0);

        const upperModule =
            kind === SettlementCellKind.Wall
                ? SETTLEMENT_MODULES.wall
                : SETTLEMENT_MODULES.wallWindow;

        for (let course = 1; course < WALL_COURSES; course += 1)
            addPlacement(upperModule, cellX, cellZ, edgeYaw, WALL_COURSE_HEIGHT * course);

        if (kind === SettlementCellKind.Door) {
            doorLocalX = rotatedX(cellX, cellZ);
            doorLocalZ = rotatedZ(cellX, cellZ);

            return;
        }

        const outwardX = edge === Edge.West ? -1 : edge === Edge.East ? 1 : 0;
        const outwardZ = edge === Edge.North ? -1 : edge === Edge.South ? 1 : 0;

        colliders.push({
            localX: rotatedX(
                cellX + outwardX * WALL_FACE_OFFSET,
                cellZ + outwardZ * WALL_FACE_OFFSET
            ),
            localZ: rotatedZ(
                cellX + outwardX * WALL_FACE_OFFSET,
                cellZ + outwardZ * WALL_FACE_OFFSET
            ),
            elevation: baseElevation,
            halfWidth: CELL_SIZE / 2,
            halfHeight: WALL_HEIGHT / 2,
            halfDepth: WALL_HALF_THICKNESS,
            rotationY: yaw + edgeYaw,
        });
    };

    for (let row = 0; row < depthCells; row += 1) {
        const rowCells = footprint[row];
        if (!rowCells) continue;

        const isNorthEdge = row === 0;
        const isSouthEdge = row === depthCells - 1;
        const cellCenterZ = (row + 0.5) * CELL_SIZE;

        for (let col = 0; col < widthCells; col += 1) {
            const kind = rowCells[col] ?? SettlementCellKind.Empty;
            if (kind === SettlementCellKind.Empty) continue;

            const isWestEdge = col === 0;
            const isEastEdge = col === widthCells - 1;
            const cellCenterX = (col + 0.5) * CELL_SIZE;

            if (kind === SettlementCellKind.Floor) {
                addPlacement(SETTLEMENT_MODULES.floor, cellCenterX, cellCenterZ, 0, 0);
                continue;
            }

            if (isNorthEdge) addWall(kind, Edge.North, cellCenterX, 0);
            if (isSouthEdge) addWall(kind, Edge.South, cellCenterX, southEdgeLocalZ);
            if (isWestEdge) addWall(kind, Edge.West, 0, cellCenterZ);
            if (isEastEdge) addWall(kind, Edge.East, eastEdgeLocalX, cellCenterZ);

            const isCorner = (isNorthEdge || isSouthEdge) && (isWestEdge || isEastEdge);
            if (!isCorner) continue;

            const cornerX = isWestEdge ? 0 : eastEdgeLocalX;
            const cornerZ = isNorthEdge ? 0 : southEdgeLocalZ;
            const cornerYaw = isNorthEdge
                ? isWestEdge
                    ? 0
                    : THREE_QUARTER_TURN
                : isWestEdge
                  ? QUARTER_TURN
                  : HALF_TURN;

            const outwardX = isWestEdge ? -1 : 1;
            const outwardZ = isNorthEdge ? -1 : 1;
            const cornerPosX = cornerX + outwardX * WALL_FACE_OFFSET;
            const cornerPosZ = cornerZ + outwardZ * WALL_FACE_OFFSET;
            const cornerScale = MODULE_SCALE * (WALL_COURSE_HEIGHT / CORNER_COURSE_HEIGHT);

            for (let course = 0; course < WALL_COURSES; course += 1)
                addPlacement(
                    SETTLEMENT_MODULES.corner,
                    cornerPosX,
                    cornerPosZ,
                    cornerYaw,
                    WALL_COURSE_HEIGHT * course,
                    false,
                    cornerScale
                );

            const cornerStackHeight = WALL_COURSE_HEIGHT * WALL_COURSES;

            colliders.push({
                localX: rotatedX(cornerPosX, cornerPosZ),
                localZ: rotatedZ(cornerPosX, cornerPosZ),
                elevation: baseElevation,
                halfWidth: CORNER_HALF_EXTENT,
                halfHeight: cornerStackHeight / 2,
                halfDepth: CORNER_HALF_EXTENT,
                rotationY: yaw + cornerYaw,
            });
        }
    }

    const centreCellX = eastEdgeLocalX / 2;
    const centreCellZ = southEdgeLocalZ / 2;

    addPlacement(template.roof, centreCellX, centreCellZ, template.roofYaw, ROOF_ELEVATION);
    addPlacement(SETTLEMENT_MODULES.chimney, centreCellX, centreCellZ, 0, CHIMNEY_ELEVATION);

    for (const anchor of template.clutterAnchors) {
        const { allowedModelPaths } = anchor;
        if (allowedModelPaths.length === 0) continue;

        const modelPath = allowedModelPaths[Math.floor(nextRandom() * allowedModelPaths.length)];
        const clutter = modelPath ? SETTLEMENT_CLUTTER_BY_PATH.get(modelPath) : undefined;
        if (!clutter) continue;

        const anchorCellX = anchor.offsetCellX * CELL_SIZE;
        const anchorCellZ = anchor.offsetCellZ * CELL_SIZE;
        const anchorX = rotatedX(anchorCellX, anchorCellZ);
        const anchorZ = rotatedZ(anchorCellX, anchorCellZ);

        placements.push({
            prop: clutter,
            localX: anchorX,
            localZ: anchorZ,
            elevation: heightMap.surfaceElevationAt(anchorX, anchorZ),
            rotationY: yaw + anchor.rotationY,
            scale: MODULE_SCALE,
            hasCollider: true,
        });
    }

    return {
        placements,
        colliders,
        footprintRadius: Math.hypot(eastEdgeLocalX, southEdgeLocalZ) / 2 + ROOF_OVERHANG,
        doorLocalX,
        doorLocalZ,
    };
}
