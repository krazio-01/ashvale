import RAPIER from "@dimforge/rapier3d-compat";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group } from "three";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { AssetLibrary } from "@/world/assets/AssetLibrary";
import type { IThemeEnvironment, IThemeManifest } from "@/types/theme";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { WORLD } from "@/constants/world";

export class World {
    private readonly physicsWorld: PhysicsWorld;
    private readonly sceneRoot = new Group();
    private readonly materialLibrary: MaterialLibrary;
    private readonly assetLibrary: AssetLibrary;
    private readonly environment: IThemeEnvironment;
    private readonly worldContext: IWorldContext;
    private readonly entities = new Set<IWorldEntity>();
    private readonly entitiesAwaitingRemoval = new Set<IWorldEntity>();
    private unsimulatedTime = 0;
    private isDisposed = false;

    private constructor(
        materialLibrary: MaterialLibrary,
        assetLibrary: AssetLibrary,
        environment: IThemeEnvironment
    ) {
        this.materialLibrary = materialLibrary;
        this.assetLibrary = assetLibrary;
        this.environment = environment;
        this.physicsWorld = new RAPIER.World({ x: 0, y: WORLD.gravity, z: 0 });
        this.physicsWorld.timestep = WORLD.fixedTimestep;

        this.worldContext = {
            physicsWorld: this.physicsWorld,
            sceneRoot: this.sceneRoot,
            materialLibrary: this.materialLibrary,
            assetLibrary: this.assetLibrary,
            environment: this.environment,
        };
    }

    static async create(manifest: IThemeManifest): Promise<World> {
        const materialLibrary = new MaterialLibrary();

        const [, assetLibrary] = await Promise.all([
            RAPIER.init(),
            AssetLibrary.create(manifest, materialLibrary),
        ]);

        return new World(materialLibrary, assetLibrary, manifest.environment);
    }

    get root(): Group {
        return this.sceneRoot;
    }

    get context(): IWorldContext {
        return this.worldContext;
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

        const fixedTimestep = WORLD.fixedTimestep;
        const maximumStepsPerFrame = WORLD.maximumStepsPerFrame;
        const frameDelta = Math.min(deltaSeconds, WORLD.maximumFrameDelta);

        this.unsimulatedTime += frameDelta;

        let stepsTaken = 0;
        while (this.unsimulatedTime >= fixedTimestep && stepsTaken < maximumStepsPerFrame) {
            this.physicsWorld.step();
            this.unsimulatedTime -= fixedTimestep;
            stepsTaken += 1;
        }

        if (stepsTaken === maximumStepsPerFrame) this.unsimulatedTime = 0;

        for (const entity of this.entities) entity.update(frameDelta);

        this.applyPendingRemovals();
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;

        for (const entity of this.entities) entity.dispose();

        this.sceneRoot.clear();
        this.entities.clear();
        this.entitiesAwaitingRemoval.clear();
        this.assetLibrary.dispose();
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
