import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import {
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    Mesh,
    MeshLambertMaterial,
    RepeatWrapping,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import type { ITerrainProfile } from "@/types/theme";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { WALKABLE_REACH } from "@/world/terrain/TerrainHeightField";
import { GROUND, TERRAIN, TERRAIN_DETAIL } from "@/constants/world";
import { clamp, lerp, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";

export class TerrainMesh extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: BufferGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly rigidBody: RigidBody;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        heightMap: TerrainHeightMap,
        seed: number
    ) {
        super("terrain");
        this.context = context;

        const profile = context.environment.terrain;
        const island = buildIslandGeometry(heightMap);

        this.geometry = island.geometry;
        this.geometry.computeVertexNormals();

        paintVertexColors(
            this.geometry,
            heightMap,
            island.pointIndices,
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
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;

        this.rigidBody = context.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], 0, center[2])
        );

        context.physicsWorld.createCollider(
            RAPIER.ColliderDesc.trimesh(island.positions, island.indices),
            this.rigidBody
        );
    }

    update(): void {}

    dispose(): void {
        this.context.physicsWorld.removeRigidBody(this.rigidBody);
        this.geometry.dispose();
        this.material.map?.dispose();
        this.material.dispose();
    }
}

function buildIslandGeometry(heightMap: TerrainHeightMap): IIslandGeometry {
    const pointsPerSide = heightMap.pointsPerSide;
    const vertexIndexByPoint = new Int32Array(pointsPerSide * pointsPerSide).fill(-1);

    const positionValues: number[] = [];
    const pointIndexValues: number[] = [];

    for (let row = 0; row < pointsPerSide; row += 1) {
        const localZ = heightMap.originZ + row * heightMap.cellSize;

        for (let column = 0; column < pointsPerSide; column += 1) {
            const localX = heightMap.originX + column * heightMap.cellSize;
            const pointIndex = row * pointsPerSide + column;
            if (heightMap.footprintDistanceAtPoint(pointIndex) > WALKABLE_REACH) continue;

            vertexIndexByPoint[pointIndex] = pointIndexValues.length;
            pointIndexValues.push(pointIndex);
            positionValues.push(localX, heightMap.elevationAtPoint(pointIndex), localZ);
        }
    }

    const indexValues: number[] = [];

    for (let row = 0; row < pointsPerSide - 1; row += 1) {
        for (let column = 0; column < pointsPerSide - 1; column += 1) {
            const nearLeft = vertexIndexByPoint[row * pointsPerSide + column] ?? -1;
            const nearRight = vertexIndexByPoint[row * pointsPerSide + column + 1] ?? -1;
            const farLeft = vertexIndexByPoint[(row + 1) * pointsPerSide + column] ?? -1;
            const farRight = vertexIndexByPoint[(row + 1) * pointsPerSide + column + 1] ?? -1;

            if (nearLeft < 0 || nearRight < 0 || farLeft < 0 || farRight < 0) continue;

            indexValues.push(nearLeft, farLeft, nearRight, nearRight, farLeft, farRight);
        }
    }

    const positions = new Float32Array(positionValues);
    const indices = new Uint32Array(indexValues);
    const geometry = new BufferGeometry();

    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));

    return { geometry, positions, indices, pointIndices: new Int32Array(pointIndexValues) };
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
    geometry: BufferGeometry,
    heightMap: TerrainHeightMap,
    pointIndices: Int32Array,
    profile: ITerrainProfile,
    palette: IGroundPalette
): void {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const positionArray = positions.array as Float32Array;
    const normalArray = normals.array as Float32Array;
    const vertexCount = positions.count;
    const colors = new Float32Array(vertexCount * 3);
    const wildTop = TERRAIN.pathLevel + profile.wildElevation;
    const mountainSpan = Math.max(profile.mountainHeight, 1);

    const wildRed = palette.wild.r;
    const wildGreen = palette.wild.g;
    const wildBlue = palette.wild.b;
    const peakRed = palette.peak.r;
    const peakGreen = palette.peak.g;
    const peakBlue = palette.peak.b;
    const rockRed = palette.rock.r;
    const rockGreen = palette.rock.g;
    const rockBlue = palette.rock.b;

    for (let index = 0; index < vertexCount; index += 1) {
        const offset = index * 3;
        const pointIndex = pointIndices[index] ?? 0;
        const carveStrength = heightMap.carveStrengthAtPoint(pointIndex);

        const heightRatio = clamp(
            ((positionArray[offset + 1] ?? 0) - wildTop) / mountainSpan,
            0,
            1
        );
        const peakBlend = Math.pow(heightRatio, TERRAIN.peakColorSharpness);

        let red = wildRed + (peakRed - wildRed) * peakBlend;
        let green = wildGreen + (peakGreen - wildGreen) * peakBlend;
        let blue = wildBlue + (peakBlue - wildBlue) * peakBlend;

        const slope = 1 - Math.abs(normalArray[offset + 1] ?? 0);
        const rockBlend = smoothstep(
            TERRAIN_DETAIL.rockSlopeStart,
            TERRAIN_DETAIL.rockSlopeEnd,
            slope
        );

        red += (rockRed - red) * rockBlend;
        green += (rockGreen - green) * rockBlend;
        blue += (rockBlue - blue) * rockBlend;

        if (carveStrength > 0) {
            const flatColor = heightMap.isCorridorAtPoint(pointIndex)
                ? palette.route
                : palette.floorAtDepth(heightMap.floorColorIndexAtPoint(pointIndex));

            const carveBlend = Math.pow(carveStrength, TERRAIN.carveColorSharpness);
            red += (flatColor.r - red) * carveBlend;
            green += (flatColor.g - green) * carveBlend;
            blue += (flatColor.b - blue) * carveBlend;
        }

        const shade = 1 - slope * profile.slopeShade;

        colors[offset] = red * shade;
        colors[offset + 1] = green * shade;
        colors[offset + 2] = blue * shade;
    }

    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

function buildGrainTexture(seed: number, worldSize: number): CanvasTexture {
    const grainNoise = new FractalNoise(seed + 4);
    const blotchNoise = new FractalNoise(seed + 5);
    const size = TERRAIN_DETAIL.textureSize;
    const texelCount = size * size;

    const rawGrain = new Float32Array(texelCount);
    const rawBlotch = new Float32Array(texelCount);

    let smallestGrain = Infinity;
    let largestGrain = -Infinity;
    let smallestBlotch = Infinity;
    let largestBlotch = -Infinity;

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

            if (grain < smallestGrain) smallestGrain = grain;
            if (grain > largestGrain) largestGrain = grain;
            if (mudClump < smallestBlotch) smallestBlotch = mudClump;
            if (mudClump > largestBlotch) largestBlotch = mudClump;
        }
    }

    const grainNormalizer = buildRangeNormalizer(smallestGrain, largestGrain);
    const blotchNormalizer = buildRangeNormalizer(smallestBlotch, largestBlotch);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const drawing = canvas.getContext("2d");
    if (!drawing) return new CanvasTexture(canvas);

    const pixels = drawing.createImageData(size, size);
    const packedPixels = new Uint32Array(pixels.data.buffer);
    const [mudRed, mudGreen, mudBlue] = TERRAIN_DETAIL.mudMultiplier;
    const [dustRed, dustGreen, dustBlue] = TERRAIN_DETAIL.dustMultiplier;

    for (let texel = 0; texel < texelCount; texel += 1) {
        const dustAmount =
            ((rawBlotch[texel] ?? 0) - blotchNormalizer.offset) * blotchNormalizer.scale +
            blotchNormalizer.fallback;

        const grit = lerp(
            1 - TERRAIN_DETAIL.grainStrength,
            1 + TERRAIN_DETAIL.grainStrength,
            ((rawGrain[texel] ?? 0) - grainNormalizer.offset) * grainNormalizer.scale +
                grainNormalizer.fallback
        );

        const red = Math.round(255 * clamp(lerp(mudRed, dustRed, dustAmount) * grit, 0, 1));
        const green = Math.round(255 * clamp(lerp(mudGreen, dustGreen, dustAmount) * grit, 0, 1));
        const blue = Math.round(255 * clamp(lerp(mudBlue, dustBlue, dustAmount) * grit, 0, 1));

        packedPixels[texel] = 0xff000000 | (blue << 16) | (green << 8) | red;
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

function buildRangeNormalizer(smallest: number, largest: number): IRangeNormalizer {
    const span = largest - smallest;

    if (span > 1e-6) return { offset: smallest, scale: 1 / span, fallback: 0 };

    return { offset: 0, scale: 0, fallback: 0.5 };
}

interface IIslandGeometry {
    geometry: BufferGeometry;
    positions: Float32Array;
    indices: Uint32Array;
    pointIndices: Int32Array;
}

interface IGroundPalette {
    wild: Color;
    rock: Color;
    peak: Color;
    route: Color;
    floorAtDepth(nestingDepth: number): Color;
}

interface IRangeNormalizer {
    offset: number;
    scale: number;
    fallback: number;
}
