import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh } from "three";
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { IChapterRegion } from "@/types/realm";
import { REGION } from "@/constants/game";

export class Region extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: BoxGeometry;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(context: IWorldContext, region: IChapterRegion) {
        super(region.regionId);
        this.context = context;

        const [width, depth] = region.floorSize;
        const [x, y, z] = region.worldPosition;
        const colorIndex = Math.min(region.nestingDepth, REGION.floorColorsByDepth.length - 1);

        this.geometry = new BoxGeometry(width, REGION.floorThickness, depth);
        this.sceneObject = new Mesh(
            this.geometry,
            context.materialLibrary.getToonMaterial(REGION.floorColorsByDepth[colorIndex])
        );
        this.sceneObject.position.set(x, y, z);
        this.sceneObject.castShadow = true;
        this.sceneObject.receiveShadow = true;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
        );

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.cuboid(width / 2, REGION.floorThickness / 2, depth / 2),
            this.rigidBody
        );
    }

    update(): void { }

    dispose(): void {
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.geometry.dispose();
    }
}
