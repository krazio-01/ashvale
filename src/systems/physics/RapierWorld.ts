import RAPIER from "@dimforge/rapier3d-compat";
import type {
    Collider,
    ColliderDesc,
    Ray,
    RigidBody,
    World as PhysicsWorld,
} from "@dimforge/rapier3d-compat";
import type { Vector3, Vector3Tuple } from "three";
import type { IModelTemplate, PropColliderShape } from "@/types/world";
import type {
    IQuaternion,
    ISurfaceHit,
    ITriangleMesh,
    IVector3,
    StaticCollider,
    StaticColliderShape,
} from "@/types/physics";
import { COLLISION_GROUPS, WORLD } from "@/constants/world";
import { COMBAT_MOVEMENT } from "@/constants/combat";
import { PHYSICS } from "@/constants/physics";
import { COLLIDER_SHAPE, STANDABLE } from "@/constants/placement";
import { FULL_TURN, GOLDEN_ANGLE, ascending, drain } from "@/lib/helpers";

const HULL_POINTS = new WeakMap<Pick<IModelTemplate, "parts">, Float32Array>();

const TRIANGLE_MESHES = new WeakMap<Pick<IModelTemplate, "parts">, ITriangleMesh>();

const COLLISION_MESHES = new WeakMap<Pick<IModelTemplate, "parts">, ITriangleMesh>();

const SOLIDITY = new WeakMap<Pick<IModelTemplate, "parts">, ISolidity>();

export function createStaticBody(physicsWorld: PhysicsWorld, center?: Vector3Tuple): RigidBody {
    const description = RAPIER.RigidBodyDesc.fixed();
    if (center) description.setTranslation(center[0], 0, center[2]);
    return physicsWorld.createRigidBody(description);
}

export function* addStaticColliderSteps(
    physicsWorld: PhysicsWorld,
    body: RigidBody,
    colliders: readonly StaticCollider[]
): Generator<void> {
    for (const collider of colliders) {
        const description = describeStaticShape(collider);
        if (!description) continue;
        physicsWorld.createCollider(
            description.setCollisionGroups(
                collider.wallRunnable ? COLLISION_GROUPS.wallRunnable : COLLISION_GROUPS.world
            ),
            body
        );
        yield;
    }
}

export function createStaticColliders(
    physicsWorld: PhysicsWorld,
    colliders: readonly StaticCollider[],
    center?: Vector3Tuple
): RigidBody {
    const body = createStaticBody(physicsWorld, center);

    try {
        drain(addStaticColliderSteps(physicsWorld, body, colliders));
    } catch (error) {
        physicsWorld.removeRigidBody(body);
        throw error;
    }

    return body;
}

export function templateBoxCollider(
    template: Pick<IModelTemplate, "halfExtents" | "centerOffset">,
    at: Vector3Tuple,
    yaw: number,
    scale: Vector3Tuple,
    wallRunnable: boolean
): StaticCollider | null {
    const [scaleX, scaleY, scaleZ] = scale;
    const halfExtents: Vector3Tuple = [
        template.halfExtents.x * scaleX,
        template.halfExtents.y * scaleY,
        template.halfExtents.z * scaleZ,
    ];
    if (!halfExtents.every((extent) => extent > 0)) return null;

    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const offsetX = template.centerOffset.x * scaleX;
    const offsetZ = template.centerOffset.z * scaleZ;

    return {
        kind: "cuboid",
        halfExtents,
        at: [
            at[0] + offsetX * cosYaw + offsetZ * sinYaw,
            at[1] + template.centerOffset.y * scaleY,
            at[2] - offsetX * sinYaw + offsetZ * cosYaw,
        ],
        yaw,
        wallRunnable,
    };
}

function templateHullCollider(
    template: Pick<IModelTemplate, "parts">,
    at: Vector3Tuple,
    yaw: number,
    scale: Vector3Tuple,
    wallRunnable: boolean
): StaticCollider | null {
    const hull = templateHullPoints(template);
    if (hull.length === 0) return null;
    return { kind: "hull", points: placedPoints(hull, at, yaw, scale), wallRunnable };
}

function templateMeshCollider(
    template: Pick<IModelTemplate, "parts">,
    at: Vector3Tuple,
    yaw: number,
    scale: Vector3Tuple,
    wallRunnable: boolean
): StaticCollider | null {
    const { positions, indices } = collisionTriangles(template);
    if (indices.length === 0) return null;
    return {
        kind: "trimesh",
        fixesInternalEdges: false,
        positions: placedPoints(positions, at, yaw, scale),
        indices,
        wallRunnable,
    };
}

export function templateShapeCollider(
    shape: PropColliderShape,
    template: Pick<IModelTemplate, "parts" | "halfExtents" | "centerOffset">,
    at: Vector3Tuple,
    yaw: number,
    scale: Vector3Tuple,
    wallRunnable: boolean
): StaticCollider | null {
    switch (shape) {
        case "hull":
            return templateHullCollider(template, at, yaw, scale, wallRunnable);
        case "trimesh":
            return templateMeshCollider(template, at, yaw, scale, wallRunnable);
        case "cuboid":
        case "cylinder":
            return templateBoxCollider(template, at, yaw, scale, wallRunnable);
    }
}

function placedPoints(
    local: Float32Array,
    at: Vector3Tuple,
    yaw: number,
    [scaleX, scaleY, scaleZ]: Vector3Tuple
): Float32Array {
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const points = new Float32Array(local.length);
    for (let index = 0; index < local.length; index += 3) {
        const x = local[index] * scaleX;
        const z = local[index + 2] * scaleZ;
        points[index] = at[0] + x * cosYaw + z * sinYaw;
        points[index + 1] = at[1] + local[index + 1] * scaleY;
        points[index + 2] = at[2] - x * sinYaw + z * cosYaw;
    }
    return points;
}

function templateTriangles(template: Pick<IModelTemplate, "parts">): ITriangleMesh {
    const cached = TRIANGLE_MESHES.get(template);
    if (cached) return cached;

    let vertexTotal = 0;
    let cornerTotal = 0;
    for (const { geometry } of template.parts) {
        const vertexCount = geometry.getAttribute("position").count;
        vertexTotal += vertexCount;
        cornerTotal += geometry.getIndex()?.count ?? vertexCount;
    }
    const positions = new Float32Array(vertexTotal * 3);
    const indices = new Uint32Array(cornerTotal);
    let vertexOffset = 0;
    let cornerOffset = 0;
    for (const { geometry } of template.parts) {
        const vertices = geometry.getAttribute("position");
        for (let vertex = 0; vertex < vertices.count; vertex += 1) {
            const write = (vertexOffset + vertex) * 3;
            positions[write] = vertices.getX(vertex);
            positions[write + 1] = vertices.getY(vertex);
            positions[write + 2] = vertices.getZ(vertex);
        }
        const index = geometry.getIndex();
        const count = index ? index.count : vertices.count;
        for (let corner = 0; corner < count; corner += 1)
            indices[cornerOffset + corner] = vertexOffset + (index ? index.getX(corner) : corner);
        vertexOffset += vertices.count;
        cornerOffset += count;
    }
    const mesh = { positions, indices };
    TRIANGLE_MESHES.set(template, mesh);
    return mesh;
}

function templateHullPoints(template: Pick<IModelTemplate, "parts">): Float32Array {
    const cached = HULL_POINTS.get(template);
    if (cached) return cached;

    const directions = PHYSICS.hullSupportDirections;
    const supports = new Float32Array(directions * 3);
    const reach = new Float32Array(directions).fill(-Infinity);
    const heights = new Float64Array(directions);
    const rings = new Float64Array(directions);
    const cosines = new Float64Array(directions);
    const sines = new Float64Array(directions);
    for (let index = 0; index < directions; index += 1) {
        const height = 1 - (2 * (index + 0.5)) / directions;
        const angle = index * GOLDEN_ANGLE;
        heights[index] = height;
        rings[index] = Math.sqrt(1 - height * height);
        cosines[index] = Math.cos(angle);
        sines[index] = Math.sin(angle);
    }
    for (const { geometry } of template.parts) {
        const positions = geometry.getAttribute("position");
        for (let vertex = 0; vertex < positions.count; vertex += 1) {
            const x = positions.getX(vertex);
            const y = positions.getY(vertex);
            const z = positions.getZ(vertex);
            for (let index = 0; index < directions; index += 1) {
                const along =
                    x * cosines[index] * rings[index] +
                    y * heights[index] +
                    z * sines[index] * rings[index];
                if (along <= reach[index]) continue;
                reach[index] = along;
                supports[index * 3] = x;
                supports[index * 3 + 1] = y;
                supports[index * 3 + 2] = z;
            }
        }
    }
    const points = reach[0] === -Infinity ? new Float32Array(0) : supports;
    HULL_POINTS.set(template, points);
    return points;
}

function collisionTriangles(template: Pick<IModelTemplate, "parts">): ITriangleMesh {
    const cached = COLLISION_MESHES.get(template);
    if (cached) return cached;

    const full = templateTriangles(template);
    let mesh = full;
    if (full.indices.length / 3 > COLLIDER_SHAPE.triangleBudget) {
        const bounds = boundsOf(full.positions);
        const longest = Math.max(
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2]
        );
        let cells = Math.ceil(Math.cbrt(COLLIDER_SHAPE.triangleBudget)) * 4;
        mesh = clusterTriangles(full, bounds.min, longest, cells);
        while (mesh.indices.length / 3 > COLLIDER_SHAPE.triangleBudget && cells > 2) {
            cells = Math.floor(cells * COLLIDER_SHAPE.decimationShrink);
            mesh = clusterTriangles(full, bounds.min, longest, cells);
        }
    }
    COLLISION_MESHES.set(template, mesh);
    return mesh;
}

function boundsOf(positions: Float32Array): { min: Vector3Tuple; max: Vector3Tuple } {
    const min: Vector3Tuple = [Infinity, Infinity, Infinity];
    const max: Vector3Tuple = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3)
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], positions[index + axis]);
            max[axis] = Math.max(max[axis], positions[index + axis]);
        }
    return { min, max };
}

function clusterTriangles(
    mesh: ITriangleMesh,
    origin: Vector3Tuple,
    longest: number,
    cells: number
): ITriangleMesh {
    const cell = longest / cells;
    const cellsPerAxis = cells + 1;
    const vertexCount = mesh.positions.length / 3;
    const clusterByCell = new Map<number, number>();
    const sums = new Float64Array(vertexCount * 3);
    const counts = new Uint32Array(vertexCount);
    const clusterOf = new Uint32Array(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const x = mesh.positions[vertex * 3];
        const y = mesh.positions[vertex * 3 + 1];
        const z = mesh.positions[vertex * 3 + 2];
        const key =
            Math.floor((x - origin[0]) / cell) +
            (Math.floor((y - origin[1]) / cell) +
                Math.floor((z - origin[2]) / cell) * cellsPerAxis) *
                cellsPerAxis;
        let cluster = clusterByCell.get(key);
        if (cluster === undefined) {
            cluster = clusterByCell.size;
            clusterByCell.set(key, cluster);
        }
        sums[cluster * 3] += x;
        sums[cluster * 3 + 1] += y;
        sums[cluster * 3 + 2] += z;
        counts[cluster] += 1;
        clusterOf[vertex] = cluster;
    }
    const clusterCount = clusterByCell.size;
    const positions = new Float32Array(clusterCount * 3);
    for (let cluster = 0; cluster < clusterCount; cluster += 1)
        for (let axis = 0; axis < 3; axis += 1)
            positions[cluster * 3 + axis] = sums[cluster * 3 + axis] / counts[cluster];
    const seen = new Set<string>();
    const indices = new Uint32Array(mesh.indices.length);
    let written = 0;
    for (let corner = 0; corner < mesh.indices.length; corner += 3) {
        const first = clusterOf[mesh.indices[corner]];
        const second = clusterOf[mesh.indices[corner + 1]];
        const third = clusterOf[mesh.indices[corner + 2]];
        if (first === second || second === third || first === third) continue;
        const low = Math.min(first, second, third);
        const high = Math.max(first, second, third);
        const key = `${low},${first + second + third - low - high},${high}`;
        if (seen.has(key)) continue;
        seen.add(key);
        indices[written] = first;
        indices[written + 1] = second;
        indices[written + 2] = third;
        written += 3;
    }
    return { positions, indices: indices.slice(0, written) };
}

interface ISolidity {
    boxFill: number;
    voidShare: number;
    voidMap: Float32Array;
    columns: number;
    cellX: number;
    cellZ: number;
}

function templateSolidity(
    template: Pick<IModelTemplate, "parts" | "halfExtents" | "centerOffset">
): ISolidity {
    const cached = SOLIDITY.get(template);
    if (cached) return cached;

    const { columns } = COLLIDER_SHAPE;
    const { positions, indices } = templateTriangles(template);
    const sizeX = template.halfExtents.x * 2;
    const sizeY = template.halfExtents.y * 2;
    const sizeZ = template.halfExtents.z * 2;
    const originX = template.centerOffset.x - template.halfExtents.x;
    const originZ = template.centerOffset.z - template.halfExtents.z;
    const originY = template.centerOffset.y - template.halfExtents.y;
    const columnOf = (value: number, origin: number, size: number): number =>
        Math.min(columns - 1, Math.max(0, Math.floor(((value - origin) / size) * columns)));
    const buckets: number[][] = Array.from({ length: columns * columns }, () => []);
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const first = indices[triangle] * 3;
        const second = indices[triangle + 1] * 3;
        const third = indices[triangle + 2] * 3;
        const firstX = positions[first];
        const secondX = positions[second];
        const thirdX = positions[third];
        const firstZ = positions[first + 2];
        const secondZ = positions[second + 2];
        const thirdZ = positions[third + 2];
        if ((secondZ - thirdZ) * (firstX - thirdX) + (thirdX - secondX) * (firstZ - thirdZ) === 0)
            continue;
        const lastColumn = columnOf(Math.max(firstX, secondX, thirdX), originX, sizeX);
        const firstRow = columnOf(Math.min(firstZ, secondZ, thirdZ), originZ, sizeZ);
        const lastRow = columnOf(Math.max(firstZ, secondZ, thirdZ), originZ, sizeZ);
        for (
            let column = columnOf(Math.min(firstX, secondX, thirdX), originX, sizeX);
            column <= lastColumn;
            column += 1
        )
            for (let row = firstRow; row <= lastRow; row += 1)
                buckets[row * columns + column].push(triangle);
    }

    let hullLength = 0;
    let solidLength = 0;
    const voidMap = new Float32Array(columns * columns).fill(-1);
    const hits: number[] = [];
    const distinctGap = sizeY * 1e-5;
    for (let row = 0; row < columns; row += 1)
        for (let column = 0; column < columns; column += 1) {
            const x = originX + ((column + 0.4137) / columns) * sizeX;
            const z = originZ + ((row + 0.5821) / columns) * sizeZ;
            hits.length = 0;
            for (const triangle of buckets[row * columns + column]) {
                const a = indices[triangle] * 3;
                const b = indices[triangle + 1] * 3;
                const c = indices[triangle + 2] * 3;
                const ax = positions[a];
                const ay = positions[a + 1];
                const az = positions[a + 2];
                const bx = positions[b];
                const by = positions[b + 1];
                const bz = positions[b + 2];
                const cx = positions[c];
                const cy = positions[c + 1];
                const cz = positions[c + 2];
                const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
                const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant;
                const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant;
                const w = 1 - u - v;
                if (u < 0 || v < 0 || w < 0) continue;
                hits.push(u * ay + v * by + w * cy);
            }
            if (hits.length === 0) continue;
            hits.sort(ascending);
            let distinctCount = 0;
            let previous = 0;
            for (let index = 0; index < hits.length; index += 1) {
                const hit = hits[index];
                if (index === 0 || hit - previous > distinctGap) {
                    hits[distinctCount] = hit;
                    distinctCount += 1;
                }
                previous = hit;
            }
            const startsBelow = distinctCount % 2 === 1;
            const columnHull = hits[distinctCount - 1] - originY;
            let columnSolid = startsBelow ? hits[0] - originY : 0;
            for (let index = startsBelow ? 1 : 0; index + 1 < distinctCount; index += 2)
                columnSolid += hits[index + 1] - hits[index];
            hullLength += columnHull;
            solidLength += columnSolid;
            voidMap[row * columns + column] = columnHull - columnSolid;
        }

    fillBoundedGaps(voidMap, columns, sizeY);
    const solidity: ISolidity = {
        boxFill: sizeY > 0 ? hullLength / (columns * columns * sizeY) : 0,
        voidShare: hullLength > 0 ? 1 - solidLength / hullLength : 0,
        voidMap,
        columns,
        cellX: sizeX / columns,
        cellZ: sizeZ / columns,
    };
    SOLIDITY.set(template, solidity);
    return solidity;
}

function fillBoundedGaps(voidMap: Float32Array, columns: number, fullHeight: number): void {
    const bounded = new Uint8Array(voidMap.length);
    for (const [step, lineStep] of [
        [1, columns],
        [columns, 1],
    ])
        for (let line = 0; line < columns; line += 1) {
            let lastSolid = -1;
            for (let cell = 0; cell < columns; cell += 1) {
                const index = line * lineStep + cell * step;
                if (voidMap[index] < 0) continue;
                if (lastSolid >= 0)
                    for (let gap = lastSolid + 1; gap < cell; gap += 1)
                        bounded[line * lineStep + gap * step] = 1;
                lastSolid = cell;
            }
        }
    for (let index = 0; index < voidMap.length; index += 1)
        if (voidMap[index] < 0 && bounded[index]) voidMap[index] = fullHeight;
}

function hasEnterableVoid(
    { voidMap, columns, cellX, cellZ }: ISolidity,
    [scaleX, scaleY, scaleZ]: Vector3Tuple
): boolean {
    const { enterableHeight, enterableWidth } = COLLIDER_SHAPE;
    for (const [step, lineStep, cellWidth] of [
        [1, columns, cellX * scaleX],
        [columns, 1, cellZ * scaleZ],
    ])
        for (let line = 0; line < columns; line += 1) {
            let run = 0;
            for (let cell = 0; cell < columns; cell += 1) {
                run =
                    voidMap[line * lineStep + cell * step] * scaleY >= enterableHeight
                        ? run + 1
                        : 0;
                if (run * cellWidth >= enterableWidth) return true;
            }
        }
    return false;
}

export function deriveColliderShape(
    template: Pick<IModelTemplate, "parts" | "halfExtents" | "centerOffset">,
    scale: Vector3Tuple
): PropColliderShape {
    const solidity = templateSolidity(template);
    if (solidity.voidShare >= COLLIDER_SHAPE.voidShareMin && hasEnterableVoid(solidity, scale))
        return "trimesh";
    return solidity.boxFill >= COLLIDER_SHAPE.boxFillMin ? "cuboid" : "hull";
}

export interface IBodySize {
    radius: number;
    height: number;
}

const STAND_RAY_DOWN = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const STAND_RAY_UP = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
const STAND_HIT: ISurfaceHit = {
    distance: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
    groups: 0,
};
const STAND_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const STAND_ORIGIN: IVector3 = { x: 0, y: 0, z: 0 };
const STAND_FEET: IVector3 = { x: 0, y: 0, z: 0 };
const STAND_CAPSULE = new RAPIER.Capsule(0, 0);

export function isStandable(
    physicsWorld: PhysicsWorld,
    feet: IVector3,
    { radius, height }: IBodySize
): boolean {
    STAND_ORIGIN.x = feet.x;
    STAND_ORIGIN.y = feet.y + STANDABLE.probeRise;
    STAND_ORIGIN.z = feet.z;
    const ground = castSurfaceRay(
        physicsWorld,
        STAND_RAY_DOWN,
        STAND_ORIGIN,
        WORLD.down,
        STANDABLE.probeRise + STANDABLE.groundReach,
        COLLISION_GROUPS.character,
        STAND_HIT
    );
    if (!ground || ground.normal.y < STANDABLE.minimumNormalY) return false;

    const groundY = ground.point.y;
    STAND_ORIGIN.y = groundY + STANDABLE.capsuleLift;
    const ceiling = castSurfaceRay(
        physicsWorld,
        STAND_RAY_UP,
        STAND_ORIGIN,
        WORLD.up,
        height,
        COLLISION_GROUPS.character,
        STAND_HIT,
        undefined,
        false
    );
    if (ceiling) return false;

    const halfSegment = Math.max(0, (height - 2 * radius) / 2);
    const lift = STANDABLE.capsuleLift + radius + halfSegment;
    STAND_ORIGIN.y = groundY + lift;
    STAND_CAPSULE.halfHeight = halfSegment;
    STAND_CAPSULE.radius = radius - STANDABLE.capsuleLift;
    return (
        physicsWorld.intersectionWithShape(
            STAND_ORIGIN,
            STAND_ROTATION,
            STAND_CAPSULE,
            undefined,
            COLLISION_GROUPS.character
        ) === null
    );
}

export function nearestStandable(
    physicsWorld: PhysicsWorld,
    feet: IVector3,
    body: IBodySize
): Vector3Tuple | null {
    const steps = Math.ceil(STANDABLE.maximumRadius / STANDABLE.ringStep);
    for (let step = 0; step <= steps; step += 1) {
        const ringRadius = step * STANDABLE.ringStep;
        const attempts =
            step === 0 ? 1 : Math.max(6, Math.ceil((FULL_TURN * ringRadius) / STANDABLE.ringStep));
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const angle = attempt * GOLDEN_ANGLE;
            const x = feet.x + Math.sin(angle) * ringRadius;
            const z = feet.z + Math.cos(angle) * ringRadius;
            STAND_ORIGIN.x = x;
            STAND_ORIGIN.y = feet.y + STANDABLE.searchRise;
            STAND_ORIGIN.z = z;
            const ground = castSurfaceRay(
                physicsWorld,
                STAND_RAY_DOWN,
                STAND_ORIGIN,
                WORLD.down,
                STANDABLE.searchRise * 4,
                COLLISION_GROUPS.character,
                STAND_HIT
            );
            if (!ground) continue;
            const groundY = ground.point.y;
            STAND_FEET.x = x;
            STAND_FEET.y = groundY;
            STAND_FEET.z = z;
            if (isStandable(physicsWorld, STAND_FEET, body)) return [x, groundY, z];
        }
    }
    return null;
}

function describeStaticShape(shape: StaticColliderShape): ColliderDesc | null {
    switch (shape.kind) {
        case "trimesh":
            return RAPIER.ColliderDesc.trimesh(
                shape.positions,
                shape.indices,
                shape.fixesInternalEdges ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined
            );
        case "cuboid":
            return RAPIER.ColliderDesc.cuboid(...shape.halfExtents)
                .setTranslation(...shape.at)
                .setRotation(yawQuaternion(shape.yaw));
        case "cylinder":
            return RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius).setTranslation(
                ...shape.at
            );
        case "hull":
            return RAPIER.ColliderDesc.convexHull(shape.points);
    }
}

export function isSegmentBlocked(
    physicsWorld: PhysicsWorld,
    ray: Ray,
    from: Vector3,
    to: Vector3,
    excludeCollider?: Collider
): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < COMBAT_MOVEMENT.minimumPlanarLength) return false;
    setRay(ray, from, dx, dy, dz, length);
    return (
        physicsWorld.castRay(
            ray,
            length,
            true,
            undefined,
            COLLISION_GROUPS.sightLine,
            excludeCollider
        ) !== null
    );
}

function setRay(
    ray: Ray,
    origin: IVector3,
    dx: number,
    dy: number,
    dz: number,
    length: number
): void {
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dx / length;
    ray.dir.y = dy / length;
    ray.dir.z = dz / length;
}

export function castSurfaceRay(
    physicsWorld: PhysicsWorld,
    ray: Ray,
    origin: IVector3,
    direction: IVector3,
    maxDistance: number,
    groups: number,
    hit: ISurfaceHit,
    exclude?: Collider,
    needsNormal = true
): ISurfaceHit | null {
    const length = Math.sqrt(
        direction.x * direction.x + direction.y * direction.y + direction.z * direction.z
    );
    if (length < COMBAT_MOVEMENT.minimumPlanarLength) return null;

    setRay(ray, origin, direction.x, direction.y, direction.z, length);

    const found = needsNormal
        ? physicsWorld.castRayAndGetNormal(ray, maxDistance, true, undefined, groups, exclude)
        : physicsWorld.castRay(ray, maxDistance, true, undefined, groups, exclude);
    if (!found) return null;

    hit.distance = found.timeOfImpact;
    hit.point.x = ray.origin.x + ray.dir.x * found.timeOfImpact;
    hit.point.y = ray.origin.y + ray.dir.y * found.timeOfImpact;
    hit.point.z = ray.origin.z + ray.dir.z * found.timeOfImpact;
    if ("normal" in found) {
        hit.normal.x = found.normal.x;
        hit.normal.y = found.normal.y;
        hit.normal.z = found.normal.z;
    } else {
        hit.normal.x = 0;
        hit.normal.y = 0;
        hit.normal.z = 0;
    }
    hit.groups = found.collider.collisionGroups();
    return hit;
}

export function isInLayer(groups: number, layer: number): boolean {
    return ((groups >>> 16) & layer) !== 0;
}

function yawQuaternion(yaw: number): IQuaternion {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
