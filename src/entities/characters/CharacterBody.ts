import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import type { Object3D } from "three";
import type { ICharacterModel, IWorldContext, IWorldEntity } from "@/types/world";

export class CharacterBody implements IWorldEntity {
    readonly sceneObject: Object3D;

    private readonly context: IWorldContext;
    private readonly model: ICharacterModel;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(
        model: ICharacterModel,
        context: IWorldContext,
        spawnPosition: [number, number, number]
    ) {
        this.model = model;
        this.context = context;

        this.sceneObject = model.build(context.materialLibrary);
        this.sceneObject.castShadow = true;

        const [x, y, z] = spawnPosition;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).lockRotations()
        );

        this.collider = context.physicsWorld.createCollider(model.colliderDesc(), this.rigidBody);
    }

    update(): void {
        const translation = this.rigidBody.translation();
        this.sceneObject.position.set(translation.x, translation.y, translation.z);
    }

    dispose(): void {
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.model.dispose();
    }
}
