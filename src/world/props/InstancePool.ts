import {
    Camera,
    DirectionalLight,
    DynamicDrawUsage,
    Frustum,
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    Object3D,
    Sphere,
} from "three";
import type { IModelPart, IModelTemplate, IWorldEntity } from "@/types/world";
import { freezeTransform } from "@/lib/helpers";

const MATRIX_SIZE = 16;
const BOUNDS_STRIDE = 4;
const MIN_CAPACITY = 8;
const UNSET_SOURCE = 0xffffffff;
const NO_BOUNDS = new Float32Array(0);

const OUTSIDE = -1;
const INTERSECTING = 0;
const INSIDE = 1;

export interface IPoolRange {
    readonly entry: IPoolEntry;
    readonly matrices: Float32Array;
    readonly bounds: Float32Array;
    readonly sphere: Sphere;
    readonly start: number;
    visible: boolean;
}

interface IPoolEntry {
    readonly template: IModelTemplate;
    readonly castsShadow: boolean;
    readonly ranges: IPoolRange[];
    batches: IPoolBatch[];
    capacity: number;
    total: number;
    isDirty: boolean;
}

interface IPoolBatch {
    readonly meshes: PooledInstancedMesh[];
    readonly matrices: Float32Array;
    readonly sources: Uint32Array;
    count: number;
    firstChanged: number;
    lastChanged: number;
}

export class PooledInstancedMesh extends InstancedMesh {
    constructor(
        part: IModelPart,
        instanceMatrix: InstancedBufferAttribute,
        castsShadow: boolean,
        readonly entry: IPoolEntry
    ) {
        super(part.geometry, part.material, 0);
        this.instanceMatrix = instanceMatrix;
        this.count = instanceMatrix.count;
        this.receiveShadow = true;
        this.castShadow = castsShadow;
        this.frustumCulled = false;
        this.matrixAutoUpdate = false;
        this.matrixWorldAutoUpdate = false;
    }

    forEachRegisteredInstance(visit: (matrix: Float32Array) => void): void {
        for (const { matrices } of this.entry.ranges) {
            for (let offset = 0; offset < matrices.length; offset += MATRIX_SIZE) {
                visit(matrices.subarray(offset, offset + MATRIX_SIZE));
            }
        }
    }
}

export class InstancePool implements IWorldEntity {
    private static readonly frustum = new Frustum();
    private static readonly shadowFrustum = new Frustum();
    private static readonly viewProjection = new Matrix4();
    private static readonly instanceSphere = new Sphere();

    private static classifyBounds(
        planes: Frustum["planes"],
        x: number,
        y: number,
        z: number,
        radius: number
    ): number {
        if (radius < 0) return OUTSIDE;

        let fullyInside = true;
        for (let planeIndex = 0; planeIndex < 6; planeIndex += 1) {
            const plane = planes[planeIndex];
            const { normal } = plane;
            const distance = normal.x * x + normal.y * y + normal.z * z + plane.constant;
            if (distance < -radius) return OUTSIDE;
            if (distance < radius) fullyInside = false;
        }
        return fullyInside ? INSIDE : INTERSECTING;
    }

    private static classifySphere(frustum: Frustum, { center, radius }: Sphere): number {
        return InstancePool.classifyBounds(frustum.planes, center.x, center.y, center.z, radius);
    }

    private static intersectsBounds(
        planes: Frustum["planes"],
        bounds: Float32Array,
        offset: number
    ): boolean {
        return (
            InstancePool.classifyBounds(
                planes,
                bounds[offset],
                bounds[offset + 1],
                bounds[offset + 2],
                bounds[offset + 3]
            ) !== OUTSIDE
        );
    }

    private static measureBounds(
        template: IModelTemplate,
        matrices: Float32Array,
        enclosing: Sphere
    ): Float32Array {
        const count = matrices.length / MATRIX_SIZE;
        const bounds = new Float32Array(count * BOUNDS_STRIDE);
        const { centerOffset, halfExtents } = template;
        const centerX = centerOffset.x;
        const centerY = centerOffset.y;
        const centerZ = centerOffset.z;
        const halfX = halfExtents.x;
        const halfY = halfExtents.y;
        const halfZ = halfExtents.z;
        const { instanceSphere } = InstancePool;

        for (let instance = 0; instance < count; instance += 1) {
            const matrixOffset = instance * MATRIX_SIZE;
            const boundsOffset = instance * BOUNDS_STRIDE;

            const x =
                matrices[matrixOffset] * centerX +
                matrices[matrixOffset + 4] * centerY +
                matrices[matrixOffset + 8] * centerZ +
                matrices[matrixOffset + 12];
            const y =
                matrices[matrixOffset + 1] * centerX +
                matrices[matrixOffset + 5] * centerY +
                matrices[matrixOffset + 9] * centerZ +
                matrices[matrixOffset + 13];
            const z =
                matrices[matrixOffset + 2] * centerX +
                matrices[matrixOffset + 6] * centerY +
                matrices[matrixOffset + 10] * centerZ +
                matrices[matrixOffset + 14];

            const axisXX = matrices[matrixOffset] * halfX;
            const axisXY = matrices[matrixOffset + 1] * halfX;
            const axisXZ = matrices[matrixOffset + 2] * halfX;
            const axisYX = matrices[matrixOffset + 4] * halfY;
            const axisYY = matrices[matrixOffset + 5] * halfY;
            const axisYZ = matrices[matrixOffset + 6] * halfY;
            const axisZX = matrices[matrixOffset + 8] * halfZ;
            const axisZY = matrices[matrixOffset + 9] * halfZ;
            const axisZZ = matrices[matrixOffset + 10] * halfZ;

            const sumX = axisXX + axisYX;
            const sumY = axisXY + axisYY;
            const sumZ = axisXZ + axisYZ;
            const differenceX = axisXX - axisYX;
            const differenceY = axisXY - axisYY;
            const differenceZ = axisXZ - axisYZ;
            const radius = Math.sqrt(
                Math.max(
                    (sumX + axisZX) ** 2 + (sumY + axisZY) ** 2 + (sumZ + axisZZ) ** 2,
                    (sumX - axisZX) ** 2 + (sumY - axisZY) ** 2 + (sumZ - axisZZ) ** 2,
                    (differenceX + axisZX) ** 2 +
                        (differenceY + axisZY) ** 2 +
                        (differenceZ + axisZZ) ** 2,
                    (differenceX - axisZX) ** 2 +
                        (differenceY - axisZY) ** 2 +
                        (differenceZ - axisZZ) ** 2
                )
            );

            bounds[boundsOffset] = x;
            bounds[boundsOffset + 1] = y;
            bounds[boundsOffset + 2] = z;
            bounds[boundsOffset + 3] = radius;
            instanceSphere.center.set(
                bounds[boundsOffset],
                bounds[boundsOffset + 1],
                bounds[boundsOffset + 2]
            );
            instanceSphere.radius = bounds[boundsOffset + 3];
            enclosing.union(instanceSphere);
        }
        return bounds;
    }

    private static appendRun(
        batch: IPoolBatch,
        matrices: Float32Array,
        sourceStart: number,
        runStart: number,
        runEnd: number
    ): void {
        const length = runEnd - runStart;
        if (length === 0) return;

        const slot = batch.count;
        batch.count += length;
        const { sources } = batch;
        let unchanged = 0;
        while (
            unchanged < length &&
            sources[slot + unchanged] === sourceStart + runStart + unchanged
        ) {
            unchanged += 1;
        }
        if (unchanged === length) return;

        const firstChanged = slot + unchanged;
        batch.matrices.set(
            matrices.subarray((runStart + unchanged) * MATRIX_SIZE, runEnd * MATRIX_SIZE),
            firstChanged * MATRIX_SIZE
        );
        for (let i = unchanged; i < length; i += 1) {
            sources[slot + i] = sourceStart + runStart + i;
        }
        if (batch.firstChanged < 0) batch.firstChanged = firstChanged;
        batch.lastChanged = slot + length - 1;
    }

    readonly sceneObject = new Group();

    private readonly entries = new Map<IModelTemplate, Map<boolean, IPoolEntry>>();
    private readonly orderedEntries: IPoolEntry[] = [];
    private readonly lastCameraWorld = new Matrix4();
    private readonly lastProjection = new Matrix4();
    private hasNewEntries = false;
    private hasDirtyEntries = false;
    private hasShadowCasters = false;
    private shadowLight: DirectionalLight | null = null;

    constructor(
        name: string,
        private readonly camera: Camera,
        private readonly cullsEachInstance: boolean
    ) {
        this.sceneObject.name = name;
        freezeTransform(this.sceneObject);
    }

    register(template: IModelTemplate, matrices: Float32Array, castsShadow: boolean): IPoolRange {
        let byShadow = this.entries.get(template);
        if (!byShadow) {
            byShadow = new Map<boolean, IPoolEntry>();
            this.entries.set(template, byShadow);
        }
        let entry = byShadow.get(castsShadow);
        if (!entry) {
            entry = {
                template,
                castsShadow,
                ranges: [],
                batches: [],
                capacity: 0,
                total: 0,
                isDirty: false,
            };
            byShadow.set(castsShadow, entry);
            this.hasNewEntries = true;
        }

        const sphere = new Sphere();
        const range: IPoolRange = {
            entry,
            matrices,
            bounds: this.cullsEachInstance
                ? InstancePool.measureBounds(template, matrices, sphere)
                : NO_BOUNDS,
            sphere,
            start: entry.total,
            visible: false,
        };
        entry.ranges.push(range);
        entry.total += matrices.length / MATRIX_SIZE;
        entry.isDirty = true;
        this.hasDirtyEntries = true;
        if (castsShadow) this.hasShadowCasters = true;
        return range;
    }

    show(range: IPoolRange, visible: boolean): void {
        if (range.visible === visible) return;
        range.visible = visible;
        range.entry.isDirty = true;
        this.hasDirtyEntries = true;
    }

    syncToCamera(): void {
        const { camera, cullsEachInstance } = this;
        const hasCameraMoved =
            cullsEachInstance &&
            (!this.lastCameraWorld.equals(camera.matrixWorld) ||
                !this.lastProjection.equals(camera.projectionMatrix));
        if (!hasCameraMoved && !this.hasDirtyEntries) return;
        this.hasDirtyEntries = false;

        if (this.hasNewEntries) {
            this.hasNewEntries = false;
            this.orderedEntries.length = 0;
            for (const byShadow of this.entries.values()) {
                for (const entry of byShadow.values()) this.orderedEntries.push(entry);
            }
        }

        let castsShadows = false;
        if (cullsEachInstance) {
            this.lastCameraWorld.copy(camera.matrixWorld);
            this.lastProjection.copy(camera.projectionMatrix);
            InstancePool.viewProjection.multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse
            );
            InstancePool.frustum.setFromProjectionMatrix(InstancePool.viewProjection);
            if (this.hasShadowCasters) castsShadows = this.updateShadowFrustum();
        }

        for (const entry of this.orderedEntries) {
            if (!cullsEachInstance && !entry.isDirty) continue;
            entry.isDirty = false;
            this.repack(entry, castsShadows);
        }
    }

    dispose(): void {
        for (const byShadow of this.entries.values()) {
            for (const entry of byShadow.values()) {
                for (const batch of entry.batches) {
                    for (const mesh of batch.meshes) mesh.dispose();
                }
            }
        }
        this.entries.clear();
        this.orderedEntries.length = 0;
        this.sceneObject.clear();
        this.hasNewEntries = false;
        this.hasDirtyEntries = false;
        this.hasShadowCasters = false;
        this.shadowLight = null;
    }

    private ensureCapacity(entry: IPoolEntry): void {
        const { total } = entry;
        if (entry.capacity >= total) return;

        for (const batch of entry.batches) {
            for (const mesh of batch.meshes) {
                this.sceneObject.remove(mesh);
                mesh.dispose();
            }
        }
        const capacity = Math.max(total, entry.capacity ? entry.capacity * 2 : MIN_CAPACITY);
        entry.capacity = capacity;
        const batchShadows =
            entry.castsShadow && this.cullsEachInstance ? [true, false] : [entry.castsShadow];
        entry.batches = batchShadows.map((castsShadow) => {
            const matrices = new Float32Array(capacity * MATRIX_SIZE);
            const instanceMatrix = new InstancedBufferAttribute(matrices, MATRIX_SIZE);
            instanceMatrix.setUsage(DynamicDrawUsage);
            const meshes = entry.template.parts.map((part) => {
                const mesh = new PooledInstancedMesh(part, instanceMatrix, castsShadow, entry);
                this.sceneObject.add(mesh);
                return mesh;
            });
            return {
                meshes,
                matrices,
                sources: new Uint32Array(capacity).fill(UNSET_SOURCE),
                count: 0,
                firstChanged: -1,
                lastChanged: -1,
            };
        });
    }

    private updateShadowFrustum(): boolean {
        if (!this.shadowLight?.parent) {
            this.shadowLight = null;
            let root: Object3D = this.sceneObject;
            while (root.parent) root = root.parent;
            root.traverse((object) => {
                if (!(object instanceof DirectionalLight)) return;
                if (!this.shadowLight || (object.castShadow && !this.shadowLight.castShadow)) {
                    this.shadowLight = object;
                }
            });
        }
        const light = this.shadowLight;
        if (!light?.castShadow) return false;

        light.updateMatrixWorld();
        light.shadow.updateMatrices(light);
        const shadowCamera = light.shadow.camera;
        InstancePool.viewProjection.multiplyMatrices(
            shadowCamera.projectionMatrix,
            shadowCamera.matrixWorldInverse
        );
        InstancePool.shadowFrustum.setFromProjectionMatrix(InstancePool.viewProjection);
        return true;
    }

    private repack(entry: IPoolEntry, castsShadows: boolean): void {
        if (entry.total === 0) return;
        this.ensureCapacity(entry);

        const { frustum, shadowFrustum } = InstancePool;
        const { batches, ranges } = entry;
        const viewBatch = batches[batches.length - 1];
        const casterBatch = batches.length > 1 ? batches[0] : viewBatch;
        const testsShadow = castsShadows && entry.castsShadow;
        const viewPlanes = frustum.planes;
        const shadowPlanes = shadowFrustum.planes;

        for (const batch of batches) {
            batch.count = 0;
            batch.firstChanged = -1;
            batch.lastChanged = -1;
        }

        for (const range of ranges) {
            if (!range.visible) continue;
            const { matrices, bounds, sphere, start } = range;
            const instanceCount = matrices.length / MATRIX_SIZE;
            if (instanceCount === 0) continue;

            if (!this.cullsEachInstance) {
                InstancePool.appendRun(viewBatch, matrices, start, 0, instanceCount);
                continue;
            }

            const viewState = InstancePool.classifySphere(frustum, sphere);
            const shadowState = testsShadow
                ? InstancePool.classifySphere(shadowFrustum, sphere)
                : OUTSIDE;
            if (viewState === OUTSIDE && shadowState === OUTSIDE) continue;

            if (shadowState === INSIDE) {
                InstancePool.appendRun(casterBatch, matrices, start, 0, instanceCount);
                continue;
            }
            if (shadowState === OUTSIDE && viewState === INSIDE) {
                InstancePool.appendRun(viewBatch, matrices, start, 0, instanceCount);
                continue;
            }

            let currentBatch: IPoolBatch | null = null;
            let runStart = 0;
            for (let i = 0; i < instanceCount; i += 1) {
                const offset = i * BOUNDS_STRIDE;
                const inShadow =
                    shadowState === INSIDE ||
                    (shadowState === INTERSECTING &&
                        InstancePool.intersectsBounds(shadowPlanes, bounds, offset));
                const batch = inShadow
                    ? casterBatch
                    : viewState === INSIDE ||
                        (viewState === INTERSECTING &&
                            InstancePool.intersectsBounds(viewPlanes, bounds, offset))
                      ? viewBatch
                      : null;

                if (batch === currentBatch) continue;
                if (currentBatch) {
                    InstancePool.appendRun(currentBatch, matrices, start, runStart, i);
                }
                currentBatch = batch;
                runStart = i;
            }
            if (currentBatch) {
                InstancePool.appendRun(currentBatch, matrices, start, runStart, instanceCount);
            }
        }

        for (const batch of batches) {
            const firstMesh = batch.meshes[0];
            if (!firstMesh) continue;
            if (batch.firstChanged >= 0) {
                firstMesh.instanceMatrix.addUpdateRange(
                    batch.firstChanged * MATRIX_SIZE,
                    (batch.lastChanged - batch.firstChanged + 1) * MATRIX_SIZE
                );
                firstMesh.instanceMatrix.needsUpdate = true;
            }
            for (const mesh of batch.meshes) {
                mesh.count = batch.count;
                mesh.visible = batch.count > 0;
            }
        }
    }
}
