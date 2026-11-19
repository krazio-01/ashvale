import { createStaticColliders } from "@/systems/physics/RapierWorld";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import { Object3D, type Vector3Tuple } from "three";
import type { IEdgeStrip, IWorldContext, IWorldEntity } from "@/types/world";
import type { LandMap } from "@/world/terrain/LandMap";
import type { ITriangleMesh } from "@/types/physics";
import { BORDER_BARRIER } from "@/constants/world";
import { JUMP_CLIMB, PLAYER, WADING } from "@/constants/player";
import { clamp, freezeTransform, lerp } from "@/lib/helpers";
import {
    edgeDropDepthAt,
    edgeDropRunOf,
    edgeDropWeightAt,
} from "@/world/terrain/TerrainGeneration";

export class TerrainEdgeBarrier implements IWorldEntity {
    private static readonly SEGMENT_EDGES_BY_CASE: readonly (readonly number[])[] = [
        [],
        [3, 0],
        [0, 1],
        [3, 1],
        [1, 2],
        [3, 0, 1, 2],
        [0, 2],
        [3, 2],
        [2, 3],
        [0, 2],
        [0, 1, 2, 3],
        [1, 2],
        [1, 3],
        [0, 1],
        [0, 3],
        [],
    ];

    private static readonly CORNER_STEPS: readonly (readonly [number, number])[] = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
    ];

    private static buildFenceAlongWalkableLimit(
        landMap: LandMap,
        guardedStrips: readonly IEdgeStrip[]
    ): ITriangleMesh {
        const { pointsPerSide, cellSize, originX, originZ } = landMap;
        const margins = new Float32Array(pointsPerSide * pointsPerSide);
        const { dropHeight } = landMap.border;
        const dropRun = edgeDropRunOf(landMap.border);

        for (let index = 0; index < margins.length; index += 1) {
            const footprintMargin =
                landMap.fenceReach - landMap.valueAtPoint("footprintDistance", index);
            const waterMargin =
                WADING.maxDepth -
                landMap.valueAtPoint("waterDepth", index) +
                PLAYER.radius * landMap.valueAtPoint("steepness", index);
            let margin = Math.min(footprintMargin, waterMargin);
            const localX = originX + (index % pointsPerSide) * cellSize;
            const localZ = originZ + Math.floor(index / pointsPerSide) * cellSize;
            for (const strip of guardedStrips)
                margin = Math.min(
                    margin,
                    JUMP_CLIMB.stepRise -
                        edgeDropWeightAt(strip, localX, localZ) *
                            edgeDropDepthAt(strip, localX, localZ, dropHeight, dropRun)
                );
            margins[index] = margin;
        }

        const positionValues: number[] = [];
        const indexValues: number[] = [];
        const edgeCrossing = (row: number, column: number, edge: number): Vector3Tuple => {
            const [fromRow, fromColumn] = TerrainEdgeBarrier.CORNER_STEPS[edge];
            const [toRow, toColumn] = TerrainEdgeBarrier.CORNER_STEPS[(edge + 1) % 4];
            const fromIndex = (row + fromRow) * pointsPerSide + column + fromColumn;
            const toIndex = (row + toRow) * pointsPerSide + column + toColumn;
            const ratio = clamp(margins[fromIndex] / (margins[fromIndex] - margins[toIndex]), 0, 1);

            return [
                originX + (column + lerp(fromColumn, toColumn, ratio)) * cellSize,
                lerp(
                    landMap.valueAtPoint("elevation", fromIndex),
                    landMap.valueAtPoint("elevation", toIndex),
                    ratio
                ),
                originZ + (row + lerp(fromRow, toRow, ratio)) * cellSize,
            ];
        };
        const addWall = (
            [startX, startY, startZ]: Vector3Tuple,
            [endX, endY, endZ]: Vector3Tuple
        ) => {
            const firstVertex = positionValues.length / 3;
            positionValues.push(
                startX,
                startY - BORDER_BARRIER.sink,
                startZ,
                endX,
                endY - BORDER_BARRIER.sink,
                endZ,
                startX,
                startY + BORDER_BARRIER.height,
                startZ,
                endX,
                endY + BORDER_BARRIER.height,
                endZ
            );
            indexValues.push(
                firstVertex,
                firstVertex + 1,
                firstVertex + 2,
                firstVertex + 2,
                firstVertex + 1,
                firstVertex + 3
            );
        };

        for (let row = 0; row + 1 < pointsPerSide; row += 1) {
            for (let column = 0; column + 1 < pointsPerSide; column += 1) {
                const nearLeft = row * pointsPerSide + column;
                const farLeft = nearLeft + pointsPerSide;
                const standingCase =
                    (margins[nearLeft] >= 0 ? 1 : 0) |
                    (margins[nearLeft + 1] >= 0 ? 2 : 0) |
                    (margins[farLeft + 1] >= 0 ? 4 : 0) |
                    (margins[farLeft] >= 0 ? 8 : 0);

                const edges = TerrainEdgeBarrier.SEGMENT_EDGES_BY_CASE[standingCase];
                for (let pair = 0; pair < edges.length; pair += 2)
                    addWall(
                        edgeCrossing(row, column, edges[pair]),
                        edgeCrossing(row, column, edges[pair + 1])
                    );
            }
        }

        return {
            positions: new Float32Array(positionValues),
            indices: new Uint32Array(indexValues),
        };
    }

    readonly sceneObject = new Object3D();

    private readonly context: IWorldContext;
    private readonly rigidBody: RigidBody;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        landMap: LandMap,
        edgeStrips: readonly IEdgeStrip[]
    ) {
        this.context = context;

        const fence = TerrainEdgeBarrier.buildFenceAlongWalkableLimit(
            landMap,
            edgeStrips.filter((strip) => strip.isGuarded)
        );
        this.rigidBody = createStaticColliders(
            context.physicsWorld,
            fence.positions.length > 0
                ? [{ kind: "trimesh", fixesInternalEdges: true, ...fence, wallRunnable: false }]
                : [],
            center
        );
        freezeTransform(this.sceneObject);
    }

    dispose(): void {
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
    }
}
