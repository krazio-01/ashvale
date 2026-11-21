import {
    BufferAttribute,
    Camera,
    DataTexture,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    MeshStandardMaterial,
    Vector2,
    Vector3,
    WebGLRenderTarget,
    type IUniform,
    type Vector3Tuple,
    type WebGLRenderer,
} from "three";
import type { IGroundSurface, IWorldContext, IWorldEntity } from "@/types/world";
import type { CoverAffinity, IThemeGroundCover } from "@/types/themes";
import type { IWorldTierValues } from "@/types/ui";
import { FLOWER_PATCHES, GROUND_COVER } from "@/constants/placement";
import { WIND } from "@/constants/world";
import { FULL_TURN, createSeededRandom, freezeTransform } from "@/lib/helpers";
import { createPassTarget, renderToTarget } from "@/lib/renderPass";
import { groundMaterialUniforms } from "@/world/terrain/TerrainMaterials";
import type { GroundCoverKind, ICoverBand } from "@/world/vegetation/GroundCoverKinds";

interface ICoverSector {
    mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
    facing: number;
    reach: number | null;
}

export class GroundCoverField implements IWorldEntity {
    private static readonly ALWAYS_BAND = new Vector3(-1, 0, 0);

    private static sectorFacing(sector: number): number {
        return ((sector + 0.5) / GROUND_COVER.sectorCount) * FULL_TURN - Math.PI;
    }

    private static angleBetween(first: number, second: number): number {
        const gap = Math.abs(first - second) % FULL_TURN;

        return Math.min(gap, FULL_TURN - gap);
    }

    private static collectSectorCells(band: ICoverBand, cellSpacing: number): number[][] {
        const { cellOverlap } = GROUND_COVER;
        const reach = Math.ceil(band.outerRadius / cellSpacing + cellOverlap);
        const innerCellsSquared = Math.max(band.innerRadius / cellSpacing - cellOverlap, 0) ** 2;
        const outerCellsSquared = (band.outerRadius / cellSpacing + cellOverlap) ** 2;
        const sectorCount = band.innerRadius > 0 ? GROUND_COVER.sectorCount : 1;
        const sectors: number[][] = Array.from({ length: sectorCount }, () => []);

        for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1)
            for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
                const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

                if (distanceSquared >= outerCellsSquared || distanceSquared < innerCellsSquared)
                    continue;

                if (sectorCount === 1) {
                    sectors[0].push(offsetX, offsetZ);
                    continue;
                }
                const turn = (Math.atan2(offsetZ, offsetX) + Math.PI) / FULL_TURN;
                const sector = Math.min(Math.floor(turn * sectorCount), sectorCount - 1);
                sectors[sector].push(offsetX, offsetZ);
            }

        return sectors;
    }

    private static affinityUniforms(affinity: CoverAffinity) {
        const bandOf = (band: CoverAffinity[keyof CoverAffinity]) =>
            band ? new Vector3(band[0], band[1], band[2] ?? 0) : GroundCoverField.ALWAYS_BAND;

        return {
            forestBand: { value: bandOf(affinity.forest) },
            clearingBand: { value: bandOf(affinity.clearing) },
            wetnessBand: { value: bandOf(affinity.wetness) },
        };
    }

    private static fieldUniforms(surface: IGroundSurface, seed: number) {
        const { landMap } = surface;
        const nextRandom = createSeededRandom(seed);

        return {
            terrainField: { value: surface.fieldTexture },
            fieldOrigin: { value: new Vector2(landMap.originX, landMap.originZ) },
            fieldCellSize: { value: landMap.cellSize },
            fieldPointsPerSide: { value: landMap.pointsPerSide },
            coverMapOrigin: { value: new Vector2(landMap.originX, landMap.originZ) },
            coverMapSpan: { value: landMap.fieldSpan },
            coverSeed: {
                value: new Vector2(
                    Math.floor(nextRandom() * GROUND_COVER.seedSpan),
                    Math.floor(nextRandom() * GROUND_COVER.seedSpan)
                ),
            },
        };
    }

    private static bakeUniforms(surface: IGroundSurface, coverTexture: DataTexture) {
        const { landMap } = surface;

        return {
            coverField: { value: coverTexture },
            coverPointsPerSide: { value: coverTexture.image.width },
            coverSubdivisions: { value: GROUND_COVER.coverTextureSubdivisions },
            coverWarpWavelengths: { value: new Vector2(...GROUND_COVER.coverWarpWavelengths) },
            coverWarpReach: { value: GROUND_COVER.coverWarpReach },
            trailEdgeJitter: { value: GROUND_COVER.trailEdgeJitter },
            footprintJitter: { value: GROUND_COVER.footprintJitter },
            patchSpacing: { value: FLOWER_PATCHES.patch.spacing },
            patchRadiusRange: { value: new Vector2(...FLOWER_PATCHES.patch.radiusRange) },
            patchChance: { value: FLOWER_PATCHES.patch.chance },
            patchCoreRatio: { value: FLOWER_PATCHES.patch.coreRatio },
            patchEdgeWavelength: { value: FLOWER_PATCHES.patch.edgeWavelength },
            patchEdgeStrength: { value: FLOWER_PATCHES.patch.edgeStrength },
            steepGroundBand: { value: new Vector2(...GROUND_COVER.steepGroundBand) },
            fullCoverBand: { value: new Vector2(...GROUND_COVER.coverFullBand) },
            coverTrailBand: { value: new Vector2(...GROUND_COVER.coverTrailBand) },
            growthStopBand: { value: new Vector2(...landMap.growthStopBand) },
            ...groundMaterialUniforms(surface.groundSplat, surface.groundDetail, surface.materials),
        };
    }

    private static bakeCoverMap(
        renderer: WebGLRenderer,
        kind: GroundCoverKind,
        uniforms: Record<string, IUniform>,
        mapSpan: number
    ): WebGLRenderTarget {
        const side = Math.min(
            Math.ceil(mapSpan / GROUND_COVER.mapTexelSize),
            GROUND_COVER.mapMaxSide,
            renderer.capabilities.maxTextureSize
        );
        const target = createPassTarget(side);
        const material = kind.createBakeMaterial(uniforms);

        renderToTarget(renderer, material, target);
        material.dispose();

        return target;
    }

    readonly sceneObject = new Group();

    private readonly camera: Camera;
    private readonly context: IWorldContext;
    private readonly cameraGround: IUniform<Vector2>;
    private readonly coverMaps: WebGLRenderTarget[] = [];
    private readonly materials: MeshStandardMaterial[] = [];
    private readonly sectors: ICoverSector[] = [];

    constructor(
        kinds: readonly GroundCoverKind[],
        context: IWorldContext,
        camera: Camera,
        center: Vector3Tuple,
        surface: IGroundSurface,
        groundCover: IThemeGroundCover,
        tier: IWorldTierValues,
        seed: number
    ) {
        this.camera = camera;
        this.context = context;
        this.sceneObject.position.set(center[0], 0, center[2]);
        freezeTransform(this.sceneObject);

        this.cameraGround = { value: new Vector2() };
        const fieldUniforms = GroundCoverField.fieldUniforms(surface, seed);
        const sharedUniforms = {
            cameraGround: this.cameraGround,
            windSway: { value: WIND.sway * groundCover.windStrength },
            windFlutter: { value: WIND.flutter * groundCover.windStrength },
            windStrength: { value: groundCover.windStrength },
            ...fieldUniforms,
        };

        const coverTexture = surface.landMap.createCoverTexture();
        const bakeUniforms = {
            ...fieldUniforms,
            ...GroundCoverField.bakeUniforms(surface, coverTexture),
        };

        for (const kind of kinds) {
            if (!kind.growsIn(groundCover)) continue;
            const kindUniforms = kind.uniforms(context, groundCover, surface);
            const coverMap = GroundCoverField.bakeCoverMap(
                context.renderer,
                kind,
                {
                    ...bakeUniforms,
                    ...GroundCoverField.affinityUniforms(kind.affinityOf(groundCover)),
                    ...kindUniforms,
                },
                fieldUniforms.coverMapSpan.value
            );
            this.coverMaps.push(coverMap);
            this.addKind(kind, tier, {
                ...sharedUniforms,
                ...kindUniforms,
                coverMap: { value: coverMap.texture },
            });
            if (kind.paintsFloor) surface.coverFloor.coverMap.value = coverMap.texture;
        }

        coverTexture.dispose();
    }

    syncToCamera(): void {
        const cameraElements = this.camera.matrixWorld.elements;
        this.cameraGround.value.set(
            cameraElements[12] - this.sceneObject.position.x,
            cameraElements[14] - this.sceneObject.position.z
        );

        const facing = Math.atan2(-cameraElements[10], -cameraElements[8]);
        const halfView = Math.atan(1 / this.camera.projectionMatrix.elements[0]);
        for (const { mesh, facing: sectorFacing, reach } of this.sectors)
            mesh.visible =
                reach === null ||
                GroundCoverField.angleBetween(facing, sectorFacing) <= halfView + reach;
    }

    dispose(): void {
        for (const { mesh } of this.sectors) mesh.geometry.dispose();
        for (const material of this.materials) this.context.materialLibrary.release(material);
        for (const coverMap of this.coverMaps) coverMap.dispose();

        this.sectors.length = 0;
        this.materials.length = 0;
        this.coverMaps.length = 0;
        this.sceneObject.clear();
    }

    private addKind(
        kind: GroundCoverKind,
        tier: IWorldTierValues,
        uniforms: Record<string, IUniform>
    ): void {
        const cellSpacing = kind.cellSpacing * tier.groundCoverSpacing;
        const layout = kind.layoutAt(tier.groundCoverReach);

        const material = kind.createMaterial(this.context.materialLibrary, {
            ...uniforms,
            ...layout.uniforms,
            cellSpacing: { value: cellSpacing },
        });
        this.materials.push(material);

        for (const band of layout.bands) this.addBand(kind, band, cellSpacing, material);
    }

    private addBand(
        kind: GroundCoverKind,
        band: ICoverBand,
        cellSpacing: number,
        material: MeshStandardMaterial
    ): void {
        const cluster = kind.buildCluster(band);
        const attributes = cluster.attributes.map(
            ([name, values, itemSize]): [string, BufferAttribute] => [
                name,
                new BufferAttribute(values, itemSize),
            ]
        );
        const index = new BufferAttribute(cluster.indices, 1);

        const sectorHalfSpan = Math.PI / GROUND_COVER.sectorCount;
        const reach =
            band.innerRadius > 0
                ? sectorHalfSpan +
                  Math.asin(
                      Math.min(1, (GROUND_COVER.sectorCellMargin * cellSpacing) / band.innerRadius)
                  )
                : null;

        GroundCoverField.collectSectorCells(band, cellSpacing).forEach((cells, sector) => {
            if (cells.length === 0) return;

            const instanceCount = cells.length / 2;
            const geometry = new InstancedBufferGeometry();
            for (const [name, attribute] of attributes) geometry.setAttribute(name, attribute);
            geometry.setAttribute(
                "cellOffset",
                new InstancedBufferAttribute(new Float32Array(cells), 2)
            );
            geometry.setAttribute(
                "bandRange",
                new InstancedBufferAttribute(
                    new Float32Array([band.innerRadius, band.outerRadius]),
                    2,
                    false,
                    instanceCount
                )
            );
            geometry.setIndex(index);
            geometry.instanceCount = instanceCount;

            const mesh = new Mesh(geometry, material);
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            this.sceneObject.add(mesh);
            freezeTransform(mesh);

            this.sectors.push({ mesh, facing: GroundCoverField.sectorFacing(sector), reach });
        });
    }
}
