import { PHYSICS } from "@/constants/physics";
import type { ParticleSolver } from "@/systems/physics/core/ParticleSolver";
import type {
    IPhysicsBinding,
    IPhysicsBodyDefinition,
    IPhysicsFeel,
    IVector3,
    PhysicsBodyKind,
} from "@/types/physics";

interface IBodyCounts {
    particles: number;
    links: number;
    tethers: number;
}

export abstract class PhysicsBody {
    protected firstParticle = 0;

    constructor(
        readonly definition: IPhysicsBodyDefinition,
        readonly index: number
    ) {}

    abstract readonly counts: IBodyCounts;
    abstract build(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract pinAnchors(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract resetToRest(solver: ParticleSolver, binding: IPhysicsBinding): void;
    abstract writeBack(solver: ParticleSolver, binding: IPhysicsBinding): void;

    protected get feel(): IPhysicsFeel {
        return { ...PHYSICS.kinds[this.definition.kind], ...this.definition.feel };
    }
}

const scratchAnchor: IVector3 = { x: 0, y: 0, z: 0 };
const scratchPosition: IVector3 = { x: 0, y: 0, z: 0 };
const scratchNeighbour: IVector3 = { x: 0, y: 0, z: 0 };
const scratchDown: IVector3 = { x: 0, y: 0, z: 0 };
const scratchAcross: IVector3 = { x: 0, y: 0, z: 0 };

class SheetBody extends PhysicsBody {
    readonly counts: IBodyCounts;

    constructor(definition: IPhysicsBodyDefinition, index: number) {
        super(definition, index);
        const { columns, rows, nodeBones, restOffsets, name } = definition;
        if (columns < 2 || rows < 2)
            throw new Error(`physics body ${name}: a sheet needs at least 2 columns and 2 rows`);
        if (nodeBones.length !== columns * rows || restOffsets.length !== columns * rows * 3)
            throw new Error(`physics body ${name}: node data does not match ${columns}x${rows}`);
        this.counts = {
            particles: columns * rows,
            links: rows * (columns - 1) + (rows - 1) * columns + this.bendLinkCount(),
            tethers: (rows - 1) * columns,
        };
    }

    build(solver: ParticleSolver, binding: IPhysicsBinding): void {
        const { columns, rows } = this.definition;
        const feel = this.feel;
        const unit = binding.unitScale(this.index);
        this.firstParticle = solver.particleCount;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                binding.anchorWorld(this.index, row * columns + column, scratchAnchor);
                solver.addParticle({
                    x: scratchAnchor.x,
                    y: scratchAnchor.y,
                    z: scratchAnchor.z,
                    inverseMass: row === 0 ? 0 : 1,
                    gravityScale: feel.gravityScale,
                    windExposure: feel.windExposure * (0.4 + (0.6 * row) / (rows - 1)),
                    damping: feel.damping,
                    impulseWeight: (feel.impulseScale * row) / (rows - 1),
                    friction: feel.contactFriction,
                });
            }
        }
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const node = row * columns + column;
                if (column + 1 < columns) this.link(solver, node, node + 1, unit, feel.stiffness);
                if (row + 1 < rows) this.link(solver, node, node + columns, unit, feel.stiffness);
                if (column + 2 < columns)
                    this.link(solver, node, node + 2, unit, feel.bendStiffness, false);
                if (row + 2 < rows)
                    this.link(solver, node, node + 2 * columns, unit, feel.bendStiffness, false);
                if (row > 0)
                    solver.addTether(
                        this.firstParticle + node,
                        this.firstParticle + column,
                        this.restDistance(column, node, unit) * (1 + feel.tetherSlack)
                    );
            }
        }
    }

    pinAnchors(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let column = 0; column < this.definition.columns; column++) {
            binding.anchorWorld(this.index, column, scratchAnchor);
            solver.setAnchor(
                this.firstParticle + column,
                scratchAnchor.x,
                scratchAnchor.y,
                scratchAnchor.z
            );
        }
    }

    resetToRest(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            binding.anchorWorld(this.index, node, scratchAnchor);
            solver.place(
                this.firstParticle + node,
                scratchAnchor.x,
                scratchAnchor.y,
                scratchAnchor.z
            );
        }
    }

    writeBack(solver: ParticleSolver, binding: IPhysicsBinding): void {
        const { columns, rows } = this.definition;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const node = row * columns + column;
                const below = row < rows - 1 ? node + columns : node;
                const above = row < rows - 1 ? node : node - columns;
                const right = column < columns - 1 ? node + 1 : node;
                const left = column < columns - 1 ? node : node - 1;
                solver.readPosition(this.firstParticle + node, scratchPosition);
                this.difference(solver, below, above, scratchDown);
                this.difference(solver, right, left, scratchAcross);
                binding.writeNode(this.index, node, scratchPosition, scratchDown, scratchAcross);
            }
        }
    }

    private difference(solver: ParticleSolver, to: number, from: number, out: IVector3): void {
        solver.readPosition(this.firstParticle + to, out);
        solver.readPosition(this.firstParticle + from, scratchNeighbour);
        out.x -= scratchNeighbour.x;
        out.y -= scratchNeighbour.y;
        out.z -= scratchNeighbour.z;
    }

    private link(
        solver: ParticleSolver,
        a: number,
        b: number,
        unit: number,
        stiffness: number,
        isStructural = true
    ): void {
        solver.addLink(
            this.firstParticle + a,
            this.firstParticle + b,
            this.restDistance(a, b, unit),
            stiffness,
            isStructural
        );
    }

    private restDistance(a: number, b: number, unit: number): number {
        const offsets = this.definition.restOffsets;
        const dx = offsets[a * 3] - offsets[b * 3];
        const dy = offsets[a * 3 + 1] - offsets[b * 3 + 1];
        const dz = offsets[a * 3 + 2] - offsets[b * 3 + 2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz) * unit;
    }

    private bendLinkCount(): number {
        const { columns, rows } = this.definition;
        return rows * Math.max(columns - 2, 0) + Math.max(rows - 2, 0) * columns;
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
