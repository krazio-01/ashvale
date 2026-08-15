import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh } from "three";
import type { Vector3Tuple } from "three";
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { IRegionPathway } from "@/types/realm";
import { CORRIDOR } from "@/constants/game";

export class Corridor extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: BoxGeometry;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(
        context: IWorldContext,
        pathway: IRegionPathway,
        fromPosition: Vector3Tuple,
        toPosition: Vector3Tuple
    ) {
        super(`${pathway.fromRegionId}-to-${pathway.toRegionId}`);
        this.context = context;

        const deltaX = toPosition[0] - fromPosition[0];
        const deltaZ = toPosition[2] - fromPosition[2];
        const length = Math.hypot(deltaX, deltaZ);
        const heading = Math.atan2(deltaX, deltaZ);

        const centerX = (fromPosition[0] + toPosition[0]) / 2;
        const centerY = (fromPosition[1] + toPosition[1]) / 2;
        const centerZ = (fromPosition[2] + toPosition[2]) / 2;

        this.geometry = new BoxGeometry(pathway.corridorWidth, CORRIDOR.floorThickness, length);
        this.sceneObject = new Mesh(
            this.geometry,
            context.materialLibrary.getToonMaterial(CORRIDOR.color)
        );
        this.sceneObject.position.set(centerX, centerY, centerZ);
        this.sceneObject.rotation.y = heading;
        this.sceneObject.receiveShadow = true;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed()
                .setTranslation(centerX, centerY, centerZ)
                .setRotation({
                    x: 0,
                    y: Math.sin(heading / 2),
                    z: 0,
                    w: Math.cos(heading / 2),
                })
        );

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.cuboid(
                pathway.corridorWidth / 2,
                CORRIDOR.floorThickness / 2,
                length / 2
            ),
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
