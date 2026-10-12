import { Vector3 } from "three";
import { PHYSICS } from "@/constants/physics";
import type { LinkKind, ParticleSolver } from "@/systems/physics/core/ParticleSolver";
import type {
    IClothFeel,
    IPhysicsBinding,
    IPhysicsBodyDefinition,
    PhysicsBodyKind,
} from "@/types/physics";

interface IBodyCounts {
    particles: number;
    stretchLinks: number;
    bendLinks: number;
    tethers: number;
}

const LINK_SPANS: readonly { kind: LinkKind; span: number; alongRow: boolean }[] = [
    { kind: "stretch", span: 1, alongRow: false },
    { kind: "stretch", span: 1, alongRow: true },
    { kind: "bend", span: 2, alongRow: false },
    { kind: "bend", span: 2, alongRow: true },
];

const scratchFrom = new Vector3();

export function sheetTangents(
    { columns, rows }: { columns: number; rows: number },
    node: number,
    points: Float64Array,
    firstPoint: number,
    down: Vector3,
    across: Vector3
): void {
    const row = Math.floor(node / columns);
    const column = node % columns;
    const below = row < rows - 1 ? node + columns : node;
    const above = row < rows - 1 ? node : node - columns;
    const right = column < columns - 1 ? node + 1 : node;
    const left = column < columns - 1 ? node : node - 1;
    down.fromArray(points, (firstPoint + below) * 3).sub(
        scratchFrom.fromArray(points, (firstPoint + above) * 3)
    );
    across
        .fromArray(points, (firstPoint + right) * 3)
        .sub(scratchFrom.fromArray(points, (firstPoint + left) * 3));
}

export abstract class PhysicsBody {
    readonly feel: IClothFeel = { ...PHYSICS.cloth };
    protected firstParticle = 0;

    constructor(
        readonly definition: IPhysicsBodyDefinition,
        readonly index: number
    ) {
        this.refreshFeel();
    }

    abstract readonly counts: IBodyCounts;
    abstract build(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract followHomes(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract resetToRest(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract writeBack(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract writeAnimated(binding: IPhysicsBinding): void;

    refreshFeel(): void {
        Object.assign(this.feel, PHYSICS.cloth, this.definition.feel);
    }
}

const scratchHome = new Vector3();
const scratchNormal = new Vector3();
const scratchPosition = new Vector3();
const scratchDown = new Vector3();
const scratchAcross = new Vector3();

class SheetBody extends PhysicsBody {
    readonly counts: IBodyCounts;

    constructor(definition: IPhysicsBodyDefinition, index: number) {
        super(definition, index);
        const { columns, rows, name, pinned, nearestPin, geodesicDistance } = definition;
        const nodes = columns * rows;
        if (columns < 2 || rows < 2)
            throw new Error(`physics body ${name}: a sheet needs at least 2 columns and 2 rows`);
        const perNode = [definition.nodeBones, pinned, nearestPin, geodesicDistance];
        if (
            perNode.some((values) => values.length !== nodes) ||
            definition.restPositions.length !== nodes * 3 ||
            definition.restNormals.length !== nodes * 3 ||
            definition.skinBones.length !== nodes * 4 ||
            definition.skinWeights.length !== nodes * 4
        )
            throw new Error(`physics body ${name}: node data does not match ${columns}x${rows}`);
        nearestPin.forEach((pin, node) => {
            if (!pinned[node] && !(pinned[pin] && Number.isFinite(geodesicDistance[node])))
                throw new Error(`physics body ${name}: node ${node} has no pinned anchor`);
        });
        this.counts = {
            particles: nodes,
            stretchLinks: rows * (columns - 1) + (rows - 1) * columns,
            bendLinks: rows * Math.max(columns - 2, 0) + Math.max(rows - 2, 0) * columns,
            tethers: pinned.filter((isPinned) => !isPinned).length,
        };
    }

    build(solver: ParticleSolver, binding: IPhysicsBinding): void {
        const unit = binding.unitScale(this.index);
        const body = solver.addBody(this.feel);
        this.firstParticle = solver.particleCount;
        this.addParticles(solver, binding, body);
        this.addLinks(solver, body, unit);
        this.addTethers(solver, unit);
    }

    followHomes(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            binding.homeWorld(this.index, node, scratchHome, scratchNormal);
            solver.setHome(this.firstParticle + node, scratchHome, scratchNormal);
        }
    }

    resetToRest(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            binding.homeWorld(this.index, node, scratchHome, scratchNormal);
            solver.place(this.firstParticle + node, scratchHome);
            solver.setHome(this.firstParticle + node, scratchHome, scratchNormal);
        }
    }

    writeBack(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            solver.readPosition(this.firstParticle + node, scratchPosition);
            sheetTangents(
                this.definition,
                node,
                solver.position,
                this.firstParticle,
                scratchDown,
                scratchAcross
            );
            binding.writeNode(this.index, node, scratchPosition, scratchDown, scratchAcross);
        }
    }

    writeAnimated(binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++)
            binding.writeAnimatedNode(this.index, node);
    }

    private addParticles(solver: ParticleSolver, binding: IPhysicsBinding, body: number): void {
        const { pinned, geodesicDistance } = this.definition;
        const longest = Math.max(...geodesicDistance);
        for (let node = 0; node < this.counts.particles; node++) {
            binding.homeWorld(this.index, node, scratchHome, scratchNormal);
            solver.addParticle({
                x: scratchHome.x,
                y: scratchHome.y,
                z: scratchHome.z,
                body,
                pinned: pinned[node],
                leashShare: longest > 0 ? geodesicDistance[node] / longest : 0,
            });
            solver.setHome(this.firstParticle + node, scratchHome, scratchNormal);
        }
    }

    private addLinks(solver: ParticleSolver, body: number, unit: number): void {
        const { columns, rows } = this.definition;
        for (let row = 0; row < rows; row++)
            for (let column = 0; column < columns; column++) {
                const node = row * columns + column;
                for (const { kind, span, alongRow } of LINK_SPANS) {
                    if ((alongRow ? row : column) + span >= (alongRow ? rows : columns)) continue;
                    const partner = node + (alongRow ? span * columns : span);
                    solver.addLink(
                        kind,
                        this.firstParticle + node,
                        this.firstParticle + partner,
                        this.restDistance(node, partner, unit),
                        body
                    );
                }
            }
    }

    private addTethers(solver: ParticleSolver, unit: number): void {
        const { pinned, nearestPin, geodesicDistance } = this.definition;
        for (let node = 0; node < this.counts.particles; node++)
            if (!pinned[node])
                solver.addTether(
                    this.firstParticle + node,
                    this.firstParticle + nearestPin[node],
                    geodesicDistance[node] * unit
                );
    }

    private restDistance(a: number, b: number, unit: number): number {
        const rest = this.definition.restPositions;
        return (
            Math.hypot(
                rest[a * 3] - rest[b * 3],
                rest[a * 3 + 1] - rest[b * 3 + 1],
                rest[a * 3 + 2] - rest[b * 3 + 2]
            ) * unit
        );
    }
}

export const PHYSICS_BODY_KINDS: Record<
    PhysicsBodyKind,
    new (definition: IPhysicsBodyDefinition, index: number) => PhysicsBody
> = { sheet: SheetBody };

export function createPhysicsBody(definition: IPhysicsBodyDefinition, index: number): PhysicsBody {
    const kind = PHYSICS_BODY_KINDS[definition.kind];
    if (!kind) throw new Error(`physics body ${definition.name}: unknown kind ${definition.kind}`);
    return new kind(definition, index);
}
