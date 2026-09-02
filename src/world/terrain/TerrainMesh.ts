import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import {
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    Mesh,
    MeshLambertMaterial,
    type IUniform,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import type { ITerrainProfile } from "@/types/theme";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { WALKABLE_REACH } from "@/world/terrain/TerrainHeightField";
import { GROUND, TERRAIN, TERRAIN_DETAIL } from "@/constants/world";
import { clamp, smoothstep } from "@/lib/helpers";
import {
    GROUND_MATERIAL_GLSL,
    groundMaterialUniforms,
    trailWearAt,
    type IGroundMaterials,
} from "@/world/terrain/GroundMaterials";

export class TerrainMesh extends Entity implements IWorldEntity {
    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: BufferGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly groundSplat: CanvasTexture;
    private readonly groundDetail: CanvasTexture;
    private readonly rigidBody: RigidBody;

    constructor(
        context: IWorldContext,
        center: Vector3Tuple,
        heightMap: TerrainHeightMap,
        groundSplat: CanvasTexture,
        groundDetail: CanvasTexture,
        materials: IGroundMaterials
    ) {
        super("terrain");
        this.context = context;
        this.groundSplat = groundSplat;
        this.groundDetail = groundDetail;

        const profile = context.environment.terrain;
        const island = buildIslandGeometry(heightMap);

        this.geometry = island.geometry;
        this.geometry.computeVertexNormals();

        paintGroundOverrides(this.geometry, heightMap, island.pointIndices, profile);

        this.material = new MeshLambertMaterial({ vertexColors: true });

        applyGroundMaterialBlend(this.material, groundSplat, groundDetail, materials);

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
        this.material.dispose();
        this.groundSplat.dispose();
        this.groundDetail.dispose();
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

            const elevation = heightMap.elevationAtPoint(pointIndex);
            if (!Number.isFinite(elevation)) continue;

            vertexIndexByPoint[pointIndex] = pointIndexValues.length;
            pointIndexValues.push(pointIndex);
            positionValues.push(localX, elevation, localZ);
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

function paintGroundOverrides(
    geometry: BufferGeometry,
    heightMap: TerrainHeightMap,
    pointIndices: Int32Array,
    profile: ITerrainProfile
): void {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const positionArray = positions.array as Float32Array;
    const normalArray = normals.array as Float32Array;
    const vertexCount = positions.count;
    const colors = new Float32Array(vertexCount * 3);
    const groundBlends = new Float32Array(vertexCount * 3);
    const wildTop = TERRAIN.pathLevel + profile.wildElevation;
    const mountainSpan = Math.max(profile.mountainHeight, 1);
    const rock = new Color(profile.rockColor);
    const peak = new Color(profile.peakColor);
    const override: IOverrideTint = { red: 0, green: 0, blue: 0, strength: 0 };

    for (let index = 0; index < vertexCount; index += 1) {
        const offset = index * 3;
        const pointIndex = pointIndices[index] ?? 0;

        const heightRatio = clamp(
            ((positionArray[offset + 1] ?? 0) - wildTop) / mountainSpan,
            0,
            1
        );
        const slope = 1 - Math.abs(normalArray[offset + 1] ?? 0);

        override.strength = 0;
        composeOverride(override, peak, Math.pow(heightRatio, TERRAIN.peakColorSharpness));
        composeOverride(
            override,
            rock,
            smoothstep(TERRAIN_DETAIL.rockSlopeStart, TERRAIN_DETAIL.rockSlopeEnd, slope)
        );

        colors[offset] = override.red;
        colors[offset + 1] = override.green;
        colors[offset + 2] = override.blue;

        groundBlends[offset] = trailWearAt(heightMap.trailDistanceAtPoint(pointIndex));
        groundBlends[offset + 1] = override.strength;
        groundBlends[offset + 2] =
            (1 - slope * profile.slopeShade) * nestingShadeAt(heightMap, pointIndex);
    }

    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("groundBlend", new BufferAttribute(groundBlends, 3));
}

function nestingShadeAt(heightMap: TerrainHeightMap, pointIndex: number): number {
    if (heightMap.isCorridorAtPoint(pointIndex)) return 1;

    const carveStrength = heightMap.carveStrengthAtPoint(pointIndex);
    if (carveStrength <= 0) return 1;

    const depthShade = Math.max(
        1 - heightMap.nestingDepthAtPoint(pointIndex) * GROUND.depthShadeStep,
        GROUND.minimumDepthShade
    );

    return 1 - (1 - depthShade) * carveStrength;
}

function composeOverride(override: IOverrideTint, color: Color, ratio: number): void {
    if (ratio <= 0) return;

    if (override.strength <= 0) {
        override.red = color.r;
        override.green = color.g;
        override.blue = color.b;
        override.strength = ratio;

        return;
    }

    override.red += (color.r - override.red) * ratio;
    override.green += (color.g - override.green) * ratio;
    override.blue += (color.b - override.blue) * ratio;
    override.strength += (1 - override.strength) * ratio;
}

function applyGroundMaterialBlend(
    material: MeshLambertMaterial,
    groundSplat: CanvasTexture,
    groundDetail: CanvasTexture,
    materials: IGroundMaterials
): void {
    const blendUniforms: Record<string, IUniform> = groundMaterialUniforms(
        groundSplat,
        groundDetail,
        materials
    );

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, blendUniforms);

        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                `#include <common>
                attribute vec3 groundBlend;
                varying vec3 vGroundBlend;
                varying vec2 vGroundPosition;`
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                vGroundBlend = groundBlend;
                vGroundPosition = position.xz;`
            );

        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                `#include <common>
                varying vec3 vGroundBlend;
                varying vec2 vGroundPosition;
                ${GROUND_MATERIAL_GLSL}`
            )
            .replace(
                "#include <color_fragment>",
                `vec4 materialShare = groundMaterialShareAt(vGroundPosition, vGroundBlend.x);
                vec3 groundColor = groundColorOf(materialShare, vGroundPosition);
                diffuseColor.rgb *=
                    mix(groundColor, vColor.rgb, vGroundBlend.y) * vGroundBlend.z;`
            );
    };
}

interface IIslandGeometry {
    geometry: BufferGeometry;
    positions: Float32Array;
    indices: Uint32Array;
    pointIndices: Int32Array;
}

interface IOverrideTint {
    red: number;
    green: number;
    blue: number;
    strength: number;
}
