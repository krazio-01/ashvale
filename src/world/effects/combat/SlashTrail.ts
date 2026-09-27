import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    DynamicDrawUsage,
    Mesh,
    ShaderMaterial,
    Vector3,
} from "three";

const MAX_SAMPLES = 24;
const SUBDIVISIONS = 6;
const MAX_POINTS = (MAX_SAMPLES - 1) * SUBDIVISIONS + 1;
const SAMPLE_LIFETIME = 0.22;
const RELEASE_FADE_RATE = 9;
const INNER_EDGE_FRACTION = 0.45;

const vertexShader = `
attribute float age;
attribute float edge;
varying float vAge;
varying float vEdge;
void main() {
    vAge = age;
    vEdge = edge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = `
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

interface ISample {
    readonly base: Vector3;
    readonly tip: Vector3;
    born: number;
}

const scratchPoint = new Vector3();

function catmullRom(
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
        .addScaledVector(scratchPoint.subVectors(p2, p0), t)
        .addScaledVector(
            scratchPoint
                .copy(p0)
                .multiplyScalar(2)
                .addScaledVector(p1, -5)
                .addScaledVector(p2, 4)
                .sub(p3),
            t2
        )
        .addScaledVector(
            scratchPoint.copy(p1).multiplyScalar(3).sub(p0).addScaledVector(p2, -3).add(p3),
            t3
        )
        .multiplyScalar(0.5);
}

export class SlashTrail {
    readonly mesh: Mesh;

    private readonly samples: ISample[] = [];
    private readonly positions = new Float32Array(MAX_POINTS * 6);
    private readonly ages = new Float32Array(MAX_POINTS * 2);
    private readonly edges = new Float32Array(MAX_POINTS * 2);
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
        for (let index = 0; index < MAX_SAMPLES; index += 1)
            this.samples.push({ base: new Vector3(), tip: new Vector3(), born: 0 });

        this.positionAttribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
        this.ageAttribute = new BufferAttribute(this.ages, 1).setUsage(DynamicDrawUsage);
        for (let point = 0; point < MAX_POINTS; point += 1) this.edges[point * 2 + 1] = 1;
        this.geometry.setAttribute("position", this.positionAttribute);
        this.geometry.setAttribute("age", this.ageAttribute);
        this.geometry.setAttribute("edge", new BufferAttribute(this.edges, 1));

        const indices: number[] = [];
        for (let point = 0; point < MAX_POINTS - 1; point += 1) {
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
            vertexShader,
            fragmentShader,
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
        recycled.base.lerpVectors(base, tip, INNER_EDGE_FRACTION);
        recycled.tip.copy(tip);
        recycled.born = this.time;
        this.samples.unshift(recycled);
        this.sampleCount = Math.min(MAX_SAMPLES, this.sampleCount + 1);
        this.intensity = 1;
    }

    update(deltaSeconds: number, emitting: boolean): void {
        this.time += deltaSeconds;
        if (!emitting)
            this.intensity = Math.max(0, this.intensity - RELEASE_FADE_RATE * deltaSeconds);

        while (this.sampleCount > 0) {
            const oldest = this.samples[this.sampleCount - 1];
            if (!oldest || this.time - oldest.born <= SAMPLE_LIFETIME) break;
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

            const steps = segment === last - 1 ? SUBDIVISIONS + 1 : SUBDIVISIONS;
            for (let step = 0; step < steps; step += 1) {
                const blend = step / SUBDIVISIONS;
                catmullRom(this.curveBase, previous.base, from.base, to.base, next.base, blend);
                catmullRom(this.curveTip, previous.tip, from.tip, to.tip, next.tip, blend);
                const born = from.born + (to.born - from.born) * blend;
                const age = Math.min(1, (this.time - born) / SAMPLE_LIFETIME);
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
