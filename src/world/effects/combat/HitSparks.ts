import {
    AdditiveBlending,
    Color,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    Vector3,
} from "three";
import type { CombatEvents } from "@/systems/combat/services/CombatEvents";
import { metres } from "@/lib/helpers";
import { HIT_SPARKS } from "@/constants/combat";
import type { ImpactTier } from "@/types/combat";
import type { IWorldEntity } from "@/types/world";

const CAPACITY = HIT_SPARKS.capacity;
const LIFETIME = HIT_SPARKS.lifetimeSeconds;
const SPARK_COLOR = new Color(HIT_SPARKS.sparkColor);
const EMBER_COLOR = new Color(HIT_SPARKS.emberColor);
const scratchDirection = new Vector3();

const vertexShader = `
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
    if (age < 0.0 || age > ${LIFETIME.toFixed(2)}) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    float life = age / ${LIFETIME.toFixed(2)};
    vec3 centre = origin + velocity * age + vec3(0.0, -${metres(9).toFixed(1)} * age * age, 0.0);
    vec4 viewCentre = viewMatrix * vec4(centre, 1.0);
    viewCentre.xy += position.xy * size * (1.0 - life);
    gl_Position = projectionMatrix * viewCentre;
    vTint = tint;
    vFade = 1.0 - life;
    vCorner = position.xy * 2.0;
}`;

const fragmentShader = `
varying vec3 vTint;
varying float vFade;
varying vec2 vCorner;
void main() {
    float falloff = smoothstep(1.0, 0.0, length(vCorner));
    gl_FragColor = vec4(vTint * (1.0 + vFade), falloff * vFade);
}`;

export class HitSparks implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly geometry = new InstancedBufferGeometry();
    private readonly material: ShaderMaterial;
    private readonly origins = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    private readonly velocities = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    private readonly tints = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    private readonly births = new InstancedBufferAttribute(
        new Float32Array(CAPACITY).fill(-1000),
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
        this.geometry.instanceCount = CAPACITY;

        this.material = new ShaderMaterial({
            uniforms: { time: { value: 0 }, size: { value: metres(0.12) } },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        });

        this.sceneObject = new Mesh(this.geometry, this.material);
        this.sceneObject.frustumCulled = false;
        this.sceneObject.renderOrder = 11;

        this.unsubscribe = events.on("hitLanded", (event) => {
            scratchDirection.subVectors(event.point, event.attacker.sceneObject.position).setY(0);
            if (scratchDirection.lengthSq() > 1e-8) scratchDirection.normalize();
            this.burst(event.point, scratchDirection, event.impact);
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
            this.cursor = (this.cursor + 1) % CAPACITY;
            const tint = index % 3 === 0 ? EMBER_COLOR : SPARK_COLOR;

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

        const headCount = Math.min(count, CAPACITY - firstSlot);
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
