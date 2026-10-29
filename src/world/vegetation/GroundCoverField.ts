import {
    Vector2,
    DataTexture,
    BufferAttribute,
    Camera,
    CanvasTexture,
    Color,
    DoubleSide,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    ShaderMaterial,
    Sphere,
    Vector3,
} from "three";
import type { IUniform, Vector3Tuple } from "three";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { WORLD_EDGE } from "@/constants/world";
import { GROUND_COVER, GRASS, BLOOM } from "@/constants/placement";
import { Entity } from "@/entities/Entity";
import { sunDirectionOf } from "@/themes/Themes";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import { FULL_TURN, shiftColorHsl } from "@/lib/helpers";
import { GROUND_MATERIAL_GLSL, groundMaterialUniforms } from "@/world/terrain/TerrainMaterials";
import type { IGroundMaterials } from "@/world/terrain/TerrainMaterials";

export const GROUND_COVER_GLSL = `
    uniform sampler2D terrainField;
    uniform vec2 fieldOrigin;
    uniform float fieldCellSize;
    uniform float fieldPointsPerSide;
    uniform vec2 steepGroundBand;
    uniform vec2 growthStopBand;
    uniform vec2 coverTrailBand;

    vec3 randomTriple(vec3 seed) {
        vec3 scattered = fract(seed * vec3(0.1031, 0.1030, 0.0973));
        scattered += dot(scattered, scattered.yxz + 33.33);

        return fract((scattered.xxy + scattered.yxx) * scattered.zyx);
    }

    float randomScalar(vec2 seed, float salt) {
        return fract(sin(dot(seed, vec2(127.1, 311.7)) + salt) * 43758.5453);
    }

    vec2 fieldPointCoordAt(vec2 ground) {
        return (ground - fieldOrigin) / fieldCellSize;
    }

    vec4 sampleTerrainField(vec2 pointCoord) {
        return texture2D(terrainField, (pointCoord + 0.5) / fieldPointsPerSide);
    }

    float insideTerrainField(vec2 pointCoord) {
        float lastPoint = fieldPointsPerSide - 1.0;

        return step(0.0, pointCoord.x) * step(pointCoord.x, lastPoint)
            * step(0.0, pointCoord.y) * step(pointCoord.y, lastPoint);
    }

    float withinGrowableGround(float steepness, float growthStopDistance) {
        float offSteepGround = 1.0 - smoothstep(steepGroundBand.x, steepGroundBand.y, steepness);
        float shortOfStop = 1.0 - smoothstep(growthStopBand.x, growthStopBand.y, growthStopDistance);

        return offSteepGround * shortOfStop;
    }

    vec2 groundCoverAt(vec2 ground, vec4 field) {
        vec2 growth = groundGrowthOf(groundMaterialShareAt(ground, 0.0));
        float offTrail = smoothstep(coverTrailBand.x, coverTrailBand.y, field.g);

        return vec2(
            growth.x * offTrail * withinGrowableGround(field.b, field.a),
            growth.y * offTrail
        );
    }

    float smoothNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 within = fract(point);
        vec2 blend = within * within * (3.0 - 2.0 * within);

        return mix(
            mix(randomScalar(cell, 0.0), randomScalar(cell + vec2(1.0, 0.0), 0.0), blend.x),
            mix(
                randomScalar(cell + vec2(0.0, 1.0), 0.0),
                randomScalar(cell + vec2(1.0, 1.0), 0.0),
                blend.x
            ),
            blend.y
        );
    }
`;

export const PATCH_FIELD_GLSL = `
    uniform float patchSpacing;
    uniform vec2 patchRadiusRange;
    uniform float patchChance;
    uniform float patchCoreRatio;
    uniform float patchEdgeWavelength;
    uniform float patchEdgeStrength;

    vec2 patchDensityAt(vec2 ground) {
        vec2 baseCell = floor(ground / patchSpacing);

        float rim = smoothNoise(ground / patchEdgeWavelength);
        float rimScale = mix(1.0 - patchEdgeStrength, 1.0 + patchEdgeStrength, rim);

        float strongest = 0.0;
        float speciesPick = 0.0;

        for (int offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            for (int offsetX = -1; offsetX <= 1; offsetX += 1) {
                vec2 cell = baseCell + vec2(float(offsetX), float(offsetZ));
                float occupancy = randomScalar(cell, 19.0);
                if (occupancy > patchChance) continue;

                vec3 placement = randomTriple(vec3(cell, 29.0));
                vec2 centre = (cell + placement.xy) * patchSpacing;
                float radius = max(
                    mix(patchRadiusRange.x, patchRadiusRange.y, placement.z) * rimScale,
                    0.001
                );
                float reach = length(ground - centre) / radius;
                float density = 1.0 - smoothstep(patchCoreRatio, 1.0, reach);

                if (density <= strongest) continue;

                strongest = density;
                speciesPick = occupancy / patchChance;
            }
        }

        return vec2(strongest, speciesPick);
    }
`;

interface IPatchFieldSettings {
    spacing: number;
    radiusRange: [number, number];
    chance: number;
    coreRatio: number;
    edgeWavelength: number;
    edgeStrength: number;
}

export interface IDetailBand {
    innerRadius: number;
    outerRadius: number;
    subdivisions: number;
}

interface IBladeCluster {
    positions: Float32Array;
    bladeYaws: Float32Array;
    bladeSeeds: Float32Array;
    indices: Uint16Array | Uint32Array;
}

interface grassFieldIFrameUniforms {
    cameraGround: IUniform<Vector2>;
    windWavePhase: IUniform<number>;
    windFlutterPhase: IUniform<number>;
    fadeStartDistance: IUniform<number>;
    fadeEndDistance: IUniform<number>;
}

interface IBloomCluster {
    positions: Float32Array;
    normals: Float32Array;
    partKinds: Float32Array;
    swayWeights: Float32Array;
    indices: Uint16Array;
}

interface bloomFieldIFrameUniforms {
    cameraGround: IUniform<Vector2>;
    windWavePhase: IUniform<number>;
    fadeStartDistance: IUniform<number>;
    fadeEndDistance: IUniform<number>;
}

export class GrassField extends Entity implements IWorldEntity {
    private static buildBladeCluster(bladeSegments: number): IBladeCluster {
        const verticesPerBlade = bladeSegments * 2 + 1;
        const totalVertices = GRASS.bladesPerTuft * verticesPerBlade;

        const positions = new Float32Array(totalVertices * 3);
        const bladeYaws = new Float32Array(totalVertices);
        const bladeSeeds = new Float32Array(totalVertices);

        const trianglesPerBlade = (bladeSegments - 1) * 2 + 1;
        const indicesPerBlade = trianglesPerBlade * 3;
        const totalIndices = GRASS.bladesPerTuft * indicesPerBlade;

        const indices =
            totalVertices > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

        let vertexIndex = 0;
        let indexIndex = 0;

        for (let bladeNumber = 0; bladeNumber < GRASS.bladesPerTuft; bladeNumber += 1) {
            const firstVertex = bladeNumber * verticesPerBlade;
            const restingYaw = (bladeNumber / GRASS.bladesPerTuft) * FULL_TURN;

            for (let row = 0; row < bladeSegments; row += 1) {
                const heightRatio = row / bladeSegments;
                const halfWidth = 0.5 * Math.pow(1 - heightRatio, GRASS.bladeTaperExponent);

                positions[vertexIndex * 3] = -halfWidth;
                positions[vertexIndex * 3 + 1] = heightRatio;
                positions[vertexIndex * 3 + 2] = 0;
                bladeYaws[vertexIndex] = restingYaw;
                bladeSeeds[vertexIndex] = bladeNumber;
                vertexIndex += 1;

                positions[vertexIndex * 3] = halfWidth;
                positions[vertexIndex * 3 + 1] = heightRatio;
                positions[vertexIndex * 3 + 2] = 0;
                bladeYaws[vertexIndex] = restingYaw;
                bladeSeeds[vertexIndex] = bladeNumber;
                vertexIndex += 1;
            }

            positions[vertexIndex * 3] = 0;
            positions[vertexIndex * 3 + 1] = 1;
            positions[vertexIndex * 3 + 2] = 0;
            bladeYaws[vertexIndex] = restingYaw;
            bladeSeeds[vertexIndex] = bladeNumber;
            vertexIndex += 1;

            for (let row = 0; row < bladeSegments - 1; row += 1) {
                const leftEdge = firstVertex + row * 2;

                indices[indexIndex] = leftEdge;
                indices[indexIndex + 1] = leftEdge + 1;
                indices[indexIndex + 2] = leftEdge + 3;
                indices[indexIndex + 3] = leftEdge;
                indices[indexIndex + 4] = leftEdge + 3;
                indices[indexIndex + 5] = leftEdge + 2;
                indexIndex += 6;
            }

            const topLeftEdge = firstVertex + (bladeSegments - 1) * 2;
            indices[indexIndex] = topLeftEdge;
            indices[indexIndex + 1] = topLeftEdge + 1;
            indices[indexIndex + 2] = firstVertex + verticesPerBlade - 1;
            indexIndex += 3;
        }

        return { positions, bladeYaws, bladeSeeds, indices };
    }

    private static readonly grassFieldVERTEX_SHADER = `
    ${GROUND_MATERIAL_GLSL}
    ${GROUND_COVER_GLSL}

    uniform vec2 cameraGround;
    uniform float windWavePhase;
    uniform float windFlutterPhase;
    uniform float fadeStartDistance;
    uniform float fadeEndDistance;

    uniform float tuftSpacing;
    uniform float tuftSpread;
    uniform vec2 bladeHeightRange;
    uniform float bladeWidth;
    uniform float bladeCurvature;
    uniform float bladeYawJitter;
    uniform vec2 leanRange;
    uniform float crushedHeightRatio;
    uniform float crushedExtraLean;

    uniform vec2 windDirection;
    uniform float windHeading;
    uniform float windBendSpread;
    uniform float windWaveLength;
    uniform float windSway;
    uniform float windFlutter;

    uniform float tuftToneWeight;
    uniform vec2 tintRange;

    attribute float bladeYaw;
    attribute float bladeSeed;
    attribute vec2 cellOffset;

    varying vec3 vNormal;
    varying float vHeightRatio;
    varying float vTint;
    varying float vPatchTone;

    const float TAU = 6.2831853;

    vec2 bendAlongArc(float heightRatio, float bendAngle, float bladeLength) {
        if (abs(bendAngle) < 0.001) return vec2(0.0, heightRatio * bladeLength);

        float arcRadius = bladeLength / bendAngle;
        float sweptAngle = bendAngle * heightRatio;

        return vec2(arcRadius * (1.0 - cos(sweptAngle)), arcRadius * sin(sweptAngle));
    }

    void main() {
        vec2 tuftCell = floor(cameraGround / tuftSpacing) + cellOffset;
        vec3 tuftRandom = randomTriple(vec3(tuftCell, 1.0));
        vec3 toneRandom = randomTriple(vec3(tuftCell, 2.0));
        vec3 bladeShape = randomTriple(vec3(tuftCell, 5.0 + bladeSeed));
        vec3 bladeMotion = randomTriple(vec3(tuftCell, 17.0 + bladeSeed));

        vec2 tuftGround = (tuftCell + tuftRandom.xy) * tuftSpacing;
        vec2 fieldPointCoord = fieldPointCoordAt(tuftGround);
        vec4 field = sampleTerrainField(fieldPointCoord);
        vec2 cover = groundCoverAt(tuftGround, field);

        float grassiness = cover.x;
        float rootedHere = insideTerrainField(fieldPointCoord) * step(tuftRandom.z, grassiness);

        float horizonFade = 1.0 - smoothstep(
            fadeStartDistance,
            fadeEndDistance,
            length(tuftGround - cameraGround)
        );
        float bladeLength = mix(bladeHeightRange.x, bladeHeightRange.y, bladeShape.x)
            * rootedHere * horizonFade * mix(crushedHeightRatio, 1.0, grassiness);

        float yaw = bladeYaw + toneRandom.y * TAU + (bladeShape.y - 0.5) * bladeYawJitter;
        vec2 facingDirection = vec2(sin(yaw), cos(yaw));
        vec2 sideDirection = vec2(facingDirection.y, -facingDirection.x);
        vec2 rootGround = tuftGround + facingDirection * tuftSpread * bladeMotion.x;

        float windWave = sin(dot(rootGround, windDirection) / windWaveLength - windWavePhase)
            * 0.5 + 0.5;
        float flutter = sin(windFlutterPhase + bladeMotion.y * TAU) * windFlutter * windWave;
        float bendAngle = mix(leanRange.x, leanRange.y, bladeShape.z)
            + windWave * windSway
            + flutter
            + (1.0 - grassiness) * crushedExtraLean;

        float bendYaw = windHeading + (bladeMotion.z - 0.5) * windBendSpread;
        vec2 bendDirection = vec2(sin(bendYaw), cos(bendYaw));

        vHeightRatio = position.y;

        vec2 arc = bendAlongArc(vHeightRatio, bendAngle, bladeLength);

        float activeWidth = bladeWidth * step(0.0001, bladeLength);
        vec3 bladeWorld = vec3(rootGround.x, field.r, rootGround.y)
            + vec3(sideDirection.x, 0.0, sideDirection.y) * position.x * activeWidth
            + vec3(bendDirection.x, 0.0, bendDirection.y) * arc.x
            + vec3(0.0, arc.y, 0.0);

        float sweptAngle = bendAngle * vHeightRatio;
        vec3 alongBlade = normalize(vec3(
            bendDirection.x * sin(sweptAngle),
            cos(sweptAngle),
            bendDirection.y * sin(sweptAngle)
        ));
        vec3 acrossBlade = vec3(sideDirection.x, 0.0, sideDirection.y);

        vNormal = normalize(
            cross(acrossBlade, alongBlade) + acrossBlade * position.x * 2.0 * bladeCurvature
        );

        vPatchTone = mix(cover.y, toneRandom.z, tuftToneWeight);
        vTint = mix(tintRange.x, tintRange.y, mix(vPatchTone, toneRandom.x, tuftToneWeight));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(bladeWorld, 1.0);
    }
`;

    private static readonly grassFieldFRAGMENT_SHADER = `
    uniform vec3 lushRootColor;
    uniform vec3 lushTipColor;
    uniform vec3 dryRootColor;
    uniform vec3 dryTipColor;
    uniform vec3 sunColor;
    uniform vec3 ambientColor;
    uniform vec3 sunDirection;
    uniform float sunWrap;
    uniform float baseOcclusion;
    uniform float tipSheen;

    varying vec3 vNormal;
    varying float vHeightRatio;
    varying float vTint;
    varying float vPatchTone;

    void main() {
        vec3 surfaceNormal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float sunFacing = mix(sunWrap, 1.0, max(dot(surfaceNormal, sunDirection), 0.0));

        vec3 rootColor = mix(dryRootColor, lushRootColor, vPatchTone);
        vec3 tipColor = mix(dryTipColor, lushTipColor, vPatchTone);
        vec3 bladeColor = mix(rootColor, tipColor, vHeightRatio) * vTint;

        float baseShade = mix(baseOcclusion, 1.0, sqrt(vHeightRatio));

        vec3 shaded = bladeColor * (ambientColor + sunColor * sunFacing) * baseShade;
        shaded += sunColor * tipSheen * pow(vHeightRatio, 5.0) * sunFacing;

        gl_FragColor = vec4(min(shaded, vec3(1.0)), 1.0);
    }
`;

    private static readonly grassFieldCameraWorldPosition = new Vector3();

    private static advancePhase(phase: number, increment: number): number {
        return (phase + increment) % FULL_TURN;
    }

    private static grassFieldBuildBandGeometry(band: IDetailBand): InstancedBufferGeometry {
        const cluster = GrassField.buildBladeCluster(band.subdivisions);
        const cellOffsets = collectBandCells(band, GRASS.tuftSpacing);
        const geometry = new InstancedBufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(cluster.positions, 3));
        geometry.setAttribute("bladeYaw", new BufferAttribute(cluster.bladeYaws, 1));
        geometry.setAttribute("bladeSeed", new BufferAttribute(cluster.bladeSeeds, 1));
        geometry.setAttribute("cellOffset", new InstancedBufferAttribute(cellOffsets, 2));
        geometry.setIndex(new BufferAttribute(cluster.indices, 1));

        geometry.instanceCount = cellOffsets.length / 2;

        return geometry;
    }

    private static bladeUniforms() {
        return {
            tuftSpacing: { value: GRASS.tuftSpacing },
            tuftSpread: { value: GRASS.tuftSpacing * GRASS.tuftSpreadRatio },
            bladeHeightRange: { value: new Vector2(...GRASS.bladeHeightRange) },
            bladeWidth: { value: GRASS.bladeWidth },
            bladeCurvature: { value: GRASS.bladeCurvature },
            bladeYawJitter: { value: FULL_TURN / GRASS.bladesPerTuft },
            leanRange: { value: new Vector2(...GRASS.leanRange) },
            crushedHeightRatio: { value: GRASS.growth.crushedHeightRatio },
            crushedExtraLean: { value: GRASS.growth.crushedExtraLean },
            windDirection: {
                value: new Vector2(Math.sin(GRASS.wind.heading), Math.cos(GRASS.wind.heading)),
            },
            windHeading: { value: GRASS.wind.heading },
            windBendSpread: { value: GRASS.wind.bendSpread },
            windWaveLength: { value: GRASS.wind.waveLength },
            windSway: { value: GRASS.wind.sway },
            windFlutter: { value: GRASS.wind.flutter },
            tuftToneWeight: { value: GRASS.tone.tuftToneWeight },
            tintRange: { value: new Vector2(...GRASS.tone.tintRange) },
        };
    }

    private static grassFieldPaletteUniforms(context: IWorldContext) {
        const { terrain, lighting, sky } = context.environment;
        const { lushHueShift, dryHueShift, tipLightnessGain, rootDarken } = GRASS.tone;

        const lushTip = new Color(
            shiftColorHsl(terrain.wildColor, lushHueShift, 1 + tipLightnessGain, tipLightnessGain)
        );
        const dryTip = new Color(
            shiftColorHsl(
                terrain.wildColor,
                dryHueShift,
                1 - tipLightnessGain,
                tipLightnessGain * 0.6
            )
        );

        return {
            lushTipColor: { value: lushTip },
            lushRootColor: { value: lushTip.clone().multiplyScalar(rootDarken) },
            dryTipColor: { value: dryTip },
            dryRootColor: { value: dryTip.clone().multiplyScalar(rootDarken) },
            sunColor: {
                value: new Color(lighting.keyColor).multiplyScalar(
                    lighting.keyIntensity * GRASS.light.sunGain
                ),
            },
            ambientColor: {
                value: new Color(lighting.skyFill).multiplyScalar(
                    lighting.hemisphereIntensity * GRASS.light.ambientGain
                ),
            },
            sunDirection: { value: sunDirectionOf(sky) },
            sunWrap: { value: GRASS.light.sunWrap },
            baseOcclusion: { value: GRASS.light.baseOcclusion },
            tipSheen: { value: GRASS.light.tipSheen },
        };
    }

    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly cameraGround = new Vector2();
    private readonly frameUniforms: grassFieldIFrameUniforms;
    private readonly fieldTexture: DataTexture;
    private readonly material: ShaderMaterial;
    private readonly geometries: InstancedBufferGeometry[] = [];

    constructor(
        context: IWorldContext,
        camera: Camera,
        center: Vector3Tuple,
        heightMap: TerrainSampleGrid,
        terrainFieldTexture: DataTexture,
        groundSplat: CanvasTexture,
        groundDetail: CanvasTexture,
        materials: IGroundMaterials
    ) {
        super("grass-field");

        this.camera = camera;
        this.fieldTexture = terrainFieldTexture;
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;

        const bands = buildDetailBands(GRASS.levelRadii);
        const fieldRadius = bands[bands.length - 1]?.outerRadius ?? 0;
        const previousRadius = bands[bands.length - 2]?.outerRadius ?? 0;

        this.frameUniforms = {
            cameraGround: { value: new Vector2() },
            windWavePhase: { value: 0 },
            windFlutterPhase: { value: 0 },
            fadeStartDistance: { value: (previousRadius + fieldRadius) / 2 },
            fadeEndDistance: { value: fieldRadius },
        };

        this.material = new ShaderMaterial({
            vertexShader: GrassField.grassFieldVERTEX_SHADER,
            fragmentShader: GrassField.grassFieldFRAGMENT_SHADER,
            side: DoubleSide,
            uniforms: {
                ...this.frameUniforms,
                ...groundCoverUniforms(this.fieldTexture, heightMap, GROUND_COVER.steepGroundBand),
                ...groundMaterialUniforms(groundSplat, groundDetail, materials),
                ...GrassField.bladeUniforms(),
                ...GrassField.grassFieldPaletteUniforms(context),
            },
        });

        const boundingSphere = new Sphere(new Vector3(), fieldRadius);

        for (const band of bands) {
            const geometry = GrassField.grassFieldBuildBandGeometry(band);
            geometry.boundingSphere = boundingSphere;

            const mesh = new Mesh(geometry, this.material);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();

            this.geometries.push(geometry);
            this.sceneObject.add(mesh);
            mesh.updateMatrixWorld(true);
            mesh.matrixWorldAutoUpdate = false;
        }
    }

    update(deltaSeconds: number): void {
        this.camera.getWorldPosition(GrassField.grassFieldCameraWorldPosition);
        this.cameraGround.set(
            GrassField.grassFieldCameraWorldPosition.x - this.sceneObject.position.x,
            GrassField.grassFieldCameraWorldPosition.z - this.sceneObject.position.z
        );

        this.frameUniforms.cameraGround.value.copy(this.cameraGround);
        this.frameUniforms.windWavePhase.value = GrassField.advancePhase(
            this.frameUniforms.windWavePhase.value,
            deltaSeconds * GRASS.wind.waveSpeed
        );
        this.frameUniforms.windFlutterPhase.value = GrassField.advancePhase(
            this.frameUniforms.windFlutterPhase.value,
            deltaSeconds * GRASS.wind.flutterSpeed
        );
    }

    dispose(): void {
        for (const geometry of this.geometries) geometry.dispose();

        this.geometries.length = 0;
        this.material.dispose();
        this.sceneObject.clear();
    }
}

export class BloomField extends Entity implements IWorldEntity {
    private static readonly STEM_PART = 0;

    private static readonly PETAL_PART = 1;

    private static buildBloomCluster(subdivisions: number): IBloomCluster {
        const petalCount = Math.max(3, Math.round((BLOOM.petalsPerBloom * subdivisions) / 2));
        const stemHeight = (BLOOM.stemHeightRange[0] + BLOOM.stemHeightRange[1]) / 2;

        const vertexCount = 4 + petalCount * 4;
        const triangleCount = 2 + petalCount * 2;

        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const partKinds = new Float32Array(vertexCount);
        const swayWeights = new Float32Array(vertexCount);
        const indices = new Uint16Array(triangleCount * 3);

        const stemHalfWidth = BLOOM.petalWidth * 0.18;
        let vertex = 0;
        let index = 0;

        const pushVertex = (
            x: number,
            y: number,
            z: number,
            normalX: number,
            normalY: number,
            normalZ: number,
            partKind: number,
            swayWeight: number
        ) => {
            positions[vertex * 3] = x;
            positions[vertex * 3 + 1] = y;
            positions[vertex * 3 + 2] = z;
            normals[vertex * 3] = normalX;
            normals[vertex * 3 + 1] = normalY;
            normals[vertex * 3 + 2] = normalZ;
            partKinds[vertex] = partKind;
            swayWeights[vertex] = swayWeight;
            vertex += 1;
        };

        const pushQuad = (firstVertex: number) => {
            indices[index] = firstVertex;
            indices[index + 1] = firstVertex + 1;
            indices[index + 2] = firstVertex + 2;
            indices[index + 3] = firstVertex;
            indices[index + 4] = firstVertex + 2;
            indices[index + 5] = firstVertex + 3;
            index += 6;
        };

        const stemFirstVertex = vertex;
        pushVertex(-stemHalfWidth, 0, 0, 0, 0, 1, BloomField.STEM_PART, 0);
        pushVertex(stemHalfWidth, 0, 0, 0, 0, 1, BloomField.STEM_PART, 0);
        pushVertex(stemHalfWidth, stemHeight, 0, 0, 0, 1, BloomField.STEM_PART, 1);
        pushVertex(-stemHalfWidth, stemHeight, 0, 0, 0, 1, BloomField.STEM_PART, 1);
        pushQuad(stemFirstVertex);

        for (let petal = 0; petal < petalCount; petal += 1) {
            const petalYaw = (petal / petalCount) * FULL_TURN;
            const outwardX = Math.sin(petalYaw);
            const outwardZ = Math.cos(petalYaw);
            const sideX = outwardZ;
            const sideZ = -outwardX;

            const halfWidth = BLOOM.petalWidth / 2;
            const tipX = outwardX * BLOOM.petalLength;
            const tipZ = outwardZ * BLOOM.petalLength;
            const tipY = stemHeight + BLOOM.petalLength * BLOOM.petalRise;

            const petalFirstVertex = vertex;
            pushVertex(
                -sideX * halfWidth * 0.35,
                stemHeight,
                -sideZ * halfWidth * 0.35,
                outwardX,
                BLOOM.petalRise,
                outwardZ,
                BloomField.PETAL_PART,
                0
            );
            pushVertex(
                sideX * halfWidth * 0.35,
                stemHeight,
                sideZ * halfWidth * 0.35,
                outwardX,
                BLOOM.petalRise,
                outwardZ,
                BloomField.PETAL_PART,
                0
            );
            pushVertex(
                tipX + sideX * halfWidth,
                tipY,
                tipZ + sideZ * halfWidth,
                outwardX,
                BLOOM.petalRise,
                outwardZ,
                BloomField.PETAL_PART,
                1
            );
            pushVertex(
                tipX - sideX * halfWidth,
                tipY,
                tipZ - sideZ * halfWidth,
                outwardX,
                BLOOM.petalRise,
                outwardZ,
                BloomField.PETAL_PART,
                1
            );
            pushQuad(petalFirstVertex);
        }

        return { positions, normals, partKinds, swayWeights, indices };
    }

    private static readonly bloomFieldVERTEX_SHADER = `
    ${GROUND_MATERIAL_GLSL}
    ${GROUND_COVER_GLSL}
    ${PATCH_FIELD_GLSL}

    uniform vec2 cameraGround;
    uniform float windWavePhase;
    uniform float fadeStartDistance;
    uniform float fadeEndDistance;

    uniform float cellSpacing;
    uniform vec2 scaleRange;
    uniform float coverage;
    uniform float swayStrength;

    uniform vec2 windDirection;
    uniform float windWaveLength;

    uniform vec3 speciesColorA;
    uniform vec3 speciesColorB;
    uniform vec3 speciesColorC;

    attribute vec2 cellOffset;
    attribute float partKind;
    attribute float swayWeight;

    varying vec3 vNormal;
    varying float vPartKind;
    varying float vPetalReach;
    varying vec3 vSpeciesColor;

    const float TAU = 6.2831853;

    void main() {
        vec2 bloomCell = floor(cameraGround / cellSpacing) + cellOffset;
        vec3 cellRandom = randomTriple(vec3(bloomCell, 3.0));
        vec3 shapeRandom = randomTriple(vec3(bloomCell, 11.0));

        vec2 bloomGround = (bloomCell + cellRandom.xy) * cellSpacing;
        vec2 fieldPointCoord = fieldPointCoordAt(bloomGround);
        vec4 field = sampleTerrainField(fieldPointCoord);
        float growable = groundCoverAt(bloomGround, field).x;

        vec2 bloomPatch = patchDensityAt(bloomGround);
        float rootedHere = insideTerrainField(fieldPointCoord)
            * step(cellRandom.z, bloomPatch.x * coverage * growable);

        float horizonFade = 1.0 - smoothstep(
            fadeStartDistance,
            fadeEndDistance,
            length(bloomGround - cameraGround)
        );
        float bloomScale = mix(scaleRange.x, scaleRange.y, shapeRandom.x)
            * rootedHere * horizonFade;

        float speciesPick = bloomPatch.y * 3.0;
        vSpeciesColor = speciesPick < 1.0
            ? speciesColorA
            : (speciesPick < 2.0 ? speciesColorB : speciesColorC);

        float yaw = shapeRandom.y * TAU;
        float yawCos = cos(yaw);
        float yawSin = sin(yaw);
        vec3 turned = vec3(
            position.x * yawCos - position.z * yawSin,
            position.y,
            position.x * yawSin + position.z * yawCos
        );

        float windWave = sin(
            dot(bloomGround, windDirection) / windWaveLength - windWavePhase
        );
        float swayFactor = partKind > 0.5 ? 1.0 : swayWeight;
        vec2 sway = windDirection * windWave * swayStrength * swayFactor;

        vec3 bloomWorld = vec3(bloomGround.x, field.r, bloomGround.y)
            + turned * bloomScale
            + vec3(sway.x, 0.0, sway.y) * bloomScale;

        vNormal = normalize(vec3(
            normal.x * yawCos - normal.z * yawSin,
            normal.y,
            normal.x * yawSin + normal.z * yawCos
        ));
        vPartKind = partKind;
        vPetalReach = swayWeight;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(bloomWorld, 1.0);
    }
`;

    private static readonly bloomFieldFRAGMENT_SHADER = `
    uniform vec3 stemColor;
    uniform vec3 sunColor;
    uniform vec3 ambientColor;
    uniform vec3 sunDirection;
    uniform float sunWrap;
    uniform float tipLightnessGain;
    uniform float throatDarken;

    varying vec3 vNormal;
    varying float vPartKind;
    varying float vPetalReach;
    varying vec3 vSpeciesColor;

    void main() {
        vec3 surfaceNormal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float sunFacing = mix(sunWrap, 1.0, max(dot(surfaceNormal, sunDirection), 0.0));

        vec3 petalColor = mix(
            vSpeciesColor * throatDarken,
            vSpeciesColor * (1.0 + tipLightnessGain),
            vPetalReach
        );
        vec3 bloomColor = mix(stemColor, petalColor, vPartKind);

        vec3 shaded = bloomColor * (ambientColor + sunColor * sunFacing);

        gl_FragColor = vec4(min(shaded, vec3(1.0)), 1.0);
    }
`;

    private static readonly bloomFieldCameraWorldPosition = new Vector3();

    private static bloomFieldBuildBandGeometry(band: IDetailBand): InstancedBufferGeometry {
        const cluster = BloomField.buildBloomCluster(band.subdivisions);
        const cellOffsets = collectBandCells(band, BLOOM.cellSpacing);
        const geometry = new InstancedBufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(cluster.positions, 3));
        geometry.setAttribute("normal", new BufferAttribute(cluster.normals, 3));
        geometry.setAttribute("partKind", new BufferAttribute(cluster.partKinds, 1));
        geometry.setAttribute("swayWeight", new BufferAttribute(cluster.swayWeights, 1));
        geometry.setAttribute("cellOffset", new InstancedBufferAttribute(cellOffsets, 2));
        geometry.setIndex(new BufferAttribute(cluster.indices, 1));

        geometry.instanceCount = cellOffsets.length / 2;

        return geometry;
    }

    private static bloomShapeUniforms() {
        return {
            cellSpacing: { value: BLOOM.cellSpacing },
            scaleRange: { value: new Vector2(...BLOOM.scaleRange) },
            coverage: { value: BLOOM.coverage },
            swayStrength: { value: BLOOM.swayStrength },
            windDirection: {
                value: new Vector2(Math.sin(GRASS.wind.heading), Math.cos(GRASS.wind.heading)),
            },
            windWaveLength: { value: GRASS.wind.waveLength },
            tipLightnessGain: { value: BLOOM.tone.tipLightnessGain },
            throatDarken: { value: BLOOM.tone.throatDarken },
        };
    }

    private static bloomFieldPaletteUniforms(context: IWorldContext) {
        const { terrain, lighting, sky } = context.environment;
        const { speciesHueSpread, stemHueShift, stemLightnessShift } = BLOOM.tone;

        return {
            speciesColorA: { value: new Color(sky.glow) },
            speciesColorB: {
                value: new Color(shiftColorHsl(sky.glow, speciesHueSpread, 1.05, -0.04)),
            },
            speciesColorC: {
                value: new Color(shiftColorHsl(sky.glow, -speciesHueSpread, 1.1, -0.08)),
            },
            stemColor: {
                value: new Color(
                    shiftColorHsl(terrain.wildColor, stemHueShift, 1, stemLightnessShift)
                ),
            },
            sunColor: {
                value: new Color(lighting.keyColor).multiplyScalar(
                    lighting.keyIntensity * BLOOM.light.sunGain
                ),
            },
            ambientColor: {
                value: new Color(lighting.skyFill).multiplyScalar(
                    lighting.hemisphereIntensity * BLOOM.light.ambientGain
                ),
            },
            sunDirection: { value: sunDirectionOf(sky) },
            sunWrap: { value: BLOOM.light.sunWrap },
        };
    }

    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly cameraGround = new Vector2();
    private readonly frameUniforms: bloomFieldIFrameUniforms;
    private readonly fieldTexture: DataTexture;
    private readonly material: ShaderMaterial;
    private readonly geometries: InstancedBufferGeometry[] = [];

    constructor(
        context: IWorldContext,
        camera: Camera,
        center: Vector3Tuple,
        heightMap: TerrainSampleGrid,
        terrainFieldTexture: DataTexture,
        groundSplat: CanvasTexture,
        groundDetail: CanvasTexture,
        materials: IGroundMaterials
    ) {
        super("bloom-field");

        this.camera = camera;
        this.fieldTexture = terrainFieldTexture;
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;

        const bands = buildDetailBands(BLOOM.levelRadii);
        const fieldRadius = bands[bands.length - 1]?.outerRadius ?? 0;
        const previousRadius = bands[bands.length - 2]?.outerRadius ?? 0;

        this.frameUniforms = {
            cameraGround: { value: new Vector2() },
            windWavePhase: { value: 0 },
            fadeStartDistance: { value: (previousRadius + fieldRadius) / 2 },
            fadeEndDistance: { value: fieldRadius },
        };

        this.material = new ShaderMaterial({
            vertexShader: BloomField.bloomFieldVERTEX_SHADER,
            fragmentShader: BloomField.bloomFieldFRAGMENT_SHADER,
            side: DoubleSide,
            uniforms: {
                ...this.frameUniforms,
                ...groundCoverUniforms(this.fieldTexture, heightMap, GROUND_COVER.steepGroundBand),
                ...groundMaterialUniforms(groundSplat, groundDetail, materials),
                ...BloomField.bloomShapeUniforms(),
                ...patchFieldUniforms(BLOOM.patch),
                ...BloomField.bloomFieldPaletteUniforms(context),
            },
        });

        const boundingSphere = new Sphere(new Vector3(), fieldRadius);

        for (const band of bands) {
            const geometry = BloomField.bloomFieldBuildBandGeometry(band);
            geometry.boundingSphere = boundingSphere;

            const mesh = new Mesh(geometry, this.material);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();

            this.geometries.push(geometry);
            this.sceneObject.add(mesh);
            mesh.updateMatrixWorld(true);
            mesh.matrixWorldAutoUpdate = false;
        }
    }

    update(deltaSeconds: number): void {
        this.camera.getWorldPosition(BloomField.bloomFieldCameraWorldPosition);
        this.cameraGround.set(
            BloomField.bloomFieldCameraWorldPosition.x - this.sceneObject.position.x,
            BloomField.bloomFieldCameraWorldPosition.z - this.sceneObject.position.z
        );

        this.frameUniforms.cameraGround.value.copy(this.cameraGround);
        this.frameUniforms.windWavePhase.value =
            (this.frameUniforms.windWavePhase.value + deltaSeconds * GRASS.wind.waveSpeed) %
            FULL_TURN;
    }

    dispose(): void {
        for (const geometry of this.geometries) geometry.dispose();

        this.geometries.length = 0;
        this.material.dispose();
        this.sceneObject.clear();
    }
}

export const groundCoverUniforms = (
    fieldTexture: DataTexture,
    heightMap: TerrainSampleGrid,
    steepGroundBand: [number, number]
) => ({
    terrainField: { value: fieldTexture },
    fieldOrigin: { value: new Vector2(heightMap.originX, heightMap.originZ) },
    fieldCellSize: { value: heightMap.cellSize },
    fieldPointsPerSide: { value: heightMap.pointsPerSide },
    steepGroundBand: { value: new Vector2(...steepGroundBand) },
    coverTrailBand: { value: new Vector2(...GROUND_COVER.coverTrailBand) },
    growthStopBand: {
        value: new Vector2(
            WORLD_EDGE.groundApron - GROUND_COVER.worldEdgeFadeWidth,
            WORLD_EDGE.groundApron
        ),
    },
});

export const patchFieldUniforms = (patch: IPatchFieldSettings) => ({
    patchSpacing: { value: patch.spacing },
    patchRadiusRange: { value: new Vector2(...patch.radiusRange) },
    patchChance: { value: patch.chance },
    patchCoreRatio: { value: patch.coreRatio },
    patchEdgeWavelength: { value: patch.edgeWavelength },
    patchEdgeStrength: { value: patch.edgeStrength },
});

export function buildDetailBands(levelRadii: number[]): IDetailBand[] {
    const finestSubdivisions = 1 << (levelRadii.length - 1);
    let innerRadius = 0;

    return levelRadii.map((outerRadius, bandIndex) => {
        const band = {
            innerRadius,
            outerRadius,
            subdivisions: finestSubdivisions >> bandIndex,
        };

        innerRadius = outerRadius;

        return band;
    });
}

export function collectBandCells(band: IDetailBand, cellSpacing: number): Float32Array {
    const reach = Math.ceil(band.outerRadius / cellSpacing);
    const innerCellsSquared = (band.innerRadius / cellSpacing) ** 2;
    const outerCellsSquared = (band.outerRadius / cellSpacing) ** 2;

    const offsets = new Float32Array((reach * 2 + 1) ** 2 * 2);
    let count = 0;

    for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1)
        for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
            const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

            if (distanceSquared >= outerCellsSquared || distanceSquared < innerCellsSquared)
                continue;

            offsets[count] = offsetX;
            offsets[count + 1] = offsetZ;
            count += 2;
        }

    return offsets.slice(0, count);
}
