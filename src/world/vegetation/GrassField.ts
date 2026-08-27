import {
    Camera,
    Color,
    DataTexture,
    DoubleSide,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    Sphere,
    Vector2,
    Vector3,
    type Vector3Tuple,
} from "three";
import { Entity } from "@/entities/Entity";
import { sunDirectionOf } from "@/themes/ThemeManifests";
import type { IWorldContext, IWorldEntity } from "@/types/world";
import type { TerrainHeightMap } from "@/world/terrain/TerrainHeightMap";
import { GRASS } from "@/constants/placement";
import { clamp } from "@/lib/helpers";

const VERTEX_SHADER = /* glsl */ `
    uniform sampler2D terrainField;
    uniform vec2 fieldOrigin;
    uniform float fieldSpan;
    uniform vec2 cameraGround;
    uniform float time;
    uniform float cellSize;
    uniform float grassRadius;
    uniform float ringFadeInFrom;
    uniform float ringFadeOutTo;
    uniform float crossfadeWidth;
    uniform float sizeGainAtHorizon;
    uniform float corridorReject;
    uniform vec2 bladeHeightRange;
    uniform float bladeWidth;
    uniform vec2 leanRange;
    uniform vec2 curlRange;
    uniform vec2 tintRange;
    uniform float windStrength;
    uniform float windFrequency;
    uniform float windScale;
    uniform float windGustScale;
    uniform float fadeStart;
    uniform float fadeEnd;
    uniform vec3 sunDirection;
    uniform float sunWrap;

    attribute vec2 cellOffset;

    varying float vHeightRatio;
    varying float vTint;
    varying float vLight;

    float hashCell(vec2 cell, float salt) {
        return fract(sin(dot(cell, vec2(127.1, 311.7)) + salt) * 43758.5453);
    }

    void main() {
        vec2 anchorCell = floor(cameraGround / cellSize + 0.5);
        vec2 worldCell = anchorCell + cellOffset;

        float jitterX = hashCell(worldCell, 0.0);
        float jitterZ = hashCell(worldCell, 4.7);
        vec2 rootGround = (worldCell + vec2(jitterX, jitterZ) - 0.5) * cellSize;

        vec2 fieldUv = (rootGround - fieldOrigin) / fieldSpan;
        vec2 field = texture2D(terrainField, fieldUv).rg;

        float insideField = step(0.0, fieldUv.x) * step(fieldUv.x, 1.0)
            * step(0.0, fieldUv.y) * step(fieldUv.y, 1.0);
        float clearOfCorridor = 1.0 - step(corridorReject, field.g);

        float distanceToCamera = length(rootGround - cameraGround);
        float distanceFade = 1.0 - smoothstep(fadeStart, fadeEnd, distanceToCamera);

        float ringWeight = min(
            smoothstep(ringFadeInFrom, ringFadeInFrom + crossfadeWidth, distanceToCamera),
            1.0 - smoothstep(ringFadeOutTo - crossfadeWidth, ringFadeOutTo, distanceToCamera)
        );
        float withinRing = step(hashCell(worldCell, 51.3), ringWeight);

        float visibility = insideField * clearOfCorridor * distanceFade * withinRing;
        float sizeGain = mix(1.0, sizeGainAtHorizon, distanceToCamera / grassRadius);

        float heightPick = hashCell(worldCell, 9.1);
        float bladeHeight = mix(bladeHeightRange.x, bladeHeightRange.y, heightPick)
            * sizeGain * visibility;

        vHeightRatio = uv.y;
        vTint = mix(tintRange.x, tintRange.y, hashCell(worldCell, 13.3));

        float flexibility = vHeightRatio * vHeightRatio;
        float lean = mix(leanRange.x, leanRange.y, hashCell(worldCell, 21.5));
        float curl = mix(curlRange.x, curlRange.y, hashCell(worldCell, 27.9));
        float yaw = hashCell(worldCell, 33.1) * 6.2831853;
        float leanBearing = hashCell(worldCell, 41.7) * 6.2831853;

        float gust = sin(
            time * windFrequency
                + (rootGround.x + rootGround.y) * windScale
                + sin(time * 0.31 + rootGround.x * windGustScale)
        );

        vec3 blade = vec3(
            position.x * bladeWidth * sizeGain + gust * windStrength * flexibility,
            position.y * bladeHeight,
            curl * flexibility
        );

        blade.x += sin(leanBearing) * lean * flexibility * bladeHeight;
        blade.z += cos(leanBearing) * lean * flexibility * bladeHeight;

        float yawSin = sin(yaw);
        float yawCos = cos(yaw);
        vec3 facing = vec3(yawSin, 0.0, yawCos);

        vec3 rootWorld = vec3(
            rootGround.x + blade.x * yawCos + blade.z * yawSin,
            field.r + blade.y,
            rootGround.y - blade.x * yawSin + blade.z * yawCos
        );

        vLight = mix(sunWrap, 1.0, max(dot(facing, sunDirection), 0.0));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(rootWorld, 1.0);
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

const cameraWorldPosition = new Vector3();

export class GrassField extends Entity implements IWorldEntity {
    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly cameraGround = new Vector2();
    private readonly materialsByRing: ShaderMaterial[] = [];
    private readonly geometriesByRing: InstancedBufferGeometry[] = [];
    private readonly fieldTexture: DataTexture;

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

        const palette = derivePalette(context);
        const grassRadius = lastRingRadius();
        const boundingSphere = new Sphere(new Vector3(), grassRadius * 2);

        let previousOuterRadius = 0;

        for (const [ringIndex, ring] of GRASS.rings.entries()) {
            const band = ringBandFor(ringIndex, ring, previousOuterRadius, grassRadius);
            const geometry = buildRingGeometry(ring, band);
            const material = buildRingMaterial(ring, band, palette, this.fieldTexture, heightMap);

            const mesh = new Mesh(geometry, material);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            geometry.boundingSphere = boundingSphere;

            this.geometriesByRing.push(geometry);
            this.materialsByRing.push(material);
            this.sceneObject.add(mesh);

            previousOuterRadius = ring.outerRadius;
        }
    }

    update(deltaSeconds: number): void {
        this.camera.getWorldPosition(cameraWorldPosition);
        this.cameraGround.set(
            cameraWorldPosition.x - this.sceneObject.position.x,
            cameraWorldPosition.z - this.sceneObject.position.z
        );

        for (const material of this.materialsByRing) {
            material.uniforms.time!.value += deltaSeconds;
            material.uniforms.cameraGround!.value.copy(this.cameraGround);
        }
    }

    dispose(): void {
        for (const geometry of this.geometriesByRing) geometry.dispose();
        for (const material of this.materialsByRing) material.dispose();

        this.geometriesByRing.length = 0;
        this.materialsByRing.length = 0;
        this.fieldTexture.dispose();
        this.sceneObject.clear();
    }
}

function ringBandFor(
    ringIndex: number,
    ring: IGrassRing,
    previousOuterRadius: number,
    grassRadius: number
): IRingBand {
    const isInnermost = ringIndex === 0;
    const isOutermost = ringIndex === GRASS.rings.length - 1;
    const overlap = GRASS.ringCrossfadeWidth;

    return {
        grassRadius,
        fadeInFrom: isInnermost ? -overlap : previousOuterRadius - overlap,
        fadeOutTo: isOutermost ? grassRadius + overlap : ring.outerRadius,
        cellsInnerRadius: isInnermost ? 0 : previousOuterRadius - overlap,
        cellsOuterRadius: ring.outerRadius,
    };
}

function buildRingGeometry(ring: IGrassRing, band: IRingBand): InstancedBufferGeometry {
    const geometry = new InstancedBufferGeometry();
    const blade = buildBladeGeometry(ring.segments);

    geometry.index = blade.index;
    geometry.setAttribute("position", blade.getAttribute("position"));
    geometry.setAttribute("uv", blade.getAttribute("uv"));

    const cells = collectRingCells(ring, band);
    geometry.setAttribute("cellOffset", new InstancedBufferAttribute(cells, 2));
    geometry.instanceCount = cells.length / 2;

    return geometry;
}

function collectRingCells(ring: IGrassRing, band: IRingBand): Float32Array {
    const reach = Math.ceil(band.cellsOuterRadius / ring.cellSize);
    const innerCells = band.cellsInnerRadius / ring.cellSize;
    const outerCells = band.cellsOuterRadius / ring.cellSize;
    const innerCellsSquared = innerCells * innerCells;
    const outerCellsSquared = outerCells * outerCells;

    const cells: number[] = [];

    for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1) {
        for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
            const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

            if (distanceSquared > outerCellsSquared) continue;
            if (distanceSquared < innerCellsSquared) continue;

            cells.push(offsetX, offsetZ);
        }
    }

    return new Float32Array(cells);
}

function buildBladeGeometry(segments: number): PlaneGeometry {
    const geometry = new PlaneGeometry(1, 1, 1, segments);
    geometry.translate(0, 0.5, 0);

    const positions = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");

    for (let index = 0; index < positions.count; index += 1)
        positions.setX(
            index,
            positions.getX(index) * Math.pow(1 - uv.getY(index), GRASS.bladeTaperExponent)
        );

    positions.needsUpdate = true;
    geometry.deleteAttribute("normal");

    return geometry;
}

function buildRingMaterial(
    ring: IGrassRing,
    band: IRingBand,
    palette: IGrassPalette,
    fieldTexture: DataTexture,
    heightMap: TerrainHeightMap
): ShaderMaterial {
    return new ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: DoubleSide,
        uniforms: {
            terrainField: { value: fieldTexture },
            fieldOrigin: { value: new Vector2(heightMap.originX, heightMap.originZ) },
            fieldSpan: { value: heightMap.span },
            cameraGround: { value: new Vector2() },
            time: { value: 0 },
            cellSize: { value: ring.cellSize },
            grassRadius: { value: band.grassRadius },
            ringFadeInFrom: { value: band.fadeInFrom },
            ringFadeOutTo: { value: band.fadeOutTo },
            crossfadeWidth: { value: GRASS.ringCrossfadeWidth },
            sizeGainAtHorizon: { value: GRASS.bladeSizeGainAtHorizon },
            corridorReject: { value: GRASS.corridorRejectThreshold },
            bladeHeightRange: { value: new Vector2(...GRASS.bladeHeightRange) },
            bladeWidth: { value: GRASS.bladeWidth },
            leanRange: { value: new Vector2(...GRASS.leanRange) },
            curlRange: { value: new Vector2(...GRASS.curlRange) },
            tintRange: { value: new Vector2(...GRASS.tintRange) },
            windStrength: { value: GRASS.windStrength },
            windFrequency: { value: GRASS.windFrequency },
            windScale: { value: GRASS.windScale },
            windGustScale: { value: GRASS.windGustScale },
            fadeStart: { value: band.grassRadius * GRASS.fadeStartRatio },
            fadeEnd: { value: band.grassRadius },
            sunDirection: { value: palette.sunDirection },
            sunWrap: { value: GRASS.sunWrap },
            rootColor: { value: palette.root },
            tipColor: { value: palette.tip },
            sunColor: { value: palette.sun },
            ambientColor: { value: palette.ambient },
        },
    });
}

function derivePalette(context: IWorldContext): IGrassPalette {
    const { terrain, lighting, sky } = context.environment;
    const wildColor = new Color(terrain.wildColor);
    const wildHsl = { h: 0, s: 0, l: 0 };
    wildColor.getHSL(wildHsl);

    return {
        root: wildColor.clone().multiplyScalar(GRASS.rootDarken),
        tip: new Color().setHSL(
            (((wildHsl.h + GRASS.tipHueShift) % 1) + 1) % 1,
            wildHsl.s,
            clamp(wildHsl.l + GRASS.tipLightnessGain, 0, 1)
        ),
        sun: new Color(lighting.keyColor).multiplyScalar(lighting.keyIntensity * GRASS.sunGain),
        ambient: new Color(lighting.skyFill).multiplyScalar(
            lighting.hemisphereIntensity * GRASS.ambientGain
        ),
        sunDirection: sunDirectionOf(sky),
    };
}

function lastRingRadius(): number {
    return GRASS.rings[GRASS.rings.length - 1]?.outerRadius ?? 0;
}

interface IGrassRing {
    outerRadius: number;
    cellSize: number;
    segments: number;
}

interface IRingBand {
    grassRadius: number;
    fadeInFrom: number;
    fadeOutTo: number;
    cellsInnerRadius: number;
    cellsOuterRadius: number;
}

interface IGrassPalette {
    root: Color;
    tip: Color;
    sun: Color;
    ambient: Color;
    sunDirection: Vector3;
}
