import {
    AdditiveBlending,
    Color,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    Vector3,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    DynamicDrawUsage,
    DataTexture,
    Group,
    RGBAFormat,
    Sprite,
    SpriteMaterial,
} from "three";
import type { CombatEvents, ICombatEventMap, ITelegraphSource } from "@/events/CombatEvents";
import { metres } from "@/lib/helpers";
import { HIT_SPARKS, TELEGRAPH_FLARES } from "@/constants/combat";
import type { ImpactTier, HitShape, IStrikeSegment, TelegraphDanger } from "@/types/combat";
import type { IWorldEntity } from "@/types/world";

interface ISample {
    readonly base: Vector3;
    readonly tip: Vector3;
    born: number;
}

interface IFlareSlot {
    sprite: Sprite;
    material: SpriteMaterial;
    source: ITelegraphSource | null;
    moveId: string;
    shape: HitShape;
    readonly socketShape: Extract<HitShape, { kind: "socket" }>;
    danger: TelegraphDanger;
    age: number;
}

export class HitSparks implements IWorldEntity {
    private static readonly LIFETIME = HIT_SPARKS.lifetimeSeconds;

    private static readonly CAPACITY = HIT_SPARKS.capacity;

    private static readonly SPARK_COLOR = new Color(HIT_SPARKS.sparkColor);

    private static readonly EMBER_COLOR = new Color(HIT_SPARKS.emberColor);

    private static readonly scratchDirection = new Vector3();

    private static readonly vertexShader = `
attribute vec3 origin;
attribute vec3 velocity;
attribute vec3 tint;
attribute float birth;
uniform float time;
uniform float size;
varying vec3 vTint;
varying float vFade;
varying vec2 vCorner;
void main() {
    float age = time - birth;
    if (age < 0.0 || age > ${HitSparks.LIFETIME.toFixed(2)}) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    float life = age / ${HitSparks.LIFETIME.toFixed(2)};
    vec3 centre = origin + velocity * age + vec3(0.0, -${metres(9).toFixed(1)} * age * age, 0.0);
    vec4 viewCentre = viewMatrix * vec4(centre, 1.0);
    viewCentre.xy += position.xy * size * (1.0 - life);
    gl_Position = projectionMatrix * viewCentre;
    vTint = tint;
    vFade = 1.0 - life;
    vCorner = position.xy * 2.0;
}`;

    private static readonly fragmentShader = `
varying vec3 vTint;
varying float vFade;
varying vec2 vCorner;
void main() {
    float falloff = smoothstep(1.0, 0.0, length(vCorner));
    gl_FragColor = vec4(vTint * (1.0 + vFade), falloff * vFade);
}`;

    readonly sceneObject: Mesh;

    private readonly geometry = new InstancedBufferGeometry();
    private readonly material: ShaderMaterial;
    private readonly origins = new InstancedBufferAttribute(
        new Float32Array(HitSparks.CAPACITY * 3),
        3
    );
    private readonly velocities = new InstancedBufferAttribute(
        new Float32Array(HitSparks.CAPACITY * 3),
        3
    );
    private readonly tints = new InstancedBufferAttribute(
        new Float32Array(HitSparks.CAPACITY * 3),
        3
    );
    private readonly births = new InstancedBufferAttribute(
        new Float32Array(HitSparks.CAPACITY).fill(-1000),
        1
    );
    private readonly unsubscribe: () => void;
    private cursor = 0;
    private time = 0;

    constructor(events: CombatEvents) {
        const quad = new PlaneGeometry(1, 1);
        this.geometry.index = quad.index;
        this.geometry.setAttribute("position", quad.getAttribute("position"));
        this.geometry.setAttribute("origin", this.origins);
        this.geometry.setAttribute("velocity", this.velocities);
        this.geometry.setAttribute("tint", this.tints);
        this.geometry.setAttribute("birth", this.births);
        this.geometry.instanceCount = HitSparks.CAPACITY;

        this.material = new ShaderMaterial({
            uniforms: { time: { value: 0 }, size: { value: metres(0.12) } },
            vertexShader: HitSparks.vertexShader,
            fragmentShader: HitSparks.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        });

        this.sceneObject = new Mesh(this.geometry, this.material);
        this.sceneObject.frustumCulled = false;
        this.sceneObject.renderOrder = 11;

        this.unsubscribe = events.on("hitLanded", (event) => {
            HitSparks.scratchDirection
                .subVectors(event.point, event.attacker.sceneObject.position)
                .setY(0);
            if (HitSparks.scratchDirection.lengthSq() > 1e-8)
                HitSparks.scratchDirection.normalize();
            this.burst(event.point, HitSparks.scratchDirection, event.impact);
        });
    }

    update(deltaSeconds: number): void {
        this.time += deltaSeconds;
        this.material.uniforms.time.value = this.time;
    }

    dispose(): void {
        this.unsubscribe();
        this.geometry.dispose();
        this.material.dispose();
    }

    private burst(point: Vector3, direction: Vector3, impact: ImpactTier): void {
        const count = HIT_SPARKS.burstSize[impact];
        const firstSlot = this.cursor;
        const speed = metres(impact === "light" ? 5 : 7);

        for (let index = 0; index < count; index += 1) {
            const slot = this.cursor;
            this.cursor = (this.cursor + 1) % HitSparks.CAPACITY;
            const tint = index % 3 === 0 ? HitSparks.EMBER_COLOR : HitSparks.SPARK_COLOR;

            this.origins.setXYZ(slot, point.x, point.y, point.z);
            this.velocities.setXYZ(
                slot,
                direction.x * speed + (Math.random() - 0.5) * speed,
                Math.random() * speed * 0.8,
                direction.z * speed + (Math.random() - 0.5) * speed
            );
            this.tints.setXYZ(slot, tint.r, tint.g, tint.b);
            this.births.setX(slot, this.time);
        }

        const headCount = Math.min(count, HitSparks.CAPACITY - firstSlot);
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
}

export class SlashTrail {
    private static readonly MAX_SAMPLES = 24;

    private static readonly SUBDIVISIONS = 6;

    private static readonly scratchPoint = new Vector3();

    private static readonly MAX_POINTS = (SlashTrail.MAX_SAMPLES - 1) * SlashTrail.SUBDIVISIONS + 1;

    private static readonly SAMPLE_LIFETIME = 0.22;

    private static readonly RELEASE_FADE_RATE = 9;

    private static readonly INNER_EDGE_FRACTION = 0.45;

    private static readonly vertexShader = `
attribute float age;
attribute float edge;
varying float vAge;
varying float vEdge;
void main() {
    vAge = age;
    vEdge = edge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

    private static readonly fragmentShader = `
uniform vec3 color;
uniform float intensity;
uniform float time;
varying float vAge;
varying float vEdge;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float streaks(float u, float v) {
    float lane = floor(v * 9.0);
    float speed = 6.0 + hash(lane) * 6.0;
    return 0.55 + 0.45 * sin((u * 18.0 - time * speed) + hash(lane + 3.0) * 6.2831);
}

void main() {
    float life = 1.0 - vAge;
    float tail = life * life;
    float core = smoothstep(0.86, 0.985, vEdge) * (1.0 - smoothstep(0.985, 1.0, vEdge));
    float glow = pow(vEdge, 2.4) * streaks(vAge, vEdge);
    float strength = (glow * 1.3 + core * 2.4) * tail * intensity;
    vec3 tint = mix(color, vec3(1.0), clamp(core * 0.9 + glow * 0.15, 0.0, 1.0));
    gl_FragColor = vec4(tint * strength, strength);
}`;

    private static catmullRom(
        out: Vector3,
        p0: Vector3,
        p1: Vector3,
        p2: Vector3,
        p3: Vector3,
        t: number
    ): Vector3 {
        const t2 = t * t;
        const t3 = t2 * t;
        return out
            .copy(p1)
            .multiplyScalar(2)
            .addScaledVector(SlashTrail.scratchPoint.subVectors(p2, p0), t)
            .addScaledVector(
                SlashTrail.scratchPoint
                    .copy(p0)
                    .multiplyScalar(2)
                    .addScaledVector(p1, -5)
                    .addScaledVector(p2, 4)
                    .sub(p3),
                t2
            )
            .addScaledVector(
                SlashTrail.scratchPoint
                    .copy(p1)
                    .multiplyScalar(3)
                    .sub(p0)
                    .addScaledVector(p2, -3)
                    .add(p3),
                t3
            )
            .multiplyScalar(0.5);
    }

    readonly mesh: Mesh;

    private readonly samples: ISample[] = [];
    private readonly positions = new Float32Array(SlashTrail.MAX_POINTS * 6);
    private readonly ages = new Float32Array(SlashTrail.MAX_POINTS * 2);
    private readonly edges = new Float32Array(SlashTrail.MAX_POINTS * 2);
    private readonly geometry = new BufferGeometry();
    private readonly material: ShaderMaterial;
    private readonly positionAttribute: BufferAttribute;
    private readonly ageAttribute: BufferAttribute;
    private readonly curveBase = new Vector3();
    private readonly curveTip = new Vector3();
    private sampleCount = 0;
    private time = 0;
    private intensity = 0;

    constructor(color: string) {
        for (let index = 0; index < SlashTrail.MAX_SAMPLES; index += 1)
            this.samples.push({ base: new Vector3(), tip: new Vector3(), born: 0 });

        this.positionAttribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
        this.ageAttribute = new BufferAttribute(this.ages, 1).setUsage(DynamicDrawUsage);
        for (let point = 0; point < SlashTrail.MAX_POINTS; point += 1)
            this.edges[point * 2 + 1] = 1;
        this.geometry.setAttribute("position", this.positionAttribute);
        this.geometry.setAttribute("age", this.ageAttribute);
        this.geometry.setAttribute("edge", new BufferAttribute(this.edges, 1));

        const indices: number[] = [];
        for (let point = 0; point < SlashTrail.MAX_POINTS - 1; point += 1) {
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
            vertexShader: SlashTrail.vertexShader,
            fragmentShader: SlashTrail.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
        });

        this.mesh = new Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.mesh.renderOrder = 10;
    }

    push(base: Vector3, tip: Vector3): void {
        const recycled = this.samples.pop();
        if (!recycled) return;
        recycled.base.lerpVectors(base, tip, SlashTrail.INNER_EDGE_FRACTION);
        recycled.tip.copy(tip);
        recycled.born = this.time;
        this.samples.unshift(recycled);
        this.sampleCount = Math.min(SlashTrail.MAX_SAMPLES, this.sampleCount + 1);
        this.intensity = 1;
    }

    update(deltaSeconds: number, emitting: boolean): void {
        this.time += deltaSeconds;
        if (!emitting)
            this.intensity = Math.max(
                0,
                this.intensity - SlashTrail.RELEASE_FADE_RATE * deltaSeconds
            );

        while (this.sampleCount > 0) {
            const oldest = this.samples[this.sampleCount - 1];
            if (!oldest || this.time - oldest.born <= SlashTrail.SAMPLE_LIFETIME) break;
            this.sampleCount -= 1;
        }
        if (this.intensity === 0) this.sampleCount = 0;

        this.mesh.visible = this.sampleCount > 1;
        if (!this.mesh.visible) return;

        this.material.uniforms.intensity.value = this.intensity;
        this.material.uniforms.time.value = this.time;

        let point = 0;
        const last = this.sampleCount - 1;
        for (let segment = 0; segment < last; segment += 1) {
            const previous = this.samples[Math.max(segment - 1, 0)];
            const from = this.samples[segment];
            const to = this.samples[segment + 1];
            const next = this.samples[Math.min(segment + 2, last)];
            if (!previous || !from || !to || !next) break;

            const steps =
                segment === last - 1 ? SlashTrail.SUBDIVISIONS + 1 : SlashTrail.SUBDIVISIONS;
            for (let step = 0; step < steps; step += 1) {
                const blend = step / SlashTrail.SUBDIVISIONS;
                SlashTrail.catmullRom(
                    this.curveBase,
                    previous.base,
                    from.base,
                    to.base,
                    next.base,
                    blend
                );
                SlashTrail.catmullRom(
                    this.curveTip,
                    previous.tip,
                    from.tip,
                    to.tip,
                    next.tip,
                    blend
                );
                const born = from.born + (to.born - from.born) * blend;
                const age = Math.min(1, (this.time - born) / SlashTrail.SAMPLE_LIFETIME);
                this.writePoint(point, age);
                point += 1;
            }
        }

        this.positionAttribute.needsUpdate = true;
        this.ageAttribute.needsUpdate = true;
        this.geometry.setDrawRange(0, Math.max(0, point - 1) * 6);
    }

    dispose(): void {
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
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

export class TelegraphFlares implements IWorldEntity {
    private static readonly TEXTURE_SIZE = 32;

    private static readonly PARRYABLE_COLOR = new Color(TELEGRAPH_FLARES.parryableColor);

    private static readonly PERILOUS_COLOR = new Color(TELEGRAPH_FLARES.perilousColor);

    private static createGlowTexture(): DataTexture {
        const pixels = new Uint8Array(
            TelegraphFlares.TEXTURE_SIZE * TelegraphFlares.TEXTURE_SIZE * 4
        );
        const centre = (TelegraphFlares.TEXTURE_SIZE - 1) / 2;
        for (let y = 0; y < TelegraphFlares.TEXTURE_SIZE; y += 1)
            for (let x = 0; x < TelegraphFlares.TEXTURE_SIZE; x += 1) {
                const radius = Math.min(1, Math.hypot(x - centre, y - centre) / centre);
                const offset = (y * TelegraphFlares.TEXTURE_SIZE + x) * 4;
                pixels.fill(255, offset, offset + 3);
                pixels[offset + 3] = Math.round(255 * (1 - radius) ** 2);
            }
        const texture = new DataTexture(
            pixels,
            TelegraphFlares.TEXTURE_SIZE,
            TelegraphFlares.TEXTURE_SIZE,
            RGBAFormat
        );
        texture.needsUpdate = true;
        return texture;
    }

    readonly sceneObject = new Group();
    readonly updatesAfterBodies = true;

    private readonly texture = TelegraphFlares.createGlowTexture();
    private readonly slots: IFlareSlot[] = [];
    private readonly segment: IStrikeSegment = {
        start: new Vector3(),
        end: new Vector3(),
        radius: 0,
    };
    private readonly unsubscribe: () => void;

    constructor(events: CombatEvents) {
        for (let index = 0; index < TELEGRAPH_FLARES.poolSize; index += 1) {
            const material = new SpriteMaterial({
                map: this.texture,
                blending: AdditiveBlending,
                depthWrite: false,
                transparent: true,
            });
            const sprite = new Sprite(material);
            sprite.visible = false;
            sprite.renderOrder = 12;
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

        this.unsubscribe = events.on("telegraph", (event) => this.ignite(event));
    }

    update(deltaSeconds: number): void {
        for (const slot of this.slots) {
            const source = slot.source;
            if (!source) continue;

            slot.age += deltaSeconds;
            if (
                slot.age >= TELEGRAPH_FLARES.seconds ||
                source.isDead ||
                source.activeMoveId !== slot.moveId ||
                !source.sampleHitShape(slot.shape, this.segment)
            ) {
                this.release(slot);
                continue;
            }

            const size =
                slot.danger === "perilous"
                    ? TELEGRAPH_FLARES.perilousSize
                    : TELEGRAPH_FLARES.parryableSize;
            slot.sprite.position.copy(this.segment.end);
            slot.sprite.scale.setScalar(
                size * Math.sin((Math.PI * slot.age) / TELEGRAPH_FLARES.seconds)
            );
            slot.sprite.visible = true;
        }
    }

    dispose(): void {
        this.unsubscribe();
        for (const slot of this.slots) slot.material.dispose();
        this.texture.dispose();
    }

    private ignite(event: ICombatEventMap["telegraph"]): void {
        if (event.combatant.team === "player") return;

        let chosen = this.slots[0];
        if (!chosen) return;
        for (const slot of this.slots) {
            if (!slot.source) {
                chosen = slot;
                break;
            }
            if (slot.age > chosen.age) chosen = slot;
        }

        chosen.source = event.combatant;
        chosen.moveId = event.moveId;
        if (event.shape.kind === "socket") {
            chosen.socketShape.bone = event.shape.bone;
            chosen.socketShape.radius = event.shape.radius;
            chosen.shape = chosen.socketShape;
        } else chosen.shape = event.shape;
        chosen.danger = event.danger;
        chosen.age = 0;
        chosen.material.color.copy(
            event.danger === "perilous"
                ? TelegraphFlares.PERILOUS_COLOR
                : TelegraphFlares.PARRYABLE_COLOR
        );
    }

    private release(slot: IFlareSlot): void {
        slot.source = null;
        slot.sprite.visible = false;
    }
}
