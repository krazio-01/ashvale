import RAPIER from "@dimforge/rapier3d-compat";
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
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import {
    CorridorClimbStyle,
    corridorStepDistanceOf,
    type ICorridorPath,
} from "@/world/terrain/TerrainHeightField";
import { LEDGE } from "@/constants/placement";
import { PLAYER } from "@/constants/characters";
import { TERRAIN, WORLD } from "@/constants/world";
import { createSeededRandom, FULL_TURN } from "@/lib/helpers";

const shelfTransform = new Object3D();

export class LedgePlatforms extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly context: IWorldContext;
    private readonly geometry: BoxGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly rigidBody: RigidBody;
    private readonly batch: InstancedMesh | null = null;

    constructor(context: IWorldContext, center: Vector3Tuple, corridorPaths: ICorridorPath[]) {
        super("ledge-platforms");
        this.context = context;

        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;

        this.geometry = new BoxGeometry(1, 1, 1);
        this.material = new MeshLambertMaterial({
            color: new Color(context.environment.terrain.rockColor),
        });

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], 0, center[2])
        );

        const treads = planCliffStaircases(corridorPaths);
        if (treads.length === 0) return;

        this.batch = new InstancedMesh(this.geometry, this.material, treads.length);
        this.batch.castShadow = true;
        this.batch.receiveShadow = true;
        this.batch.matrixAutoUpdate = false;
        this.batch.updateMatrix();

        for (let index = 0; index < treads.length; index += 1) {
            const tread = treads[index];
            if (!tread) continue;

            const treadHeight = tread.topElevation - tread.baseElevation;

            shelfTransform.position.set(
                tread.centerX,
                tread.baseElevation + treadHeight / 2,
                tread.centerZ
            );
            shelfTransform.scale.set(tread.halfWidth * 2, treadHeight, tread.halfDepth * 2);
            shelfTransform.rotation.y = tread.rotationY;
            shelfTransform.updateMatrix();
            this.batch.setMatrixAt(index, shelfTransform.matrix);

            const colliderDesc = RAPIER.ColliderDesc.cuboid(
                tread.halfWidth,
                treadHeight / 2,
                tread.halfDepth
            )
                .setTranslation(tread.centerX, tread.baseElevation + treadHeight / 2, tread.centerZ)
                .setRotation(yawQuaternion(tread.rotationY));

            context.physicsWorld.createCollider(colliderDesc, this.rigidBody);
        }

        this.batch.instanceMatrix.needsUpdate = true;
        this.batch.computeBoundingSphere();
        this.sceneObject.add(this.batch);
        this.batch.updateMatrixWorld(true);
        this.batch.matrixWorldAutoUpdate = false;
    }

    update(): void {}

    dispose(): void {
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.batch?.dispose();
        this.geometry.dispose();
        this.material.dispose();
        this.sceneObject.clear();
    }
}

function planCliffStaircases(corridorPaths: ICorridorPath[]): ITread[] {
    const climb = measureClimbAbility();
    const treads: ITread[] = [];

    for (const corridor of corridorPaths) addStaircaseForCorridor(treads, corridor, climb);

    return treads;
}

function measureClimbAbility(): IClimbAbility {
    const jumpApex = (PLAYER.jumpForce * PLAYER.jumpForce) / (2 * Math.abs(WORLD.gravity));

    return {
        targetRise: jumpApex * LEDGE.stepRiseOfJumpApex,
        safeMaxRise: jumpApex * LEDGE.safeRiseOfJumpApex,
    };
}

function addStaircaseForCorridor(
    treads: ITread[],
    corridor: ICorridorPath,
    climb: IClimbAbility
): void {
    if (corridor.climbStyle === CorridorClimbStyle.Ramp) return;

    const climbHeight = Math.abs(corridor.toElevation - corridor.fromElevation);
    if (climbHeight <= climb.targetRise) return;

    const spanX = corridor.toX - corridor.fromX;
    const spanZ = corridor.toZ - corridor.fromZ;
    const spanLength = Math.sqrt(spanX * spanX + spanZ * spanZ);
    if (spanLength <= 0) return;

    const alongX = spanX / spanLength;
    const alongZ = spanZ / spanLength;
    const acrossX = -alongZ;
    const acrossZ = alongX;

    const faceDistance = corridorStepDistanceOf(spanLength);
    const isClimbing = corridor.toElevation > corridor.fromElevation;
    const towardLowerGround = isClimbing ? -1 : 1;
    const lowerElevation = Math.min(corridor.fromElevation, corridor.toElevation);
    const higherElevation = Math.max(corridor.fromElevation, corridor.toElevation);

    const nextRandom = createSeededRandom(Math.floor(corridor.lateralSeed * 1_000_003));
    const averageRockHalfWidth = corridor.halfWidth * LEDGE.rockWidthOfCorridorHalfWidth;
    const lateralReach = corridor.halfWidth * LEDGE.lateralSpreadOfCorridorHalfWidth;
    const lateralBias = corridor.climbStyle === CorridorClimbStyle.Hidden ? 1 : 0;
    const hiddenSide = corridor.lateralSeed < 0.5 ? -1 : 1;

    const stepCount = resolveStepCount(climbHeight, spanLength, averageRockHalfWidth, climb);
    const perStepSpacing = Math.min(
        averageRockHalfWidth * 2,
        (spanLength * LEDGE.maxAlongCorridorRatio) / stepCount
    );
    const stepRise = climbHeight / stepCount;

    for (let step = 0; step < stepCount; step += 1) {
        const targetTop = Math.min(lowerElevation + stepRise * (step + 1), higherElevation);

        for (let rock = 0; rock < LEDGE.rocksPerStep; rock += 1) {
            const halfWidth =
                averageRockHalfWidth * (1 + (nextRandom() - 0.5) * LEDGE.rockWidthJitter);

            const lateralOffset = lateralOffsetFor(
                corridor.climbStyle,
                step,
                lateralReach,
                hiddenSide,
                lateralBias,
                nextRandom
            );

            const alongJitter = (nextRandom() - 0.5) * halfWidth * LEDGE.alongSpreadOfRockWidth;
            const distanceFromFace =
                TERRAIN.corridorStepFaceWidth / 2 +
                (stepCount - step) * perStepSpacing +
                alongJitter;

            const distanceAlongSpan = faceDistance + towardLowerGround * distanceFromFace;
            const centerX = corridor.fromX + alongX * distanceAlongSpan + acrossX * lateralOffset;
            const centerZ = corridor.fromZ + alongZ * distanceAlongSpan + acrossZ * lateralOffset;

            const topElevation = Math.min(
                targetTop + (nextRandom() - 0.5) * stepRise * LEDGE.riseJitter,
                higherElevation
            );

            treads.push({
                centerX,
                centerZ,
                halfWidth,
                halfDepth: halfWidth * (0.7 + nextRandom() * 0.6),
                baseElevation: topElevation - LEDGE.buriedDepth,
                topElevation,
                rotationY: nextRandom() * FULL_TURN,
            });
        }
    }
}

function resolveStepCount(
    climbHeight: number,
    spanLength: number,
    averageRockHalfWidth: number,
    climb: IClimbAbility
): number {
    const naturalStepCount = Math.ceil(climbHeight / climb.targetRise);
    const spacing = averageRockHalfWidth * 2;
    const maxAvailableSpan = spanLength * LEDGE.maxAlongCorridorRatio;
    const spanLimitedStepCount = Math.max(1, Math.floor(maxAvailableSpan / spacing));
    const minSafeStepCount = Math.ceil(climbHeight / climb.safeMaxRise);

    return Math.max(minSafeStepCount, Math.min(naturalStepCount, spanLimitedStepCount));
}

function lateralOffsetFor(
    style: CorridorClimbStyle,
    step: number,
    lateralReach: number,
    hiddenSide: number,
    lateralBias: number,
    nextRandom: () => number
): number {
    const scatter = (nextRandom() - 0.5) * lateralReach;

    if (lateralBias === 1) return hiddenSide * lateralReach * 0.6 + scatter * 0.5;
    if (style === CorridorClimbStyle.Zigzag)
        return (step % 2 === 0 ? 1 : -1) * lateralReach * 0.6 + scatter * 0.5;

    return scatter;
}

function yawQuaternion(rotationY: number): IQuaternion {
    return { x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) };
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

interface IQuaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}
