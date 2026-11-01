import RAPIER from "@dimforge/rapier3d-compat";
import type { World as PhysicsWorld } from "@dimforge/rapier3d-compat";
import { Group, Vector2 } from "three";
import type { IUniform, Vector3, WebGLRenderer } from "three";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { AssetLibrary } from "@/world/assets/AssetLibrary";
import { EventEmitter } from "@/events/EventEmitter";
import type { GameEvents } from "@/events/EventEmitter";
import { CombatRegistry } from "@/systems/combat/CombatRegistry";
import { TimeDilation } from "@/systems/combat/TimeDilation";
import { AttackCoordinator } from "@/systems/combat/AttackCoordinator";
import { ProjectileSystem } from "@/systems/combat/ProjectileSystem";
import { WorldEffects } from "@/systems/effects/Effects";
import type { IThemeEnvironment, IThemeConfig, IWorldContext, IWorldEntity } from "@/types/world";
import { WIND, WORLD } from "@/constants/world";
import { FULL_TURN } from "@/lib/helpers";
import { sunDirectionFromSky } from "@/themes/Themes";
import { isSegmentBlocked } from "@/systems/physics/RapierWorld";

export class WorldEnvironment {
    readonly uniforms: {
        time: IUniform<number>;
        windWavePhase: IUniform<number>;
        windFlutterPhase: IUniform<number>;
        windDirection: IUniform<Vector2>;
        windHeading: IUniform<number>;
        windBendSpread: IUniform<number>;
        windWaveLength: IUniform<number>;
        windSway: IUniform<number>;
        windFlutter: IUniform<number>;
        sunDirection: IUniform<Vector3>;
    };

    constructor(environment: IThemeEnvironment) {
        this.uniforms = {
            time: { value: 0 },
            windWavePhase: { value: 0 },
            windFlutterPhase: { value: 0 },
            windDirection: { value: new Vector2(Math.sin(WIND.heading), Math.cos(WIND.heading)) },
            windHeading: { value: WIND.heading },
            windBendSpread: { value: WIND.bendSpread },
            windWaveLength: { value: WIND.waveLength },
            windSway: { value: WIND.sway },
            windFlutter: { value: WIND.flutter },
            sunDirection: { value: sunDirectionFromSky(environment.sky) },
        };
    }

    update(deltaSeconds: number): void {
        const uniforms = this.uniforms;
        uniforms.time.value += deltaSeconds;
        uniforms.windWavePhase.value =
            (uniforms.windWavePhase.value + deltaSeconds * WIND.waveSpeed) % FULL_TURN;
        uniforms.windFlutterPhase.value =
            (uniforms.windFlutterPhase.value + deltaSeconds * WIND.flutterSpeed) % FULL_TURN;
    }
}

export class World {
    private static addOnce(entities: IWorldEntity[], entity: IWorldEntity): void {
        if (!entities.includes(entity)) entities.push(entity);
    }

    private static removeFrom(entities: IWorldEntity[], entity: IWorldEntity): void {
        const index = entities.indexOf(entity);
        if (index >= 0) entities.splice(index, 1);
    }

    private static updateAll(
        entities: IWorldEntity[],
        deltaSeconds: number,
        interpolationAlpha: number
    ): void {
        for (let index = 0; index < entities.length; index += 1)
            entities[index].update(deltaSeconds, interpolationAlpha);
    }

    private readonly physicsWorld: PhysicsWorld;
    private readonly sceneRoot = new Group();
    private readonly materialLibrary: MaterialLibrary;
    private readonly assetLibrary: AssetLibrary;
    private readonly events: GameEvents = new EventEmitter();
    private readonly timeDilation = new TimeDilation();
    private readonly attackCoordinator = new AttackCoordinator();
    private readonly projectiles: ProjectileSystem;
    private readonly projectileRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    private readonly worldEnvironment: WorldEnvironment;
    private readonly worldContext: IWorldContext;
    private readonly entities: IWorldEntity[] = [];
    private readonly worldEffects: WorldEffects;
    private readonly steppedEntities: IWorldEntity[] = [];
    private unsimulatedTime = 0;
    private isDisposed = false;

    private constructor(
        materialLibrary: MaterialLibrary,
        assetLibrary: AssetLibrary,
        environment: IThemeEnvironment
    ) {
        this.materialLibrary = materialLibrary;
        this.assetLibrary = assetLibrary;
        this.worldEnvironment = new WorldEnvironment(environment);
        this.physicsWorld = new RAPIER.World({ x: 0, y: WORLD.gravity, z: 0 });
        this.physicsWorld.timestep = WORLD.fixedTimestep;
        const combatRegistry = new CombatRegistry();
        this.projectiles = new ProjectileSystem(combatRegistry, this.events, (from, to) =>
            this.isProjectileBlocked(from, to)
        );
        this.sceneRoot.add(this.projectiles.sceneObject);
        this.worldEffects = new WorldEffects(this.events);
        this.sceneRoot.add(this.worldEffects.sceneObject);

        this.worldContext = {
            physicsWorld: this.physicsWorld,
            sceneRoot: this.sceneRoot,
            assetLibrary: this.assetLibrary,
            combatRegistry,
            events: this.events,
            timeDilation: this.timeDilation,
            attackCoordinator: this.attackCoordinator,
            projectiles: this.projectiles,
            environment,
            worldEnvironment: this.worldEnvironment,
        };
    }

    static async create(manifest: IThemeConfig, renderer: WebGLRenderer): Promise<World> {
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

        World.addOnce(this.entities, entity);
        if (entity.fixedUpdate || entity.afterPhysicsStep)
            World.addOnce(this.steppedEntities, entity);
        this.sceneRoot.add(entity.sceneObject);
    }

    removeEntity(entity: IWorldEntity): void {
        World.removeFrom(this.entities, entity);
        World.removeFrom(this.steppedEntities, entity);
        this.sceneRoot.remove(entity.sceneObject);
        entity.dispose();
    }

    update(deltaSeconds: number): void {
        if (this.isDisposed) return;

        const fixedTimestep = WORLD.fixedTimestep;
        const maximumStepsPerFrame = WORLD.maximumStepsPerFrame;
        const realFrameDelta = Math.min(deltaSeconds, WORLD.maximumFrameDelta);
        const frameDelta = realFrameDelta * this.timeDilation.slowMotionTimeScale;
        this.timeDilation.tick(realFrameDelta);

        this.unsimulatedTime += frameDelta;

        let stepsTaken = 0;
        while (this.unsimulatedTime >= fixedTimestep && stepsTaken < maximumStepsPerFrame) {
            const stepped = this.steppedEntities;
            for (let index = 0; index < stepped.length; index += 1)
                stepped[index].fixedUpdate?.(fixedTimestep);
            this.attackCoordinator.tick(fixedTimestep);
            this.projectiles.tick(fixedTimestep);
            this.physicsWorld.step();
            for (let index = 0; index < stepped.length; index += 1)
                stepped[index].afterPhysicsStep?.();
            this.unsimulatedTime -= fixedTimestep;
            stepsTaken += 1;
        }

        const isCatchingUp = stepsTaken === maximumStepsPerFrame;
        if (isCatchingUp) this.unsimulatedTime = 0;

        const interpolationAlpha = isCatchingUp ? 1 : this.unsimulatedTime / fixedTimestep;
        this.worldEnvironment.update(frameDelta);
        World.updateAll(this.entities, frameDelta, interpolationAlpha);
        this.worldEffects.update(frameDelta);
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;

        for (const entity of this.entities) entity.dispose();
        this.worldEffects.dispose();
        this.projectiles.dispose();

        this.sceneRoot.clear();
        this.assetLibrary.dispose();
        this.materialLibrary.dispose();
        this.physicsWorld.free();
    }

    private isProjectileBlocked(from: Vector3, to: Vector3): boolean {
        return isSegmentBlocked(this.physicsWorld, this.projectileRay, from, to);
    }
}
