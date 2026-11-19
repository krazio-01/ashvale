import { WATER_FRAGMENT_SHADER, WATER_VERTEX_SHADER } from "@/shaders/water";
import {
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    Mesh,
    ShaderMaterial,
    Vector3,
    Vector4,
    type Object3D,
    type Vector3Tuple,
} from "three";
import type { IWorldContext, IWorldEntity, IWaterCourse, IWaterPoint } from "@/types/world";
import type { LandMap } from "@/world/terrain/LandMap";
import { CellIndex } from "@/lib/spatialGrid";
import { shoreAllowanceAt } from "@/world/water/WaterChannel";
import { WATER_CHANNEL, WATER_SURFACE, WADING_RIPPLES } from "@/constants/world";
import {
    lerp,
    smoothstep,
    resampleSmoothPath,
    pathDirectionAt,
    freezeTransform,
    gridQuadIndices,
    horizontalDistance,
    accumulatePathLengths,
} from "@/lib/helpers";
import type { IPlanarPoint } from "@/lib/helpers";

const RIBBON_ATTRIBUTES = [
    ["position", 3],
    ["waterDepth", 1],
    ["flowDirection", 2],
    ["streamCoord", 2],
] as const;

const MAX_SMALL_INDEX_VERTEX_COUNT = 65535;

type RibbonArrays = Record<(typeof RIBBON_ATTRIBUTES)[number][0], Float32Array>;

interface IWaderTarget {
    target: Object3D;
    feetOffset: number;
}

interface IWaterRibbon {
    points: IWaterPoint[];
    columnsPerSide: number;
}

class WadingIndex {
    private readonly courseX: Float32Array;
    private readonly courseZ: Float32Array;
    private readonly courseWaterline: Float32Array;
    private readonly courseHalfWidth: Float32Array;
    private readonly courseCells: CellIndex | null;

    constructor(ribbons: readonly IWaterRibbon[]) {
        const totalSmoothedCount = ribbons.reduce(
            (total, ribbon) => total + ribbon.points.length,
            0
        );
        this.courseX = new Float32Array(totalSmoothedCount);
        this.courseZ = new Float32Array(totalSmoothedCount);
        this.courseWaterline = new Float32Array(totalSmoothedCount);
        this.courseHalfWidth = new Float32Array(totalSmoothedCount);

        let pointCursor = 0;
        let widestHalfWidth = 0;
        let smallestX = Infinity;
        let smallestZ = Infinity;
        let largestX = -Infinity;
        let largestZ = -Infinity;

        for (const { points } of ribbons) {
            for (const point of points) {
                this.courseX[pointCursor] = point.x;
                this.courseZ[pointCursor] = point.z;
                this.courseWaterline[pointCursor] = point.waterlineElevation;
                this.courseHalfWidth[pointCursor] = point.halfWidth;
                widestHalfWidth = Math.max(widestHalfWidth, this.courseHalfWidth[pointCursor]);
                smallestX = Math.min(smallestX, this.courseX[pointCursor]);
                smallestZ = Math.min(smallestZ, this.courseZ[pointCursor]);
                largestX = Math.max(largestX, this.courseX[pointCursor]);
                largestZ = Math.max(largestZ, this.courseZ[pointCursor]);
                pointCursor += 1;
            }
        }

        if (totalSmoothedCount === 0) {
            this.courseCells = null;
            return;
        }
        const boxReach = widestHalfWidth + WADING_RIPPLES.channelGrace;
        this.courseCells = new CellIndex(
            boxReach,
            { minX: smallestX, minZ: smallestZ, maxX: largestX, maxZ: largestZ },
            totalSmoothedCount,
            (point, box) => {
                box.minX = this.courseX[point] - boxReach;
                box.maxX = this.courseX[point] + boxReach;
                box.minZ = this.courseZ[point] - boxReach;
                box.maxZ = this.courseZ[point] + boxReach;
            }
        );
    }

    immersionOf(localX: number, localZ: number, feetElevation: number): number {
        const cells = this.courseCells;
        if (!cells) return 0;
        const cell = cells.cellAt(localX, localZ);
        if (cell < 0) return 0;

        let nearestDistanceSquared = Infinity;
        let nearestPoint = -1;
        const cellEnd = cells.endOf(cell);

        for (let cursor = cells.startOf(cell); cursor < cellEnd; cursor += 1) {
            const point = cells.itemAt(cursor);
            const offsetX = localX - this.courseX[point];
            const offsetZ = localZ - this.courseZ[point];
            const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;

            if (distanceSquared >= nearestDistanceSquared) continue;

            nearestDistanceSquared = distanceSquared;
            nearestPoint = point;
        }

        if (nearestPoint < 0) return 0;

        const nearestDistance = Math.sqrt(nearestDistanceSquared);
        const halfWidth = this.courseHalfWidth[nearestPoint];
        const withinChannel =
            1 - smoothstep(halfWidth, halfWidth + WADING_RIPPLES.channelGrace, nearestDistance);
        if (withinChannel <= 0) return 0;

        const standingDepth = this.courseWaterline[nearestPoint] - feetElevation;

        return (
            withinChannel *
            smoothstep(WADING_RIPPLES.immersionStart, WADING_RIPPLES.immersionDepth, standingDepth)
        );
    }
}

export class WaterSurface implements IWorldEntity {
    private static readonly scratchDirection: IPlanarPoint = { x: 0, z: 0 };

    private static buildWetIndices(
        firstVertex: number,
        pointCount: number,
        columnCount: number,
        waterDepths: Float32Array
    ): Uint32Array {
        const margin = -WATER_SURFACE.wetQuadMargin;

        return gridQuadIndices(
            pointCount - 1,
            columnCount - 1,
            (row, column) => firstVertex + row * columnCount + column,
            (nearLeft, nearRight, farLeft, farRight) => {
                const nearLeftDepth = waterDepths[nearLeft];
                const nearRightDepth = waterDepths[nearRight];
                const farLeftDepth = waterDepths[farLeft];
                const farRightDepth = waterDepths[farRight];

                if (
                    nearLeftDepth < WATER_SURFACE.bankSkipDepth ||
                    nearRightDepth < WATER_SURFACE.bankSkipDepth ||
                    farLeftDepth < WATER_SURFACE.bankSkipDepth ||
                    farRightDepth < WATER_SURFACE.bankSkipDepth
                )
                    return false;

                return (
                    nearLeftDepth > margin ||
                    nearRightDepth > margin ||
                    farLeftDepth > margin ||
                    farRightDepth > margin
                );
            }
        );
    }

    private static maximumHalfWidthOf(points: IWaterPoint[]): number {
        let widest = 0;
        for (const point of points) widest = Math.max(widest, point.halfWidth);
        return widest;
    }

    private static resampleCoursePoints(
        points: IWaterCourse["points"],
        targetStep: number
    ): IWaterPoint[] {
        return resampleSmoothPath(
            points,
            targetStep,
            (x, z, start, end, travelRatio) => ({
                x,
                z,
                waterlineElevation: lerp(
                    start.waterlineElevation,
                    end.waterlineElevation,
                    travelRatio
                ),
                halfWidth: lerp(start.halfWidth, end.halfWidth, travelRatio),
                bedRatio: lerp(start.bedRatio, end.bedRatio, travelRatio),
            }),
            (last) => ({ ...last })
        );
    }

    private static writeRibbon(
        { points, columnsPerSide }: IWaterRibbon,
        landMap: LandMap,
        arrays: RibbonArrays,
        firstVertex: number
    ): Uint32Array {
        const columnCount = columnCountOf(columnsPerSide);
        const {
            position: positions,
            waterDepth: waterDepths,
            flowDirection: flowDirections,
            streamCoord: streamCoords,
        } = arrays;
        const accumulatedDistances = new Float64Array(points.length);
        accumulatePathLengths(points, accumulatedDistances);
        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];
            const { x: downstreamX, z: downstreamZ } = pathDirectionAt(
                points,
                index,
                WaterSurface.scratchDirection
            );

            const reach = point.halfWidth + WATER_CHANNEL.shoreReach;
            const rowStart = firstVertex + index * columnCount;
            const rowInfluence = (WATER_SURFACE.headRows - index) / WATER_SURFACE.headRows;

            for (let column = 0; column < columnCount; column += 1) {
                const normalizedCross = (column - columnsPerSide) / columnsPerSide;
                const offset = normalizedCross * reach;
                let localX = point.x + downstreamZ * offset;
                let localZ = point.z - downstreamX * offset;

                if (index < WATER_SURFACE.headRows) {
                    const headCurvature =
                        (1 - normalizedCross * normalizedCross) *
                        (reach * WATER_SURFACE.headCurvatureShare);
                    localX -= downstreamX * headCurvature * rowInfluence;
                    localZ -= downstreamZ * headCurvature * rowInfluence;
                }

                const vertex = rowStart + column;

                positions[vertex * 3] = localX;
                positions[vertex * 3 + 1] = point.waterlineElevation;
                positions[vertex * 3 + 2] = localZ;

                const surfaceElevation = landMap.surfaceElevationAt(localX, localZ);
                const dropBelowWater = point.waterlineElevation - surfaceElevation;

                if (dropBelowWater > WATER_CHANNEL.bedDepth + WATER_CHANNEL.cutoffBelowBed) {
                    waterDepths[vertex] = WATER_SURFACE.outsideDepth;
                } else {
                    waterDepths[vertex] = Math.min(
                        dropBelowWater,
                        shoreAllowanceAt(Math.abs(offset), point.halfWidth)
                    );
                }
                flowDirections[vertex * 2] = downstreamX;
                flowDirections[vertex * 2 + 1] = downstreamZ;
                streamCoords[vertex * 2] = normalizedCross;
                streamCoords[vertex * 2 + 1] = accumulatedDistances[index];
            }
        }

        return WaterSurface.buildWetIndices(firstVertex, points.length, columnCount, waterDepths);
    }

    private static buildGeometry(
        ribbons: readonly IWaterRibbon[],
        landMap: LandMap
    ): BufferGeometry {
        const geometry = new BufferGeometry();
        if (ribbons.length === 0) return geometry;

        const vertexCount = ribbons.reduce((total, ribbon) => total + vertexCountOf(ribbon), 0);
        const arrays: RibbonArrays = {
            position: new Float32Array(vertexCount * 3),
            waterDepth: new Float32Array(vertexCount),
            flowDirection: new Float32Array(vertexCount * 2),
            streamCoord: new Float32Array(vertexCount * 2),
        };
        let firstVertex = 0;
        let indexCount = 0;
        const parts: Uint32Array[] = [];
        for (const ribbon of ribbons) {
            const part = WaterSurface.writeRibbon(ribbon, landMap, arrays, firstVertex);
            parts.push(part);
            indexCount += part.length;
            firstVertex += vertexCountOf(ribbon);
        }

        const usesSmallIndices = vertexCount <= MAX_SMALL_INDEX_VERTEX_COUNT;
        let indices: Uint16Array | Uint32Array = parts[0];
        if (parts.length > 1 || usesSmallIndices) {
            indices = usesSmallIndices ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
            let offset = 0;
            for (const part of parts) {
                indices.set(part, offset);
                offset += part.length;
            }
        }
        for (const [name, itemSize] of RIBBON_ATTRIBUTES)
            geometry.setAttribute(name, new BufferAttribute(arrays[name], itemSize));
        geometry.setIndex(new BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();
        return geometry;
    }

    private static surfaceUniforms(context: IWorldContext) {
        const { environment } = context;
        const { water } = environment;

        return {
            shallowColor: { value: new Color(water.shallowColor) },
            deepColor: { value: new Color(water.deepColor) },

            time: context.worldEnvironment.uniforms.time,
            depthFadeRange: { value: WATER_SURFACE.depthFadeRange },
            depthColorCurve: { value: WATER_SURFACE.depthColorCurve },
            shallowAlpha: { value: WATER_SURFACE.shallowAlpha },
            deepAlpha: { value: WATER_SURFACE.deepAlpha },
            flowSpeed: { value: WATER_SURFACE.flowSpeed },

            rippleWavelengths: { value: new Vector4(...WATER_SURFACE.rippleWavelengths) },
            rippleAmplitudes: { value: new Vector4(...WATER_SURFACE.rippleAmplitudes) },
            rippleDrifts: { value: new Vector4(...WATER_SURFACE.rippleDrifts) },

            reflectivityAtNormal: { value: WATER_SURFACE.reflectivityAtNormal },
            grazingCurve: { value: WATER_SURFACE.grazingCurve },

            shoreFoamStrength: { value: WATER_SURFACE.shoreFoamStrength },

            causticScale: { value: WATER_SURFACE.causticScale },
            causticSpeed: { value: WATER_SURFACE.causticSpeed },
            causticIntensity: { value: WATER_SURFACE.causticIntensity },

            sunSpecularShininess: { value: WATER_SURFACE.sunSpecularShininess },
            sunSpecularIntensity: { value: WATER_SURFACE.sunSpecularIntensity },

            waderPosition: { value: new Vector3() },
            waderStrength: { value: 0 },
            waderMotion: { value: 0 },
            waderRingWavelength: { value: WADING_RIPPLES.ringWavelength },
            waderRingSpeed: { value: WADING_RIPPLES.ringSpeed },
            waderRingFalloff: { value: WADING_RIPPLES.ringFalloff },
            waderRingAmplitude: { value: WADING_RIPPLES.ringAmplitude },
            waderContactFoamStrength: { value: WADING_RIPPLES.contactFoamStrength },
        };
    }

    readonly sceneObject: Mesh;

    private readonly material: ShaderMaterial;
    private readonly centerX: number;
    private readonly centerZ: number;
    private readonly wadingIndex: WadingIndex;
    private readonly uniforms: ReturnType<typeof WaterSurface.surfaceUniforms>;
    private needsImmersionUpdate = true;
    private readonly previousWaderPosition = new Vector3();
    private hasPreviousWaderPosition = false;
    private wader: IWaderTarget | null = null;

    constructor(
        private readonly context: IWorldContext,
        center: Vector3Tuple,
        courses: IWaterCourse[],
        landMap: LandMap
    ) {
        this.centerX = center[0];
        this.centerZ = center[2];

        const ribbons: IWaterRibbon[] = [];

        for (const course of courses) {
            const smoothed = WaterSurface.resampleCoursePoints(
                course.points,
                WATER_SURFACE.splineResampleStep
            );
            if (smoothed.length < 2) continue;
            const reach = WaterSurface.maximumHalfWidthOf(smoothed) + WATER_CHANNEL.shoreReach;
            const columnsPerSide = Math.max(Math.ceil(reach / WATER_SURFACE.lateralStep), 1);
            ribbons.push({ points: smoothed, columnsPerSide });
        }

        this.wadingIndex = new WadingIndex(ribbons);
        const geometry = WaterSurface.buildGeometry(ribbons, landMap);
        this.uniforms = WaterSurface.surfaceUniforms(context);
        this.material = new ShaderMaterial({
            vertexShader: WATER_VERTEX_SHADER,
            fragmentShader: WATER_FRAGMENT_SHADER,
            uniforms: {
                ...context.materialLibrary.styleUniforms,
                ...this.uniforms,
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });

        context.materialLibrary.track(this.material);

        this.sceneObject = new Mesh(geometry, this.material);
        this.sceneObject.position.set(center[0], 0, center[2]);
        this.sceneObject.renderOrder = 1;
        freezeTransform(this.sceneObject);
    }

    follow(target: Object3D, feetOffset: number): void {
        if (this.wader?.target !== target) {
            this.hasPreviousWaderPosition = false;
            this.uniforms.waderMotion.value = 0;
        }
        this.wader = { target, feetOffset };
        this.needsImmersionUpdate = true;
    }

    update(deltaSeconds: number): void {
        const wader = this.wader;
        if (!wader) return;

        const position = wader.target.getWorldPosition(this.uniforms.waderPosition.value);
        const previous = this.previousWaderPosition;
        const moved = !previous.equals(position);
        if (this.needsImmersionUpdate || moved) {
            this.uniforms.waderStrength.value = this.wadingIndex.immersionOf(
                position.x - this.centerX,
                position.z - this.centerZ,
                position.y - wader.feetOffset
            );
            this.needsImmersionUpdate = false;
        }

        const speed =
            moved && this.hasPreviousWaderPosition && deltaSeconds > 0
                ? horizontalDistance(previous, position) / deltaSeconds
                : 0;
        const targetMotion = Math.min(speed / WADING_RIPPLES.fullMotionSpeed, 1);
        this.uniforms.waderMotion.value = lerp(
            this.uniforms.waderMotion.value,
            targetMotion,
            Math.min(1, deltaSeconds * WADING_RIPPLES.motionResponse)
        );
        previous.copy(position);
        this.hasPreviousWaderPosition = true;
    }

    dispose(): void {
        this.sceneObject.geometry.dispose();
        this.context.materialLibrary.release(this.material);
    }
}

const columnCountOf = (columnsPerSide: number): number => columnsPerSide * 2 + 1;

const vertexCountOf = ({ points, columnsPerSide }: IWaterRibbon): number =>
    points.length * columnCountOf(columnsPerSide);
