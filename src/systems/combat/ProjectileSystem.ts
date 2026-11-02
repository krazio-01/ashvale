import { Group, Mesh, SphereGeometry, Vector3 } from "three";
import type { MeshBasicMaterial } from "three";
import type { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import { SweptHitDetector } from "@/systems/combat/hit/SweptHitDetector";
import { createHitEvent, createHitPayload, emitHitLanded } from "@/events/CombatEvents";
import type { ICombatEventMap } from "@/events/CombatEvents";
import type { GameEvents } from "@/events/EventEmitter";
import { isConnected } from "@/systems/combat/hit/HitResolver";
import type { CombatRegistry } from "@/systems/combat/CombatRegistry";
import { PROJECTILE_POOL, PROJECTILES } from "@/constants/combat";
import type { IProjectileSpec, ICombatant, IHitPayload, ProjectileKind } from "@/types/combat";

type IProjectileOwner = ICombatant & { readonly attackPower: number };
type WorldBlockTest = (from: Vector3, to: Vector3) => boolean;

interface IProjectile {
    readonly mesh: Mesh;
    readonly sweep: SweptHitDetector;
    readonly position: Vector3;
    readonly previous: Vector3;
    readonly velocity: Vector3;
    payload: IHitPayload | null;
    spec: IProjectileSpec;
    age: number;
    isLive: boolean;
}

export class ProjectileSystem {
    readonly sceneObject = new Group();

    private readonly registry: CombatRegistry;
    private readonly events: GameEvents;
    private readonly isWorldBlocked: WorldBlockTest;
    private readonly geometry = new SphereGeometry(1, 8, 6);
    private readonly materials: Record<ProjectileKind, MeshBasicMaterial>;
    private readonly pool: IProjectile[] = [];
    private readonly hitDefenders: ICombatant[] = [];
    private hitEvent: ICombatEventMap["hitLanded"] | null = null;

    constructor(
        registry: CombatRegistry,
        events: GameEvents,
        materialLibrary: MaterialLibrary,
        isWorldBlocked: WorldBlockTest
    ) {
        this.registry = registry;
        this.events = events;
        this.isWorldBlocked = isWorldBlocked;
        this.materials = {
            bolt: materialLibrary.getUnlitMaterial({ color: PROJECTILES.bolt.color }),
            blast: materialLibrary.getUnlitMaterial({ color: PROJECTILES.blast.color }),
        };

        for (let index = 0; index < PROJECTILE_POOL.size; index += 1) {
            const mesh = new Mesh(this.geometry, this.materials.bolt);
            mesh.visible = false;
            this.sceneObject.add(mesh);
            this.pool.push({
                mesh,
                sweep: new SweptHitDetector(),
                position: mesh.position,
                previous: new Vector3(),
                velocity: new Vector3(),
                payload: null,
                spec: PROJECTILES.bolt,
                age: 0,
                isLive: false,
            });
        }
    }

    launch(
        owner: IProjectileOwner,
        kind: ProjectileKind,
        origin: Vector3,
        aimPoint: Vector3
    ): boolean {
        const projectile = this.pool.find((candidate) => !candidate.isLive);
        if (!projectile) return false;

        const spec = PROJECTILES[kind];
        projectile.spec = spec;
        projectile.age = 0;
        projectile.isLive = true;
        projectile.position.copy(origin);
        projectile.previous.copy(origin);
        projectile.velocity.subVectors(aimPoint, origin);
        if (projectile.velocity.lengthSq() < 1e-8) projectile.velocity.set(0, 0, 1);
        projectile.velocity.normalize().multiplyScalar(spec.speed);
        projectile.sweep.begin();

        const payload = (projectile.payload ??= createHitPayload(owner, true));
        payload.attacker = owner;
        payload.moveId = kind;
        payload.damage = owner.attackPower * spec.damageScale;
        payload.poiseDamage = spec.poiseDamage;
        payload.impact = spec.impact;
        payload.knockback = spec.knockback;
        payload.parryable = spec.parryable;
        payload.dodgeOnly = spec.dodgeOnly;

        projectile.mesh.material = this.materials[kind];
        projectile.mesh.scale.setScalar(spec.radius);
        projectile.mesh.visible = true;
        return true;
    }

    tick(deltaSeconds: number): void {
        for (const projectile of this.pool) {
            if (!projectile.isLive) continue;

            projectile.previous.copy(projectile.position);
            projectile.position.addScaledVector(projectile.velocity, deltaSeconds);
            projectile.age += deltaSeconds;

            if (
                projectile.payload!.attacker.isDead ||
                projectile.age >= PROJECTILE_POOL.lifetimeSeconds ||
                this.isWorldBlocked(projectile.previous, projectile.position)
            ) {
                this.release(projectile);
                continue;
            }
            this.resolveHits(projectile);
        }
    }

    dispose(): void {
        this.geometry.dispose();
        this.sceneObject.clear();
    }

    private resolveHits(projectile: IProjectile): void {
        const payload = projectile.payload!;
        const count = projectile.sweep.sweep(
            projectile.previous,
            projectile.position,
            projectile.spec.radius,
            payload.attacker.team,
            this.registry,
            this.hitDefenders
        );

        for (let index = 0; index < count; index += 1) {
            const defender = this.hitDefenders[index];

            payload.origin.copy(projectile.previous);
            const outcome = defender.receiveHit(payload);
            if (outcome.kind === "parried") {
                this.release(projectile);
                return;
            }
            if (!isConnected(outcome)) continue;

            const event = (this.hitEvent ??= createHitEvent(payload.attacker));
            event.attacker = payload.attacker;
            emitHitLanded(
                this.events,
                event,
                defender,
                outcome,
                payload.impact,
                projectile.position
            );
            this.release(projectile);
            return;
        }
    }

    private release(projectile: IProjectile): void {
        projectile.isLive = false;
        projectile.mesh.visible = false;
    }
}
