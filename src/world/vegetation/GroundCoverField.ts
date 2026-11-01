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
import type { IWorldContext, IWorldEntity, IGroundSurface, IThemeLighting } from "@/types/world";
import type { TerrainSampleGrid } from "@/world/terrain/TerrainGeneration";
import { WORLD_EDGE } from "@/constants/world";
import { FLOWER_PATCHES, GRASS, GROUND_COVER } from "@/constants/placement";
import { FULL_TURN, freezeTransform, shiftColorHsl } from "@/lib/helpers";
import { GROUND_MATERIAL_GLSL, groundMaterialUniforms } from "@/world/terrain/TerrainMaterials";

const patchFieldUniforms = () => {
    const patch = FLOWER_PATCHES.patch;
    return {
        patchSpacing: { value: patch.spacing },
        patchRadiusRange: { value: new Vector2(...patch.radiusRange) },
        patchChance: { value: patch.chance },
        patchCoreRatio: { value: patch.coreRatio },
        patchEdgeWavelength: { value: patch.edgeWavelength },
        patchEdgeStrength: { value: patch.edgeStrength },
    };
};

const coverLightUniforms = (
    lighting: IThemeLighting,
    light: { sunGain: number; ambientGain: number; sunWrap: number }
) => ({
    sunColor: {
        value: new Color(lighting.sunLightColor).multiplyScalar(
            lighting.sunLightIntensity * light.sunGain
        ),
    },
    ambientColor: {
        value: new Color(lighting.hemisphereSkyColor).multiplyScalar(
            lighting.hemisphereIntensity * light.ambientGain
        ),
    },
    sunWrap: { value: light.sunWrap },
});

const GROUND_COVER_GLSL = `
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

    const float TAU = 6.2831853;
`;

const SUN_FACING_GLSL = `
    float sunFacingOf(vec3 normal) {
        vec3 surfaceNormal = normalize(normal) * (gl_FrontFacing ? 1.0 : -1.0);
        return mix(sunWrap, 1.0, max(dot(surfaceNormal, sunDirection), 0.0));
    }
`;

const PATCH_FIELD_GLSL = `
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

const GRASS_VERTEX_SHADER = `
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

const GRASS_FRAGMENT_SHADER = `
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
    ${SUN_FACING_GLSL}

    void main() {
        float sunFacing = sunFacingOf(vNormal);

        vec3 rootColor = mix(dryRootColor, lushRootColor, vPatchTone);
        vec3 tipColor = mix(dryTipColor, lushTipColor, vPatchTone);
        vec3 bladeColor = mix(rootColor, tipColor, vHeightRatio) * vTint;

        float baseShade = mix(baseOcclusion, 1.0, sqrt(vHeightRatio));

        vec3 shaded = bladeColor * (ambientColor + sunColor * sunFacing) * baseShade;
        shaded += sunColor * tipSheen * pow(vHeightRatio, 5.0) * sunFacing;

        gl_FragColor = vec4(min(shaded, vec3(1.0)), 1.0);
    }
`;

const FLOWER_VERTEX_SHADER = `
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

const FLOWER_FRAGMENT_SHADER = `
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
    ${SUN_FACING_GLSL}

    void main() {
        float sunFacing = sunFacingOf(vNormal);

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

const STEM_PART = 0;

const PETAL_PART = 1;

export const GROUND_COVER_KINDS = {
    grass: {
        id: "grass-field",
        detailLevelRadii: GRASS.detailLevelRadii,
        cellSpacing: GRASS.tuftSpacing,
        vertexShader: GRASS_VERTEX_SHADER,
        fragmentShader: GRASS_FRAGMENT_SHADER,
        buildCluster: buildBladeCluster,
        uniforms: (context) => ({ ...bladeUniforms(), ...grassPaletteUniforms(context) }),
    },
    flowers: {
        id: "flower-field",
        detailLevelRadii: FLOWER_PATCHES.detailLevelRadii,
        cellSpacing: FLOWER_PATCHES.cellSpacing,
        vertexShader: FLOWER_VERTEX_SHADER,
        fragmentShader: FLOWER_FRAGMENT_SHADER,
        buildCluster: buildFlowerCluster,
        uniforms: (context) => ({
            ...flowerShapeUniforms(),
            ...patchFieldUniforms(),
            ...flowerPaletteUniforms(context),
        }),
    },
} satisfies Record<string, IGroundCoverKind>;

interface IGroundCoverCluster {
    attributes: readonly (readonly [name: string, values: Float32Array, itemSize: number])[];
    indices: Uint16Array | Uint32Array;
}

export interface IGroundCoverKind {
    id: string;
    detailLevelRadii: number[];
    cellSpacing: number;
    vertexShader: string;
    fragmentShader: string;
    buildCluster(subdivisions: number): IGroundCoverCluster;
    uniforms(context: IWorldContext): Record<string, IUniform>;
}

interface IDetailBand {
    innerRadius: number;
    outerRadius: number;
    subdivisions: number;
}

export class GroundCoverField implements IWorldEntity {
    private static collectBandCells(band: IDetailBand, cellSpacing: number): Float32Array {
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

    private static readonly groundCoverUniforms = (
        fieldTexture: DataTexture,
        sampleGrid: TerrainSampleGrid
    ) => ({
        terrainField: { value: fieldTexture },
        fieldOrigin: { value: new Vector2(sampleGrid.originX, sampleGrid.originZ) },
        fieldCellSize: { value: sampleGrid.cellSize },
        fieldPointsPerSide: { value: sampleGrid.pointsPerSide },
        steepGroundBand: { value: new Vector2(...GROUND_COVER.steepGroundBand) },
        coverTrailBand: { value: new Vector2(...GROUND_COVER.coverTrailBand) },
        growthStopBand: {
            value: new Vector2(
                WORLD_EDGE.flatBorderWidth - GROUND_COVER.worldEdgeFadeWidth,
                WORLD_EDGE.flatBorderWidth
            ),
        },
    });

    private static buildDetailBands(levelRadii: number[]): IDetailBand[] {
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

    private static readonly cameraWorldPosition = new Vector3();

    private static buildBandGeometry(
        kind: IGroundCoverKind,
        band: IDetailBand
    ): InstancedBufferGeometry {
        const cluster = kind.buildCluster(band.subdivisions);
        const cellOffsets = GroundCoverField.collectBandCells(band, kind.cellSpacing);
        const geometry = new InstancedBufferGeometry();

        for (const [name, values, itemSize] of cluster.attributes)
            geometry.setAttribute(name, new BufferAttribute(values, itemSize));
        geometry.setAttribute("cellOffset", new InstancedBufferAttribute(cellOffsets, 2));
        geometry.setIndex(new BufferAttribute(cluster.indices, 1));

        geometry.instanceCount = cellOffsets.length / 2;

        return geometry;
    }

    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly cameraGround: IUniform<Vector2>;
    private readonly material: ShaderMaterial;
    private readonly geometries: InstancedBufferGeometry[] = [];

    constructor(
        kind: IGroundCoverKind,
        context: IWorldContext,
        camera: Camera,
        center: Vector3Tuple,
        surface: IGroundSurface
    ) {
        this.camera = camera;
        this.sceneObject.position.set(center[0], 0, center[2]);
        freezeTransform(this.sceneObject);

        const bands = GroundCoverField.buildDetailBands(kind.detailLevelRadii);
        const fieldRadius = bands[bands.length - 1]?.outerRadius ?? 0;
        const previousRadius = bands[bands.length - 2]?.outerRadius ?? 0;

        this.cameraGround = { value: new Vector2() };
        this.material = new ShaderMaterial({
            vertexShader: kind.vertexShader,
            fragmentShader: kind.fragmentShader,
            side: DoubleSide,
            uniforms: {
                cameraGround: this.cameraGround,
                fadeStartDistance: { value: (previousRadius + fieldRadius) / 2 },
                fadeEndDistance: { value: fieldRadius },
                ...context.worldEnvironment.uniforms,
                ...GroundCoverField.groundCoverUniforms(surface.fieldTexture, surface.sampleGrid),
                ...groundMaterialUniforms(
                    surface.groundSplat,
                    surface.groundDetail,
                    surface.materials
                ),
                ...kind.uniforms(context),
            },
        });

        const boundingSphere = new Sphere(new Vector3(), fieldRadius);

        for (const band of bands) {
            const geometry = GroundCoverField.buildBandGeometry(kind, band);
            geometry.boundingSphere = boundingSphere;

            const mesh = new Mesh(geometry, this.material);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;

            this.geometries.push(geometry);
            this.sceneObject.add(mesh);
            freezeTransform(mesh);
        }
    }

    update(): void {
        this.camera.getWorldPosition(GroundCoverField.cameraWorldPosition);
        this.cameraGround.value.set(
            GroundCoverField.cameraWorldPosition.x - this.sceneObject.position.x,
            GroundCoverField.cameraWorldPosition.z - this.sceneObject.position.z
        );
    }

    dispose(): void {
        for (const geometry of this.geometries) geometry.dispose();

        this.geometries.length = 0;
        this.material.dispose();
        this.sceneObject.clear();
    }
}

function buildBladeCluster(bladeSegments: number): IGroundCoverCluster {
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
        const pushVertex = (x: number, y: number): void => {
            positions[vertexIndex * 3] = x;
            positions[vertexIndex * 3 + 1] = y;
            positions[vertexIndex * 3 + 2] = 0;
            bladeYaws[vertexIndex] = restingYaw;
            bladeSeeds[vertexIndex] = bladeNumber;
            vertexIndex += 1;
        };

        for (let row = 0; row < bladeSegments; row += 1) {
            const heightRatio = row / bladeSegments;
            const halfWidth = 0.5 * Math.pow(1 - heightRatio, GRASS.bladeTaperExponent);

            pushVertex(-halfWidth, heightRatio);
            pushVertex(halfWidth, heightRatio);
        }

        pushVertex(0, 1);

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

    return {
        attributes: [
            ["position", positions, 3],
            ["bladeYaw", bladeYaws, 1],
            ["bladeSeed", bladeSeeds, 1],
        ],
        indices,
    };
}

function bladeUniforms() {
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
        tuftToneWeight: { value: GRASS.tone.tuftToneWeight },
        tintRange: { value: new Vector2(...GRASS.tone.tintRange) },
    };
}

function grassPaletteUniforms(context: IWorldContext) {
    const { terrain, lighting } = context.environment;
    const { lushHueShift, dryHueShift, tipLightnessGain, rootDarken } = GRASS.tone;

    const lushTip = new Color(
        shiftColorHsl(terrain.grassColor, {
            hueShift: lushHueShift,
            saturationScale: 1 + tipLightnessGain,
            lightnessShift: tipLightnessGain,
        })
    );
    const dryTip = new Color(
        shiftColorHsl(terrain.grassColor, {
            hueShift: dryHueShift,
            saturationScale: 1 - tipLightnessGain,
            lightnessShift: tipLightnessGain * 0.6,
        })
    );

    return {
        lushTipColor: { value: lushTip },
        lushRootColor: { value: lushTip.clone().multiplyScalar(rootDarken) },
        dryTipColor: { value: dryTip },
        dryRootColor: { value: dryTip.clone().multiplyScalar(rootDarken) },
        ...coverLightUniforms(lighting, GRASS.light),
        baseOcclusion: { value: GRASS.light.baseOcclusion },
        tipSheen: { value: GRASS.light.tipSheen },
    };
}

function buildFlowerCluster(subdivisions: number): IGroundCoverCluster {
    const petalCount = Math.max(3, Math.round((FLOWER_PATCHES.petalsPerBloom * subdivisions) / 2));
    const stemHeight = (FLOWER_PATCHES.stemHeightRange[0] + FLOWER_PATCHES.stemHeightRange[1]) / 2;

    const vertexCount = 4 + petalCount * 4;
    const triangleCount = 2 + petalCount * 2;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const partKinds = new Float32Array(vertexCount);
    const swayWeights = new Float32Array(vertexCount);
    const indices = new Uint16Array(triangleCount * 3);

    const stemHalfWidth = FLOWER_PATCHES.petalWidth * 0.18;
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

        const halfWidth = FLOWER_PATCHES.petalWidth / 2;
        const tipX = outwardX * FLOWER_PATCHES.petalLength;
        const tipZ = outwardZ * FLOWER_PATCHES.petalLength;
        const tipY = stemHeight + FLOWER_PATCHES.petalLength * FLOWER_PATCHES.petalRise;

        const petalFirstVertex = vertex;
        pushVertex(
            -sideX * halfWidth * 0.35,
            stemHeight,
            -sideZ * halfWidth * 0.35,
            outwardX,
            FLOWER_PATCHES.petalRise,
            outwardZ,
            PETAL_PART,
            0
        );
        pushVertex(
            sideX * halfWidth * 0.35,
            stemHeight,
            sideZ * halfWidth * 0.35,
            outwardX,
            FLOWER_PATCHES.petalRise,
            outwardZ,
            PETAL_PART,
            0
        );
        pushVertex(
            tipX + sideX * halfWidth,
            tipY,
            tipZ + sideZ * halfWidth,
            outwardX,
            FLOWER_PATCHES.petalRise,
            outwardZ,
            PETAL_PART,
            1
        );
        pushVertex(
            tipX - sideX * halfWidth,
            tipY,
            tipZ - sideZ * halfWidth,
            outwardX,
            FLOWER_PATCHES.petalRise,
            outwardZ,
            PETAL_PART,
            1
        );
        pushQuad(petalFirstVertex);
    }

    return {
        attributes: [
            ["position", positions, 3],
            ["normal", normals, 3],
            ["partKind", partKinds, 1],
            ["swayWeight", swayWeights, 1],
        ],
        indices,
    };
}

function flowerShapeUniforms() {
    return {
        cellSpacing: { value: FLOWER_PATCHES.cellSpacing },
        scaleRange: { value: new Vector2(...FLOWER_PATCHES.scaleRange) },
        coverage: { value: FLOWER_PATCHES.coverage },
        swayStrength: { value: FLOWER_PATCHES.swayStrength },
        tipLightnessGain: { value: FLOWER_PATCHES.tone.tipLightnessGain },
        throatDarken: { value: FLOWER_PATCHES.tone.throatDarken },
    };
}

function flowerPaletteUniforms(context: IWorldContext) {
    const { terrain, lighting, sky } = context.environment;
    const { speciesHueSpread, stemHueShift, stemLightnessShift } = FLOWER_PATCHES.tone;

    return {
        speciesColorA: { value: new Color(sky.glow) },
        speciesColorB: {
            value: new Color(
                shiftColorHsl(sky.glow, {
                    hueShift: speciesHueSpread,
                    saturationScale: 1.05,
                    lightnessShift: -0.04,
                })
            ),
        },
        speciesColorC: {
            value: new Color(
                shiftColorHsl(sky.glow, {
                    hueShift: -speciesHueSpread,
                    saturationScale: 1.1,
                    lightnessShift: -0.08,
                })
            ),
        },
        stemColor: {
            value: new Color(
                shiftColorHsl(terrain.grassColor, {
                    hueShift: stemHueShift,
                    saturationScale: 1,
                    lightnessShift: stemLightnessShift,
                })
            ),
        },
        ...coverLightUniforms(lighting, FLOWER_PATCHES.light),
    };
}
