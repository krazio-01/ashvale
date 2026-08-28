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
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { GROUND, TERRAIN, TERRAIN_DETAIL } from "@/constants/world";
import { clamp, lerp, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";

interface IRunningRange {
    include(value: number): void;
    normalize(value: number): number;
}

interface IGroundPalette {
    wild: Color;
    rock: Color;
    peak: Color;
    route: Color;
    floorAtDepth(nestingDepth: number): Color;
}

export class TerrainMesh extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: PlaneGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly rigidBody: RigidBody;
    private readonly collider: Collider;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        heightMap: TerrainHeightMap,
        seed: number
    ) {
        super("terrain");
        this.context = context;

        const profile = context.environment.terrain;

        this.geometry = new PlaneGeometry(
            heightMap.span,
            heightMap.span,
            heightMap.cellsPerSide,
            heightMap.cellsPerSide
        );
        this.geometry.rotateX(-Math.PI / 2);

        const positions = this.geometry.getAttribute("position");
        const gridPoints = new Int32Array(positions.count);

        for (let index = 0; index < positions.count; index += 1) {
            const pointIndex = heightMap.nearestPointIndex(
                positions.getX(index),
                positions.getZ(index)
            );

            gridPoints[index] = pointIndex;
            positions.setY(index, heightMap.elevationAtPoint(pointIndex));
        }

        positions.needsUpdate = true;
        this.geometry.computeVertexNormals();
        paintVertexColors(
            this.geometry,
            heightMap,
            gridPoints,
            profile,
            deriveGroundPalette(profile)
        );

        this.material = new MeshLambertMaterial({
            vertexColors: true,
            map: buildGrainTexture(seed, heightMap.span),
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

    update(): void {}

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
    heightMap: TerrainHeightMap,
    gridPoints: Int32Array,
    profile: ITerrainProfile,
    palette: IGroundPalette
): void {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const vertexCount = positions.count;
    const colors = new Float32Array(vertexCount * 3);
    const blended = new Color();
    const wildTop = TERRAIN.pathLevel + profile.wildElevation;

    for (let index = 0; index < vertexCount; index += 1) {
        const pointIndex = gridPoints[index] ?? 0;
        const carveStrength = heightMap.carveStrengthAtPoint(pointIndex);

        const heightRatio = clamp(
            (positions.getY(index) - wildTop) / Math.max(profile.mountainHeight, 1),
            0,
            1
        );

        blended.copy(palette.wild).lerp(palette.peak, Math.pow(heightRatio, 0.7));

        const slope = 1 - Math.abs(normals.getY(index));

        blended.lerp(
            palette.rock,
            smoothstep(TERRAIN_DETAIL.rockSlopeStart, TERRAIN_DETAIL.rockSlopeEnd, slope)
        );

        if (carveStrength > 0) {
            const flatColor = heightMap.isCorridorAtPoint(pointIndex)
                ? palette.route
                : palette.floorAtDepth(heightMap.floorColorIndexAtPoint(pointIndex));

            blended.lerp(flatColor, Math.pow(carveStrength, TERRAIN.carveColorSharpness));
        }

        const shade = 1 - slope * profile.slopeShade;

        colors[index * 3] = blended.r * shade;
        colors[index * 3 + 1] = blended.g * shade;
        colors[index * 3 + 2] = blended.b * shade;
    }

    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

function createRunningRange(): IRunningRange {
    let minSeen = Infinity;
    let maxSeen = -Infinity;

    return {
        include(value: number): void {
            if (value < minSeen) minSeen = value;
            if (value > maxSeen) maxSeen = value;
        },
        normalize(value: number): number {
            const span = maxSeen - minSeen;
            return span > 1e-6 ? (value - minSeen) / span : 0.5;
        },
    };
}

function buildGrainTexture(seed: number, worldSize: number): CanvasTexture {
    const grainNoise = new FractalNoise(seed + 4);
    const blotchNoise = new FractalNoise(seed + 5);
    const size = TERRAIN_DETAIL.textureSize;
    const texelCount = size * size;

    const rawGrain = new Float32Array(texelCount);
    const rawBlotch = new Float32Array(texelCount);
    const grainRange = createRunningRange();
    const blotchRange = createRunningRange();

    for (let pixelZ = 0; pixelZ < size; pixelZ += 1) {
        for (let pixelX = 0; pixelX < size; pixelX += 1) {
            const texel = pixelZ * size + pixelX;
            const unitX = pixelX / size;
            const unitZ = pixelZ / size;

            const grain = grainNoise.sampleTileable(
                unitX,
                unitZ,
                TERRAIN_DETAIL.grainTileCount,
                3,
                0.55
            );
            const mudClump = blotchNoise.sampleTileable(
                unitX,
                unitZ,
                TERRAIN_DETAIL.blotchTileCount,
                3,
                0.55
            );

            rawGrain[texel] = grain;
            rawBlotch[texel] = mudClump;
            grainRange.include(grain);
            blotchRange.include(mudClump);
        }
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const drawing = canvas.getContext("2d");
    if (!drawing) return new CanvasTexture(canvas);

    const pixels = drawing.createImageData(size, size);
    const [mudRed, mudGreen, mudBlue] = TERRAIN_DETAIL.mudMultiplier;
    const [dustRed, dustGreen, dustBlue] = TERRAIN_DETAIL.dustMultiplier;

    for (let texel = 0; texel < texelCount; texel += 1) {
        const dustAmount = blotchRange.normalize(rawBlotch[texel] ?? 0);
        const grit = lerp(
            1 - TERRAIN_DETAIL.grainStrength,
            1 + TERRAIN_DETAIL.grainStrength,
            grainRange.normalize(rawGrain[texel] ?? 0)
        );

        const offset = texel * 4;
        pixels.data[offset] = Math.round(
            255 * clamp(lerp(mudRed, dustRed, dustAmount) * grit, 0, 1)
        );
        pixels.data[offset + 1] = Math.round(
            255 * clamp(lerp(mudGreen, dustGreen, dustAmount) * grit, 0, 1)
        );
        pixels.data[offset + 2] = Math.round(
            255 * clamp(lerp(mudBlue, dustBlue, dustAmount) * grit, 0, 1)
        );
        pixels.data[offset + 3] = 255;
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
