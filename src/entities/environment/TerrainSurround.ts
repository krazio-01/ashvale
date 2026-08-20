import RAPIER from "@dimforge/rapier3d-compat";
import type { Collider, RigidBody } from "@dimforge/rapier3d-compat";
import {
    BufferAttribute,
    CanvasTexture,
    Color,
    Mesh,
    MeshLambertMaterial,
    PlaneGeometry,
    RepeatWrapping,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import type { ITerrainProfile } from "@/types/theme";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { ITerrainSample, TerrainHeightField } from "@/world/TerrainHeightField";
import { GROUND, TERRAIN, TERRAIN_DETAIL } from "@/constants/game";
import { clamp } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";

interface IGroundPalette {
    wild: Color;
    rock: Color;
    peak: Color;
    route: Color;
    floorAtDepth(nestingDepth: number): Color;
}

export class TerrainSurround extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: PlaneGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        playRadius: number,
        heightField: TerrainHeightField,
        seed: number
    ) {
        super("terrain");
        this.context = context;

        const profile = context.environment.terrain;
        const outerRadius = playRadius + TERRAIN.transition + TERRAIN.spread;
        const size = outerRadius * 2;
        const resolution = clamp(
            Math.round(size / TERRAIN.targetCellSize),
            TERRAIN.minimumResolution,
            TERRAIN.maximumResolution
        );

        this.geometry = new PlaneGeometry(size, size, resolution, resolution);
        this.geometry.rotateX(-Math.PI / 2);

        const positions = this.geometry.getAttribute("position");
        const samples: ITerrainSample[] = [];

        for (let index = 0; index < positions.count; index += 1) {
            const sample = heightField.sampleAt(positions.getX(index), positions.getZ(index));
            positions.setY(index, sample.height);
            samples.push(sample);
        }

        positions.needsUpdate = true;
        this.geometry.computeVertexNormals();
        paintVertexColors(this.geometry, samples, profile, deriveGroundPalette(profile), seed);

        this.material = new MeshLambertMaterial({
            vertexColors: true,
            map: buildGrainTexture(seed, size),
        });

        this.sceneObject = new Mesh(this.geometry, this.material);
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.receiveShadow = true;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], 0, center[2])
        );

        const indices = this.geometry.getIndex();

        this.collider = context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.trimesh(
                new Float32Array(positions.array),
                new Uint32Array(indices ? indices.array : [])
            ),
            this.rigidBody
        );
    }

    update(): void { }

    dispose(): void {
        this.context.physicsWorld.removeCollider(this.collider, false);
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.geometry.dispose();
        this.material.map?.dispose();
        this.material.dispose();
    }
}

function deriveGroundPalette(profile: ITerrainProfile): IGroundPalette {
    const wild = new Color(profile.wildColor);
    const wildHsl = { h: 0, s: 0, l: 0 };
    wild.getHSL(wildHsl);

    const clearedHue = (((wildHsl.h + GROUND.clearedHueShift) % 1) + 1) % 1;
    const clearedSaturation = clamp(wildHsl.s * GROUND.clearedSaturationScale, 0, 1);
    const clearedLightness = clamp(wildHsl.l + GROUND.clearedLightnessGain, 0, 1);
    const floorsByDepth = new Map<number, Color>();

    return {
        wild,
        rock: new Color(profile.rockColor),
        peak: new Color(profile.peakColor),
        route: new Color().setHSL(
            clearedHue,
            clamp(clearedSaturation * GROUND.routeSaturationScale, 0, 1),
            clamp(clearedLightness + GROUND.routeLightnessGain, 0, 1)
        ),
        floorAtDepth(nestingDepth: number): Color {
            const cached = floorsByDepth.get(nestingDepth);
            if (cached) return cached;

            const derived = new Color().setHSL(
                clearedHue,
                clearedSaturation,
                clamp(
                    clearedLightness - nestingDepth * GROUND.depthLightnessStep,
                    GROUND.minimumFloorLightness,
                    1
                )
            );

            floorsByDepth.set(nestingDepth, derived);

            return derived;
        },
    };
}

function paintVertexColors(
    geometry: PlaneGeometry,
    samples: ITerrainSample[],
    profile: ITerrainProfile,
    palette: IGroundPalette,
    seed: number
): void {
    const patchNoise = new FractalNoise(seed + 2);
    const broadNoise = new FractalNoise(seed + 3);
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const colors = new Float32Array(positions.count * 3);
    const blended = new Color();

    const wildTop = TERRAIN.pathLevel + profile.wildElevation;

    for (let index = 0; index < positions.count; index += 1) {
        const sample = samples[index];
        if (!sample) continue;

        const x = positions.getX(index);
        const z = positions.getZ(index);

        const heightRatio = clamp(
            (positions.getY(index) - wildTop) / Math.max(profile.mountainHeight, 1),
            0,
            1
        );

        blended.copy(palette.wild).lerp(palette.peak, Math.pow(heightRatio, 0.7));

        const slope = 1 - Math.abs(normals.getY(index));
        const rockRatio = clamp(
            (slope - TERRAIN_DETAIL.rockSlopeStart) /
            (TERRAIN_DETAIL.rockSlopeEnd - TERRAIN_DETAIL.rockSlopeStart),
            0,
            1
        );

        blended.lerp(palette.rock, rockRatio * rockRatio * (3 - 2 * rockRatio));

        if (sample.flatWeight > 0) {
            const flatColor = sample.isCorridor
                ? palette.route
                : palette.floorAtDepth(sample.floorColorIndex);

            blended.lerp(flatColor, Math.pow(sample.flatWeight, TERRAIN.flatColorSharpness));
        }

        const broad =
            1 +
            (broadNoise.sample(
                x * TERRAIN_DETAIL.broadVariationScale,
                z * TERRAIN_DETAIL.broadVariationScale,
                2,
                0.5
            ) -
                0.5) *
            TERRAIN_DETAIL.broadVariationStrength *
            2;

        const patch =
            1 +
            (patchNoise.sample(x * 0.08, z * 0.08, 2, 0.5) - 0.5) * TERRAIN.colorNoiseStrength * 2;

        const shade = 1 - slope * profile.slopeShade;

        colors[index * 3] = blended.r * shade * broad * patch;
        colors[index * 3 + 1] = blended.g * shade * broad * patch;
        colors[index * 3 + 2] = blended.b * shade * broad * patch;
    }

    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

function buildGrainTexture(seed: number, worldSize: number): CanvasTexture {
    const grainNoise = new FractalNoise(seed + 4);
    const size = TERRAIN_DETAIL.textureSize;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const drawing = canvas.getContext("2d");
    if (!drawing) return new CanvasTexture(canvas);

    const pixels = drawing.createImageData(size, size);

    for (let pixelZ = 0; pixelZ < size; pixelZ += 1) {
        for (let pixelX = 0; pixelX < size; pixelX += 1) {
            const grain = grainNoise.sample((pixelX / size) * 9, (pixelZ / size) * 9, 3, 0.55);
            const brightness = Math.round(
                255 * (1 - TERRAIN_DETAIL.grainStrength / 2 + grain * TERRAIN_DETAIL.grainStrength)
            );

            const offset = (pixelZ * size + pixelX) * 4;
            pixels.data[offset] = brightness;
            pixels.data[offset + 1] = brightness;
            pixels.data[offset + 2] = brightness;
            pixels.data[offset + 3] = 255;
        }
    }

    drawing.putImageData(pixels, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(
        worldSize / TERRAIN_DETAIL.worldRepeat,
        worldSize / TERRAIN_DETAIL.worldRepeat
    );

    return texture;
}
