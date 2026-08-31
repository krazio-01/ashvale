import {
    BufferAttribute,
    Camera,
    Color,
    DataTexture,
    DoubleSide,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    ShaderMaterial,
    Sphere,
    Vector2,
    Vector3,
    type IUniform,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { GRASS } from "@/constants/placement";
import { WORLD_EDGE } from "@/constants/world";
import { shiftColorHsl, FULL_TURN } from "@/lib/helpers";

const VERTEX_SHADER = /* glsl */ `
    uniform sampler2D terrainField;
    uniform vec2 fieldOrigin;
    uniform float fieldCellSize;
    uniform float fieldPointsPerSide;

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

    uniform vec2 steepGroundBand;
    uniform vec2 carvedPathBand;
    uniform float groundApron;

    uniform vec2 windDirection;
    uniform float windHeading;
    uniform float windBendSpread;
    uniform float windWaveLength;
    uniform float windSway;
    uniform float windFlutter;

    uniform float patchNoiseScale;
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

    vec3 randomTriple(vec3 seed) {
        vec3 scattered = fract(seed * vec3(0.1031, 0.1030, 0.0973));
        scattered += dot(scattered, scattered.yxz + 33.33);

        return fract((scattered.xxy + scattered.yxx) * scattered.zyx);
    }

    float noiseAt(vec2 ground) {
        vec2 cell = floor(ground);
        vec2 withinCell = ground - cell;
        vec2 weight = withinCell * withinCell * (3.0 - 2.0 * withinCell);

        float nearLeft = randomTriple(vec3(cell, 101.0)).x;
        float nearRight = randomTriple(vec3(cell + vec2(1.0, 0.0), 101.0)).x;
        float farLeft = randomTriple(vec3(cell + vec2(0.0, 1.0), 101.0)).x;
        float farRight = randomTriple(vec3(cell + vec2(1.0, 1.0), 101.0)).x;

        return mix(mix(nearLeft, nearRight, weight.x), mix(farLeft, farRight, weight.x), weight.y);
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

    float openGroundAt(vec4 field) {
        float offSteepGround = 1.0 - smoothstep(steepGroundBand.x, steepGroundBand.y, field.b);
        float offCarvedPath = 1.0 - smoothstep(carvedPathBand.x, carvedPathBand.y, field.g);
        float onWalkableGround = 1.0 - step(groundApron, field.a);

        return offSteepGround * offCarvedPath * onWalkableGround;
    }

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

        float rootedHere = insideTerrainField(fieldPointCoord)
            * step(tuftRandom.z, openGroundAt(field));

        float horizonFade = 1.0 - smoothstep(
            fadeStartDistance,
            fadeEndDistance,
            length(tuftGround - cameraGround)
        );
        float bladeLength = mix(bladeHeightRange.x, bladeHeightRange.y, bladeShape.x)
            * rootedHere * horizonFade;

        float yaw = bladeYaw + toneRandom.y * TAU + (bladeShape.y - 0.5) * bladeYawJitter;
        vec2 facingDirection = vec2(sin(yaw), cos(yaw));
        vec2 sideDirection = vec2(facingDirection.y, -facingDirection.x);
        vec2 rootGround = tuftGround + facingDirection * tuftSpread * bladeMotion.x;

        float windWave = sin(dot(rootGround, windDirection) / windWaveLength - windWavePhase)
            * 0.5 + 0.5;
        float flutter = sin(windFlutterPhase + bladeMotion.y * TAU) * windFlutter * windWave;
        float bendAngle = mix(leanRange.x, leanRange.y, bladeShape.z)
            + windWave * windSway
            + flutter;

        float bendYaw = windHeading + (bladeMotion.z - 0.5) * windBendSpread;
        vec2 bendDirection = vec2(sin(bendYaw), cos(bendYaw));

        vHeightRatio = position.y;

        vec2 arc = bendAlongArc(vHeightRatio, bendAngle, bladeLength);

        vec3 bladeWorld = vec3(rootGround.x, field.r, rootGround.y)
            + vec3(sideDirection.x, 0.0, sideDirection.y) * position.x * bladeWidth
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

        vPatchTone = noiseAt(rootGround * patchNoiseScale);
        vTint = mix(tintRange.x, tintRange.y, mix(vPatchTone, toneRandom.x, tuftToneWeight));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(bladeWorld, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
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

const cameraWorldPosition = new Vector3();

export class GrassField extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly cameraGround = new Vector2();
    private readonly frameUniforms: IFrameUniforms;
    private readonly fieldTexture: DataTexture;
    private readonly material: ShaderMaterial;
    private readonly geometries: InstancedBufferGeometry[] = [];

    constructor(
        context: IWorldContext,
        camera: Camera,
        center: Vector3Tuple,
        heightMap: TerrainHeightMap
    ) {
        super("grass-field");

        this.camera = camera;
        this.fieldTexture = heightMap.createShaderTexture();
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.matrixAutoUpdate = false;
        this.sceneObject.updateMatrix();
        this.sceneObject.updateMatrixWorld(true);
        this.sceneObject.matrixWorldAutoUpdate = false;

        const bands = buildDetailBands();
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
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: DoubleSide,
            uniforms: {
                ...this.frameUniforms,
                ...terrainUniforms(this.fieldTexture, heightMap),
                ...bladeUniforms(),
                ...paletteUniforms(context),
            },
        });

        const boundingSphere = new Sphere(new Vector3(), fieldRadius);

        for (const band of bands) {
            const geometry = buildBandGeometry(band);
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
        this.camera.getWorldPosition(cameraWorldPosition);
        this.cameraGround.set(
            cameraWorldPosition.x - this.sceneObject.position.x,
            cameraWorldPosition.z - this.sceneObject.position.z
        );

        this.frameUniforms.cameraGround.value.copy(this.cameraGround);
        this.frameUniforms.windWavePhase.value = advancePhase(
            this.frameUniforms.windWavePhase.value,
            deltaSeconds * GRASS.wind.waveSpeed
        );
        this.frameUniforms.windFlutterPhase.value = advancePhase(
            this.frameUniforms.windFlutterPhase.value,
            deltaSeconds * GRASS.wind.flutterSpeed
        );
    }

    dispose(): void {
        for (const geometry of this.geometries) geometry.dispose();

        this.geometries.length = 0;
        this.material.dispose();
        this.fieldTexture.dispose();
        this.sceneObject.clear();
    }
}

function advancePhase(phase: number, increment: number): number {
    return (phase + increment) % FULL_TURN;
}

function buildDetailBands(): IGrassDetailBand[] {
    const finestSegments = 1 << (GRASS.levelRadii.length - 1);
    let innerRadius = 0;

    return GRASS.levelRadii.map((outerRadius, bandIndex) => {
        const band = {
            innerRadius,
            outerRadius,
            bladeSegments: finestSegments >> bandIndex,
        };

        innerRadius = outerRadius;

        return band;
    });
}

function buildBandGeometry(band: IGrassDetailBand): InstancedBufferGeometry {
    const cluster = buildBladeCluster(band.bladeSegments);
    const cellOffsets = collectBandCells(band);
    const geometry = new InstancedBufferGeometry();

    geometry.setAttribute("position", new BufferAttribute(cluster.positions, 3));
    geometry.setAttribute("bladeYaw", new BufferAttribute(cluster.bladeYaws, 1));
    geometry.setAttribute("bladeSeed", new BufferAttribute(cluster.bladeSeeds, 1));
    geometry.setAttribute("cellOffset", new InstancedBufferAttribute(cellOffsets, 2));
    geometry.setIndex(new BufferAttribute(cluster.indices, 1));

    geometry.instanceCount = cellOffsets.length / 2;

    return geometry;
}

function buildBladeCluster(bladeSegments: number): IBladeCluster {
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

function collectBandCells(band: IGrassDetailBand): Float32Array {
    const reach = Math.ceil(band.outerRadius / GRASS.tuftSpacing);
    const innerCellsSquared = (band.innerRadius / GRASS.tuftSpacing) ** 2;
    const outerCellsSquared = (band.outerRadius / GRASS.tuftSpacing) ** 2;

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

function terrainUniforms(fieldTexture: DataTexture, heightMap: TerrainHeightMap) {
    return {
        terrainField: { value: fieldTexture },
        fieldOrigin: { value: new Vector2(heightMap.originX, heightMap.originZ) },
        fieldCellSize: { value: heightMap.cellSize },
        fieldPointsPerSide: { value: heightMap.pointsPerSide },
        steepGroundBand: {
            value: new Vector2(GRASS.steepGroundLimit * 0.65, GRASS.steepGroundLimit),
        },
        carvedPathBand: {
            value: new Vector2(GRASS.carvedPathLimit * 0.3, GRASS.carvedPathLimit),
        },
        groundApron: { value: WORLD_EDGE.groundApron },
    };
}

function bladeUniforms() {
    return {
        tuftSpacing: { value: GRASS.tuftSpacing },
        tuftSpread: { value: GRASS.tuftSpacing },
        bladeHeightRange: { value: new Vector2(...GRASS.bladeHeightRange) },
        bladeWidth: { value: GRASS.bladeWidth },
        bladeCurvature: { value: GRASS.bladeCurvature },
        bladeYawJitter: { value: FULL_TURN / GRASS.bladesPerTuft },
        leanRange: { value: new Vector2(...GRASS.leanRange) },
        windDirection: {
            value: new Vector2(Math.sin(GRASS.wind.heading), Math.cos(GRASS.wind.heading)),
        },
        windHeading: { value: GRASS.wind.heading },
        windBendSpread: { value: GRASS.wind.bendSpread },
        windWaveLength: { value: GRASS.wind.waveLength },
        windSway: { value: GRASS.wind.sway },
        windFlutter: { value: GRASS.wind.flutter },
        patchNoiseScale: { value: GRASS.tone.patchNoiseScale },
        tuftToneWeight: { value: GRASS.tone.tuftToneWeight },
        tintRange: { value: new Vector2(...GRASS.tone.tintRange) },
    };
}

function paletteUniforms(context: IWorldContext) {
    const { terrain, lighting, sky } = context.environment;
    const { lushHueShift, dryHueShift, tipLightnessGain, rootDarken } = GRASS.tone;

    const lushTip = new Color(
        shiftColorHsl(terrain.wildColor, lushHueShift, 1 + tipLightnessGain, tipLightnessGain)
    );
    const dryTip = new Color(
        shiftColorHsl(terrain.wildColor, dryHueShift, 1 - tipLightnessGain, tipLightnessGain * 0.6)
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

interface IBladeCluster {
    positions: Float32Array;
    bladeYaws: Float32Array;
    bladeSeeds: Float32Array;
    indices: Uint16Array | Uint32Array;
}

interface IGrassDetailBand {
    innerRadius: number;
    outerRadius: number;
    bladeSegments: number;
}

interface IFrameUniforms {
    cameraGround: IUniform<Vector2>;
    windWavePhase: IUniform<number>;
    windFlutterPhase: IUniform<number>;
    fadeStartDistance: IUniform<number>;
    fadeEndDistance: IUniform<number>;
}
