import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    DynamicDrawUsage,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    ShaderMaterial,
    Sprite,
    SpriteMaterial,
    Vector3,
} from "three";
import type { Material, Object3D } from "three";
import { EFFECTS } from "@/constants/combat";
import type { EffectId } from "@/constants/combat";
import { lerp, metresToUnits, randomOffset, smoothCurveValue } from "@/lib/helpers";
import {
    createGlowTexture,
    particleBurstVertexShader,
    PARTICLE_BURST_FRAGMENT_SHADER,
    RIBBON_TRAIL_FRAGMENT_SHADER,
    RIBBON_TRAIL_VERTEX_SHADER,
} from "@/systems/effects/EffectShaders";
import type { IAttackWarningSource, ICombatEventMap } from "@/events/CombatEvents";
import type { AttackWarningDanger, HitShape, ICapsule, ImpactTier } from "@/types/combat";
import type {
    EffectSpec,
    EffectTrigger,
    IAttackWarningFlareSpec,
    IEffectTarget,
    IMaterialFlashSpec,
    IParticleBurstSpec,
    IRibbonTrailSpec,
    IWorldEntity,
} from "@/types/world";
import type { GameEvents } from "@/events/EventEmitter";

interface IEffectKinds {
    materialFlash: MaterialFlash;
    particleBurst: ParticleBurst;
    attackWarningFlare: AttackWarningFlares;
    ribbonTrail: RibbonTrail;
}

type EffectFor<Id extends EffectId> = IEffectKinds[(typeof EFFECTS)[Id]["kind"]];

export type MaterialEffectId = {
    [Id in EffectId]: (typeof EFFECTS)[Id]["kind"] extends "materialFlash" ? Id : never;
}[EffectId];

interface IFlareSlot {
    sprite: Sprite;
    material: SpriteMaterial;
    source: IAttackWarningSource | null;
    moveId: string;
    shape: HitShape;
    readonly socketShape: Extract<HitShape, { kind: "socket" }>;
    danger: AttackWarningDanger;
    age: number;
}

interface ITrailSample {
    readonly base: Vector3;
    readonly tip: Vector3;
    born: number;
}

type TriggeredEffectId = {
    [Id in EffectId]: (typeof EFFECTS)[Id] extends { trigger: EffectTrigger } ? Id : never;
}[EffectId];

class MaterialOverride {
    private readonly meshes: readonly Mesh[];
    private readonly originals: (Material | Material[])[] = [];
    private readonly applied: Material[] = [];

    constructor(meshes: readonly Mesh[]) {
        this.meshes = meshes;
    }

    apply(material: Material): void {
        if (this.applied.length === 0)
            for (let index = 0; index < this.meshes.length; index += 1)
                this.originals[index] = this.meshes[index].material;
        this.applied.push(material);
        this.setAll(material);
    }

    release(material: Material): void {
        const index = this.applied.lastIndexOf(material);
        if (index < 0) return;

        this.applied.splice(index, 1);
        const top = this.applied[this.applied.length - 1];
        if (top) {
            this.setAll(top);
            return;
        }
        for (let meshIndex = 0; meshIndex < this.meshes.length; meshIndex += 1) {
            const original = this.originals[meshIndex];
            if (original) this.meshes[meshIndex].material = original;
        }
    }

    private setAll(material: Material): void {
        for (let index = 0; index < this.meshes.length; index += 1)
            this.meshes[index].material = material;
    }
}

export abstract class Effect {
    readonly sceneObject: Object3D | null = null;

    abstract update(deltaSeconds: number): void;
    abstract dispose(): void;
}

class MaterialFlash extends Effect {
    private static readonly flashMaterials = new Map<number, Material>();

    private static flashMaterialFor(color: number): Material {
        let material = MaterialFlash.flashMaterials.get(color);
        if (!material) {
            material = new MeshBasicMaterial({ color, toneMapped: false });
            MaterialFlash.flashMaterials.set(color, material);
        }
        return material;
    }

    private readonly material: Material;
    private remainingSeconds = 0;
    private isShowing = false;

    constructor(
        private readonly override: MaterialOverride,
        private readonly spec: IMaterialFlashSpec
    ) {
        super();
        this.material = MaterialFlash.flashMaterialFor(spec.color);
    }

    play(): void {
        this.remainingSeconds = this.spec.seconds;
        if (this.isShowing) return;

        this.override.apply(this.material);
        this.isShowing = true;
    }

    update(deltaSeconds: number): void {
        if (this.remainingSeconds <= 0) return;

        this.remainingSeconds = Math.max(0, this.remainingSeconds - deltaSeconds);
        if (this.remainingSeconds === 0) this.release();
    }

    dispose(): void {
        this.release();
    }

    private release(): void {
        if (!this.isShowing) return;

        this.override.release(this.material);
        this.isShowing = false;
    }
}

class ParticleBurst extends Effect {
    readonly sceneObject: Mesh;

    private readonly geometry = new InstancedBufferGeometry();
    private readonly material: ShaderMaterial;
    private readonly origins: InstancedBufferAttribute;
    private readonly velocities: InstancedBufferAttribute;
    private readonly tints: InstancedBufferAttribute;
    private readonly births: InstancedBufferAttribute;
    private readonly colors: readonly Color[];
    private cursor = 0;
    private time = 0;

    constructor(private readonly spec: IParticleBurstSpec) {
        super();
        const capacity = spec.capacity;
        this.origins = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.velocities = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.tints = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.births = new InstancedBufferAttribute(new Float32Array(capacity).fill(-1000), 1);
        this.colors = spec.colorCycle.map((hex) => new Color(hex));

        const quad = new PlaneGeometry(1, 1);
        this.geometry.index = quad.index;
        this.geometry.setAttribute("position", quad.getAttribute("position"));
        this.geometry.setAttribute("origin", this.origins);
        this.geometry.setAttribute("velocity", this.velocities);
        this.geometry.setAttribute("tint", this.tints);
        this.geometry.setAttribute("birth", this.births);
        this.geometry.instanceCount = capacity;

        this.material = new ShaderMaterial({
            uniforms: { time: { value: 0 }, size: { value: metresToUnits(spec.sizeMetres) } },
            vertexShader: particleBurstVertexShader(spec),
            fragmentShader: PARTICLE_BURST_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        });

        this.sceneObject = new Mesh(this.geometry, this.material);
        this.sceneObject.frustumCulled = false;
        this.sceneObject.renderOrder = spec.renderOrder;
    }

    play(point: Vector3, direction: Vector3, tier: ImpactTier): void {
        const capacity = this.spec.capacity;
        const count = this.spec.burstSize[tier];
        const firstSlot = this.cursor;
        const speed = metresToUnits(this.spec.speedMetres[tier]);

        for (let index = 0; index < count; index += 1) {
            const slot = this.cursor;
            this.cursor = (this.cursor + 1) % capacity;
            const tint = this.colors[index % this.colors.length];

            this.origins.setXYZ(slot, point.x, point.y, point.z);
            this.velocities.setXYZ(
                slot,
                direction.x * speed + randomOffset(Math.random, speed * this.spec.spreadFraction),
                Math.random() * speed * this.spec.liftFraction,
                direction.z * speed + randomOffset(Math.random, speed * this.spec.spreadFraction)
            );
            this.tints.setXYZ(slot, tint.r, tint.g, tint.b);
            this.births.setX(slot, this.time);
        }

        const headCount = Math.min(count, capacity - firstSlot);
        for (const attribute of [this.origins, this.velocities, this.tints, this.births]) {
            attribute.addUpdateRange(
                firstSlot * attribute.itemSize,
                headCount * attribute.itemSize
            );
            if (count > headCount)
                attribute.addUpdateRange(0, (count - headCount) * attribute.itemSize);
            attribute.needsUpdate = true;
        }
    }

    update(deltaSeconds: number): void {
        this.time += deltaSeconds;
        this.material.uniforms.time.value = this.time;
    }

    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
    }
}

class AttackWarningFlares extends Effect {
    readonly sceneObject = new Group();

    private readonly texture: ReturnType<typeof createGlowTexture>;
    private readonly slots: IFlareSlot[] = [];
    private readonly colors: Readonly<Record<AttackWarningDanger, Color>>;
    private readonly segment: ICapsule = {
        start: new Vector3(),
        end: new Vector3(),
        radius: 0,
    };

    constructor(private readonly spec: IAttackWarningFlareSpec) {
        super();
        this.texture = createGlowTexture(spec.textureSize);
        this.colors = {
            parryable: new Color(spec.colors.parryable),
            dodgeOnly: new Color(spec.colors.dodgeOnly),
        };
        for (let index = 0; index < spec.poolSize; index += 1) {
            const material = new SpriteMaterial({
                map: this.texture,
                blending: AdditiveBlending,
                depthWrite: false,
                transparent: true,
            });
            const sprite = new Sprite(material);
            sprite.visible = false;
            sprite.renderOrder = spec.renderOrder;
            this.sceneObject.add(sprite);
            this.slots.push({
                sprite,
                material,
                source: null,
                moveId: "",
                shape: { kind: "weapon" },
                socketShape: { kind: "socket", bone: "", radius: 0 },
                danger: "parryable",
                age: 0,
            });
        }
    }

    play(warning: ICombatEventMap["attackWarning"]): void {
        if (warning.combatant.team === this.spec.ignoreTeam) return;

        let chosen = this.slots[0];
        for (const slot of this.slots) {
            if (!slot.source) {
                chosen = slot;
                break;
            }
            if (slot.age > chosen.age) chosen = slot;
        }

        chosen.source = warning.combatant;
        chosen.moveId = warning.moveId;
        if (warning.shape.kind === "socket") {
            chosen.socketShape.bone = warning.shape.bone;
            chosen.socketShape.radius = warning.shape.radius;
            chosen.shape = chosen.socketShape;
        } else chosen.shape = warning.shape;
        chosen.danger = warning.danger;
        chosen.age = 0;
        chosen.material.color.copy(this.colors[warning.danger]);
    }

    update(deltaSeconds: number): void {
        const seconds = this.spec.seconds;
        for (const slot of this.slots) {
            const source = slot.source;
            if (!source) continue;

            slot.age += deltaSeconds;
            if (
                slot.age >= seconds ||
                source.isDead ||
                source.activeMoveId !== slot.moveId ||
                !source.sampleHitShape(slot.shape, this.segment)
            ) {
                this.release(slot);
                continue;
            }

            slot.sprite.position.copy(this.segment.end);
            slot.sprite.scale.setScalar(
                this.spec.sizes[slot.danger] * Math.sin((Math.PI * slot.age) / seconds)
            );
            slot.sprite.visible = true;
        }
    }

    dispose(): void {
        for (const slot of this.slots) slot.material.dispose();
        this.texture.dispose();
    }

    private release(slot: IFlareSlot): void {
        slot.source = null;
        slot.sprite.visible = false;
    }
}

class RibbonTrail extends Effect {
    private static catmullRom(
        out: Vector3,
        p0: Vector3,
        p1: Vector3,
        p2: Vector3,
        p3: Vector3,
        t: number
    ): Vector3 {
        return out.set(
            smoothCurveValue(p0.x, p1.x, p2.x, p3.x, t),
            smoothCurveValue(p0.y, p1.y, p2.y, p3.y, t),
            smoothCurveValue(p0.z, p1.z, p2.z, p3.z, t)
        );
    }

    readonly sceneObject: Mesh;

    private readonly samples: ITrailSample[] = [];
    private readonly maxPoints: number;
    private readonly positions: Float32Array;
    private readonly ages: Float32Array;
    private readonly edges: Float32Array;
    private readonly geometry = new BufferGeometry();
    private readonly material: ShaderMaterial;
    private readonly positionAttribute: BufferAttribute;
    private readonly ageAttribute: BufferAttribute;
    private readonly curveBase = new Vector3();
    private readonly curveTip = new Vector3();
    private newestSample = 0;
    private sampleCount = 0;
    private time = 0;
    private intensity = 0;
    private isEmitting = false;

    constructor(
        private readonly spec: IRibbonTrailSpec,
        color: string
    ) {
        super();
        this.maxPoints = (spec.maxSamples - 1) * spec.subdivisions + 1;
        this.positions = new Float32Array(this.maxPoints * 6);
        this.ages = new Float32Array(this.maxPoints * 2);
        this.edges = new Float32Array(this.maxPoints * 2);
        for (let index = 0; index < spec.maxSamples; index += 1)
            this.samples.push({ base: new Vector3(), tip: new Vector3(), born: 0 });

        this.positionAttribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
        this.ageAttribute = new BufferAttribute(this.ages, 1).setUsage(DynamicDrawUsage);
        for (let point = 0; point < this.maxPoints; point += 1) this.edges[point * 2 + 1] = 1;
        this.geometry.setAttribute("position", this.positionAttribute);
        this.geometry.setAttribute("age", this.ageAttribute);
        this.geometry.setAttribute("edge", new BufferAttribute(this.edges, 1));

        const indices: number[] = [];
        for (let point = 0; point < this.maxPoints - 1; point += 1) {
            const base = point * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        this.geometry.setIndex(indices);

        this.material = new ShaderMaterial({
            uniforms: {
                color: { value: new Color(color) },
                intensity: { value: 0 },
                time: { value: 0 },
            },
            vertexShader: RIBBON_TRAIL_VERTEX_SHADER,
            fragmentShader: RIBBON_TRAIL_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
        });

        this.sceneObject = new Mesh(this.geometry, this.material);
        this.sceneObject.frustumCulled = false;
        this.sceneObject.visible = false;
        this.sceneObject.renderOrder = spec.renderOrder;
    }

    play(base: Vector3, tip: Vector3): void {
        const maxSamples = this.spec.maxSamples;
        this.newestSample = (this.newestSample + maxSamples - 1) % maxSamples;
        const sample = this.samples[this.newestSample];
        sample.base.lerpVectors(base, tip, this.spec.innerEdgeFraction);
        sample.tip.copy(tip);
        sample.born = this.time;
        this.sampleCount = Math.min(maxSamples, this.sampleCount + 1);
        this.intensity = 1;
        this.isEmitting = true;
    }

    update(deltaSeconds: number): void {
        const { sampleLifetime, subdivisions } = this.spec;
        this.time += deltaSeconds;
        if (!this.isEmitting)
            this.intensity = Math.max(0, this.intensity - this.spec.releaseFadeRate * deltaSeconds);
        this.isEmitting = false;

        while (this.sampleCount > 0) {
            const oldest = this.sampleAt(this.sampleCount - 1);
            if (this.time - oldest.born <= sampleLifetime) break;
            this.sampleCount -= 1;
        }
        if (this.intensity === 0) this.sampleCount = 0;

        this.sceneObject.visible = this.sampleCount > 1;
        if (!this.sceneObject.visible) return;

        this.material.uniforms.intensity.value = this.intensity;
        this.material.uniforms.time.value = this.time;

        let point = 0;
        const last = this.sampleCount - 1;
        for (let segment = 0; segment < last; segment += 1) {
            const previous = this.sampleAt(Math.max(segment - 1, 0));
            const from = this.sampleAt(segment);
            const to = this.sampleAt(segment + 1);
            const next = this.sampleAt(Math.min(segment + 2, last));

            const steps = segment === last - 1 ? subdivisions + 1 : subdivisions;
            for (let step = 0; step < steps; step += 1) {
                const blend = step / subdivisions;
                RibbonTrail.catmullRom(
                    this.curveBase,
                    previous.base,
                    from.base,
                    to.base,
                    next.base,
                    blend
                );
                RibbonTrail.catmullRom(
                    this.curveTip,
                    previous.tip,
                    from.tip,
                    to.tip,
                    next.tip,
                    blend
                );
                const born = lerp(from.born, to.born, blend);
                const age = Math.min(1, (this.time - born) / sampleLifetime);
                this.writePoint(point, age);
                point += 1;
            }
        }

        this.positionAttribute.needsUpdate = true;
        this.ageAttribute.needsUpdate = true;
        this.geometry.setDrawRange(0, Math.max(0, point - 1) * 6);
    }

    dispose(): void {
        this.sceneObject.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
    }

    private sampleAt(age: number): ITrailSample {
        return this.samples[(this.newestSample + age) % this.spec.maxSamples];
    }

    private writePoint(point: number, age: number): void {
        const offset = point * 6;
        this.positions[offset] = this.curveBase.x;
        this.positions[offset + 1] = this.curveBase.y;
        this.positions[offset + 2] = this.curveBase.z;
        this.positions[offset + 3] = this.curveTip.x;
        this.positions[offset + 4] = this.curveTip.y;
        this.positions[offset + 5] = this.curveTip.z;
        this.ages[point * 2] = age;
        this.ages[point * 2 + 1] = age;
    }
}

export class EffectSet {
    private static createEffect(
        spec: EffectSpec,
        target: IEffectTarget,
        override: MaterialOverride
    ): Effect {
        switch (spec.kind) {
            case "materialFlash":
                return new MaterialFlash(override, spec);
            case "particleBurst":
                return new ParticleBurst(spec);
            case "attackWarningFlare":
                return new AttackWarningFlares(spec);
            case "ribbonTrail":
                return new RibbonTrail(spec, target.color ?? "#ffffff");
        }
    }

    private readonly effectsById = new Map<EffectId, Effect>();
    private readonly effects: Effect[] = [];

    constructor(ids: readonly EffectId[], target: IEffectTarget) {
        const override = new MaterialOverride(target.meshes ?? []);
        for (const id of ids) {
            const effect = EffectSet.createEffect(EFFECTS[id], target, override);
            if (effect.sceneObject) target.sceneRoot?.add(effect.sceneObject);
            this.effectsById.set(id, effect);
            this.effects.push(effect);
        }
    }

    get<Id extends EffectId>(id: Id): EffectFor<Id> {
        return this.effectsById.get(id) as EffectFor<Id>;
    }

    update(deltaSeconds: number): void {
        for (const effect of this.effects) effect.update(deltaSeconds);
    }

    dispose(): void {
        for (const effect of this.effects) effect.dispose();
    }
}

export class WorldEffects implements IWorldEntity {
    private static readonly scratchDirection = new Vector3();

    private static readonly TRIGGERED_EFFECT_IDS = (Object.keys(EFFECTS) as EffectId[]).filter(
        (id): id is TriggeredEffectId => "trigger" in EFFECTS[id]
    );

    private static playOnTrigger(
        effect: Effect,
        events: GameEvents,
        trigger: EffectTrigger
    ): () => void {
        switch (trigger) {
            case "hitLanded":
                return events.on("hitLanded", (hit) => {
                    if (!(effect instanceof ParticleBurst)) return;
                    WorldEffects.scratchDirection
                        .subVectors(hit.point, hit.attacker.sceneObject.position)
                        .setY(0);
                    if (WorldEffects.scratchDirection.lengthSq() > 1e-8)
                        WorldEffects.scratchDirection.normalize();
                    effect.play(hit.point, WorldEffects.scratchDirection, hit.impact);
                });
            case "attackWarning":
                return events.on("attackWarning", (warning) => {
                    if (effect instanceof AttackWarningFlares) effect.play(warning);
                });
        }
    }

    readonly sceneObject = new Group();

    private readonly effects: EffectSet;
    private readonly unsubscribers: (() => void)[] = [];

    constructor(events: GameEvents) {
        this.effects = new EffectSet(WorldEffects.TRIGGERED_EFFECT_IDS, {
            sceneRoot: this.sceneObject,
        });
        for (const id of WorldEffects.TRIGGERED_EFFECT_IDS)
            this.unsubscribers.push(
                WorldEffects.playOnTrigger(this.effects.get(id), events, EFFECTS[id].trigger)
            );
    }

    update(deltaSeconds: number): void {
        this.effects.update(deltaSeconds);
    }

    dispose(): void {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.effects.dispose();
    }
}
