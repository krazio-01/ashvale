import {
    BufferAttribute,
    Camera,
    CanvasTexture,
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
import { BLOOM, GRASS, GROUND_FIELD } from "@/constants/placement";
import { FULL_TURN, shiftColorHsl } from "@/lib/helpers";
import {
    GROUND_FIELD_GLSL,
    buildDetailBands,
    collectBandCells,
    groundFieldUniforms,
    type IDetailBand,
} from "@/world/vegetation/GroundField";
import {
    GROUND_MATERIAL_GLSL,
    groundMaterialUniforms,
    type IGroundMaterials,
} from "@/world/terrain/GroundMaterials";

const VERTEX_SHADER = /* glsl */ `
    ${GROUND_MATERIAL_GLSL}
    ${GROUND_FIELD_GLSL}

    uniform vec2 cameraGround;
    uniform float windWavePhase;
    uniform float fadeStartDistance;
    uniform float fadeEndDistance;

    uniform float cellSpacing;
    uniform vec2 scaleRange;
    uniform float coverage;
    uniform float driftWavelength;
    uniform float driftThreshold;
    uniform float speciesWavelength;
    uniform float speciesOffset;
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
        vec2 growth = groundGrowthOf(groundMaterialShareAt(bloomGround, trailWearAt(field.g)));

        /* blooms follow the same growable-ground rule as grass, so they never appear on
           worn trails, cliff faces or past the island lip */
        float growable = growth.x * withinGrowableGround(field.b, field.a);

        float drift = driftNoise(bloomGround / driftWavelength);
        float driftStrength = smoothstep(driftThreshold, 1.0, drift);
        float rootedHere = insideTerrainField(fieldPointCoord)
            * step(cellRandom.z, driftStrength * coverage * growable);

        float horizonFade = 1.0 - smoothstep(
            fadeStartDistance,
            fadeEndDistance,
            length(bloomGround - cameraGround)
        );
        float bloomScale = mix(scaleRange.x, scaleRange.y, shapeRandom.x)
            * rootedHere * horizonFade;

        float speciesPick = driftNoise(
            (bloomGround + vec2(speciesOffset)) / speciesWavelength
        ) * 3.0;
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
        vec2 sway = windDirection * windWave * swayStrength * swayWeight;

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

const FRAGMENT_SHADER = /* glsl */ `
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

const cameraWorldPosition = new Vector3();

export class BloomField extends Entity implements IWorldEntity {
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
        heightMap: TerrainHeightMap,
        groundSplat: CanvasTexture,
        groundDetail: CanvasTexture,
        materials: IGroundMaterials
    ) {
        super("bloom-field");

        this.camera = camera;
        this.fieldTexture = heightMap.createShaderTexture();
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
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: DoubleSide,
            uniforms: {
                ...this.frameUniforms,
                ...groundFieldUniforms(this.fieldTexture, heightMap, GROUND_FIELD.steepGroundBand),
                ...groundMaterialUniforms(groundSplat, groundDetail, materials),
                ...bloomShapeUniforms(),
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
        this.frameUniforms.windWavePhase.value =
            (this.frameUniforms.windWavePhase.value + deltaSeconds * GRASS.wind.waveSpeed) %
            FULL_TURN;
    }

    dispose(): void {
        for (const geometry of this.geometries) geometry.dispose();

        this.geometries.length = 0;
        this.material.dispose();
        this.fieldTexture.dispose();
        this.sceneObject.clear();
    }
}

function buildBandGeometry(band: IDetailBand): InstancedBufferGeometry {
    const cluster = buildBloomCluster(band.subdivisions);
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

const STEM_PART = 0;
const PETAL_PART = 1;

function buildBloomCluster(subdivisions: number): IBloomCluster {
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
    pushVertex(-stemHalfWidth, 0, 0, 0, 0, 1, STEM_PART, 0);
    pushVertex(stemHalfWidth, 0, 0, 0, 0, 1, STEM_PART, 0);
    pushVertex(stemHalfWidth, stemHeight, 0, 0, 0, 1, STEM_PART, 1);
    pushVertex(-stemHalfWidth, stemHeight, 0, 0, 0, 1, STEM_PART, 1);
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
            PETAL_PART,
            0
        );
        pushVertex(
            sideX * halfWidth * 0.35,
            stemHeight,
            sideZ * halfWidth * 0.35,
            outwardX,
            BLOOM.petalRise,
            outwardZ,
            PETAL_PART,
            0
        );
        pushVertex(
            tipX + sideX * halfWidth,
            tipY,
            tipZ + sideZ * halfWidth,
            outwardX,
            BLOOM.petalRise,
            outwardZ,
            PETAL_PART,
            1
        );
        pushVertex(
            tipX - sideX * halfWidth,
            tipY,
            tipZ - sideZ * halfWidth,
            outwardX,
            BLOOM.petalRise,
            outwardZ,
            PETAL_PART,
            1
        );
        pushQuad(petalFirstVertex);
    }

    return { positions, normals, partKinds, swayWeights, indices };
}

function bloomShapeUniforms() {
    return {
        cellSpacing: { value: BLOOM.cellSpacing },
        scaleRange: { value: new Vector2(...BLOOM.scaleRange) },
        coverage: { value: BLOOM.coverage },
        driftWavelength: { value: BLOOM.driftWavelength },
        driftThreshold: { value: BLOOM.driftThreshold },
        speciesWavelength: { value: BLOOM.speciesWavelength },
        speciesOffset: { value: BLOOM.speciesOffset },
        swayStrength: { value: BLOOM.swayStrength },
        windDirection: {
            value: new Vector2(Math.sin(GRASS.wind.heading), Math.cos(GRASS.wind.heading)),
        },
        windWaveLength: { value: GRASS.wind.waveLength },
        tipLightnessGain: { value: BLOOM.tone.tipLightnessGain },
        throatDarken: { value: BLOOM.tone.throatDarken },
    };
}

function paletteUniforms(context: IWorldContext) {
    const { terrain, lighting, sky } = context.environment;
    const { speciesHueSpread, stemHueShift, stemLightnessShift } = BLOOM.tone;

    return {
        speciesColorA: { value: new Color(sky.glow) },
        speciesColorB: { value: new Color(shiftColorHsl(sky.glow, speciesHueSpread, 1.05, -0.04)) },
        speciesColorC: {
            value: new Color(shiftColorHsl(sky.glow, -speciesHueSpread, 1.1, -0.08)),
        },
        stemColor: {
            value: new Color(shiftColorHsl(terrain.wildColor, stemHueShift, 1, stemLightnessShift)),
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

interface IBloomCluster {
    positions: Float32Array;
    normals: Float32Array;
    partKinds: Float32Array;
    swayWeights: Float32Array;
    indices: Uint16Array;
}

interface IFrameUniforms {
    cameraGround: IUniform<Vector2>;
    windWavePhase: IUniform<number>;
    fadeStartDistance: IUniform<number>;
    fadeEndDistance: IUniform<number>;
}
