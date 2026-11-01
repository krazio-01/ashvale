import RAPIER from "@dimforge/rapier3d-compat";
import { createFixedBody } from "@/systems/physics/RapierWorld";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import {
    BoxGeometry,
    Color,
    Group,
    InstancedMesh,
    MeshLambertMaterial,
    Object3D,
    type Vector3Tuple,
} from "three";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import {
    corridorStepFaceDistance,
    type TerrainSampleGrid,
} from "@/world/terrain/TerrainGeneration";
import { CorridorClimbStyle, type ICorridorPath } from "@/types/world";
import { TERRAIN, WORLD, WORLD_EDGE } from "@/constants/world";
import { LEDGE_STEPS } from "@/constants/placement";
import { PLAYER } from "@/constants/player";
import {
    clamp,
    createSeededRandom,
    FULL_TURN,
    randomOffset,
    freezeTransform,
    yawQuaternion,
    segmentFrame,
} from "@/lib/helpers";

interface IFenceMesh {
    positions: Float32Array;
    indices: Uint32Array;
}

interface IClimbAbility {
    targetRise: number;
    safeMaxRise: number;
}

interface ITread {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
    baseElevation: number;
    topElevation: number;
    rotationY: number;
}

export class TerrainEdgeBarrier implements IWorldEntity {
    private static buildFenceAlongFootprint(sampleGrid: TerrainSampleGrid): IFenceMesh {
        const standingReach =
            WORLD_EDGE.flatBorderWidth + WORLD_EDGE.lipWidth * WORLD_EDGE.barrierLipRatio;
        const pointsPerSide = sampleGrid.pointsPerSide;
        const halfCell = sampleGrid.cellSize / 2;

        const positionValues: number[] = [];
        const indexValues: number[] = [];

        const isStandingGround = (row: number, column: number): boolean =>
            sampleGrid.valueAtPoint("footprintDistance", row * pointsPerSide + column) <=
            standingReach;

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
            const localZ = sampleGrid.originZ + row * sampleGrid.cellSize;

            for (let column = 0; column < pointsPerSide; column += 1) {
                const localX = sampleGrid.originX + column * sampleGrid.cellSize;
                if (!isStandingGround(row, column)) continue;

                const elevation = sampleGrid.valueAtPoint(
                    "elevation",
                    row * pointsPerSide + column
                );

                if (column + 1 >= pointsPerSide || !isStandingGround(row, column + 1))
                    addPanel(localX + halfCell, localZ, 0, halfCell, elevation);

                if (column === 0 || !isStandingGround(row, column - 1))
                    addPanel(localX - halfCell, localZ, 0, -halfCell, elevation);

                if (row + 1 >= pointsPerSide || !isStandingGround(row + 1, column))
                    addPanel(localX, localZ + halfCell, -halfCell, 0, elevation);

                if (row === 0 || !isStandingGround(row - 1, column))
                    addPanel(localX, localZ - halfCell, halfCell, 0, elevation);
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

    constructor(context: IWorldContext, center: Vector3Tuple, sampleGrid: TerrainSampleGrid) {
        this.context = context;

        const fence = TerrainEdgeBarrier.buildFenceAlongFootprint(sampleGrid);
        this.rigidBody = createFixedBody(context.physicsWorld, center);

        if (fence.positions.length > 0)
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

export class TerrainLedges implements IWorldEntity {
    private static resolveStepCount(
        climbHeight: number,
        spanLength: number,
        averageRockHalfWidth: number,
        climb: IClimbAbility
    ): number {
        const naturalStepCount = Math.ceil(climbHeight / climb.targetRise);
        const spacing = averageRockHalfWidth * 2;
        const maxAvailableSpan = spanLength * LEDGE_STEPS.maxAlongCorridorRatio;
        const spanLimitedStepCount = Math.max(1, Math.floor(maxAvailableSpan / spacing));
        const minSafeStepCount = Math.ceil(climbHeight / climb.safeMaxRise);

        return Math.max(minSafeStepCount, Math.min(naturalStepCount, spanLimitedStepCount));
    }

    private static lateralOffsetFor(
        style: CorridorClimbStyle,
        step: number,
        lateralReach: number,
        hiddenSide: number,
        nextRandom: () => number
    ): number {
        const scatter = randomOffset(nextRandom, lateralReach / 2);

        if (style === CorridorClimbStyle.Hidden)
            return hiddenSide * lateralReach * 0.6 + scatter * 0.5;
        if (style === CorridorClimbStyle.Zigzag)
            return (step % 2 === 0 ? 1 : -1) * lateralReach * 0.6 + scatter * 0.5;

        return scatter;
    }

    private static measureClimbAbility(): IClimbAbility {
        const jumpApex = (PLAYER.jumpForce * PLAYER.jumpForce) / (2 * Math.abs(WORLD.gravity));

        return {
            targetRise: jumpApex * LEDGE_STEPS.stepRiseOfJumpApex,
            safeMaxRise: jumpApex * LEDGE_STEPS.safeRiseOfJumpApex,
        };
    }

    private static addStaircaseForCorridor(
        treads: ITread[],
        corridor: ICorridorPath,
        climb: IClimbAbility
    ): void {
        if (corridor.climbStyle === CorridorClimbStyle.Ramp) return;

        const climbHeight = Math.abs(corridor.toElevation - corridor.fromElevation);
        if (climbHeight <= climb.targetRise) return;

        const {
            alongX,
            alongZ,
            acrossX,
            acrossZ,
            length: spanLength,
        } = segmentFrame(corridor.fromX, corridor.fromZ, corridor.toX, corridor.toZ);
        if (spanLength <= 0) return;

        const faceDistance = corridorStepFaceDistance(spanLength);
        const isClimbing = corridor.toElevation > corridor.fromElevation;
        const towardLowerGround = isClimbing ? -1 : 1;
        const lowerElevation = Math.min(corridor.fromElevation, corridor.toElevation);
        const higherElevation = Math.max(corridor.fromElevation, corridor.toElevation);

        const nextRandom = createSeededRandom(Math.floor(corridor.lateralSeed * 1_000_003));
        const averageRockHalfWidth = corridor.halfWidth * LEDGE_STEPS.rockWidthOfCorridorHalfWidth;
        const lateralReach = corridor.halfWidth * LEDGE_STEPS.lateralSpreadOfCorridorHalfWidth;
        const hiddenSide = corridor.lateralSeed < 0.5 ? -1 : 1;

        const stepCount = TerrainLedges.resolveStepCount(
            climbHeight,
            spanLength,
            averageRockHalfWidth,
            climb
        );
        const perStepSpacing = Math.min(
            averageRockHalfWidth * 2,
            (spanLength * LEDGE_STEPS.maxAlongCorridorRatio) / stepCount
        );
        const stepRise = climbHeight / stepCount;

        for (let step = 0; step < stepCount; step += 1) {
            const targetTop = Math.min(lowerElevation + stepRise * (step + 1), higherElevation);

            for (let rock = 0; rock < LEDGE_STEPS.rocksPerStep; rock += 1) {
                const halfWidth =
                    averageRockHalfWidth *
                    (1 + randomOffset(nextRandom, LEDGE_STEPS.rockWidthJitter / 2));

                const lateralOffset = TerrainLedges.lateralOffsetFor(
                    corridor.climbStyle,
                    step,
                    lateralReach,
                    hiddenSide,
                    nextRandom
                );

                const alongJitter =
                    randomOffset(nextRandom, halfWidth / 2) * LEDGE_STEPS.alongSpreadOfRockWidth;
                const distanceFromFace =
                    TERRAIN.corridorStepFaceWidth / 2 +
                    (stepCount - step) * perStepSpacing +
                    alongJitter;

                const distanceAlongSpan = clamp(
                    faceDistance + towardLowerGround * distanceFromFace,
                    averageRockHalfWidth,
                    Math.max(averageRockHalfWidth, spanLength - averageRockHalfWidth)
                );
                const centerX =
                    corridor.fromX + alongX * distanceAlongSpan + acrossX * lateralOffset;
                const centerZ =
                    corridor.fromZ + alongZ * distanceAlongSpan + acrossZ * lateralOffset;

                const topElevation = Math.min(
                    targetTop + randomOffset(nextRandom, stepRise / 2) * LEDGE_STEPS.riseJitter,
                    higherElevation
                );

                treads.push({
                    centerX,
                    centerZ,
                    halfWidth,
                    halfDepth: halfWidth * (0.7 + nextRandom() * 0.6),
                    baseElevation: topElevation - LEDGE_STEPS.buriedDepth,
                    topElevation,
                    rotationY: nextRandom() * FULL_TURN,
                });
            }
        }
    }

    private static readonly treadTransform = new Object3D();

    private static planCliffStaircases(corridorPaths: ICorridorPath[]): ITread[] {
        const climb = TerrainLedges.measureClimbAbility();
        const treads: ITread[] = [];

        for (const corridor of corridorPaths)
            TerrainLedges.addStaircaseForCorridor(treads, corridor, climb);

        return treads;
    }

    readonly sceneObject = new Group();

    private readonly context: IWorldContext;
    private readonly geometry: BoxGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly rigidBody: RigidBody;
    private readonly treadMesh: InstancedMesh | null = null;

    constructor(context: IWorldContext, center: Vector3Tuple, corridorPaths: ICorridorPath[]) {
        this.context = context;

        this.sceneObject.position.set(center[0], 0, center[2]);
        freezeTransform(this.sceneObject);

        this.geometry = new BoxGeometry(1, 1, 1);
        this.material = new MeshLambertMaterial({
            color: new Color(context.environment.terrain.rockColor),
        });

        this.rigidBody = createFixedBody(context.physicsWorld, center);

        const treads = TerrainLedges.planCliffStaircases(corridorPaths);
        if (treads.length === 0) return;

        this.treadMesh = new InstancedMesh(this.geometry, this.material, treads.length);
        this.treadMesh.castShadow = true;
        this.treadMesh.receiveShadow = true;

        for (let index = 0; index < treads.length; index += 1) {
            const tread = treads[index];

            const treadHeight = tread.topElevation - tread.baseElevation;

            TerrainLedges.treadTransform.position.set(
                tread.centerX,
                tread.baseElevation + treadHeight / 2,
                tread.centerZ
            );
            TerrainLedges.treadTransform.scale.set(
                tread.halfWidth * 2,
                treadHeight,
                tread.halfDepth * 2
            );
            TerrainLedges.treadTransform.rotation.y = tread.rotationY;
            TerrainLedges.treadTransform.updateMatrix();
            this.treadMesh.setMatrixAt(index, TerrainLedges.treadTransform.matrix);

            const colliderDesc = RAPIER.ColliderDesc.cuboid(
                tread.halfWidth,
                treadHeight / 2,
                tread.halfDepth
            )
                .setTranslation(tread.centerX, tread.baseElevation + treadHeight / 2, tread.centerZ)
                .setRotation(yawQuaternion(tread.rotationY));

            context.physicsWorld.createCollider(colliderDesc, this.rigidBody);
        }

        this.treadMesh.instanceMatrix.needsUpdate = true;
        this.treadMesh.computeBoundingSphere();
        this.sceneObject.add(this.treadMesh);
        freezeTransform(this.treadMesh);
    }

    update(): void {}

    dispose(): void {
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.treadMesh?.dispose();
        this.geometry.dispose();
        this.material.dispose();
        this.sceneObject.clear();
    }
}
