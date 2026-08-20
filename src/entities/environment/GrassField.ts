import {
    BufferAttribute,
    BufferGeometry,
    Camera,
    Color,
    DoubleSide,
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    Object3D,
    PlaneGeometry,
    ShaderMaterial,
    Vector3,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import { sunDirectionOf } from "@/themes/themeManifests";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightField } from "@/world/TerrainHeightField";
import { GRASS } from "@/constants/game";
import { clamp, createSeededRandom, hashString, lerp } from "@/lib/helpers";

const VERTEX_SHADER = /* glsl */ `
    uniform float time;
    uniform float windStrength;
    uniform float windFrequency;
    uniform float windScale;
    uniform float windGustScale;
    uniform float fadeStart;
    uniform float fadeEnd;
    uniform vec3 sunDirection;
    uniform float sunWrap;

    attribute float bladeCurl;
    attribute float bladeTint;

    varying float vHeightRatio;
    varying float vTint;
    varying float vLight;

    void main() {
        vHeightRatio = uv.y;
        vTint = bladeTint;

        vec4 rootWorld = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float fade = 1.0 - smoothstep(fadeStart, fadeEnd, distance(cameraPosition, rootWorld.xyz));

        float flexibility = vHeightRatio * vHeightRatio;
        float gust = sin(
            time * windFrequency
                + (rootWorld.x + rootWorld.z) * windScale
                + sin(time * 0.31 + rootWorld.x * windGustScale)
        );

        vec3 shaped = position;
        shaped.z += bladeCurl * flexibility;
        shaped.x += gust * windStrength * flexibility;
        shaped.y *= fade;

        vec3 facing = normalize(mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0));
        vLight = mix(sunWrap, 1.0, max(dot(facing, sunDirection), 0.0));

        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(shaped, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 rootColor;
    uniform vec3 tipColor;
    uniform vec3 sunColor;
    uniform vec3 ambientColor;

    varying float vHeightRatio;
    varying float vTint;
    varying float vLight;

    void main() {
        vec3 bladeColor = mix(rootColor, tipColor, vHeightRatio) * vTint;

        gl_FragColor = vec4(bladeColor * (ambientColor + sunColor * vLight), 1.0);
    }
`;

const cameraPosition = new Vector3();

interface IGrassTile {
    mesh: InstancedMesh;
    tier: number;
}

export class GrassField extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly heightField: TerrainHeightField;
    private readonly center: Vector3Tuple;
    private readonly seed: number;
    private readonly material: ShaderMaterial;
    private readonly bladeGeometriesByTier: BufferGeometry[];
    private readonly tilesByKey = new Map<string, IGrassTile>();
    private readonly pendingKeys: string[] = [];
    private readonly viewRadius: number;

    constructor(
        context: IWorldContext,
        camera: Camera,
        center: Vector3Tuple,
        heightField: TerrainHeightField,
        seed: number
    ) {
        super("grass-field");

        this.camera = camera;
        this.heightField = heightField;
        this.center = center;
        this.seed = seed;
        this.viewRadius = GRASS.detailTiers[GRASS.detailTiers.length - 1]?.radius ?? 0;

        const { terrain, lighting, sky } = context.environment;
        const wildColor = new Color(terrain.wildColor);
        const wildHsl = { h: 0, s: 0, l: 0 };
        wildColor.getHSL(wildHsl);

        this.material = new ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: {
                time: { value: 0 },
                windStrength: { value: GRASS.windStrength },
                windFrequency: { value: GRASS.windFrequency },
                windScale: { value: GRASS.windScale },
                windGustScale: { value: GRASS.windGustScale },
                fadeStart: { value: GRASS.fadeStart },
                fadeEnd: { value: GRASS.fadeEnd },
                sunDirection: { value: sunDirectionOf(sky) },
                sunWrap: { value: GRASS.sunWrap },
                rootColor: { value: wildColor.clone().multiplyScalar(GRASS.rootDarken) },
                tipColor: {
                    value: new Color().setHSL(
                        (((wildHsl.h + GRASS.tipHueShift) % 1) + 1) % 1,
                        wildHsl.s,
                        clamp(wildHsl.l + GRASS.tipLightnessGain, 0, 1)
                    ),
                },
                sunColor: {
                    value: new Color(lighting.keyColor).multiplyScalar(lighting.keyIntensity * 0.55),
                },
                ambientColor: {
                    value: new Color(lighting.skyFill).multiplyScalar(
                        lighting.hemisphereIntensity * 0.9
                    ),
                },
            },
            side: DoubleSide,
        });

        this.bladeGeometriesByTier = GRASS.detailTiers.map((tier) =>
            buildBladeGeometry(tier.segments)
        );
    }

    update(deltaSeconds: number): void {
        this.material.uniforms.time!.value += deltaSeconds;

        this.camera.getWorldPosition(cameraPosition);
        this.releaseStaleTiles();
        this.queueMissingTiles();
        this.buildQueuedTiles();
    }

    dispose(): void {
        for (const tile of this.tilesByKey.values()) {
            tile.mesh.geometry.dispose();
            tile.mesh.dispose();
        }

        for (const geometry of this.bladeGeometriesByTier) geometry.dispose();

        this.tilesByKey.clear();
        this.pendingKeys.length = 0;
        this.material.dispose();
        this.sceneObject.clear();
    }

    // A tile is dropped when it leaves view or when its detail tier no longer matches its
    // distance; queueMissingTiles then rebuilds it at the tier it now deserves.
    private releaseStaleTiles(): void {
        const releaseRadius = this.viewRadius + GRASS.tileSize;

        for (const [key, tile] of this.tilesByKey) {
            const distance = this.tileDistanceFromCamera(key);
            const isStale =
                distance > releaseRadius || this.resolveTier(distance, tile.tier) !== tile.tier;

            if (!isStale) continue;

            this.sceneObject.remove(tile.mesh);
            tile.mesh.geometry.dispose();
            tile.mesh.dispose();
            this.tilesByKey.delete(key);
        }
    }

    private queueMissingTiles(): void {
        const localX = cameraPosition.x - this.center[0];
        const localZ = cameraPosition.z - this.center[2];
        const reach = Math.ceil(this.viewRadius / GRASS.tileSize);
        const centerTileX = Math.floor(localX / GRASS.tileSize);
        const centerTileZ = Math.floor(localZ / GRASS.tileSize);

        for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1) {
            for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
                const key = `${centerTileX + offsetX}:${centerTileZ + offsetZ}`;

                if (this.tilesByKey.has(key) || this.pendingKeys.includes(key)) continue;
                if (this.tileDistanceFromCamera(key) > this.viewRadius + GRASS.tileSize) continue;

                this.pendingKeys.push(key);
            }
        }
    }

    private buildQueuedTiles(): void {
        for (let built = 0; built < GRASS.tilesPerFrame; built += 1) {
            const key = this.pendingKeys.shift();
            if (!key) return;

            const tier = this.resolveTier(this.tileDistanceFromCamera(key), null);
            const mesh = this.buildTileMesh(key, tier);

            if (!mesh) continue;

            this.tilesByKey.set(key, { mesh, tier });
            this.sceneObject.add(mesh);
        }
    }

    private resolveTier(distance: number, currentTier: number | null): number {
        for (let tier = 0; tier < GRASS.detailTiers.length; tier += 1) {
            const boundary = GRASS.detailTiers[tier]!.radius;
            const widened =
                currentTier !== null && currentTier > tier ? boundary + GRASS.tierHysteresis : boundary;

            if (distance <= widened) return tier;
        }

        return GRASS.detailTiers.length - 1;
    }

    private tileDistanceFromCamera(key: string): number {
        const [tileX, tileZ] = key.split(":").map(Number);

        return Math.hypot(
            (tileX! + 0.5) * GRASS.tileSize + this.center[0] - cameraPosition.x,
            (tileZ! + 0.5) * GRASS.tileSize + this.center[2] - cameraPosition.z
        );
    }

    private buildTileMesh(key: string, tierIndex: number): InstancedMesh | null {
        const tier = GRASS.detailTiers[tierIndex];
        const bladeGeometry = this.bladeGeometriesByTier[tierIndex];
        if (!tier || !bladeGeometry) return null;

        const [tileX, tileZ] = key.split(":").map(Number);
        const originX = tileX! * GRASS.tileSize;
        const originZ = tileZ! * GRASS.tileSize;
        const bladeCount = Math.round(
            GRASS.tileSize * GRASS.tileSize * tier.bladesPerSquareMetre
        );

        const nextRandom = createSeededRandom(hashString(`${this.seed}:${key}`));
        const transform = new Object3D();
        const matrices: number[] = [];
        const curls: number[] = [];
        const tints: number[] = [];

        for (let blade = 0; blade < bladeCount; blade += 1) {
            const localX = originX + nextRandom() * GRASS.tileSize;
            const localZ = originZ + nextRandom() * GRASS.tileSize;

            const sample = this.heightField.sampleAt(localX, localZ);
            if (sample.isCorridor && sample.flatWeight > GRASS.routeRejectWeight) continue;

            const lean = lerp(GRASS.leanRange[0], GRASS.leanRange[1], nextRandom());
            const leanAngle = nextRandom() * Math.PI * 2;
            const height =
                lerp(GRASS.bladeHeightRange[0], GRASS.bladeHeightRange[1], nextRandom()) *
                tier.scale;

            transform.position.set(
                this.center[0] + localX,
                sample.height - 0.02,
                this.center[2] + localZ
            );
            transform.rotation.set(
                Math.sin(leanAngle) * lean,
                nextRandom() * Math.PI * 2,
                Math.cos(leanAngle) * lean
            );
            transform.scale.set(GRASS.bladeWidth * tier.scale, height, 1);
            transform.updateMatrix();

            matrices.push(...transform.matrix.elements);
            curls.push(lerp(GRASS.curlRange[0], GRASS.curlRange[1], nextRandom()));
            tints.push(lerp(GRASS.tintRange[0], GRASS.tintRange[1], nextRandom()));
        }

        const instanceCount = curls.length;
        if (instanceCount === 0) return null;

        const geometry = bladeGeometry.clone();
        geometry.setAttribute("bladeCurl", new InstancedBufferAttribute(new Float32Array(curls), 1));
        geometry.setAttribute("bladeTint", new InstancedBufferAttribute(new Float32Array(tints), 1));

        const mesh = new InstancedMesh(geometry, this.material, instanceCount);
        mesh.instanceMatrix.array.set(matrices);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        return mesh;
    }
}

function buildBladeGeometry(segments: number): BufferGeometry {
    const geometry = new PlaneGeometry(1, 1, 1, segments);
    geometry.translate(0, 0.5, 0);

    const positions = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const upwardNormals = new Float32Array(positions.count * 3);

    for (let index = 0; index < positions.count; index += 1) {
        positions.setX(
            index,
            positions.getX(index) * Math.pow(1 - uv.getY(index), GRASS.bladeTaperExponent)
        );

        upwardNormals[index * 3] = 0;
        upwardNormals[index * 3 + 1] = 1;
        upwardNormals[index * 3 + 2] = 0;
    }

    positions.needsUpdate = true;
    geometry.setAttribute("normal", new BufferAttribute(upwardNormals, 3));

    return geometry;
}
