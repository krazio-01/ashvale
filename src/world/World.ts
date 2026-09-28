import RAPIER from "@dimforge/rapier3d-compat";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group } from "three";
import type { Vector3 } from "three";
import type { WebGLRenderer } from "three";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { AssetLibrary } from "@/world/assets/AssetLibrary";
import { CombatEvents } from "@/systems/combat/services/CombatEvents";
import { CombatRegistry } from "@/systems/combat/services/CombatRegistry";
import { TimeDilation } from "@/systems/combat/services/TimeDilation";
import { AttackCoordinator } from "@/systems/combat/services/AttackCoordinator";
import { ProjectileSystem } from "@/systems/combat/services/ProjectileSystem";
import type { IThemeEnvironment, IThemeManifest } from "@/types/theme";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { WORLD } from "@/constants/world";
import { isSegmentBlocked } from "@/world/SegmentQuery";

export class World {
    private readonly physicsWorld: PhysicsWorld;
    private readonly sceneRoot = new Group();
    private readonly materialLibrary: MaterialLibrary;
    private readonly assetLibrary: AssetLibrary;
    private readonly combatRegistry = new CombatRegistry();
    private readonly combatEvents = new CombatEvents();
    private readonly timeDilation = new TimeDilation();
    private readonly attackCoordinator = new AttackCoordinator();
    private readonly projectiles: ProjectileSystem;
    private readonly projectileRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    private readonly environment: IThemeEnvironment;
    private readonly worldContext: IWorldContext;
    private readonly entities = new Set<IWorldEntity>();
    private readonly lateEntities = new Set<IWorldEntity>();
    private readonly steppedEntities = new Set<IWorldEntity>();
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
        this.projectiles = new ProjectileSystem(
            this.combatRegistry,
            this.combatEvents,
            (from, to) => this.isProjectileBlocked(from, to)
        );
        this.sceneRoot.add(this.projectiles.sceneObject);

        this.worldContext = {
            physicsWorld: this.physicsWorld,
            sceneRoot: this.sceneRoot,
            materialLibrary: this.materialLibrary,
            assetLibrary: this.assetLibrary,
            combatRegistry: this.combatRegistry,
            combatEvents: this.combatEvents,
            timeDilation: this.timeDilation,
            attackCoordinator: this.attackCoordinator,
            projectiles: this.projectiles,
            environment: this.environment,
        };
    }

    static async create(manifest: IThemeManifest, renderer: WebGLRenderer): Promise<World> {
        const materialLibrary = new MaterialLibrary();

        const [, assetLibrary] = await Promise.all([
            RAPIER.init(),
            AssetLibrary.create(manifest, materialLibrary, renderer),
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

        (entity.updatesAfterBodies ? this.lateEntities : this.entities).add(entity);
        if (entity.fixedUpdate || entity.postStep) this.steppedEntities.add(entity);
        this.sceneRoot.add(entity.sceneObject);
    }

    update(deltaSeconds: number): void {
        if (this.isDisposed) return;

        const fixedTimestep = WORLD.fixedTimestep;
        const maximumStepsPerFrame = WORLD.maximumStepsPerFrame;
        const realFrameDelta = Math.min(deltaSeconds, WORLD.maximumFrameDelta);
        const frameDelta = realFrameDelta * this.timeDilation.globalScale;
        this.timeDilation.tick(realFrameDelta);

        this.unsimulatedTime += frameDelta;

        let stepsTaken = 0;
        while (this.unsimulatedTime >= fixedTimestep && stepsTaken < maximumStepsPerFrame) {
            for (const entity of this.steppedEntities) entity.fixedUpdate?.(fixedTimestep);
            this.attackCoordinator.tick(fixedTimestep);
            this.projectiles.tick(fixedTimestep);
            this.physicsWorld.step();
            for (const entity of this.steppedEntities) entity.postStep?.();
            this.unsimulatedTime -= fixedTimestep;
            stepsTaken += 1;
        }

        const isCatchingUp = stepsTaken === maximumStepsPerFrame;
        if (isCatchingUp) this.unsimulatedTime = 0;

        const interpolationAlpha = isCatchingUp ? 1 : this.unsimulatedTime / fixedTimestep;
        for (const entity of this.entities) entity.update(frameDelta, interpolationAlpha);
        for (const entity of this.lateEntities) entity.update(frameDelta, interpolationAlpha);
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;

        for (const entity of this.entities) entity.dispose();
        for (const entity of this.lateEntities) entity.dispose();
        this.projectiles.dispose();

        this.combatEvents.clear();
        this.timeDilation.clear();
        this.sceneRoot.clear();
        this.entities.clear();
        this.lateEntities.clear();
        this.steppedEntities.clear();
        this.assetLibrary.dispose();
        this.materialLibrary.dispose();
        this.physicsWorld.free();
    }

    private isProjectileBlocked(from: Vector3, to: Vector3): boolean {
        return isSegmentBlocked(this.physicsWorld, this.projectileRay, from, to);
    }
}
