import RAPIER from "@dimforge/rapier3d-compat";
import { createFixedBody } from "@/systems/physics/RapierWorld";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import {
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    Color,
    type DataTexture,
    Mesh,
    MeshLambertMaterial,
    type IUniform,
    type Vector3Tuple,
} from "three";
import type { ITerrainProfile, IWorldContext, IWorldEntity, IGroundSurface } from "@/types/world";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { GROUND_DEPTH_SHADE, TERRAIN, TERRAIN_DETAIL, WATER_CHANNEL } from "@/constants/world";
import { clamp, smoothstep, freezeTransform, gridQuadIndices } from "@/lib/helpers";
import {
    GROUND_MATERIAL_GLSL,
    groundMaterialUniforms,
    type IGroundMaterials,
} from "@/world/terrain/TerrainMaterials";

interface IIslandGeometry {
    geometry: BufferGeometry;
    positions: Float32Array;
    indices: Uint32Array;
    pointIndices: Int32Array;
}

interface ITintOverride {
    red: number;
    green: number;
    blue: number;
    strength: number;
}

export class TerrainSurface implements IWorldEntity {
    private static readonly shoreWetnessAt = (waterDepth: number): number =>
        1 - smoothstep(0, WATER_CHANNEL.shoreWetBand, -waterDepth);

    private static nestingShadeAt(sampleGrid: TerrainSampleGrid, pointIndex: number): number {
        if (sampleGrid.valueAtPoint("corridorFlag", pointIndex) === 1) return 1;

        const carveStrength = sampleGrid.valueAtPoint("carveStrength", pointIndex);
        if (carveStrength <= 0) return 1;

        const depthShade = Math.max(
            1 -
                sampleGrid.valueAtPoint("nestingDepth", pointIndex) *
                    GROUND_DEPTH_SHADE.depthShadeStep,
            GROUND_DEPTH_SHADE.minimumDepthShade
        );

        return 1 - (1 - depthShade) * carveStrength;
    }

    private static composeOverride(override: ITintOverride, color: Color, ratio: number): void {
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

    private static buildIslandGeometry(sampleGrid: TerrainSampleGrid): IIslandGeometry {
        const pointsPerSide = sampleGrid.pointsPerSide;
        const vertexIndexByPoint = new Int32Array(pointsPerSide * pointsPerSide).fill(-1);

        const positionValues: number[] = [];
        const pointIndexValues: number[] = [];

        for (let row = 0; row < pointsPerSide; row += 1) {
            const localZ = sampleGrid.originZ + row * sampleGrid.cellSize;

            for (let column = 0; column < pointsPerSide; column += 1) {
                const localX = sampleGrid.originX + column * sampleGrid.cellSize;
                const pointIndex = row * pointsPerSide + column;
                if (!sampleGrid.hasGroundAtPoint(pointIndex)) continue;

                vertexIndexByPoint[pointIndex] = pointIndexValues.length;
                pointIndexValues.push(pointIndex);
                positionValues.push(
                    localX,
                    sampleGrid.valueAtPoint("elevation", pointIndex),
                    localZ
                );
            }
        }

        const indices = gridQuadIndices(
            pointsPerSide - 1,
            pointsPerSide - 1,
            (row, column) => vertexIndexByPoint[row * pointsPerSide + column],
            (nearLeft, nearRight, farLeft, farRight) =>
                !(nearLeft < 0 || nearRight < 0 || farLeft < 0 || farRight < 0)
        );
        const positions = new Float32Array(positionValues);
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setIndex(new BufferAttribute(indices, 1));

        return { geometry, positions, indices, pointIndices: new Int32Array(pointIndexValues) };
    }

    private static paintGroundOverrides(
        geometry: BufferGeometry,
        sampleGrid: TerrainSampleGrid,
        pointIndices: Int32Array,
        profile: ITerrainProfile
    ): void {
        const positions = geometry.getAttribute("position");
        const normals = geometry.getAttribute("normal");
        const positionArray = positions.array as Float32Array;
        const normalArray = normals.array as Float32Array;
        const vertexCount = positions.count;
        const colors = new Float32Array(vertexCount * 3);
        const groundBlends = new Float32Array(vertexCount * 4);
        const wildTop = TERRAIN.pathLevel + profile.grasslandHeight;
        const mountainSpan = Math.max(profile.mountainHeight, 1);
        const rock = new Color(profile.rockColor);
        const peak = new Color(profile.peakColor);
        const override: ITintOverride = { red: 0, green: 0, blue: 0, strength: 0 };

        for (let index = 0; index < vertexCount; index += 1) {
            const offset = index * 3;
            const blendOffset = index * 4;
            const pointIndex = pointIndices[index];

            const heightRatio = clamp((positionArray[offset + 1] - wildTop) / mountainSpan, 0, 1);
            const slope = 1 - Math.abs(normalArray[offset + 1]);

            override.strength = 0;
            TerrainSurface.composeOverride(
                override,
                peak,
                Math.pow(heightRatio, TERRAIN.peakColorSharpness)
            );
            TerrainSurface.composeOverride(
                override,
                rock,
                smoothstep(TERRAIN_DETAIL.rockSlopeStart, TERRAIN_DETAIL.rockSlopeEnd, slope)
            );

            colors[offset] = override.red;
            colors[offset + 1] = override.green;
            colors[offset + 2] = override.blue;
            groundBlends[blendOffset] = sampleGrid.valueAtPoint("trailDistance", pointIndex);
            groundBlends[blendOffset + 1] = override.strength;
            groundBlends[blendOffset + 2] =
                (1 - slope * profile.slopeShade) *
                TerrainSurface.nestingShadeAt(sampleGrid, pointIndex);
            groundBlends[blendOffset + 3] = TerrainSurface.shoreWetnessAt(
                sampleGrid.valueAtPoint("waterDepth", pointIndex)
            );
        }

        geometry.setAttribute("color", new BufferAttribute(colors, 3));
        geometry.setAttribute("groundBlend", new BufferAttribute(groundBlends, 4));
    }

    private static applyGroundMaterialBlend(
        material: MeshLambertMaterial,
        groundSplat: CanvasTexture,
        groundDetail: CanvasTexture,
        materials: IGroundMaterials
    ): void {
        const blendUniforms: Record<string, IUniform> = {
            ...groundMaterialUniforms(groundSplat, groundDetail, materials),
            shoreWetShade: { value: WATER_CHANNEL.shoreWetShade },
        };

        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, blendUniforms);

            shader.vertexShader = shader.vertexShader
                .replace(
                    "#include <common>",
                    `#include <common>
                attribute vec4 groundBlend;
                varying vec4 vGroundBlend;
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
                uniform float shoreWetShade;
                varying vec4 vGroundBlend;
                varying vec2 vGroundPosition;
                ${GROUND_MATERIAL_GLSL}`
                )
                .replace(
                    "#include <color_fragment>",
                    `vec4 materialShare = groundMaterialShareAt(vGroundPosition, trailWearAt(vGroundBlend.x));
                vec3 wetRiverbedColor = mix(gritColor, mudColor, 0.25) * shoreWetShade;
                vec3 groundColor = mix(
                    groundColorOf(materialShare, vGroundPosition),
                    wetRiverbedColor,
                    vGroundBlend.w
                );
                diffuseColor.rgb *=
                    mix(groundColor, vColor.rgb, vGroundBlend.y) * vGroundBlend.z;`
                );
        };
    }

    readonly sceneObject: Mesh;

    private readonly context: IWorldContext;
    private readonly geometry: BufferGeometry;
    private readonly material: MeshLambertMaterial;
    private readonly groundSplat: CanvasTexture;
    private readonly groundDetail: CanvasTexture;
    private readonly terrainFieldTexture: DataTexture;
    private readonly rigidBody: RigidBody;

    constructor(context: IWorldContext, center: Vector3Tuple, surface: IGroundSurface) {
        const {
            sampleGrid,
            fieldTexture: terrainFieldTexture,
            groundSplat,
            groundDetail,
            materials,
        } = surface;
        this.context = context;
        this.terrainFieldTexture = terrainFieldTexture;
        this.groundSplat = groundSplat;
        this.groundDetail = groundDetail;

        const profile = context.environment.terrain;
        const island = TerrainSurface.buildIslandGeometry(sampleGrid);

        this.geometry = island.geometry;
        this.geometry.computeVertexNormals();

        TerrainSurface.paintGroundOverrides(
            this.geometry,
            sampleGrid,
            island.pointIndices,
            profile
        );

        this.material = new MeshLambertMaterial({ vertexColors: true });
        this.material.customProgramCacheKey = () => "terrain-surface-ground-material";

        TerrainSurface.applyGroundMaterialBlend(
            this.material,
            groundSplat,
            groundDetail,
            materials
        );

        this.sceneObject = new Mesh(this.geometry, this.material);
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.receiveShadow = true;
        freezeTransform(this.sceneObject);

        this.rigidBody = createFixedBody(context.physicsWorld, center);

        if (island.indices.length > 0)
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
        this.terrainFieldTexture.dispose();
    }
}
