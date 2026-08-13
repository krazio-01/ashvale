import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import { Mesh, PlaneGeometry } from "three";
import { Entity } from "@/entities/Entity";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { GROUND, PALETTE } from "@/constants/game";

const QUARTER_TURN = -Math.PI / 2;

export class Ground extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: PlaneGeometry;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(id: string, context: IWorldContext) {
        super(id);

        this.context = context;
        this.geometry = new PlaneGeometry(GROUND.size, GROUND.size);

        this.sceneObject = new Mesh(
            this.geometry,
            context.materialLibrary.getToonMaterial(PALETTE.groundNear)
        );
        this.sceneObject.rotation.x = QUARTER_TURN;
        this.sceneObject.receiveShadow = true;

        const halfSize = GROUND.size / 2;
        const halfThickness = GROUND.thickness / 2;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(0, -halfThickness, 0)
        );

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.cuboid(halfSize, halfThickness, halfSize),
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
