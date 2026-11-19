import { backLightPatch } from "@/shaders/materialPatches";
import {
    Color,
    DoubleSide,
    MeshStandardMaterial,
    ShaderMaterial,
    Vector2,
    type IUniform,
} from "three";
import type { IGroundSurface, IShaderPatch, IWorldContext } from "@/types/world";
import type { CoverAffinity, IThemeGroundCover } from "@/types/themes";
import { FLOWER_PATCHES, GRASS, GROUND_COVER } from "@/constants/placement";
import { SCALE, STYLE } from "@/constants/world";
import { FULL_TURN, createSeededRandom, shiftedColor } from "@/lib/helpers";
import { MaterialLibrary } from "@/world/assets/MaterialLibrary";
import {
    COVER_BAKE_GLSL,
    COVER_BAKE_MAIN,
    COVER_BAKE_VERTEX_SHADER,
    COVER_VERTEX_GLSL,
    FLOWER_SHADERS,
    GRASS_SHADERS,
} from "@/shaders/groundCover";
import type { ICoverShaderSet } from "@/shaders/groundCover";

export interface ICoverBand {
    innerRadius: number;
    outerRadius: number;
    detail: number;
    drawnShare: number;
}

interface ICoverThinning {
    reach: number;
    fullReach: number;
    falloff: number;
    floorShare: number;
    fadeStart: number;
    rankFadeWidth: number;
    bandShareRatio: number;
    detail: { near: number; far: number; reach: number };
}

interface ICoverLayout {
    bands: ICoverBand[];
    uniforms: Record<string, IUniform>;
}

interface IGroundCoverCluster {
    attributes: readonly (readonly [name: string, values: Float32Array, itemSize: number])[];
    indices: Uint16Array | Uint32Array;
}

export abstract class GroundCoverKind {
    private static coverShareAt(
        distance: number,
        { fullReach, falloff, floorShare }: ICoverThinning
    ): number {
        return Math.min(
            1,
            Math.max(floorShare, (fullReach / Math.max(distance, fullReach)) ** falloff)
        );
    }

    private static drawnShareAt(distance: number, thinning: ICoverThinning): number {
        return Math.min(
            1,
            GroundCoverKind.coverShareAt(distance, thinning) * (1 + thinning.rankFadeWidth)
        );
    }

    private static nextBandEdge(innerRadius: number, thinning: ICoverThinning): number {
        const { reach, fullReach, falloff, floorShare, rankFadeWidth, bandShareRatio, detail } =
            thinning;
        const floorReach = fullReach * floorShare ** (-1 / falloff);
        const shareEdge =
            fullReach *
            (((1 + rankFadeWidth) * bandShareRatio) /
                GroundCoverKind.drawnShareAt(innerRadius, thinning)) **
                (1 / falloff);
        const lastShareEdge =
            innerRadius >= floorReach
                ? reach
                : shareEdge * bandShareRatio ** (1 / falloff) > floorReach
                  ? floorReach
                  : shareEdge;

        return Math.min(reach, lastShareEdge, innerRadius < detail.reach ? detail.reach : reach);
    }

    abstract readonly id: string;
    abstract readonly cellSpacing: number;
    abstract readonly paintsFloor: boolean;

    protected abstract readonly thinning: ICoverThinning;
    protected abstract readonly backLight: string | null;
    protected abstract readonly shaders: ICoverShaderSet;

    abstract buildCluster(band: ICoverBand): IGroundCoverCluster;

    abstract affinityOf(groundCover: IThemeGroundCover): CoverAffinity;

    growsIn(_groundCover: IThemeGroundCover): boolean {
        return true;
    }

    abstract uniforms(
        context: IWorldContext,
        groundCover: IThemeGroundCover,
        surface: IGroundSurface
    ): Record<string, IUniform>;

    layoutAt(reachScale: number): ICoverLayout {
        const thinning: ICoverThinning = {
            ...this.thinning,
            reach: this.thinning.reach * reachScale,
            fullReach: this.thinning.fullReach * reachScale,
            fadeStart: this.thinning.fadeStart * reachScale,
            detail: { ...this.thinning.detail, reach: this.thinning.detail.reach * reachScale },
        };
        const bands: ICoverBand[] = [];

        for (let innerRadius = 0; innerRadius < thinning.reach;) {
            const outerRadius = GroundCoverKind.nextBandEdge(innerRadius, thinning);
            bands.push({
                innerRadius,
                outerRadius,
                detail:
                    innerRadius < thinning.detail.reach
                        ? thinning.detail.near
                        : thinning.detail.far,
                drawnShare: GroundCoverKind.drawnShareAt(innerRadius, thinning),
            });
            innerRadius = outerRadius;
        }

        return {
            bands,
            uniforms: {
                coverReach: { value: thinning.reach },
                coverFullReach: { value: thinning.fullReach },
                coverFalloff: { value: thinning.falloff },
                coverFloorShare: { value: thinning.floorShare },
                coverFadeStart: { value: thinning.fadeStart },
                coverRankFadeWidth: { value: thinning.rankFadeWidth },
            },
        };
    }

    createMaterial(
        materialLibrary: MaterialLibrary,
        uniforms: Record<string, IUniform>
    ): MeshStandardMaterial {
        const coverPatch: IShaderPatch = {
            uniforms,
            vertex: {
                after: { common: `${COVER_VERTEX_GLSL}\n${this.shaders.vertex.declarations}` },
                replace: { beginnormal_vertex: this.shaders.vertex.body, begin_vertex: "" },
            },
            fragment: {
                after: { common: this.shaders.fragment.declarations },
                replace: { color_fragment: this.shaders.fragment.body },
            },
        };

        return materialLibrary.style(
            new MeshStandardMaterial({
                side: DoubleSide,
                roughness: GROUND_COVER.plantRoughness,
                metalness: STYLE.metalness,
            }),
            this.id,
            {
                role: "groundCover",
                patches: this.backLight
                    ? [coverPatch, backLightPatch(this.backLight)]
                    : [coverPatch],
            }
        );
    }

    createBakeMaterial(uniforms: Record<string, IUniform>): ShaderMaterial {
        return new ShaderMaterial({
            vertexShader: COVER_BAKE_VERTEX_SHADER,
            fragmentShader: `${COVER_BAKE_GLSL}\n${this.shaders.bake}\n${COVER_BAKE_MAIN}`,
            uniforms,
            depthTest: false,
            depthWrite: false,
        });
    }
}

class GrassKind extends GroundCoverKind {
    private static readonly BLADE_SEED = 99;

    private static readonly RANDOMS_PER_BLADE = 8;

    readonly id = "grass-field";
    readonly cellSpacing = GRASS.shape.patchSpan;
    readonly paintsFloor = true;

    protected readonly thinning = GRASS.thinning;
    protected readonly backLight = "vBladeHeight";
    protected readonly shaders = GRASS_SHADERS;

    buildCluster({ detail: segments, drawnShare }: ICoverBand): IGroundCoverCluster {
        const { RANDOMS_PER_BLADE } = GrassKind;
        const patchArea = (GRASS.shape.patchSpan / SCALE.unitsPerMetre) ** 2;
        const fullBladeCount = Math.round(GRASS.shape.bladesPerSquareMetre * patchArea);
        const bladeCount = Math.ceil(fullBladeCount * drawnShare);
        const verticesPerBlade = segments * 2 + 1;
        const totalVertices = bladeCount * verticesPerBlade;
        const indicesPerBlade = ((segments - 1) * 2 + 1) * 3;

        const positions = new Float32Array(totalVertices * 3);
        const normals = new Float32Array(totalVertices * 3);
        const bladeData = new Float32Array(totalVertices * 4);
        const bladeTraits = new Float32Array(totalVertices * 4);
        const bladeRanks = new Float32Array(totalVertices);
        const indices =
            totalVertices > 65535
                ? new Uint32Array(bladeCount * indicesPerBlade)
                : new Uint16Array(bladeCount * indicesPerBlade);
        const nextRandom = createSeededRandom(GrassKind.BLADE_SEED);
        const bladeRandoms = new Float32Array(RANDOMS_PER_BLADE);
        const bladeDataRandoms = bladeRandoms.subarray(0, 4);
        const bladeTraitRandoms = bladeRandoms.subarray(4);
        const halfWidth = 0.5;

        for (let bladeNumber = 0; bladeNumber < bladeCount; bladeNumber += 1) {
            const firstVertex = bladeNumber * verticesPerBlade;
            for (let draw = 0; draw < RANDOMS_PER_BLADE; draw += 1)
                bladeRandoms[draw] = nextRandom();
            bladeRanks.fill(
                (bladeNumber + 0.5) / fullBladeCount,
                firstVertex,
                firstVertex + verticesPerBlade
            );

            for (let vertex = 0; vertex < verticesPerBlade; vertex += 1) {
                const row = Math.floor(vertex / 2);
                const isTip = vertex === verticesPerBlade - 1;
                const position = (firstVertex + vertex) * 3;
                positions[position] = isTip ? 0 : vertex % 2 === 0 ? -halfWidth : halfWidth;
                positions[position + 1] = isTip ? 1 : row / segments;
                normals[position + 1] = 1;
                bladeData.set(bladeDataRandoms, (firstVertex + vertex) * 4);
                bladeTraits.set(bladeTraitRandoms, (firstVertex + vertex) * 4);
            }

            const firstIndex = bladeNumber * indicesPerBlade;
            for (let row = 0; row < segments - 1; row += 1) {
                const leftEdge = firstVertex + row * 2;
                const at = firstIndex + row * 6;
                indices[at] = leftEdge;
                indices[at + 1] = leftEdge + 1;
                indices[at + 2] = leftEdge + 3;
                indices[at + 3] = leftEdge;
                indices[at + 4] = leftEdge + 3;
                indices[at + 5] = leftEdge + 2;
            }
            const topLeftEdge = firstVertex + (segments - 1) * 2;
            const topAt = firstIndex + indicesPerBlade - 3;
            indices[topAt] = topLeftEdge;
            indices[topAt + 1] = topLeftEdge + 1;
            indices[topAt + 2] = firstVertex + verticesPerBlade - 1;
        }

        return {
            attributes: [
                ["position", positions, 3],
                ["bladeData", bladeData, 4],
                ["bladeTraits", bladeTraits, 4],
                ["bladeRank", bladeRanks, 1],
                ["normal", normals, 3],
            ],
            indices,
        };
    }

    affinityOf(groundCover: IThemeGroundCover): CoverAffinity {
        return groundCover.grass;
    }

    uniforms(
        _context: IWorldContext,
        _groundCover: IThemeGroundCover,
        surface: IGroundSurface
    ): Record<string, IUniform> {
        const { shape, coverage, wind, tone, light, tufts } = GRASS;

        return {
            clumpWavelength: { value: coverage.clumpWavelength },
            dryPatchWavelength: { value: coverage.dryPatchWavelength },
            dryPatchBand: { value: new Vector2(...coverage.dryPatchBand) },
            patchContrast: { value: coverage.patchContrast },
            bedThinning: { value: coverage.bedThinning },
            patchFullBand: { value: new Vector2(...coverage.patchFullBand) },
            bladeHeightRange: { value: new Vector2(...shape.bladeHeightRange) },
            bladeWidth: { value: shape.bladeWidth },
            bladeSink: { value: shape.bladeSink },
            bladeTaper: { value: shape.bladeTaper },
            widthJitter: { value: new Vector2(...shape.widthJitter) },
            bladeLean: { value: shape.lean },
            bladeLeanBase: { value: shape.leanBase },
            bendRiseLoss: { value: shape.bendRiseLoss },
            tallBoost: { value: shape.tallBoost },
            viewFacing: { value: shape.viewFacing },
            maxWidthGain: { value: shape.maxWidthGain },
            heightSkew: { value: shape.heightSkew },
            tallShare: { value: shape.tallShare },
            tallStretch: { value: shape.tallStretch },
            stalkShare: { value: shape.stalks.share },
            stalkStretch: { value: shape.stalks.stretch },
            bladeRoundness: { value: shape.roundness },
            coverageHeight: { value: new Vector2(...coverage.heightRange) },
            clumpKeep: { value: new Vector2(...coverage.clumpKeep) },
            clumpHeight: { value: new Vector2(...coverage.clumpHeight) },
            windSwayGain: { value: wind.swayGain },
            windRestShare: { value: wind.restShare },
            gustBand: { value: new Vector2(...wind.gustBand) },
            ...surface.coverFloor.meadow,
            tuftCellSize: { value: tufts.cellSize },
            tuftReach: { value: tufts.reach },
            tuftHeight: { value: new Vector2(...tufts.heightRange) },
            tuftLean: { value: tufts.lean },
            tuftToneShift: { value: tufts.toneShift },
            dryAmount: { value: tone.dryAmount },
            dryPatchGain: { value: tone.dryPatchGain },
            tipJitter: { value: new Vector2(...tone.tipJitter) },
            gustBright: { value: tone.gustBright },
            normalUpBlend: { value: light.normalUpBlend },
            sideTilt: { value: light.sideTilt },
        };
    }
}

class FlowerKind extends GroundCoverKind {
    private static readonly STEM_PART = 0;

    private static readonly PETAL_PART = 1;

    readonly id = "flower-field";
    readonly cellSpacing = FLOWER_PATCHES.cellSpacing;
    readonly paintsFloor = false;

    protected readonly thinning = FLOWER_PATCHES.thinning;
    protected readonly backLight = null;
    protected readonly shaders = FLOWER_SHADERS;

    buildCluster({ detail: petalCount }: ICoverBand): IGroundCoverCluster {
        const { STEM_PART, PETAL_PART } = FlowerKind;
        const {
            stemHeightRange,
            petalWidth,
            petalLength,
            petalRise,
            stemWidthShare,
            throatWidthShare,
        } = FLOWER_PATCHES;
        const stemHeight = (stemHeightRange[0] + stemHeightRange[1]) / 2;
        const vertexCount = 4 + petalCount * 4;

        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const partKinds = new Float32Array(vertexCount);
        const swayWeights = new Float32Array(vertexCount);
        const indices = new Uint16Array((2 + petalCount * 2) * 3);

        let vertex = 0;
        let index = 0;

        const pushQuad = (
            corners: readonly (readonly [x: number, y: number, z: number, swayWeight: number])[],
            normal: readonly [number, number, number],
            partKind: number
        ) => {
            indices[index] = vertex;
            indices[index + 1] = vertex + 1;
            indices[index + 2] = vertex + 2;
            indices[index + 3] = vertex;
            indices[index + 4] = vertex + 2;
            indices[index + 5] = vertex + 3;
            index += 6;
            for (const [x, y, z, swayWeight] of corners) {
                const offset = vertex * 3;
                positions[offset] = x;
                positions[offset + 1] = y;
                positions[offset + 2] = z;
                normals.set(normal, offset);
                partKinds[vertex] = partKind;
                swayWeights[vertex] = swayWeight;
                vertex += 1;
            }
        };

        const stemHalfWidth = petalWidth * stemWidthShare;
        pushQuad(
            [
                [-stemHalfWidth, 0, 0, 0],
                [stemHalfWidth, 0, 0, 0],
                [stemHalfWidth, stemHeight, 0, 1],
                [-stemHalfWidth, stemHeight, 0, 1],
            ],
            [0, 0, 1],
            STEM_PART
        );

        const halfWidth = petalWidth / 2;
        const throatHalfWidth = halfWidth * throatWidthShare;
        const tipY = stemHeight + petalLength * petalRise;
        for (let petal = 0; petal < petalCount; petal += 1) {
            const petalYaw = (petal / petalCount) * FULL_TURN;
            const outwardX = Math.sin(petalYaw);
            const outwardZ = Math.cos(petalYaw);
            const tipX = outwardX * petalLength;
            const tipZ = outwardZ * petalLength;

            pushQuad(
                [
                    [-outwardZ * throatHalfWidth, stemHeight, outwardX * throatHalfWidth, 0],
                    [outwardZ * throatHalfWidth, stemHeight, -outwardX * throatHalfWidth, 0],
                    [tipX + outwardZ * halfWidth, tipY, tipZ - outwardX * halfWidth, 1],
                    [tipX - outwardZ * halfWidth, tipY, tipZ + outwardX * halfWidth, 1],
                ],
                [outwardX, petalRise, outwardZ],
                PETAL_PART
            );
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

    affinityOf(groundCover: IThemeGroundCover): CoverAffinity {
        return groundCover.flowers.affinity;
    }

    override growsIn(groundCover: IThemeGroundCover): boolean {
        return groundCover.flowers.coverage > 0;
    }

    uniforms(context: IWorldContext, { flowers }: IThemeGroundCover): Record<string, IUniform> {
        const { tone } = FLOWER_PATCHES;

        return {
            coverage: { value: flowers.coverage },
            bloomCoverBand: { value: new Vector2(...FLOWER_PATCHES.patch.coverBand) },
            scaleRange: { value: new Vector2(...FLOWER_PATCHES.scaleRange) },
            swayStrength: { value: FLOWER_PATCHES.swayStrength },
            speciesColors: { value: flowers.palette.map((hex) => new Color(hex)) },
            stemColor: {
                value: shiftedColor(context.environment.terrain.grassColor, {
                    hueShift: tone.stemHueShift,
                    saturationScale: 1,
                    lightnessShift: tone.stemLightnessShift,
                }),
            },
            tipLightnessGain: { value: tone.tipLightnessGain },
            throatDarken: { value: tone.throatDarken },
        };
    }
}

export const GROUND_COVER_KINDS = {
    grass: new GrassKind(),
    flowers: new FlowerKind(),
} satisfies Record<string, GroundCoverKind>;
