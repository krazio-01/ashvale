import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import { Object3D, type Vector3Tuple } from "three";
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { WORLD_EDGE } from "@/constants/world";

export class WalkableEdgeBarrier extends Entity implements IWorldEntity {
    readonly sceneObject = new Object3D();

    private readonly context: IWorldContext;
    private readonly rigidBody: RigidBody;

    constructor(context: IWorldContext, center: Vector3Tuple, heightMap: TerrainHeightMap) {
        super("walkable-edge-barrier");
        this.context = context;

        const fence = buildFenceAlongFootprint(heightMap);

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], 0, center[2])
        );

        context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.trimesh(fence.positions, fence.indices),
            this.rigidBody
        );
    }

    update(): void {}

    dispose(): void {
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
    }
}

function buildFenceAlongFootprint(heightMap: TerrainHeightMap): IFenceMesh {
    const standingReach = WORLD_EDGE.groundApron + WORLD_EDGE.lipWidth * WORLD_EDGE.barrierLipRatio;
    const pointsPerSide = heightMap.pointsPerSide;
    const halfCell = heightMap.cellSize / 2;

    const positionValues: number[] = [];
    const indexValues: number[] = [];

    const isStandingGround = (row: number, column: number): boolean =>
        heightMap.footprintDistanceAtPoint(row * pointsPerSide + column) <= standingReach;

    const addPanel = (
        centerX: number,
        centerZ: number,
        spanX: number,
        spanZ: number,
        elevation: number
    ): void => {
        const firstVertex = positionValues.length / 3;
        const bottom = elevation - WORLD_EDGE.barrierSink;
        const top = elevation + WORLD_EDGE.barrierHeight;

        positionValues.push(
            centerX - spanX,
            bottom,
            centerZ - spanZ,
            centerX + spanX,
            bottom,
            centerZ + spanZ,
            centerX - spanX,
            top,
            centerZ - spanZ,
            centerX + spanX,
            top,
            centerZ + spanZ
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

    for (let row = 0; row < pointsPerSide; row += 1) {
        const localZ = heightMap.originZ + row * heightMap.cellSize;

        for (let column = 0; column < pointsPerSide; column += 1) {
            const localX = heightMap.originX + column * heightMap.cellSize;
            if (!isStandingGround(row, column)) continue;

            const elevation = heightMap.elevationAtPoint(row * pointsPerSide + column);

            if (column + 1 >= pointsPerSide || !isStandingGround(row, column + 1))
                addPanel(localX + halfCell, localZ, 0, halfCell, elevation);

            if (column === 0 || !isStandingGround(row, column - 1))
                addPanel(localX - halfCell, localZ, 0, halfCell, elevation);

            if (row + 1 >= pointsPerSide || !isStandingGround(row + 1, column))
                addPanel(localX, localZ + halfCell, halfCell, 0, elevation);

            if (row === 0 || !isStandingGround(row - 1, column))
                addPanel(localX, localZ - halfCell, halfCell, 0, elevation);
        }
    }

    return { positions: new Float32Array(positionValues), indices: new Uint32Array(indexValues) };
}

interface IFenceMesh {
    positions: Float32Array;
    indices: Uint32Array;
}
