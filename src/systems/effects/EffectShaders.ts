import { DataTexture, RGBAFormat } from "three";
import { metresToUnits } from "@/lib/helpers";
import type { IParticleBurstSpec } from "@/types/world";

export const PARTICLE_BURST_FRAGMENT_SHADER = `
varying vec3 vTint;
varying float vFade;
varying vec2 vCorner;
void main() {
    float falloff = smoothstep(1.0, 0.0, length(vCorner));
    gl_FragColor = vec4(vTint * (1.0 + vFade), falloff * vFade);
}`;

export const RIBBON_TRAIL_VERTEX_SHADER = `
attribute float age;
attribute float edge;
varying float vAge;
varying float vEdge;
void main() {
    vAge = age;
    vEdge = edge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const RIBBON_TRAIL_FRAGMENT_SHADER = `
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

export function particleBurstVertexShader(spec: IParticleBurstSpec): string {
    const lifetime = spec.lifetimeSeconds.toFixed(2);
    return `
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
    if (age < 0.0 || age > ${lifetime}) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    float life = age / ${lifetime};
    vec3 centre = origin + velocity * age + vec3(0.0, -${metresToUnits(spec.gravityMetres).toFixed(1)} * age * age, 0.0);
    vec4 viewCentre = viewMatrix * vec4(centre, 1.0);
    viewCentre.xy += position.xy * size * (1.0 - life);
    gl_Position = projectionMatrix * viewCentre;
    vTint = tint;
    vFade = 1.0 - life;
    vCorner = position.xy * 2.0;
}`;
}

export function createGlowTexture(size: number): DataTexture {
    const pixels = new Uint8Array(size * size * 4);
    const centre = (size - 1) / 2;
    for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1) {
            const radius = Math.min(1, Math.hypot(x - centre, y - centre) / centre);
            const offset = (y * size + x) * 4;
            pixels.fill(255, offset, offset + 3);
            pixels[offset + 3] = Math.round(255 * (1 - radius) ** 2);
        }
    const texture = new DataTexture(pixels, size, size, RGBAFormat);
    texture.needsUpdate = true;
    return texture;
}
