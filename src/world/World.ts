import RAPIER from "@dimforge/rapier3d-compat";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group } from "three";
import { MaterialLibrary } from "@/world/MaterialLibrary";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { WORLD } from "@/constants/game";

export class World {
    private readonly physicsWorld: PhysicsWorld;
    private readonly sceneRoot = new Group();
    private readonly materialLibrary = new MaterialLibrary();
    private readonly entities = new Set<IWorldEntity>();
    private readonly entitiesAwaitingRemoval = new Set<IWorldEntity>();
    private unsimulatedTime = 0;
    private isDisposed = false;

    private constructor() {
        this.physicsWorld = new RAPIER.World({ x: 0, y: WORLD.gravity, z: 0 });
        this.physicsWorld.timestep = WORLD.fixedTimestep;
    }

    static async create(): Promise<World> {
        await RAPIER.init();
        return new World();
    }

    get root(): Group {
        return this.sceneRoot;
    }

    get context(): IWorldContext {
        return {
            physicsWorld: this.physicsWorld,
            sceneRoot: this.sceneRoot,
            materialLibrary: this.materialLibrary,
        };
    }

    addEntity(entity: IWorldEntity): void {
        if (this.isDisposed) return;

        this.entities.add(entity);
        this.sceneRoot.add(entity.sceneObject);
    }

    removeEntity(entity: IWorldEntity): void {
        this.entitiesAwaitingRemoval.add(entity);
    }

    update(deltaSeconds: number): void {
        if (this.isDisposed) return;

        const frameDelta = Math.min(deltaSeconds, WORLD.maximumFrameDelta);
        this.unsimulatedTime += frameDelta;

        let stepsTaken = 0;
        while (
            this.unsimulatedTime >= WORLD.fixedTimestep &&
            stepsTaken < WORLD.maximumStepsPerFrame
        ) {
            this.physicsWorld.step();
            this.unsimulatedTime -= WORLD.fixedTimestep;
            stepsTaken += 1;
        }

        for (const entity of this.entities) entity.update(frameDelta);

        this.applyPendingRemovals();
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;

        for (const entity of this.entities) {
            this.sceneRoot.remove(entity.sceneObject);
            entity.dispose();
        }

        this.entities.clear();
        this.entitiesAwaitingRemoval.clear();
        this.materialLibrary.dispose();
        this.physicsWorld.free();
    }

    private applyPendingRemovals(): void {
        if (this.entitiesAwaitingRemoval.size === 0) return;

        for (const entity of this.entitiesAwaitingRemoval) {
            this.entities.delete(entity);
            this.sceneRoot.remove(entity.sceneObject);
            entity.dispose();
        }

        this.entitiesAwaitingRemoval.clear();
    }
}
