import { createStaticColliders, templateShapeCollider } from "@/systems/physics/RapierWorld";
import type { RigidBody, World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Camera, Group } from "three";
import type { IModelTemplate, IPropGroup, IWorldContext, IWorldEntity } from "@/types/world";
import type { StaticCollider } from "@/types/physics";
import type { IGameSettings } from "@/types/ui";
import { AssetLibrary } from "@/world/assets/AssetLibrary";
import { store } from "@/store/store";
import { worldTierOf } from "@/store/settingsSlice";
import { PROP_SCATTER, PROP_LAYER_RULES, PROP_TRANSFORM_STRIDE } from "@/constants/placement";
import { createSeededRandom, hashString, lerp, freezeTransform } from "@/lib/helpers";
import { IPoolRange, InstancePool } from "@/world/props/InstancePool";

type ChunkDetail = "near" | "far" | "hidden";

interface IFootprintBounds {
    minimumX: number;
    maximumX: number;
    minimumZ: number;
    maximumZ: number;
}

export class PropChunk implements IWorldEntity {
    private static farTreeSettings: IGameSettings | null = null;

    private static farTreeDistance = 0;

    private static placeInstances(
        group: IPropGroup,
        template: IModelTemplate | null,
        colliders: StaticCollider[],
        footprint: IFootprintBounds
    ): Float32Array {
        const { transforms, instanceCount, footprintRadius } = group;
        const matrices = new Float32Array(template ? instanceCount * 16 : 0);
        const colliderShape = group.hasCollider ? group.colliderShape : null;
        const trunkHeight = template?.trunk?.height ?? template?.height ?? 0;
        const trunkRadius = Math.min(template?.trunk?.radius ?? footprintRadius, footprintRadius);

        for (let instance = 0; instance < instanceCount; instance += 1) {
            const offset = instance * PROP_TRANSFORM_STRIDE;
            const x = transforms[offset];
            const y = transforms[offset + 1];
            const z = transforms[offset + 2];
            const yaw = transforms[offset + 3];
            const scale = transforms[offset + 4];
            const radius = footprintRadius * scale;
            if (x - radius < footprint.minimumX) footprint.minimumX = x - radius;
            if (x + radius > footprint.maximumX) footprint.maximumX = x + radius;
            if (z - radius < footprint.minimumZ) footprint.minimumZ = z - radius;
            if (z + radius > footprint.maximumZ) footprint.maximumZ = z + radius;
            if (!template) continue;

            const halfSine = Math.sin(yaw / 2);
            const doubleSine = halfSine + halfSine;
            const turn = Math.cos(yaw / 2) * doubleSine;
            const diagonal = (1 - halfSine * doubleSine) * scale;
            const element = instance * 16;
            matrices[element] = diagonal;
            matrices[element + 2] = -turn * scale;
            matrices[element + 5] = scale;
            matrices[element + 8] = turn * scale;
            matrices[element + 10] = diagonal;
            matrices[element + 12] = x;
            matrices[element + 13] = y;
            matrices[element + 14] = z;
            matrices[element + 15] = 1;

            if (colliderShape === null) continue;
            if (colliderShape !== "cylinder") {
                const collider = templateShapeCollider(
                    colliderShape,
                    template,
                    [x, y, z],
                    yaw,
                    [scale, scale, scale],
                    false
                );
                if (collider) colliders.push(collider);
                continue;
            }

            const halfHeight = (trunkHeight * scale) / 2;
            const cylinderRadius = trunkRadius * scale;
            if (!(halfHeight > 0) || !(cylinderRadius > 0)) continue;

            colliders.push({
                kind: "cylinder",
                halfHeight,
                radius: cylinderRadius,
                at: [x, y + halfHeight, z],
                wallRunnable: false,
            });
        }

        return matrices;
    }

    readonly sceneObject = new Group();

    private readonly physicsWorld: PhysicsWorld;
    private readonly camera: Camera;
    private readonly rigidBody: RigidBody | null;
    private readonly nearRanges: IPoolRange[] = [];
    private readonly farRanges: IPoolRange[] = [];
    private readonly smallRanges: IPoolRange[] = [];
    private readonly treelineRanges: IPoolRange[] = [];

    private detail: ChunkDetail = "hidden";
    private showsSmall = false;
    private footprintCenterX = 0;
    private footprintCenterZ = 0;
    private footprintReach = 0;
    private nearDistance = Infinity;
    private readonly nearEnterSquared: number;
    private readonly nearKeepSquared: number;
    private readonly smallEnterSquared: number;
    private readonly smallKeepSquared: number;

    constructor(
        context: IWorldContext,
        camera: Camera,
        groups: IPropGroup[],
        private readonly nearPool: InstancePool,
        private readonly farPool: InstancePool
    ) {
        this.camera = camera;
        this.physicsWorld = context.physicsWorld;
        const colliders: StaticCollider[] = [];
        const footprint: IFootprintBounds = {
            minimumX: Infinity,
            maximumX: -Infinity,
            minimumZ: Infinity,
            maximumZ: -Infinity,
        };

        for (const group of groups) {
            if (group.instanceCount === 0) continue;

            const template = context.assetLibrary.getTemplate(group.modelPath);
            const matrices = PropChunk.placeInstances(group, template, colliders, footprint);
            if (!template) continue;

            if (group.isSmall && !group.isTreeline) {
                this.smallRanges.push(nearPool.register(template, matrices, false));
                continue;
            }

            const farPath = AssetLibrary.entryOf(group.modelPath)?.far;
            const farTemplate = farPath ? context.assetLibrary.getTemplate(farPath) : null;
            if (group.isTreeline)
                this.treelineRanges.push(
                    farPool.register(farTemplate ?? template, matrices, false)
                );
            else {
                this.nearRanges.push(
                    nearPool.register(template, matrices, PROP_LAYER_RULES[group.layer].castsShadow)
                );
                if (farTemplate)
                    this.farRanges.push(farPool.register(farTemplate, matrices, false));
            }
        }

        this.rigidBody = colliders.length
            ? createStaticColliders(this.physicsWorld, colliders)
            : null;
        freezeTransform(this.sceneObject);

        this.settleFootprint(footprint);
        const { deactivationMargin, smallProps } = PROP_SCATTER;
        const nearKeep = this.nearDistance + deactivationMargin;
        const smallEnter = smallProps.viewDistance + this.footprintReach;
        const smallKeep = smallEnter + deactivationMargin;
        this.nearEnterSquared = this.nearDistance * this.nearDistance;
        this.nearKeepSquared = nearKeep * nearKeep;
        this.smallEnterSquared = smallEnter * smallEnter;
        this.smallKeepSquared = smallKeep * smallKeep;
        this.update();
    }

    update(): void {
        const cameraElements = this.camera.matrixWorld.elements;
        const offsetX = cameraElements[12] - this.footprintCenterX;
        const offsetZ = cameraElements[14] - this.footprintCenterZ;
        const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

        let detail: ChunkDetail = "near";
        if (
            distanceSquared >
            (this.detail === "near" ? this.nearKeepSquared : this.nearEnterSquared)
        ) {
            detail = this.distantDetail(distanceSquared);
        }
        const showsSmall =
            detail === "near" &&
            distanceSquared <= (this.showsSmall ? this.smallKeepSquared : this.smallEnterSquared);
        if (detail !== this.detail || showsSmall !== this.showsSmall)
            this.showDetail(detail, showsSmall);
    }

    dispose(): void {
        if (this.rigidBody) this.physicsWorld.removeRigidBody(this.rigidBody);
        this.showDetail("hidden", false);
    }

    private distantDetail(distanceSquared: number): ChunkDetail {
        if (!this.farRanges.length && !this.treelineRanges.length) return "hidden";
        const settings = store.getState().settings.values;
        if (settings !== PropChunk.farTreeSettings) {
            PropChunk.farTreeSettings = settings;
            PropChunk.farTreeDistance = worldTierOf(settings).farTreeDistance;
        }
        const farReach =
            PropChunk.farTreeDistance +
            this.footprintReach +
            (this.detail === "hidden" ? 0 : PROP_SCATTER.deactivationMargin);
        return distanceSquared <= farReach * farReach ? "far" : "hidden";
    }

    private showDetail(detail: ChunkDetail, showsSmall: boolean): void {
        const previous = this.detail;
        if (showsSmall !== this.showsSmall)
            for (const range of this.smallRanges) this.nearPool.show(range, showsSmall);
        if ((detail === "near") !== (previous === "near"))
            for (const range of this.nearRanges) this.nearPool.show(range, detail === "near");
        if ((detail === "far") !== (previous === "far"))
            for (const range of this.farRanges) this.farPool.show(range, detail === "far");
        if ((detail === "hidden") !== (previous === "hidden"))
            for (const range of this.treelineRanges) this.farPool.show(range, detail !== "hidden");
        this.detail = detail;
        this.showsSmall = showsSmall;
    }

    private settleFootprint({ minimumX, maximumX, minimumZ, maximumZ }: IFootprintBounds): void {
        if (minimumX > maximumX) return;

        this.footprintCenterX = (minimumX + maximumX) / 2;
        this.footprintCenterZ = (minimumZ + maximumZ) / 2;
        this.footprintReach = Math.hypot(maximumX - minimumX, maximumZ - minimumZ) / 2;

        const jitterSeed = hashString(
            `${this.footprintCenterX.toFixed(1)},${this.footprintCenterZ.toFixed(1)}`
        );
        const jitterRatio = createSeededRandom(jitterSeed)();
        this.nearDistance =
            PROP_SCATTER.activationRadius *
                lerp(
                    1 - PROP_SCATTER.activationJitter,
                    1 + PROP_SCATTER.activationJitter,
                    jitterRatio
                ) +
            this.footprintReach;
    }
}
