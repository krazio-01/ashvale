import { SettlementCellKind, type ISettlementBuildingTemplate } from "@/types/settlement";
import type { ISettlementColliderDesc, ISettlementPlacement } from "@/types/settlement";
import type { IThemeProp } from "@/types/theme";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import {
    CELL_SIZE,
    CHIMNEY_ELEVATION,
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

/* Outward direction of each perimeter edge in the template's own frame, used both to yaw the
   module (rotationY = 0 faces local -Z) and to push the collider out to the wall's face. */
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

export interface IGenerateBuildingInput {
    template: ISettlementBuildingTemplate;
    originLocalX: number;
    originLocalZ: number;
    /* The building's own yaw; rotationY = 0 means a module's front face points local -Z. */
    yaw: number;
    heightMap: TerrainSampleGrid;
    nextRandom: () => number;
}

export interface IGeneratedBuilding {
    placements: ISettlementPlacement[];
    colliders: ISettlementColliderDesc[];
    footprintRadius: number;
    doorLocalX: number;
    doorLocalZ: number;
}

export function generateBuilding(input: IGenerateBuildingInput): IGeneratedBuilding {
    const { template, originLocalX, originLocalZ, yaw, heightMap, nextRandom } = input;
    const { widthCells, depthCells, footprint } = template;

    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const eastEdgeLocalX = widthCells * CELL_SIZE;
    const southEdgeLocalZ = depthCells * CELL_SIZE;

    const placements: ISettlementPlacement[] = [];
    const colliders: ISettlementColliderDesc[] = [];
    let doorLocalX = originLocalX;
    let doorLocalZ = originLocalZ;

    /* Must match three's Object3D.rotation.y matrix, which PropBatch applies to the instances:
       x' = x*cos + z*sin, z' = -x*sin + z*cos. */
    const rotatedX = (cellX: number, cellZ: number): number =>
        originLocalX + cellX * cosYaw + cellZ * sinYaw;
    const rotatedZ = (cellX: number, cellZ: number): number =>
        originLocalZ - cellX * sinYaw + cellZ * cosYaw;

    /* One sample for the whole building: per-module terrain sampling shears the rigid kit apart
       on any slope. Region sites are flattened plateaus, so a single sample is accurate. */
    const baseElevation = heightMap.surfaceElevationAt(
        rotatedX(eastEdgeLocalX / 2, southEdgeLocalZ / 2),
        rotatedZ(eastEdgeLocalX / 2, southEdgeLocalZ / 2)
    );

    const addPlacement = (
        prop: IThemeProp,
        cellX: number,
        cellZ: number,
        localYaw: number,
        heightAboveFloor: number,
        hasCollider = false
    ): void => {
        placements.push({
            prop,
            localX: rotatedX(cellX, cellZ),
            localZ: rotatedZ(cellX, cellZ),
            elevation: baseElevation + heightAboveFloor,
            rotationY: yaw + localYaw,
            scale: MODULE_SCALE,
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

        /* Upper courses never carry a door - a first-floor doorway opens onto nothing - so a door
           cell becomes a window above, which also gives the facade some rhythm. */
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

        /* The wall body sits WALL_FACE_OFFSET outboard of the module origin, so the collider is
           pushed along the edge's outward normal to line up with what the player can see. Its
           half-extents describe the module before rotation - a wall always spans X and is thin in
           Z - and rotationY is what turns it onto the correct edge. */
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

            /* A corner cell lies on two edges and owes a wall to each: emitting only the corner
               post would leave most of every face open. Interior wall cells are not supported in
               v1 (no partitions), and are skipped rather than silently snapped to an edge. */
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

            for (let course = 0; course < WALL_COURSES; course += 1)
                addPlacement(
                    SETTLEMENT_MODULES.corner,
                    cornerX,
                    cornerZ,
                    cornerYaw,
                    WALL_COURSE_HEIGHT * course
                );

            colliders.push({
                localX: rotatedX(cornerX, cornerZ),
                localZ: rotatedZ(cornerX, cornerZ),
                elevation: baseElevation,
                halfWidth: CORNER_HALF_EXTENT,
                halfHeight: WALL_HEIGHT / 2,
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
            /* Anchors sit outside the footprint, off the flattened pad the building shares, so
               these do sample the terrain individually. */
            elevation: heightMap.surfaceElevationAt(anchorX, anchorZ),
            rotationY: yaw + anchor.rotationY,
            scale: MODULE_SCALE,
            /* Free-standing clutter, not part of the shell - a real cylinder collider via
               PropBatch.addColliders, same mechanism every other Rock-layer prop already uses. */
            hasCollider: true,
        });
    }

    return {
        placements,
        colliders,
        /* Includes the roof overhang: the roof is what neighbours and scattered props must clear,
           not the wall footprint. */
        footprintRadius: Math.hypot(eastEdgeLocalX, southEdgeLocalZ) / 2 + ROOF_OVERHANG,
        doorLocalX,
        doorLocalZ,
    };
}
